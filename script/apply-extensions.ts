/**
 * Aktiver Postgres-extensions og spesial-indexer som Drizzle ikke kan
 * uttrykke direkte i schema-en.
 *
 * - `vector`: pgvector for RAG-hjernen (knowledge_chunks.embedding). Supabase
 *   har pakken pre-installert, men extensionen må aktiveres per database.
 * - HNSW-indeks på `knowledge_chunks.embedding` for rask cosine similarity-
 *   søk. Drizzle 0.39 har ikke godt API for å sette `vector_cosine_ops`-
 *   operator class på indeks, så vi lager den manuelt her.
 *
 * Idempotent: bruker `IF NOT EXISTS` overalt. Kjøres etter `drizzle-kit
 * push` slik at knowledge_chunks-tabellen finnes når vi prøver å indeksere
 * den.
 */
import "dotenv/config";
import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("❌ DATABASE_URL er ikke satt — kan ikke sette opp extensions.");
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

async function main() {
  console.log("🧠 Setter opp pgvector-extension og indexer...");
  const client = await pool.connect();
  try {
    // pgvector for RAG-embeddings
    await client.query(`CREATE EXTENSION IF NOT EXISTS vector`);
    console.log("   ✓ vector-extension aktivert");

    // HNSW-indeks på knowledge_chunks.embedding for cosine similarity.
    // Sjekker først at tabellen finnes — første gang dette scriptet kjøres
    // kan det være før drizzle-kit har laget tabellen.
    const { rows } = await client.query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = 'knowledge_chunks'
       ) AS exists`,
    );
    if (rows[0]?.exists) {
      await client.query(
        `CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_hnsw
         ON public.knowledge_chunks
         USING hnsw (embedding vector_cosine_ops)`,
      );
      console.log("   ✓ HNSW-indeks på knowledge_chunks.embedding klar");
    } else {
      console.log(
        "   ℹ knowledge_chunks-tabellen finnes ikke ennå — hopp over HNSW (kjøres ved neste deploy)",
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
  console.log("✓ Ferdig.");
}

main().catch((err) => {
  console.error("\n❌ Kunne ikke sette opp extensions:", err);
  process.exit(1);
});
