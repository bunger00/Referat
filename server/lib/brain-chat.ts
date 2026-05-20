import { trackedChatCompletion } from "./ai-tracker";
import { searchKnowledge, type KnowledgeSearchHit } from "./knowledge";
import type { ChatMessage, KnowledgeSourceRef } from "@shared/schema";

const SYSTEM_PROMPT_TEMPLATE = `Du er en assistent som hjelper brukeren med å hente kunnskap fra deres egen
"hjerne" — en samling av tidligere møter, erfaringsmøter, regler, dokumenter
og lærdommer.

Reglene:
1. Svar KUN basert på kontekst-utdragene under. Hvis svaret ikke finnes der,
   si tydelig "Jeg finner ikke noe om dette i hjernen din ennå."
2. Når du refererer til informasjon fra kontekst, oppgi kilden eksplisitt
   som [Kilde N] (N = nummeret i lista). Eksempel:
   "Forrige gang du diskuterte dette anbefalte du å [...] [Kilde 2]."
3. Svar på norsk (bokmål), uavhengig av spørsmålsspråk.
4. Vær konkret og kort. Bruk punktlister når det passer.
5. Hvis flere kilder sier ulikt, fortell brukeren det og oppgi begge perspektivene.
6. Aldri gjett. Aldri legg til informasjon som ikke står i kontekst.

KONTEKST (nummerert liste over relevante utdrag fra hjernen):
{{CONTEXT}}`;

const SOURCE_TYPE_LABELS: Record<string, string> = {
  lesson: "Lærdom",
  meeting_summary: "Møtereferat",
  meeting_transcript: "Møtetranskript",
  experience_transcript: "Erfaringsmøte",
  rule: "Regel",
  uploaded_doc: "Opplastet dokument",
  uploaded_image: "Opplastet bilde",
};

function formatContextBlock(hits: KnowledgeSearchHit[]): string {
  if (hits.length === 0) {
    return "(Ingen relevante utdrag funnet — hjernen din inneholder kanskje ikke informasjon om dette ennå.)";
  }
  return hits
    .map((hit, idx) => {
      const typeLabel = SOURCE_TYPE_LABELS[hit.chunk.sourceType] ?? hit.chunk.sourceType;
      return [
        `[Kilde ${idx + 1}] ${typeLabel} — ${hit.chunk.sourceName}`,
        hit.chunk.content,
      ].join("\n");
    })
    .join("\n\n---\n\n");
}

/**
 * Svar på et chat-spørsmål mot brukerens RAG-hjerne. Returnerer både selve
 * svaret og en strukturert liste av kildene som ble brukt slik at klienten
 * kan vise klikkbare lenker tilbake til opphavet.
 */
export async function answerWithBrain(args: {
  userId: string;
  messages: ChatMessage[];
}): Promise<{ answer: string; sources: KnowledgeSourceRef[] }> {
  const { userId, messages } = args;
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  if (!lastUser?.content.trim()) {
    return { answer: "Skriv et spørsmål og jeg svarer.", sources: [] };
  }

  const hits = await searchKnowledge(userId, lastUser.content, {
    topK: 8,
    minSimilarity: 0.3,
  });

  const contextBlock = formatContextBlock(hits);
  const systemPrompt = SYSTEM_PROMPT_TEMPLATE.replace("{{CONTEXT}}", contextBlock);

  const resp = (await trackedChatCompletion(
    { endpoint: "/api/brain/chat", userId },
    {
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        // Hele meldingshistorikken slik at oppfølgings-spørsmål får tråd.
        ...messages.map((m) => ({ role: m.role, content: m.content })),
      ],
    },
  )) as any;

  const answer: string = resp.choices?.[0]?.message?.content?.trim() ?? "";
  const sources: KnowledgeSourceRef[] = hits.map((hit) => ({
    chunkId: hit.chunk.id,
    sourceType: hit.chunk.sourceType as KnowledgeSourceRef["sourceType"],
    sourceId: hit.chunk.sourceId,
    sourceName: hit.chunk.sourceName,
    excerpt: hit.chunk.content.slice(0, 200) + (hit.chunk.content.length > 200 ? "…" : ""),
    score: hit.similarity,
  }));

  return { answer, sources };
}
