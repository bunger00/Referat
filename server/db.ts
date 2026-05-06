import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL!; // validated in env.ts

// Detect cloud Postgres providers that require SSL.
const needsSsl =
  /supabase|amazonaws|render\.com|neon\.tech|googleapis|ondigitalocean/.test(connectionString) ||
  connectionString.includes("sslmode=require");

// Detect Supabase pgbouncer (transaction-mode pooler runs on port 6543).
// Transaction mode does not support prepared statements; we don't pre-prepare,
// so we just keep connections short-lived. Session mode (port 5432) is fully
// compatible with prepared statements.
const isPgBouncerTransaction = /:6543\b/.test(connectionString);

export const pool = new Pool({
  connectionString,
  ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  // Keep pool small; Supabase free tier (nano) caps at ~60 connections total.
  max: parseInt(process.env.DB_POOL_MAX || "10", 10),
  // pgbouncer in transaction mode rotates connections — short idle timeout.
  idleTimeoutMillis: isPgBouncerTransaction ? 10_000 : 30_000,
});

export const db = drizzle(pool, { schema });

pool.on("error", (err) => {
  console.error("Postgres pool error:", err);
});
