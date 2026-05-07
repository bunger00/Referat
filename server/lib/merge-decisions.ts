export type DecisionLike = {
  id?: string;
  text: string;
  context?: string | null;
};

/**
 * Slå sammen beslutninger fra hoved-analyze og dedikert pass.
 * Dedup ved ID-match eller ved tekst-similarity (substring eller >60% felles ord).
 *
 * Pure function, testbar.
 */
export function mergeDecisions<T extends DecisionLike>(main: T[], dedicated: T[]): T[] {
  const result = [...main];
  for (const d of dedicated) {
    const dText = (d.text || "").toLowerCase().trim();
    if (!dText) continue;
    const dup = result.find(r => {
      if (r.id && d.id && r.id === d.id) return true;
      const rText = (r.text || "").toLowerCase().trim();
      if (rText && dText && (rText.includes(dText) || dText.includes(rText))) return true;
      const rWords = rText.split(/\s+/).filter(w => w.length > 3);
      const dWords = dText.split(/\s+/).filter(w => w.length > 3);
      if (rWords.length > 0 && dWords.length > 0) {
        const rSet: Record<string, true> = {};
        rWords.forEach(w => { rSet[w] = true; });
        let overlap = 0;
        for (let i = 0; i < dWords.length; i++) if (rSet[dWords[i]]) overlap++;
        const ratio = overlap / Math.max(rWords.length, dWords.length);
        if (ratio > 0.6) return true;
      }
      return false;
    });
    if (!dup) result.push(d);
  }
  return result;
}
