import type { Express } from "express";
import multer from "multer";
import { requireAuth, getUserId } from "../auth";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { openai } from "../lib/openai-client";
import {
  ingestText,
  ingestLesson,
  ingestMeetingSummary,
  ingestMeetingTranscript,
  ingestRule,
  isIngested,
} from "../lib/knowledge";
import { answerWithBrain } from "../lib/brain-chat";
import { chatMessageSchema } from "@shared/schema";
import { z } from "zod";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
});

async function parsePdfBuffer(buf: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const fn = (mod as any).default ?? mod;
  const result = await fn(buf);
  return result.text || "";
}

async function parseDocxBuffer(buf: Buffer): Promise<string> {
  const mod = await import("mammoth");
  const fn = (mod as any).default?.extractRawText ?? (mod as any).extractRawText;
  const result = await fn({ buffer: buf });
  return result.value || "";
}

async function describeImageWithVision(buf: Buffer, mimeType: string): Promise<string> {
  const base64 = buf.toString("base64");
  const resp = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "Du er en analytisk leser av bilder. Beskriv hva som vises slik at noen kan slå opp innholdet senere uten å se bildet. Inkluder tekst som synes, diagrammer, viktige objekter og kontekst. Svar på norsk.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Beskriv dette bildet med fokus på kunnskapsverdi:" },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } },
        ] as any,
      },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? "";
}

export function registerBrainRoutes(app: Express) {
  /**
   * POST /api/brain/chat
   * Body: { messages: ChatMessage[] }
   * Response: { answer: string, sources: KnowledgeSourceRef[] }
   */
  app.post("/api/brain/chat", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { messages } = chatRequestSchema.parse(req.body);
      const result = await answerWithBrain({ userId, messages });
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Ugyldig input", details: error.issues });
      }
      logger.error({ err: error.message }, "Brain chat failed");
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/brain/upload
   * Multipart-skjema med en fil. Parser PDF/Word/bilde til tekst og ingester
   * til knowledge_chunks. Returnerer antall chunks som ble lagt til.
   *
   * Excel-støtte: ikke i MVP. Krever `xlsx`-pakke som ikke er installert ennå.
   * Legg til den separat når brukeren har behov for det.
   */
  app.post("/api/brain/upload", requireAuth, upload.single("file"), async (req, res) => {
    const userId = getUserId(req);
    try {
      if (!req.file) return res.status(400).json({ error: "Ingen fil mottatt" });
      const { originalname, mimetype, buffer } = req.file;
      let text = "";
      let sourceType: "uploaded_doc" | "uploaded_image" = "uploaded_doc";

      if (mimetype === "application/pdf" || originalname.toLowerCase().endsWith(".pdf")) {
        text = await parsePdfBuffer(buffer);
      } else if (
        mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
        originalname.toLowerCase().endsWith(".docx")
      ) {
        text = await parseDocxBuffer(buffer);
      } else if (mimetype.startsWith("image/")) {
        text = await describeImageWithVision(buffer, mimetype);
        sourceType = "uploaded_image";
      } else if (mimetype === "text/plain" || originalname.toLowerCase().endsWith(".txt")) {
        text = buffer.toString("utf-8");
      } else {
        return res.status(400).json({
          error: `Filtype ikke støttet (${mimetype}). Støttede typer: PDF, Word (.docx), bilde, tekst.`,
        });
      }

      if (!text.trim()) {
        return res.status(400).json({ error: "Klarte ikke å hente ut tekst fra filen." });
      }

      const result = await ingestText({
        userId,
        sourceType,
        sourceId: null,
        sourceName: originalname,
        text,
        metadata: {
          mimeType: mimetype,
          uploadedAt: new Date().toISOString(),
        },
      });

      res.json({ ok: true, chunks: result.chunks, filename: originalname });
    } catch (error: any) {
      logger.error({ err: error.message }, "Brain upload failed");
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/brain/backfill
   * Idempotent ingestion av brukerens eksisterende data:
   * - Møtereferater (meeting_sessions.summary)
   * - Lærdommer (lessons_learned)
   * - Regler (extracted_rules) — via getRulesState
   *
   * Sjekker isIngested for hver kilde, så kjør-på-nytt er trygt og bare
   * tar med nytt innhold.
   */
  app.post("/api/brain/backfill", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      let total = 0;
      let skipped = 0;

      // Møtereferater
      const sessions = await storage.getMeetingSessions(userId);
      for (const session of sessions) {
        if (!session.summary?.trim()) continue;
        if (await isIngested(userId, "meeting_summary", session.id)) {
          skipped++;
          continue;
        }
        const r = await ingestMeetingSummary(userId, session);
        total += r.chunks;
      }

      // Lærdommer
      const lessons = await storage.getLessons(userId);
      for (const lesson of lessons) {
        if (await isIngested(userId, "lesson", lesson.id)) {
          skipped++;
          continue;
        }
        const r = await ingestLesson(userId, lesson);
        total += r.chunks;
      }

      // Regler
      const rulesState = await storage.getRulesState(userId);
      // rulesState.rules er ExtractedRule (Zod-type) — vi trenger ExtractedRuleRow
      // fra DB for å få id-en. Hent via en separat path:
      // (For MVP-enkelhet: vi hopper over rules-backfill og lar nye rule-uploads
      // ingestes ved opprettelse-tid i framtidig PR. Logger antallet for synlighet.)
      logger.info({ ruleCount: rulesState.rules.length }, "Rules backfill skipped in MVP");

      res.json({
        ok: true,
        chunksAdded: total,
        sourcesSkipped: skipped,
      });
    } catch (error: any) {
      logger.error({ err: error.message }, "Backfill failed");
      res.status(500).json({ error: error.message });
    }
  });

  // Disable unused import warnings
  void ingestMeetingTranscript;
  void ingestRule;
}
