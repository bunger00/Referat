import type { Express } from "express";
import multer from "multer";
import { requireAuth, getUserId } from "../auth";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { extractLessons } from "../lib/lesson-extractor";
import { ingestText, searchKnowledge } from "../lib/knowledge";
import { parseUploadedFile, UnsupportedFileTypeError } from "../lib/file-parsers";
import { trackedChatCompletion } from "../lib/ai-tracker";
import { z } from "zod";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

const ALLOWED_UPDATE_FIELDS = [
  "title",
  "seriesId",
  "topic",
  "language",
  "elapsedSeconds",
  "transcript",
  "speakerMappings",
  "userNotes",
  "endedAt",
  "lessonsExtractedAt",
] as const;

const createSeriesSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional().nullable(),
});

export function registerExperienceRoutes(app: Express) {
  // ============= Sessions =============

  app.get("/api/experience/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessions = await storage.getExperienceSessions(userId);
      res.json({ sessions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.get("/api/experience/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      const [lessons, attachments] = await Promise.all([
        storage.getLessonsForSession(userId, id),
        storage.getExperienceAttachments(userId, id),
      ]);

      // Hvis sesjonen er del av en serie, send med åpne lærdommer fra
      // SØSTRE-sesjoner (samme serie, ikke denne) slik at klienten kan vise
      // "Fra forrige gang"-panel.
      let openSeriesLessons: typeof lessons = [];
      if (session.seriesId) {
        const seriesLessons = await storage.getLessonsInSeries(userId, session.seriesId);
        openSeriesLessons = seriesLessons.filter(
          (l) => l.sessionId !== id && (l.status === "open" || l.status === "in_progress"),
        );
      }

      res.json({ session, lessons, attachments, openSeriesLessons });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/experience/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const session = await storage.createExperienceSession(userId, {
        title: req.body.title || null,
        seriesId: req.body.seriesId ?? null,
        topic: req.body.topic ?? null,
        language: req.body.language ?? "no",
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

  app.delete("/api/experience/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
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

  // ============= Series =============

  app.get("/api/experience/series", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const series = await storage.getExperienceSeries(userId);
      res.json({ series });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/experience/series", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const data = createSeriesSchema.parse(req.body);
      const series = await storage.createExperienceSeries(userId, {
        name: data.name,
        description: data.description ?? null,
      });
      res.json({ series });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Ugyldig input", details: error.issues });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.patch("/api/experience/series/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const updates = createSeriesSchema.partial().parse(req.body);
      const series = await storage.updateExperienceSeries(userId, id, updates);
      if (!series) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ series });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Ugyldig input", details: error.issues });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.delete("/api/experience/series/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const ok = await storage.deleteExperienceSeries(userId, id);
      res.json({ ok });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============= Attachments =============

  app.get("/api/experience/sessions/:id/attachments", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessionId = parseInt(req.params.id, 10);
      if (isNaN(sessionId)) return res.status(400).json({ error: "Ugyldig ID" });
      const attachments = await storage.getExperienceAttachments(userId, sessionId);
      res.json({ attachments });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Last opp et dokument som vedlegg på en sesjon. Parser teksten med en
   * gang og lagrer den; filen kastes. Embedder ogsa innholdet til hjernen
   * slik at det blir søkbart i /hjernen-chat.
   */
  app.post(
    "/api/experience/sessions/:id/attachments",
    requireAuth,
    upload.single("file"),
    async (req, res) => {
      const userId = getUserId(req);
      try {
        const sessionId = parseInt(req.params.id, 10);
        if (isNaN(sessionId)) return res.status(400).json({ error: "Ugyldig ID" });
        const session = await storage.getExperienceSession(userId, sessionId);
        if (!session) return res.status(404).json({ error: "Sesjon ikke funnet" });
        if (!req.file) return res.status(400).json({ error: "Ingen fil mottatt" });

        const { originalname, mimetype, buffer, size } = req.file;
        const { text } = await parseUploadedFile({
          buffer,
          mimeType: mimetype,
          filename: originalname,
        });
        if (!text.trim()) {
          return res.status(400).json({ error: "Klarte ikke å hente ut tekst fra filen." });
        }

        const attachment = await storage.createExperienceAttachment(userId, {
          sessionId,
          filename: originalname,
          mimeType: mimetype,
          extractedText: text,
          bytes: size,
        });

        // Embed til hjernen (best-effort). sourceName inkluderer møtetittel
        // slik at brukere kan se hvor dokumentet kom fra.
        try {
          await ingestText({
            userId,
            sourceType: "uploaded_doc",
            sourceId: attachment.id,
            sourceName: `${originalname} (fra ${session.title || `møte ${sessionId}`})`,
            text,
            metadata: {
              mimeType: mimetype,
              experienceSessionId: sessionId,
              uploadedAt: new Date().toISOString(),
            },
          });
        } catch (err: any) {
          logger.warn({ err: err.message }, "Attachment ingest failed (non-fatal)");
        }

        res.json({ attachment });
      } catch (error: any) {
        if (error instanceof UnsupportedFileTypeError) {
          return res.status(400).json({ error: error.message });
        }
        logger.error({ err: error.message }, "Attachment upload failed");
        res.status(500).json({ error: error.message });
      }
    },
  );

  app.delete("/api/experience/attachments/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const ok = await storage.deleteExperienceAttachment(userId, id);
      res.json({ ok });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============= Visual-check =============

  app.post("/api/experience/visual-check", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const { text } = z.object({ text: z.string().min(1).max(2000) }).parse(req.body);
      const resp = (await trackedChatCompletion(
        { endpoint: "/api/experience/visual-check", userId },
        {
          model: "gpt-5",
          messages: [
            {
              role: "system",
              content:
                "Du er en klassifierer. Svar KUN med JSON `{\"visual\": true}` eller `{\"visual\": false}`. true hvis teksten refererer til noe visuelt (skjerm, diagram, tegning, tabell, bilde, dokument vist) som lytteren ser akkurat nå.",
            },
            { role: "user", content: text },
          ],
          response_format: { type: "json_object" },
        },
      )) as any;
      const raw = resp.choices?.[0]?.message?.content ?? "{}";
      let parsed = { visual: false };
      try { parsed = JSON.parse(raw); } catch { /* keep default */ }
      res.json({ visual: !!parsed.visual });
    } catch (error: any) {
      logger.warn({ err: error.message }, "Visual-check failed");
      res.json({ visual: false });
    }
  });

  // ============= Extract =============

  /**
   * Kjør AI-ekstraksjon med all tilgjengelig kontekst:
   * - Sesjonens transkript
   * - Vedlagte dokumenter
   * - Åpne lærdommer fra samme serie (for oppfølgings-koblinger)
   * - RAG-treff i hjernen basert på møtetittel + transkript-ekstrakt
   * - Serie-metadata (navn + beskrivelse)
   */
  app.post("/api/experience/sessions/:id/extract", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });

      // Samle kontekst i parallell
      const [attachments, seriesRow, openLessons] = await Promise.all([
        storage.getExperienceAttachments(userId, id),
        session.seriesId ? storage.getExperienceSeriesById(userId, session.seriesId) : Promise.resolve(undefined),
        session.seriesId
          ? storage.getLessonsInSeries(userId, session.seriesId).then((all) =>
              all.filter(
                (l) => l.sessionId !== id && (l.status === "open" || l.status === "in_progress"),
              ),
            )
          : Promise.resolve([] as any[]),
      ]);

      // Hent relevant tidligere kunnskap via RAG. Bruk møtetittel + første
      // 1000 tegn av transkriptet som spørringen — dette gir oss treff på
      // dokumenter og lærdommer som AI burde ha med som kontekst.
      const transcriptForSearch = (session.transcript ?? [])
        .map((s) => s.text)
        .join(" ")
        .slice(0, 1000);
      const ragQuery = [session.title, transcriptForSearch].filter(Boolean).join(" ");
      let priorKnowledge: Array<{ sourceName: string; content: string }> = [];
      if (ragQuery.trim().length > 0) {
        try {
          const hits = await searchKnowledge(userId, ragQuery, { topK: 5, minSimilarity: 0.35 });
          // Filtrer ut treff som peker tilbake på denne sesjonen selv
          priorKnowledge = hits
            .filter((h) => {
              if (h.chunk.sourceType === "experience_transcript" && h.chunk.sourceId === id) return false;
              return true;
            })
            .map((h) => ({ sourceName: h.chunk.sourceName, content: h.chunk.content }));
        } catch (err: any) {
          logger.warn({ err: err.message }, "RAG context fetch failed (non-fatal)");
        }
      }

      const proposals = await extractLessons({
        userId,
        transcript: session.transcript ?? [],
        userNotes: session.userNotes,
        meetingTitle: session.title,
        topic: session.topic,
        context: {
          attachments,
          openLessonsInSeries: openLessons,
          priorKnowledge,
          seriesName: seriesRow?.name ?? null,
          seriesDescription: seriesRow?.description ?? null,
        },
      });

      // Ingester rå-transkriptet i RAG-hjernen samtidig (best-effort)
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

      res.json({ proposals, contextUsed: {
        attachmentsCount: attachments.length,
        openLessonsCount: openLessons.length,
        priorKnowledgeCount: priorKnowledge.length,
      } });
    } catch (error: any) {
      logger.error({ err: error.message }, "Lesson extraction failed");
      res.status(500).json({ error: error.message });
    }
  });
}
