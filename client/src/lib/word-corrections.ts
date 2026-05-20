import type { WordCorrection } from "@shared/schema";

/**
 * Bytter ut feilstavede ord/uttrykk med brukerens lagrede korreksjoner.
 *
 * Eksempel: hvis brukeren har lagret { original: "Børn", corrected: "Bjørn" }
 * blir "Hei Børn, hva sa du?" → "Hei Bjørn, hva sa du?".
 *
 * - Case-insensitivt match (gi-flagg), men erstatter med eksakt cased target.
 * - `\b...\b` ordgrenser sikrer at "Bør" ikke matcher inni "Børste".
 * - Mellomrom i original behandles som "ett eller flere whitespace-tegn"
 *   for å håndtere variabel avstand fra Whisper.
 *
 * Brukes både av møte-siden og erfaringsmøte-siden så ordrettelser oppfører
 * seg likt på tvers av modulene.
 */
export function applyWordCorrections(text: string, corrections: WordCorrection[]): string {
  if (!corrections.length) return text;
  let result = text;
  for (const c of corrections) {
    const escaped = c.original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ +/g, "\\s+");
    const regex = new RegExp(`\\b${escaped}\\b`, "gi");
    result = result.replace(regex, c.corrected);
  }
  return result;
}
