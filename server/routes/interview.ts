import type { Express } from "express";
import { requireAuth, getUserId } from "../auth";
import { storage } from "../storage";
import { openai } from "../lib/openai-client";
import { logger } from "../lib/logger";
import type {
  TranscriptSegment,
  InterviewScores,
  StarStatus,
  InterviewEvalSnapshot,
  InterviewReport,
} from "@shared/schema";

export function registerInterviewRoutes(app: Express) {
  // GET liste
  app.get("/api/interview/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const sessions = await storage.getInterviewSessions(userId);
      res.json({ sessions });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // GET én økt
  app.get("/api/interview/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const session = await storage.getInterviewSession(userId, id);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST opprett
  app.post("/api/interview/sessions", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const session = await storage.createInterviewSession(userId, {
        title: req.body.title || null,
        industry: req.body.industry || "bygg",
        elapsedSeconds: 0,
        transcript: [],
        currentScores: null,
        currentStar: null,
        evalHistory: [],
        report: null,
        endedAt: null,
      });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // PATCH oppdater
  app.patch("/api/interview/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      const updates: Record<string, unknown> = {};
      const allowed = [
        "title",
        "industry",
        "elapsedSeconds",
        "transcript",
        "currentScores",
        "currentStar",
        "evalHistory",
        "report",
        "endedAt",
      ];
      for (const key of allowed) {
        if (req.body[key] !== undefined) updates[key] = req.body[key];
      }
      const session = await storage.updateInterviewSession(userId, id, updates);
      if (!session) return res.status(404).json({ error: "Ikke funnet" });
      res.json({ session });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // DELETE
  app.delete("/api/interview/sessions/:id", requireAuth, async (req, res) => {
    const userId = getUserId(req);
    try {
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: "Ugyldig ID" });
      await storage.deleteInterviewSession(userId, id);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // POST analyze — live evaluering hvert minutt
  app.post("/api/interview/analyze", requireAuth, async (req, res) => {
    try {
      const transcript: TranscriptSegment[] = req.body.transcript || [];
      const industry: string = req.body.industry || "bygg";
      const minute: number = req.body.minute || 0;

      if (transcript.length === 0) {
        return res.json({ scores: null, star: null, candidateText: "" });
      }

      const transcriptText = transcript.map((s) => s.text).join("\n");
      const systemPrompt = buildInterviewSystemPrompt(industry);
      const userContent = `Her er transkripsjonen så langt (intervjuer og kandidat blandet):\n\n${transcriptText}\n\nAnalyser KUN kandidatens svar. Returner JSON som beskrevet.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.3,
        max_tokens: 1500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return res.json({ scores: null, star: null, candidateText: "" });

      try {
        const parsed = JSON.parse(content);
        const scores: InterviewScores = parsed.scores;
        const star: StarStatus = parsed.star ?? { situation: false, task: false, action: false, result: false };
        const candidateText: string = parsed.candidate_text ?? "";

        const required = ["konkretisering", "fagdybde", "eierskap", "refleksjon", "samhandling", "struktur"] as const;
        for (const key of required) {
          if (!scores?.[key] || typeof scores[key].score !== "number") {
            return res.status(500).json({ error: "Ugyldig AI-respons", detail: content.slice(0, 500) });
          }
          scores[key].score = Math.max(0, Math.min(10, scores[key].score));
        }

        const snapshot: InterviewEvalSnapshot = {
          at: new Date().toISOString(),
          minute,
          scores,
          star,
          candidateWordCount: candidateText.split(/\s+/).filter(Boolean).length,
        };

        res.json({ scores, star, snapshot, candidateText });
      } catch (e: any) {
        logger.error({ err: e }, "Interview analyze JSON parse error");
        res.status(500).json({ error: "JSON-parsing feilet" });
      }
    } catch (error: any) {
      logger.error({ err: error }, "Interview analyze error");
      res.status(500).json({ error: error.message });
    }
  });

  // POST report — generer sluttrapport
  app.post("/api/interview/report", requireAuth, async (req, res) => {
    try {
      const transcript: TranscriptSegment[] = req.body.transcript || [];
      const evalHistory: InterviewEvalSnapshot[] = req.body.evalHistory || [];
      const industry: string = req.body.industry || "bygg";

      if (transcript.length === 0) {
        return res.status(400).json({ error: "Ingen transkripsjon" });
      }

      const transcriptText = transcript.map((s) => s.text).join("\n");
      const lastEval = evalHistory[evalHistory.length - 1];

      const systemPrompt = `${buildInterviewSystemPrompt(industry)}

NÅ SKAL DU LAGE EN DETALJERT SLUTTRAPPORT.

Returner JSON med:
{
  "summary": "2-3 setninger om kandidatens helhetsinntrykk",
  "strengths": ["3-5 konkrete styrker, med referanse til hva kandidaten faktisk sa"],
  "improvements": ["3-5 konkrete forbedringspunkter, hver med (a) hva som var svakt, (b) hvorfor det matter, (c) konkret råd for neste gang"],
  "scores": {
    "konkretisering": {"score": 0-10, "rationale": "..."},
    "fagdybde": {"score": 0-10, "rationale": "..."},
    "eierskap": {"score": 0-10, "rationale": "..."},
    "refleksjon": {"score": 0-10, "rationale": "..."},
    "samhandling": {"score": 0-10, "rationale": "..."},
    "struktur": {"score": 0-10, "rationale": "..."}
  }
}`;

      const userContent = `Full transkripsjon:\n\n${transcriptText}\n\nLag detaljert sluttrapport.`;

      const response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2500,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) return res.status(500).json({ error: "Tom AI-respons" });

      try {
        const parsed = JSON.parse(content);
        const report: InterviewReport = {
          summary: parsed.summary || "",
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
          improvements: Array.isArray(parsed.improvements) ? parsed.improvements : [],
          finalScores: parsed.scores || lastEval?.scores,
          generatedAt: new Date().toISOString(),
        };
        res.json({ report });
      } catch (e: any) {
        res.status(500).json({ error: "JSON-parsing feilet" });
      }
    } catch (error: any) {
      logger.error({ err: error }, "Interview report error");
      res.status(500).json({ error: error.message });
    }
  });
}

function buildInterviewSystemPrompt(industry: string): string {
  const industryContext =
    industry === "bygg"
      ? `BRANSJE: Bygg/anlegg. Forventede fagområder: VDC, taktplanlegging, kontraktsformer (NS 8405/8407, totalentreprise, samspill), risiko, grensesnitt mellom fag, byggeplassdrift, HMS, prosjektering, prosjektøkonomi.`
      : `BRANSJE: Generelt — vurder kandidaten mot generelle profesjonelle kriterier.`;

  return `Du er en erfaren intervju-coach som vurderer en jobbintervju-kandidat live.

${industryContext}

OPPGAVE 1 — SKILL INTERVJUER FRA KANDIDAT
Transkripsjonen blander begge stemmer. Bruk disse heuristikkene:
- INTERVJUER: korte ytringer som ofte ender med "?", introduserer temaer, ber om eksempler ("Kan du fortelle om…", "Hvordan gjorde du…").
- KANDIDAT: lengre svar i jeg-form, beskriver erfaring og prosjekter.
Trekk ut all KANDIDAT-tekst som én sammenhengende ytring og evalér KUN den.

OPPGAVE 2 — EVALUER KANDIDATEN PÅ 6 KRITERIER (1-10)

1. KONKRETISERING (1-10): Bruker tall, navn på prosjekter, roller, fagdisipliner, måleenheter, tidsangivelser?
   Lav (1-3): "vi pleier å…", "vi leverte gode resultater" — vagt.
   Middels (4-6): noen eksempler men mangler tall/kontekst.
   Høy (7-10): konkrete eksempler med prosjektnavn, roller, tall, tid.

2. FAGDYBDE (1-10): Forstår faget reelt? Bruker fagterminologi presist eller bare buzzord?
   Lav: gjentar moteord uten å forklare ("vi jobbet smidig"), blander begreper.
   Høy: presis bruk av fagord (taktplanlegging, VDC-roller, risiko-allokering, grensesnitt).

3. EIERSKAP (1-10): Skiller mellom hva hen selv gjorde vs teamet?
   Lav: utelukkende vi-form, uklart hva personen bidro med.
   Høy: tydelig "jeg gjorde X, teamet gjorde Y, resultatet ble Z". Tar ansvar også for dårlige utfall.

4. REFLEKSJON (1-10): Reflekterer over egne valg, feil og forbedringer?
   Lav: alt gikk bra, ingen feil, ingen læring.
   Høy: beskriver konkrete feil, analyserer årsak, kobler til ny atferd.

5. SAMHANDLING (1-10): Beskriver samspill med andre — kollegaer, kunder, byggherre — på troverdig måte?
   Lav: andre er problemet, lite om egen rolle i samspillet.
   Høy: viser empati, beskriver konflikthåndtering og forventningsstyring.

6. STRUKTUR (1-10): Rød tråd fra spørsmål til svar, holder seg til poenget?
   Lav: lange digresjoner, uklar konklusjon, svarer på noe annet.
   Høy: tydelig STAR-oppbygning (Situation-Task-Action-Result), presist svar.

For HVERT kriterium gi en score (heltall 1-10) og en kort begrunnelse (1 setning, maks ~20 ord). Begrunnelsen skal referere til hva kandidaten faktisk sa — IKKE generisk "kandidaten viser god…" Ikke straff kandidaten for at kort transkript ikke har rukket å vise alt — gi neutral score 5-6 hvis det er for tidlig å vurdere.

OPPGAVE 3 — STAR-DETEKSJON
Sjekk om kandidaten har dekket Situation/Task/Action/Result i sitt SISTE svar:
- Situation: kontekst-beskrivelse (hvilket prosjekt, hva slags rolle)
- Task: hva som måtte oppnås
- Action: hva kandidaten gjorde
- Result: hva utfallet ble

Returner ALLTID JSON i dette eksakte formatet:
{
  "candidate_text": "Den sammenhengende kandidat-ytringen du klippet ut, eller tom streng hvis ingen kandidat-tekst er identifisert ennå",
  "scores": {
    "konkretisering": {"score": 7, "rationale": "Nevner takt 4 uker og 12% redusert avvik, men savner prosjektnavn."},
    "fagdybde": {"score": 6, "rationale": "Bruker 'samhandling' korrekt, men forklarer ikke takt-mekanikken."},
    "eierskap": {"score": 5, "rationale": "Mest 'vi'-form; uklart hva kandidaten selv gjorde."},
    "refleksjon": {"score": 4, "rationale": "Ingen omtale av hva som ikke fungerte eller forbedringer."},
    "samhandling": {"score": 7, "rationale": "Beskriver dialog med byggherre konkret."},
    "struktur": {"score": 6, "rationale": "Klar situasjon, men resultat kommer som biting på slutten."}
  },
  "star": {
    "situation": true,
    "task": true,
    "action": true,
    "result": false
  }
}`;
}
