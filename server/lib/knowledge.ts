import { and, desc, eq, sql } from "drizzle-orm";
import { cosineDistance } from "drizzle-orm/sql/functions/vector";
import { db } from "../db";
import {
  knowledgeChunks,
  type KnowledgeChunk,
  type KnowledgeSourceType,
  type LessonLearned,
  type MeetingSession,
  type ExtractedRuleRow,
} from "@shared/schema";
import { chunkText, embed, embedBatch } from "./embeddings";
import { logger } from "./logger";

/**
 * Slett alle eksisterende chunks for en (sourceType, sourceId)-kombinasjon.
 * Brukes før re-ingestion slik at vi ikke får duplikater.
 */
async function deleteSourceChunks(
  userId: string,
  sourceType: KnowledgeSourceType,
  sourceId: number | null,
) {
  const whereClause = sourceId === null
    ? and(
        eq(knowledgeChunks.userId, userId),
        eq(knowledgeChunks.sourceType, sourceType),
        sql`${knowledgeChunks.sourceId} IS NULL`,
      )
    : and(
        eq(knowledgeChunks.userId, userId),
        eq(knowledgeChunks.sourceType, sourceType),
        eq(knowledgeChunks.sourceId, sourceId),
      );
  await db.delete(knowledgeChunks).where(whereClause);
}

/**
 * Lavnivå-ingestion: tar en tekst, chunker den, embedder hver chunk, og
 * skriver til knowledge_chunks. Idempotent: sletter eksisterende chunks for
 * (sourceType, sourceId) før insert.
 */
export async function ingestText(args: {
  userId: string;
  sourceType: KnowledgeSourceType;
  sourceId: number | null;
  sourceName: string;
  text: string;
  metadata?: Record<string, unknown>;
  chunkOptions?: { windowWords?: number; overlapWords?: number };
}) {
  const { userId, sourceType, sourceId, sourceName, text, metadata, chunkOptions } = args;
  if (!text.trim()) return { chunks: 0 };

  const chunks = chunkText(text, chunkOptions);
  if (chunks.length === 0) return { chunks: 0 };

  const embeddings = await embedBatch(chunks, userId);

  await deleteSourceChunks(userId, sourceType, sourceId);
  await db.insert(knowledgeChunks).values(
    chunks.map((content, idx) => ({
      userId,
      sourceType,
      sourceId,
      sourceName,
      content,
      embedding: embeddings[idx],
      metadata: { ...(metadata ?? {}), chunkIndex: idx, totalChunks: chunks.length },
    })),
  );

  return { chunks: chunks.length };
}

// ============= Domene-spesifikke wrappers =============

