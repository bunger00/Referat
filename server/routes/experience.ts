import type { Express } from "express";
import { requireAuth, getUserId } from "../auth";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { extractLessons } from "../lib/lesson-extractor";
import { ingestText } from "../lib/knowledge";

const ALLOWED_UPDATE_FIELDS = [
  "title",
  "elapsedSeconds",
  "transcript",
  "speakerMappings",
  "userNotes",
  "endedAt",
  "lessonsExtractedAt",
] as const;

export function registerExperienceRoutes(app: Express) {
  // GET liste
  app.get("/api/experience/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessions = await storage.getExperienceSessions(userId);
      res.json({ sessions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET én økt
  app.get("/api/experience/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      const lessons = await storage.getLessonsForSession(userId, id);
      res.json({ session, lessons });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST opprett
  app.post("/api/experience/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const session = await storage.createExperienceSession(userId, {
        title: req.body.title || null,
        elapsedSeconds: 0,
        transcript: [],
        speakerMappings: {},
        userNotes: req.body.userNotes ?? null,
        endedAt: null,
        lessonsExtractedAt: null,
      });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH oppdater
  app.patch("/api/experience/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const updates: Record<string, unknown> = {};
      for (const key of ALLOWED_UPDATE_FIELDS) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const session = await storage.updateExperienceSession(userId, id, updates);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE
  app.delete("/api/experience/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      // Slett tilhørende lærdommer først (knowledge_chunks blir liggende
      // med foreldreløs sourceId — det er ok, de blir filtrert ut når brukeren
      // navigerer eller backfill kjøres på nytt).
      const lessons = await storage.getLessonsForSession(userId, id);
      for (const lesson of lessons) {
        await storage.deleteLesson(userId, lesson.id);
      }
      const ok = await storage.deleteExperienceSession(userId, id);
      res.json({ ok });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * POST /api/experience/sessions/:id/extract
   *
   * Kjør AI-ekstraksjon av lærdommer fra et fullført erfaringsmøte.
   * Returnerer foreslåtte lærdommer som klienten viser i et godkjenningskort.
   * Lærdommene blir IKKE lagret ennå — klient ringer POST /api/lessons
   * for hver godkjent lærdom.
   */
  app.post("/api/experience/sessions/:id/extract", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });

      const proposals = await extractLessons({
        userId,
        transcript: session.transcript ?? [],
        userNotes: session.userNotes,
        meetingTitle: session.title,
      });

      // Ingester rå-transkriptet i RAG-hjernen samtidig (best-effort).
      // Selv før brukeren har godkjent lærdommene er det verdi i å ha selve
      // samtalen som retrieval-grunnlag.
      const transcriptText = (session.transcript ?? [])
        .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
        .join("\n");
      if (transcriptText.trim()) {
        try {
          await ingestText({
            userId,
            sourceType: "experience_transcript",
            sourceId: session.id,
            sourceName: session.title ?? `Erfaringsmøte ${session.id}`,
            text: transcriptText,
            metadata: { startedAt: session.startedAt.toISOString() },
          });
        } catch (err: any) {
          logger.warn({ err: err.message }, "Transcript ingest failed (non-fatal)");
        }
      }

      await storage.updateExperienceSession(userId, id, {
        lessonsExtractedAt: new Date(),
      });

      res.json({ proposals });
    } catch (error: any) {
      logger.error({ err: error.message }, "Lesson extraction failed");
      res.status(500).json({ error: error.message });
    }
  });
}
