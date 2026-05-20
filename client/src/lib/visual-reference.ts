/**
 * Heuristikker for å oppdage at noen refererer til noe visuelt under et
 * erfaringsmøte ("som dere ser her", "denne tegningen" osv). Brukes til å
 * trigge skjermbilde-fangst slik at AI får visuell kontekst når lærdommer
 * ekstraheres.
 *
 * Returnerer true hvis vi har høy konfidens på at det refereres til skjermen.
 * Tvilsomme tilfeller skal kalle backendens AI-klassifierer i stedet.
 */
const VISUAL_REFERENCE_PATTERNS: RegExp[] = [
  /\bsom (?:dere|du) ser\b/i,
  /\b(?:p[aå] (?:denne|den her|skjermen)|her p[aå])\b/i,
  /\b(?:denne|den her) (?:tegninga?|skjerma?|figuren?|grafa?|tabella?|kurva?|graf|plot|bildet|illustrasjon|diagrammet)\b/i,
  /\b(?:i|p[aå]) (?:tabella?|figuren|grafen|diagrammet|bildet|skjermen)\b/i,
  /\b(?:kan|kunne) dere se\b/i,
  /\b(?:vis(er|t)?|delt?) p[aå] skjermen\b/i,
  /\bse (?:p[aå]|her)\b/i,
  /\b(?:dette|her)\s+(?:viser|illustrerer)\b/i,
  // Tall + visuelt objekt: "punkt 3 i tabellen", "rad 2"
  /\b(?:punkt|rad|kolonne|linje)\s+\d+\b/i,
];

export function isLikelyVisualReference(text: string): boolean {
  if (!text || text.length < 8) return false;
  return VISUAL_REFERENCE_PATTERNS.some((re) => re.test(text));
}

/**
 * Eksporterer mønstrene for testing/debugging.
 */
export const _visualReferencePatterns = VISUAL_REFERENCE_PATTERNS;
