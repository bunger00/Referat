import { trackedChatCompletion } from "./ai-tracker";
import { tryRepairTruncatedJson } from "./json-repair";
import { logger } from "./logger";
import type {
  ProposedLesson,
  TranscriptSegment,
  ExperienceAttachment,
  LessonLearned,
} from "@shared/schema";
import { z } from "zod";

const SYSTEM_PROMPT = `Du er en analytiker som leser et erfaringsmøte — en samtale der flere deltakere
deler erfaringer, lærdommer og forbedringer rundt et prosjekt eller en metode.

Din oppgave er å ekstrahere strukturerte LÆRDOMMER (lessons learned) fra
samtalen, slik at de senere kan brukes som referansematerial for fremtidige
prosjekter eller møter.

Reglene:
1. Hver lærdom skal stå alene — en leser om seks måneder må forstå den uten
   å lese hele transkriptet.
2. Bestem GRANULARITET case-by-case:
   - "short" (1-3 setninger): En konkret, avgrenset observasjon.
   - "thematic" (lengre tematisk blokk): En mer omfattende refleksjon som
     dekker et tema med flere nyanser.
3. Strukturer hver lærdom som JSON med feltene:
   - title: Kort, presis tittel (max 60 tegn)
   - problem: Hva var utfordringen, observasjonen eller mønsteret som ble nevnt?
   - solution: Hva ble læringen, anbefalingen eller løsningen?
   - context: Valgfri ekstra kontekst — prosjekttype, bransje, situasjon. Tom hvis ikke nevnt.
   - type: "short" eller "thematic"
   - tags: 1-5 nøkkelord på norsk (lowercase) som beskriver tema
   - relatesToLessonId: Hvis denne lærdommen oppdaterer eller utdyper en EKSISTERENDE
     lærdom (vist under "Tidligere lærdommer"), oppgi dens id som tall. Ellers null.
4. Bruk ALL gitt kontekst:
   - Eksisterende lærdommer fra samme prosjekt → identifiser oppfølginger eller nyere innsikter
   - Vedlagte dokumenter → siter eller refererer hvis relevant
   - Tidligere kunnskap fra hjernen → koble til etablerte mønstre
5. IKKE inkluder:
   - Aksjoner eller "TODO"-er (det er en annen modul)
   - Beslutninger som krever vedtak
   - Generelle observasjoner uten lærings-verdi
   - Småprat
   - Lærdommer som er identiske med eksisterende åpne lærdommer (markér dem som relatesToLessonId i stedet)
6. Hvis møtet ikke inneholder noen reelle lærdommer, returner tom array.
7. Skriv ALT på norsk (bokmål), uavhengig av hvilket språk transkriptet er på.

Output: kun gyldig JSON med formatet:
{
  "lessons": [
    { "title": "...", "problem": "...", "solution": "...", "context": "...",
      "type": "short", "tags": ["..."], "relatesToLessonId": null }
  ]
}
Ingen kommentarer, ingen markdown-fences, kun rå JSON.`;

const responseSchema = z.object({
  lessons: z.array(
    z.object({
      title: z.string(),
      problem: z.string(),
      solution: z.string(),
      context: z.string().optional().default(""),
      type: z.enum(["short", "thematic"]),
      tags: z.array(z.string()).optional().default([]),
      relatesToLessonId: z.number().nullable().optional(),
    }),
  ),
});

export interface ExtractionContext {
  attachments?: ExperienceAttachment[];
  // Åpne/in_progress lærdommer fra forrige sesjoner i samme serie. AI kan
  // identifisere disse som "oppfølginger" og markere relatesToLessonId.
  openLessonsInSeries?: LessonLearned[];
  // Verifisert tidligere kunnskap (RAG-treff fra hjernen) som er relevant for
  // dette møtet. Inkluderer både gamle lærdommer og dokumenter.
  priorKnowledge?: Array<{ sourceName: string; content: string }>;
  // Series-metadata (navn, beskrivelse) hvis sesjonen er del av en serie
  seriesName?: string | null;
  seriesDescription?: string | null;
}

