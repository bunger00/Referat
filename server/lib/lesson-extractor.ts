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

Din oppgave er å ekstrahere ALLE LÆRDOMMER (lessons learned) som har
overførings-verdi til fremtidige prosjekter eller møter. Vær GRUNDIG — det
er mye bedre å foreslå én lærdom for mye enn å gå glipp av noen. Brukeren
kan alltids avvise det som ikke er relevant.

## Prosess (følg denne sekvensen i hodet)

1. **Tematisk skanning** — Hvilke 4-8 hovedtemaer ble berørt? Lag mental
   liste.
2. **For hvert tema, let etter**:
   a. EKSPLISITTE lærdommer ("vi lærte at...", "det vi tar med oss er...")
   b. IMPLISITTE innsikter (problemer som ble løst, mønstre som ble
      identifisert, vendepunkter i samtalen)
   c. ENDRINGS-FORSLAG (forbedringer som ble luftet, selv om ingen
      bestemte noe)
   d. ADVARSLER (ting deltakerne mente man ikke bør gjøre)
   e. KONTRA-INTUITIVE OBSERVASJONER (noe som overrasket noen)
3. **Subtile lærdommer**: relasjoner mellom roller, kommunikasjons-
   mønstre, beslutningsprosesser, kulturelle observasjoner — disse
   glemmes ofte men har stor verdi.
4. **Cross-check**: går du tilbake i transkriptet, finner du noe du
   først overså? Legg det til.

## Forventet volum

Et erfaringsmøte på 20-30 minutter inneholder TYPISK 6-12 distinkte
lærdommer hvis du leter grundig. Kortere møter (under 10 min) gir
3-6. Hvis du har funnet færre enn 4 og transkriptet er over 5 min, har
du sannsynligvis vært for konservativ — skan en gang til.

## Struktur per lærdom (JSON)

- title: Kort, presis tittel (max 60 tegn)
- problem: Utfordringen, observasjonen eller mønsteret som ble nevnt.
  Konkret — ikke generisk.
- solution: Læringen, anbefalingen eller løsningen. Konkret nok til at
  noen kan handle på den.
- context: Ekstra kontekst — prosjekttype, fase, rolle. Tom hvis ikke
  relevant.
- type: "short" (1-3 setninger) eller "thematic" (utdypet refleksjon)
- tags: 1-5 nøkkelord på norsk (lowercase)
- relatesToLessonId: Hvis denne lærdommen oppdaterer eller utdyper en
  EKSISTERENDE lærdom (vist under "Tidligere lærdommer"), oppgi dens id.
  Ellers null.

## Bruk ALL kontekst

- Eksisterende lærdommer fra samme prosjekt → identifiser oppfølginger
  via relatesToLessonId
- Vedlagte dokumenter → siter eller referer hvis relevant
- Tidligere kunnskap fra hjernen → koble til etablerte mønstre

## Ikke inkluder

- Aksjoner eller "TODO"-er (egen modul)
- Beslutninger som krever vedtak (egen modul)
- Småprat uten lærings-verdi
- Lærdommer som er bit-for-bit identiske med eksisterende åpne lærdommer
  (markér som relatesToLessonId i stedet)

## Språk

Skriv ALT på norsk (bokmål), uavhengig av hvilket språk transkriptet
er på.

## Output-format

Kun gyldig JSON, ingen markdown-fences, ingen kommentarer:
{
  "lessons": [
    { "title": "...", "problem": "...", "solution": "...", "context": "...",
      "type": "short", "tags": ["..."], "relatesToLessonId": null }
  ]
}`;

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
  topic?: string | null;
  context?: ExtractionContext;
}): Promise<ProposedLesson[]> {
  const { userId, transcript, userNotes, meetingTitle, topic, context } = args;
  if (transcript.length === 0) return [];

  const transcriptText = transcript
    .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join("\n");

  const seriesHeader = context?.seriesName
    ? `Prosjekt/serie: ${context.seriesName}${context.seriesDescription ? ` — ${context.seriesDescription}` : ""}`
    : null;

  // Tema-overskriften kommer FØRST i prompten — den setter den domene-
  // konteksten AI skal lese resten av materialet gjennom og bruke i
  // formuleringen av lærdommer.
  const topicHeader = topic?.trim()
    ? `TEMA/DOMENE: ${topic.trim()}\n(Bruk fagterminologi og uttrykk fra dette domenet når du formulerer lærdommer.)`
    : null;

  const userPrompt = [
    topicHeader,
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