export async function ingestLesson(userId: string, lesson: LessonLearned) {
  // Lærdommer er typisk korte nok til å gå inn som én chunk. Vi
  // bygger en sammensatt tekst som dekker problem, løsning og kontekst slik
  // at semantisk søk treffer på hvilken som helst del.
  const text = [
    `Tittel: ${lesson.title}`,
    `Problem: ${lesson.problem}`,
    `Løsning: ${lesson.solution}`,
    lesson.context ? `Kontekst: ${lesson.context}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  return ingestText({
    userId,
    sourceType: "lesson",
    sourceId: lesson.id,
    sourceName: lesson.title,
    text,
    metadata: {
      type: lesson.type,
      tags: lesson.tags ?? [],
      sessionId: lesson.sessionId,
      createdAt: lesson.createdAt.toISOString(),
    },
    // Lærdommer skal ikke chunkes — én rad per lærdom for ren retrieval
    chunkOptions: { windowWords: 10_000, overlapWords: 0 },
  });
}

export async function ingestMeetingSummary(userId: string, session: MeetingSession) {
  if (!session.summary?.trim()) return { chunks: 0 };
  return ingestText({
    userId,
    sourceType: "meeting_summary",
    sourceId: session.id,
    sourceName: session.title ?? `Møte ${session.id}`,
    text: session.summary,
    metadata: {
      seriesId: session.seriesId,
      seriesName: session.seriesName,
      startedAt: session.startedAt.toISOString(),
    },
  });
}

export async function ingestMeetingTranscript(userId: string, session: MeetingSession) {
  const segments = session.transcript ?? [];
  if (segments.length === 0) return { chunks: 0 };
  const text = segments
    .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join("\n");
  return ingestText({
    userId,
    sourceType: "meeting_transcript",
    sourceId: session.id,
    sourceName: session.title ?? `Møte ${session.id}`,
    text,
    metadata: {
      seriesId: session.seriesId,
      startedAt: session.startedAt.toISOString(),
    },
  });
}

export async function ingestRule(userId: string, rule: ExtractedRuleRow) {
  const text = [
    `Regel: ${rule.ruleTitle}`,
    `Seksjon: ${rule.section}`,
    `Tekst: ${rule.ruleText}`,
    `Sammendrag: ${rule.summary}`,
  ].join("\n\n");
  return ingestText({
    userId,
    sourceType: "rule",
    sourceId: rule.id,
    sourceName: `${rule.documentName} — ${rule.ruleTitle}`,
    text,
    metadata: {
      documentId: rule.documentId,
      documentName: rule.documentName,
      tags: rule.tags ?? [],
    },
    chunkOptions: { windowWords: 10_000, overlapWords: 0 },
  });
}

// ============= Søk =============

export interface KnowledgeSearchHit {
  chunk: KnowledgeChunk;
  similarity: number;
}

/**
 * Cosine similarity-søk i brukerens knowledge_chunks. Returnerer top-K
 * chunks sortert etter avtagende likhet.
 *
 * `cosineDistance` i pgvector returnerer 1 - cosine_similarity, så likheten
 * er `1 - distance`. Vi rangerer på distance (ASC) og oversetter til
 * similarity i output for lesbarhet.
 */
export async function searchKnowledge(
  userId: string,
  query: string,
  opts: { topK?: number; minSimilarity?: number } = {},
): Promise<KnowledgeSearchHit[]> {
  const topK = opts.topK ?? 8;
  const minSimilarity = opts.minSimilarity ?? 0;

  const queryEmbedding = await embed(query, userId);
  const distanceExpr = cosineDistance(knowledgeChunks.embedding, queryEmbedding);

  const rows = await db
    .select({
      chunk: knowledgeChunks,
      distance: sql<number>`${distanceExpr}`.as("distance"),
    })
    .from(knowledgeChunks)
    .where(eq(knowledgeChunks.userId, userId))
    .orderBy(sql`distance ASC`)
    .limit(topK);

  return rows
    .map((r) => ({ chunk: r.chunk, similarity: 1 - r.distance }))
    .filter((hit) => hit.similarity >= minSimilarity);
}

/**
 * Sjekk om en kilde allerede er ingestet (for idempotent backfill).
 */
export async function isIngested(
  userId: string,
  sourceType: KnowledgeSourceType,
  sourceId: number,
): Promise<boolean> {
  const [row] = await db
    .select({ id: knowledgeChunks.id })
    .from(knowledgeChunks)
    .where(
      and(
        eq(knowledgeChunks.userId, userId),
        eq(knowledgeChunks.sourceType, sourceType),
        eq(knowledgeChunks.sourceId, sourceId),
      ),
    )
    .limit(1);
  return !!row;
}

/**
 * Logg-utility for ingestion-pipelines. Returnerer summary av hva som ble
 * gjort uten å throw — kalleren kan beslutte om delvis suksess er ok.
 */
export function logIngestResult(
  context: string,
  result: { chunks: number },
  err?: unknown,
) {
  if (err) {
    logger.warn({ context, err: (err as Error)?.message }, "Ingest failed");
  } else {
    logger.info({ context, chunks: result.chunks }, "Ingest ok");
  }
}

// Eksporter også re-importen for andre moduler
export { desc };
