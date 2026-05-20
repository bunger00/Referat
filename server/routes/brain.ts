import type { Express } from "express";
import multer from "multer";
import { requireAuth, getUserId } from "../auth";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import {
  ingestText,
  ingestLesson,
  ingestMeetingSummary,
  ingestMeetingTranscript,
  ingestRule,
  isIngested,
} from "../lib/knowledge";
import { answerWithBrain } from "../lib/brain-chat";
import { parseUploadedFile, UnsupportedFileTypeError } from "../lib/file-parsers";
import { chatMessageSchema } from "@shared/schema";
import { z } from "zod";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

const chatRequestSchema = z.object({
  messages: z.array(chatMessageSchema).min(1),
});

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
   * Multipart-skjema med en fil. Parser PDF/Word/Excel/bilde/tekst til
   * tekst og ingester til knowledge_chunks for /hjernen-chat.
   */
  app.post("/api/brain/upload", requireAuth, upload.single("file"), async (req, res) => {
    const userId = getUserId(req);
    try {
      if (!req.file) return res.status(400).json({ error: "Ingen fil mottatt" });
      const { originalname, mimetype, buffer } = req.file;
      const { text, sourceTypeHint } = await parseUploadedFile({
        buffer,
        mimeType: mimetype,
        filename: originalname,
      });
      if (!text.trim()) {
        return res.status(400).json({ error: "Klarte ikke å hente ut tekst fra filen." });
      }
      const result = await ingestText({
        userId,
        sourceType: sourceTypeHint,
        sourceId: null,
        sourceName: originalname,
        text,
        metadata: { mimeType: mimetype, uploadedAt: new Date().toISOString() },
      });
      res.json({ ok: true, chunks: result.chunks, filename: originalname });
    } catch (error: any) {
      if (error instanceof UnsupportedFileTypeError) {
        return res.status(400).json({ error: error.message });
      }
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