function formatAttachments(items?: ExperienceAttachment[]): string {
  if (!items?.length) return "";
  const blocks = items.map((a) => {
    // Begrens lengden så vi ikke sprenger context-budsjettet
    const truncated = a.extractedText.slice(0, 8000);
    const suffix = a.extractedText.length > 8000 ? "\n[...avkortet]" : "";
    return `### ${a.filename}\n${truncated}${suffix}`;
  });
  return `\n\nVEDLAGTE DOKUMENTER (diskutert under møtet):\n${blocks.join("\n\n")}`;
}

function formatOpenLessons(items?: LessonLearned[]): string {
  if (!items?.length) return "";
  const blocks = items.map((l) => {
    return `[id ${l.id}, ${l.status}] ${l.title}\n  Problem: ${l.problem}\n  Løsning: ${l.solution}`;
  });
  return `\n\nTIDLIGERE LÆRDOMMER fra samme prosjekt/serie (åpne eller under utprøving):\n${blocks.join("\n\n")}`;
}

function formatPriorKnowledge(items?: Array<{ sourceName: string; content: string }>): string {
  if (!items?.length) return "";
  const blocks = items.map((k) => {
    const truncated = k.content.slice(0, 1500);
    return `- ${k.sourceName}: ${truncated}${k.content.length > 1500 ? "..." : ""}`;
  });
  return `\n\nRELEVANT TIDLIGERE KUNNSKAP fra hjernen:\n${blocks.join("\n")}`;
}

/**
 * Ekstraher lærdommer fra et erfaringsmøte-transkript. Når kontekst er gitt
 * (vedlegg, tidligere lærdommer, RAG-treff) brukes alt sammen for å gi AI
 * et fyldigere grunnlag. Returnerer ProposedLesson[] med valgfri
 * relatesToLessonId for oppfølgings-koblinger.
 */
export async function extractLessons(args: {
  userId: string;
  transcript: TranscriptSegment[];
  userNotes?: string | null;
  meetingTitle?: string | null;
  context?: ExtractionContext;
}): Promise<ProposedLesson[]> {
  const { userId, transcript, userNotes, meetingTitle, context } = args;
  if (transcript.length === 0) return [];

  const transcriptText = transcript
    .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join("\n");

  const seriesHeader = context?.seriesName
    ? `Prosjekt/serie: ${context.seriesName}${context.seriesDescription ? ` — ${context.seriesDescription}` : ""}`
    : null;

  const userPrompt = [
    seriesHeader,
    meetingTitle ? `Møtetittel: ${meetingTitle}` : null,
    userNotes?.trim() ? `Brukerens egne notater:\n${userNotes.trim()}` : null,
    formatOpenLessons(context?.openLessonsInSeries),
    formatPriorKnowledge(context?.priorKnowledge),
    formatAttachments(context?.attachments),
    `\nMØTETRANSKRIPT:\n${transcriptText}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = (await trackedChatCompletion(
    { endpoint: "/api/experience/extract", userId },
    {
      model: "gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    },
  )) as any;

  const raw: string = resp.choices?.[0]?.message?.content ?? "";
  const cleaned = tryRepairTruncatedJson(raw) ?? raw;
  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(JSON.parse(cleaned));
  } catch (err: any) {
    logger.warn({ err: err?.message, raw: raw.slice(0, 200) }, "Lesson extraction parse failed");
    return [];
  }

  return parsed.lessons.map((lesson, idx) => ({
    id: `proposed-${idx}-${Date.now()}`,
    title: lesson.title,
    problem: lesson.problem,
    solution: lesson.solution,
    context: lesson.context,
    type: lesson.type,
    tags: lesson.tags,
    relatedScreenshotIds: [],
    relatedDocumentIds: [],
    relatesToLessonId: lesson.relatesToLessonId ?? null,
  } satisfies ProposedLesson));
}
