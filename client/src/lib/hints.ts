/**
 * Førstegangs-tips. Lagrer i localStorage hvilke hint brukeren har sett
 * eller eksplisitt skjult, så vi viser dem kun én gang.
 */

const PREFIX = "referat:hint:";

export type HintKey =
  | "firstRecording"
  | "firstProposal"
  | "firstSummary"
  | "knowledgeBase";

export function isHintDismissed(key: HintKey): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PREFIX + key) === "1";
  } catch {
    return true;
  }
}

export function dismissHint(key: HintKey): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, "1");
  } catch {
    /* ignore quota / private mode */
  }
}

export function resetAllHints(): void {
  if (typeof window === "undefined") return;
  try {
    Object.keys(window.localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => window.localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}
