import { trackedChatCompletion } from "./ai-tracker";
import { tryRepairTruncatedJson } from "./json-repair";
import { logger } from "./logger";
import { proposedLessonSchema, type ProposedLesson, type TranscriptSegment } from "@shared/schema";
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
   - "short" (1-3 setninger): En konkret, avgrenset observasjon
     (f.eks. "Ukentlige stand-ups uten agenda gir lav verdi — innfør 3-punkts
     fast agenda").
   - "thematic" (lengre tematisk blokk): En mer omfattende refleksjon som
     dekker et tema med flere nyanser (f.eks. en lengre diskusjon om hvordan
     kundeforhold endrer seg gjennom prosjektfaser).
3. Strukturer hver lærdom som JSON med feltene:
   - title: Kort, presis tittel (max 60 tegn)
   - problem: Hva var utfordringen, observasjonen eller mønsteret som ble nevnt?
   - solution: Hva ble læringen, anbefalingen eller løsningen?
   - context: Valgfri ekstra kontekst — prosjekttype, bransje, situasjon. Tom hvis ikke nevnt.
   - type: "short" eller "thematic"
   - tags: 1-5 nøkkelord på norsk (lowercase) som beskriver tema (f.eks. ["kommunikasjon", "møtestruktur"])
4. IKKE inkluder:
   - Aksjoner eller "TODO"-er (det er en annen modul)
   - Beslutninger som krever vedtak
   - Generelle observasjoner uten lærings-verdi
   - Småprat
5. Hvis møtet ikke inneholder noen reelle lærdommer, returner tom array.
6. Skriv ALT på norsk (bokmål), uavhengig av hvilket språk transkriptet er på.

Output: kun gyldig JSON med formatet:
{
  "lessons": [
    { "title": "...", "problem": "...", "solution": "...", "context": "...", "type": "short", "tags": ["..."] }
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
    }),
  ),
});

/**
 * Ekstraher lærdommer fra et erfaringsmøte-transkript ved å gi gpt-5 hele
 * samtalen og strukturere svaret som ProposedLesson[]. Klienten vil deretter
 * vise hvert forslag i et redigerbart kort før brukeren godkjenner og lagrer.
 */
export async function extractLessons(args: {
  userId: string;
  transcript: TranscriptSegment[];
  userNotes?: string | null;
  meetingTitle?: string | null;
}): Promise<ProposedLesson[]> {
  const { userId, transcript, userNotes, meetingTitle } = args;
  if (transcript.length === 0) return [];

  const transcriptText = transcript
    .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join("\n");

  const userPrompt = [
    meetingTitle ? `Møtetittel: ${meetingTitle}` : null,
    userNotes?.trim() ? `Brukerens egne notater under møtet:\n${userNotes.trim()}` : null,
    `Transkript:\n${transcriptText}`,
  ]
    .filter(Boolean)
    .join("\n\n---\n\n");

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
  } satisfies ProposedLesson));
}
