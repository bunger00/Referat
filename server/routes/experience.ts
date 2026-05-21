import type { Express } from "express";
import multer from "multer";
import { requireAuth, getUserId } from "../auth";
import { storage } from "../storage";
import { logger } from "../lib/logger";
import { extractLessons } from "../lib/lesson-extractor";
import { ingestText, searchKnowledge } from "../lib/knowledge";
import { parseUploadedFile, UnsupportedFileTypeError } from "../lib/file-parsers";
import { trackedChatCompletion } from "../lib/ai-tracker";
import { buildExperiencePptx } from "../lib/pptx-summary";
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
        const parsed = await parseUploadedFile({
          buffer,
          mimeType: mimetype,
          filename: originalname,
        });
        if (!parsed.text.trim()) {
          return res.status(400).json({ error: "Klarte ikke å hente ut tekst fra filen." });
        }

        // For bilder lagrer vi den (HEIC-konverterte) bytene som base64 så
        // brukeren kan se selve bildet senere — ikke bare AI-tolkningen.
        const imageData = parsed.imageBuffer ? parsed.imageBuffer.toString("base64") : null;
        const storedMime = parsed.imageMimeType ?? mimetype;
        const attachment = await storage.createExperienceAttachment(userId, {
          sessionId,
          filename: originalname,
          mimeType: storedMime,
          extractedText: parsed.text,
          bytes: size,
          imageData,
        });

        // Embed til hjernen (best-effort). sourceName inkluderer møtetittel
        // slik at brukere kan se hvor dokumentet kom fra.
        try {
          await ingestText({
            userId,
            sourceType: "uploaded_doc",
            sourceId: attachment.id,
            sourceName: `${originalname} (fra ${session.title || `møte ${sessionId}`})`,
            text: parsed.text,
            metadata: {
              mimeType: storedMime,
              experienceSessionId: sessionId,
              uploadedAt: new Date().toISOString(),
            },
          });
        } catch (err: any) {
          logger.warn({ err: err.message }, "Attachment ingest failed (non-fatal)");
        }

        // Returner uten den tunge imageData-feltet — klienten henter den
        // separat via /attachments/:id/image når den faktisk trengs.
        const { imageData: _unused, ...attachmentLight } = attachment;
        void _unused;
        res.json({ attachment: attachmentLight });
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

  /**
   * Hent rå-bildet for et bilde-vedlegg. Sender base64-dekodet binær med
   * riktig Content-Type så <img>-tagger kan referere endepunktet direkte
   * (med Authorization-header via authFetch + blob URL i frontend).
   * Returnerer 404 om vedlegget ikke er et bilde / ikke har lagrede bytes.
   */
  app.get("/api/experience/attachments/:id/image", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const att = await storage.getExperienceAttachment(userId, id);
      if (!att || !att.imageData) return res.status(404).json({ error: "Bilde ikke funnet" });
      const buf = Buffer.from(att.imageData, "base64");
      res.setHeader("Content-Type", att.mimeType);
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ============= QR-paret opplastings-tokens =============

  /**
   * Generer en engangs-token som brukeren kan dele med en mobil-enhet
   * (via QR-kode) for å laste opp filer rett til denne sesjonen uten å
   * logge inn på telefonen. Tokenet utløper etter 1 time.
   */
  app.post("/api/experience/sessions/:id/upload-token", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessionId = parseInt(req.params.id, 10);
      if (isNaN(sessionId)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, sessionId);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      const tokenRow = await storage.createExperienceUploadToken(userId, sessionId);
      res.json({
        token: tokenRow.token,
        expiresAt: tokenRow.expiresAt,
      });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Last opp fil via engangs-token (ingen auth-header — tokenet selv er
   * authoriteten). Tokens er tilfeldige 64-tegns strings med 1t utløp.
   * Brukes av mobil-siden som scannet QR-koden.
   */
  app.post("/api/upload-via-token/:token", upload.single("file"), async (req, res) => {
    try {
      const token = req.params.token;
      const tokenRow = await storage.lookupExperienceUploadToken(token);
      if (!tokenRow) return res.status(401).json({ error: "Ugyldig eller utløpt token" });
      const session = await storage.getExperienceSession(tokenRow.userId, tokenRow.sessionId);
      if (!session) return res.status(404).json({ error: "Sesjon ikke funnet" });
      if (!req.file) return res.status(400).json({ error: "Ingen fil mottatt" });

      const { originalname, mimetype, buffer, size } = req.file;
      const parsed = await parseUploadedFile({
        buffer,
        mimeType: mimetype,
        filename: originalname,
      });
      if (!parsed.text.trim()) {
        return res.status(400).json({ error: "Klarte ikke å hente ut tekst fra filen." });
      }

      const imageData = parsed.imageBuffer ? parsed.imageBuffer.toString("base64") : null;
      const storedMime = parsed.imageMimeType ?? mimetype;
      const attachment = await storage.createExperienceAttachment(tokenRow.userId, {
        sessionId: tokenRow.sessionId,
        filename: originalname,
        mimeType: storedMime,
        extractedText: parsed.text,
        bytes: size,
        imageData,
      });

      // Best-effort: embed til hjernen
      try {
        await ingestText({
          userId: tokenRow.userId,
          sourceType: "uploaded_doc",
          sourceId: attachment.id,
          sourceName: `${originalname} (fra ${session.title || `møte ${session.id}`})`,
          text: parsed.text,
          metadata: {
            mimeType: storedMime,
            experienceSessionId: session.id,
            uploadedAt: new Date().toISOString(),
            viaMobileToken: true,
          },
        });
      } catch (err: any) {
        logger.warn({ err: err.message }, "Mobile token attachment ingest failed (non-fatal)");
      }

      res.json({ ok: true, filename: originalname });
    } catch (error: any) {
      if (error instanceof UnsupportedFileTypeError) {
        return res.status(400).json({ error: error.message });
      }
      logger.error({ err: error.message }, "Token upload failed");
      res.status(500).json({ error: error.message });
    }
  });

  /**
   * Info-endepunkt for mobil-siden — viser sesjons-tittel etter token-
   * validering, slik at brukeren kan bekrefte at de laster opp til rett sted.
   */
  app.get("/api/upload-via-token/:token/info", async (req, res) => {
    try {
      const token = req.params.token;
      const tokenRow = await storage.lookupExperienceUploadToken(token);
      if (!tokenRow) return res.status(401).json({ error: "Ugyldig eller utløpt token" });
      const session = await storage.getExperienceSession(tokenRow.userId, tokenRow.sessionId);
      if (!session) return res.status(404).json({ error: "Sesjon ikke funnet" });
      res.json({
        sessionTitle: session.title,
        expiresAt: tokenRow.expiresAt,
      });
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

  /**
   * Eksporter en én-sides PowerPoint-oppsummering av sesjonen med Lean
   * Communications-merkevarestiling og AI-genererte illustrasjoner fra
   * Lean Image Generator. Synchront: AI-summary tar 10-30s, hver
   * illustrasjon ~30s — totalt 60-90 sek for typisk respons.
   */
  app.post("/api/experience/sessions/:id/export-pptx", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getExperienceSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });

      // Valideres mykt — feil verdier faller tilbake til standard.
      const bodySchema = z.object({
        slideCount: z.union([z.literal(3), z.literal(5), z.literal(8)]).optional(),
        imageFrequency: z.enum(["every", "alternate"]).optional(),
      });
      const opts = bodySchema.parse(req.body ?? {});

      const lessons = await storage.getLessonsForSession(userId, id);
      const { buffer, filename, illustratorStats } = await buildExperiencePptx({
        userId,
        transcript: session.transcript ?? [],
        lessons,
        meetingTitle: session.title,
        topic: session.topic,
        startedAt: session.startedAt,
        slideCount: opts.slideCount ?? 5,
        imageFrequency: opts.imageFrequency ?? "every",
      });

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      );
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      // Diagnostiske headers så klienten kan vise advarsel hvis illustrator
      // feilet — Access-Control-Expose-Headers gjør at fetch() i nettleseren
      // får tilgang til dem (Express setter ikke same-origin-blokk for disse).
      res.setHeader("X-Illustrator-Attempted", String(illustratorStats.attempted));
      res.setHeader("X-Illustrator-Succeeded", String(illustratorStats.succeeded));
      if (illustratorStats.firstError) {
        // Header-verdier må være ASCII — kapp og strip non-ASCII
        const safe = illustratorStats.firstError.replace(/[^\x20-\x7E]/g, "?").slice(0, 200);
        res.setHeader("X-Illustrator-Error", safe);
      }
      res.setHeader(
        "Access-Control-Expose-Headers",
        "X-Illustrator-Attempted, X-Illustrator-Succeeded, X-Illustrator-Error, Content-Disposition",
      );
      res.send(buffer);
    } catch (error: any) {
      logger.error({ err: error.message }, "PPTX export failed");
      res.status(500).json({ error: error.message });
    }
  });
}
