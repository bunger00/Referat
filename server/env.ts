/**
 * Preflight environment validation.
 *
 * This file is intentionally the FIRST import in server/index.ts so it runs
 * before any other module (db.ts, routes.ts, …) tries to read env vars at
 * import time. It exits the process with a friendly message if anything
 * critical is missing.
 */

const REQUIRED: Array<{ key: string; hint: string }> = [
  { key: "DATABASE_URL", hint: "Postgres connection string, f.eks. postgresql://localhost:5432/referat" },
  { key: "OPENAI_API_KEY", hint: "OpenAI API-nøkkel (sk-...)" },
];

const missing = REQUIRED.filter(({ key }) => !process.env[key]);
if (missing.length > 0) {
  console.error("\n❌ Manglende miljøvariabler:");
  missing.forEach(({ key, hint }) => console.error(`   - ${key}  (${hint})`));
  console.error("\nKopier .env.example til .env og fyll inn verdiene, eller sett dem i miljøet.\n");
  process.exit(1);
}

if (!process.env.APP_PASSWORD_HASH) {
  console.warn("⚠️  APP_PASSWORD_HASH er ikke satt — login vil avvise alle forsøk. Kjør `npm run setup` for å generere.");
}
if (!process.env.SESSION_SECRET) {
  console.warn("⚠️  SESSION_SECRET er ikke satt — bruker usikker default. Sett en lang tilfeldig streng i .env.");
}
const hasHfEndpoints = process.env.HF_NB_WHISPER_MEDIUM_URL || process.env.HF_NB_WHISPER_LARGE_URL;
if (!process.env.HUGGINGFACE_API_KEY || !hasHfEndpoints) {
  console.log("ℹ️  HuggingFace ikke konfigurert — bruker OpenAI Whisper for all transkripsjon.");
}

export {};
