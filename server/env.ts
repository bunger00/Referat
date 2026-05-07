/**
 * Preflight environment validation.
 *
 * This file is intentionally the FIRST import in server/index.ts so it runs
 * before any other module (db.ts, auth.ts, …) tries to read env vars at
 * import time. It exits the process with a friendly message if anything
 * critical is missing.
 */

const REQUIRED: Array<{ key: string; hint: string }> = [
  { key: "DATABASE_URL", hint: "Postgres connection string fra Supabase, f.eks. postgresql://postgres.<ref>:<pwd>@aws-0-...pooler.supabase.com:5432/postgres" },
  { key: "OPENAI_API_KEY", hint: "OpenAI API-nøkkel (sk-...)" },
  { key: "SUPABASE_URL", hint: "Supabase project URL, f.eks. https://<ref>.supabase.co (Project Settings → API)" },
];

const missing = REQUIRED.filter(({ key }) => !process.env[key]);
if (missing.length > 0) {
  console.error("\n❌ Manglende miljøvariabler:");
  missing.forEach(({ key, hint }) => console.error(`   - ${key}  (${hint})`));
  console.error("\nKopier .env.example til .env og fyll inn verdiene, eller sett dem i miljøet.\n");
  process.exit(1);
}

const hasHfEndpoints = process.env.HF_NB_WHISPER_MEDIUM_URL || process.env.HF_NB_WHISPER_LARGE_URL;
if (!process.env.HUGGINGFACE_API_KEY || !hasHfEndpoints) {
  console.log("ℹ️  HuggingFace ikke konfigurert — bruker OpenAI Whisper for all transkripsjon.");
}

export {};
