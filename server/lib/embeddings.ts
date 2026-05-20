import { openai } from "./openai-client";
import { logger } from "./logger";
import { db } from "../db";
import { aiUsageLog } from "@shared/schema";

const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIM = 1536;

// $0.02 per 1M tokens for text-embedding-3-small (per OpenAI 2025-prising)
const PRICE_USD_PER_MTOKEN = 0.02;

/**
 * Embed én tekstbit. For batch-bruk, foretrekk `embedBatch` — én OpenAI-
 * forespørsel med 100 tekster er ~10x raskere enn 100 enkelt-kall.
 */
export async function embed(text: string, userId: string | null): Promise<number[]> {
  const [vec] = await embedBatch([text], userId);
  return vec;
}

/**
 * Embed en batch tekster i én OpenAI-forespørsel. Returnerer vektorer i
 * samme rekkefølge som input.
 *
 * OpenAI tar inntil 2048 inputs per kall og 8192 tokens per input. Vi
 * splitter på 100 av gangen for å holde request-størrelsen håndterbar og
 * unngå at én stor batch må retries i sin helhet ved transient feil.
 */
export async function embedBatch(
  texts: string[],
  userId: string | null,
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const BATCH_SIZE = 100;
  const out: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const resp = await openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunk,
    });
    for (const item of resp.data) {
      out.push(item.embedding as number[]);
    }
    // Best-effort usage-log; aldri block bruker-flyten på dette.
    void logEmbeddingUsage(userId, resp.usage?.prompt_tokens ?? 0);
  }

  return out;
}

async function logEmbeddingUsage(userId: string | null, tokens: number) {
  if (tokens === 0) return;
  try {
    const costMicrocents = Math.round((tokens * PRICE_USD_PER_MTOKEN * 100_000) / 1_000_000);
    await db.insert(aiUsageLog).values({
      userId,
      endpoint: "/api/embeddings",
      model: EMBEDDING_MODEL,
      promptTokens: tokens,
      completionTokens: 0,
      totalTokens: tokens,
      costMicrocents,
    } as any);
  } catch (err: any) {
    logger.warn({ err: err?.message }, "Embedding usage log failed (non-fatal)");
  }
}

/**
 * Splitter lang tekst i overlappende vinduer av ord. Brukes for transkripter
 * og lange dokumenter slik at hver chunk er liten nok til å embedde og
 * fortsatt holder semantisk koherens med naboene gjennom overlap.
 *
 * `windowWords=500, overlapWords=50` er empirisk en god start for norsk
 * tekst med moderate setninger.
 */
export function chunkText(
  text: string,
  opts: { windowWords?: number; overlapWords?: number } = {},
): string[] {
  const windowWords = opts.windowWords ?? 500;
  const overlapWords = opts.overlapWords ?? 50;
  const stride = windowWords - overlapWords;
  if (stride <= 0) throw new Error("overlapWords må være mindre enn windowWords");

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  if (words.length <= windowWords) return [text.trim()];

  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += stride) {
    const slice = words.slice(i, i + windowWords).join(" ");
    if (slice.trim().length > 0) chunks.push(slice);
    if (i + windowWords >= words.length) break;
  }
  return chunks;
}

export { EMBEDDING_DIM, EMBEDDING_MODEL };
