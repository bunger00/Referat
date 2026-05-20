import type { Express } from "express";
import { requireAuth, getUserId } from "../auth";
import { storage } from "../storage";
import { ingestLesson } from "../lib/knowledge";
import { logger } from "../lib/logger";
import { lessonTypeSchema, lessonStatusSchema } from "@shared/schema";
import { z } from "zod";

const createSchema = z.object({
  sessionId: z.number().nullable().optional(),
  title: z.string().min(1).max(255),
  problem: z.string().min(1),
  solution: z.string().min(1),
  context: z.string().optional().nullable(),
  type: lessonTypeSchema,
  status: lessonStatusSchema.optional().default("open"),
  tags: z.array(z.string()).optional().default([]),
  relatedScreenshotIds: z.array(z.number()).optional().default([]),
  relatedDocumentIds: z.array(z.number()).optional().default([]),
});

const updateSchema = createSchema.partial();

export function registerLessonsRoutes(app: Express) {
  // GET liste
  app.get("/api/lessons", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const lessons = await storage.getLessons(userId);
      res.json({ lessons });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST opprett — også embedder direkte til knowledge_chunks
  app.post("/api/lessons", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const data = createSchema.parse(req.body);
      const lesson = await storage.createLesson(userId, {
        sessionId: data.sessionId ?? null,
        title: data.title,
        problem: data.problem,
        solution: data.solution,
        context: data.context ?? null,
        type: data.type,
        status: data.status,
        tags: data.tags,
        relatedScreenshotIds: data.relatedScreenshotIds,
        relatedDocumentIds: data.relatedDocumentIds,
      });
      // Best-effort: ingest til RAG-hjernen. Hvis dette feiler, lærdommen er
      // fortsatt lagret og kan ingestes manuelt senere via backfill.
      try {
        await ingestLesson(userId, lesson);
      } catch (err: any) {
        logger.warn({ err: err.message, lessonId: lesson.id }, "Lesson ingest failed (non-fatal)");
      }
      res.json({ lesson });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Ugyldig input", details: error.issues });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH oppdater — re-embed til knowledge_chunks
  app.patch("/api/lessons/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const data = updateSchema.parse(req.body);
      const lesson = await storage.updateLesson(userId, id, data);
      if (!lesson) return res.status(404).json({ error: "Ikke funnet" });
      // Re-embed siden innholdet kan ha endret seg
      try {
        await ingestLesson(userId, lesson);
      } catch (err: any) {
        logger.warn({ err: err.message, lessonId: id }, "Lesson re-ingest failed (non-fatal)");
      }
      res.json({ lesson });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Ugyldig input", details: error.issues });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE
  app.delete("/api/lessons/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const ok = await storage.deleteLesson(userId, id);
      res.json({ ok });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });
}
