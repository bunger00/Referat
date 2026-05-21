import { trackedChatCompletion } from "./ai-tracker";
import { logger } from "./logger";
import { tryRepairTruncatedJson } from "./json-repair";
import type { TranscriptSegment } from "@shared/schema";
import { z } from "zod";

export interface CleanupConfig {
  topic?: string;
  targetLanguage: "no" | "en";
}

const SYSTEM_PROMPT = `Du er en transkripsjons-redaktør. Du får rå Whisper-segmenter fra et live-
opptak. Whisper kan tidvis gjøre feil — særlig med fagord, navn, og ved blandet
språk. Din jobb er å renskrive segmentene mens du bevarer mening.

Regler:
1. Behold antall segmenter og deres rekkefølge. Hvert input-segment må ha
   et tilsvarende output-segment.
2. Behold timestamps og IDer eksakt.
3. Fiks åpenbare feiltranskripsjoner basert på temaet du blir gitt.
4. Hvis Whisper har transkribert engelsk lyd som garbled norsk, skriv om
   til ryddig {{TARGET_LANGUAGE}} (oversett ved behov).
5. Glatt ut grammatikk og setningsbygning, men IKKE legg til informasjon
   som ikke er der.
6. Behold faglige termer fra temaet — hvis temaet er "taktplanlegging",
   skal "TEC" eller "TEX" → "Takt"; hvis "lean" → "Lean", ikke "Yandri".
7. Hvis et segment er ren støy eller hallusinasjon ("Red Dead Redemption 3",
   "Takk for at du så" osv), erstatt text med en tom streng.
8. Output: gyldig JSON med samme struktur som input. Ingen kommentarer.`;

const inputSegmentSchema = z.object({
  id: z.string().optional(),
  timestamp: z.string().optional(),
  speaker: z.string().optional(),
  text: z.string(),
});

const responseSchema = z.object({
  segments: z.array(inputSegmentSchema),
});

/**
 * Kjør AI-renskriving på en batch transkripsjons-segmenter. Returnerer
 * segmenter med samme antall og rekkefølge, men med renskrevet tekst.
 *
 * Best-effort: hvis AI gir tilbake feil-formet JSON eller ulikt antall
 * segmenter, returneres originalsegmentene urørt.
 */
export async function cleanupSegments(
  segments: TranscriptSegment[],
  config: CleanupConfig,
  userId: string | null,
): Promise<TranscriptSegment[]> {
  if (segments.length === 0) return segments;

  const targetLangLabel = config.targetLanguage === "no" ? "norsk (bokmål)" : "engelsk";
  const systemPrompt = SYSTEM_PROMPT.replace("{{TARGET_LANGUAGE}}", targetLangLabel);

  const inputJson = JSON.stringify({
    targetLanguage: config.targetLanguage,
    topic: config.topic ?? null,
    segments: segments.map((s) => ({
      id: s.id,
      timestamp: s.timestamp,
      speaker: s.speaker,
      text: s.text,
    })),
  });

  const resp = (await trackedChatCompletion(
    { endpoint: "/api/transcribe/cleanup", userId },
    {
      model: "gpt-5",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: inputJson },
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
    logger.warn({ err: err?.message, raw: raw.slice(0, 200) }, "Cleanup parse failed");
    return segments;
  }

  if (parsed.segments.length !== segments.length) {
    logger.warn(
      { expected: segments.length, got: parsed.segments.length },
      "Cleanup returned different segment count — returning raw",
    );
    return segments;
  }

  // Map AI output tilbake til originalsegmentene basert på rekkefølge.
  // Bevarer original ID/timestamp/speaker — det er trygt selv om AI skulle
  // tukle med disse feltene.
  return segments.map((orig, idx) => {
    const updated = parsed.segments[idx];
    const newText = (updated.text ?? "").trim();
    return {
      ...orig,
      text: newText,
    };
  }).filter((s) => s.text.length > 0); // dropp tomme segmenter (markert som hallusinasjoner)
}
