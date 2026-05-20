/**
 * Aktiver Row Level Security på alle tabeller i public-schema.
 *
 * Bakgrunn: Supabase eksponerer en REST API (PostgREST) over public-schema
 * via `anon` og `authenticated`-rollene. Uten RLS kan hvem som helst med
 * VITE_SUPABASE_ANON_KEY lese/skrive alle rader direkte via REST — selv om
 * vår egen backend krever JWT og scoper på user_id.
 *
 * Vår backend kobler til via DATABASE_URL som `postgres`-rollen (Supabase
 * pooler), som har BYPASSRLS. Når RLS er på uten policies blir altså
 * resultatet:
 *   - REST API via anon/authenticated → 0 rader (effektivt blokkert)
 *   - Backend via DATABASE_URL → uendret, ser alt
 *   - Frontend bruker Supabase JS kun til auth, ikke til data → upåvirket
 *
 * Scriptet er idempotent: vi inspiserer pg_class.relrowsecurity og kjører
 * kun ALTER TABLE for tabeller der RLS ikke allerede er på. Trygt å kjøre
 * ved hver deploy.
 *
 * Hvis en framtidig tabell skal eksponeres direkte via REST API, må du
 * legge til eksplisitte policies FØR du deployer — ellers vil REST gi 0
 * rader.
 *
 * Kjøres automatisk via `npm run db:push`, eller manuelt med
 * `tsx -r dotenv/config script/apply-rls.ts`.
 */
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL er ikke satt — kan ikke aktivere RLS.");
  process.exit(1);
}

const needsSsl =
  /supabase|amazonaws|render\.com|neon\.tech|googleapis|ondigitalocean/.test(
    connectionString,
  ) || connectionString.includes("sslmode=require");

const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  max: 2,
});

// `format('... %I ...', name)` lar Postgres selv quote identifier trygt,
// så vi unngår SQL-injection selv om vi itererer over alle public-tabeller.
const sql = `
DO $$
DECLARE
  t RECORD;
  enabled_count INT := 0;
  already_count INT := 0;
BEGIN
  FOR t IN
    SELECT c.relname, c.relrowsecurity AS rls_on
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
  LOOP
    IF t.rls_on THEN
      already_count := already_count + 1;
    ELSE
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
      RAISE NOTICE 'RLS aktivert: %', t.relname;
      enabled_count := enabled_count + 1;
    END IF;
  END LOOP;
  RAISE NOTICE 'Ferdig: % nye, % fra foer (totalt % tabeller i public)',
    enabled_count, already_count, enabled_count + already_count;
END $$;
`;

async function main() {
  console.log("🔒 Aktiverer Row Level Security på public-tabeller...");
  const client = await pool.connect();
  try {
    client.on("notice", (notice) => {
      console.log(`   ${notice.message}`);
    });
    await client.query(sql);
    console.log("✓ Ferdig.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("\n❌ Kunne ikke aktivere RLS:", err);
  process.exit(1);
});
