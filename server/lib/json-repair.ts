/**
 * Forsøker å reparere JSON som ble kuttet midt i (typisk når GPT treffer
 * max_tokens). Klipper til siste komma/objekt-grense og lukker
 * gjenstående { [ med } ]. Best-effort — returnerer null hvis det ikke gir
 * gyldig JSON-stub.
 *
 * Pure function, ingen sideeffekter — testbar.
 */
export function tryRepairTruncatedJson(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s.replace(/^```(json)?\s*/i, "").replace(/```\s*$/i, "");

  let inString = false;
  let escape = false;
  const stack: string[] = [];
  let lastSafeIdx = -1;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) { escape = false; continue; }
    if (c === "\\") { escape = true; continue; }
    if (c === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (c === "{" || c === "[") stack.push(c);
    else if (c === "}" || c === "]") stack.pop();

    if (stack.length > 0 && (c === "," || c === "}" || c === "]")) {
      lastSafeIdx = i;
    }
  }

  let truncated = s;
  if (inString && lastSafeIdx > 0) {
    truncated = s.slice(0, lastSafeIdx + 1);
    inString = false;
    escape = false;
    stack.length = 0;
    for (let i = 0; i < truncated.length; i++) {
      const c = truncated[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === "{" || c === "[") stack.push(c);
      else if (c === "}" || c === "]") stack.pop();
    }
  }

  truncated = truncated.replace(/,\s*$/, "");

  while (stack.length > 0) {
    const open = stack.pop()!;
    truncated += open === "{" ? "}" : "]";
  }

  return truncated;
}
