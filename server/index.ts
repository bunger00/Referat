// IMPORTANT: env validation must run before any module that reads env at
// import time (db.ts, etc). Keep this as the first import.
import "./env";

import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import createMemoryStore from "memorystore";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { db, pool } from "./db";
import { sql } from "drizzle-orm";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    isAuthenticated: boolean;
  }
}

// =====================================================================
// Session store: PostgreSQL in production, in-memory in development
// =====================================================================
const isProd = process.env.NODE_ENV === "production";

let sessionStore: session.Store;
if (isProd) {
  const PgSession = connectPgSimple(session);
  sessionStore = new PgSession({
    pool,
    tableName: "user_sessions",
    // We create the table ourselves below — connect-pg-simple's auto-create
    // reads table.sql relative to __dirname, which breaks when the package is
    // bundled by esbuild (the SQL file isn't copied into dist/). Falsy here
    // prevents the lazy fs.readFile call entirely.
    createTableIfMissing: false,
    errorLog: (...args) => console.error("[pg-session]", ...args),
  });
} else {
  const MemoryStore = createMemoryStore(session);
  sessionStore = new MemoryStore({ checkPeriod: 86400000 });
}

// Trust proxy when behind reverse proxy (Render, Replit, nginx, etc.)
if (isProd) {
  app.set("trust proxy", 1);
}

app.use(
  session({
    secret: process.env.SESSION_SECRET || "meeting-app-insecure-default-CHANGE-ME",
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      secure: isProd,
      httpOnly: true,
      // Same-origin (frontend served by same Express app), so "lax" is correct.
      sameSite: "lax",
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    },
  })
);

app.use(
  express.json({
    limit: "50mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

// Request logging for /api routes
app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      // Don't log full responses for endpoints that return large payloads
      const isHeavy = path.includes("/transcribe") || path.includes("/sessions") || path.includes("/rules");
      if (capturedJsonResponse && !isHeavy) {
        const json = JSON.stringify(capturedJsonResponse);
        logLine += ` :: ${json.length > 200 ? json.slice(0, 200) + "…" : json}`;
      }
      log(logLine);
    }
  });

  next();
});

// Health check — placed before auth so monitoring can hit it.
app.get("/api/health", async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: "ok",
      uptime: process.uptime(),
      env: process.env.NODE_ENV || "development",
      hasOpenAi: !!process.env.OPENAI_API_KEY,
      hasHuggingFace:
        !!process.env.HUGGINGFACE_API_KEY &&
        !!(process.env.HF_NB_WHISPER_MEDIUM_URL || process.env.HF_NB_WHISPER_LARGE_URL),
    });
  } catch (e: any) {
    res.status(503).json({ status: "error", db: "unreachable", message: e?.message });
  }
});

(async () => {
  // Ensure session table exists. We do this ourselves rather than relying on
  // connect-pg-simple's createTableIfMissing because that feature reads
  // table.sql via __dirname, which esbuild's bundling breaks.
  if (isProd) {
    try {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "user_sessions" (
          "sid" varchar NOT NULL PRIMARY KEY,
          "sess" json NOT NULL,
          "expire" timestamp(6) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "IDX_user_sessions_expire" ON "user_sessions" ("expire")`);
    } catch (e) {
      console.error("Failed to ensure user_sessions table:", e);
    }
  }

  // Ensure optional columns exist (safe to run on every startup — IF NOT EXISTS is idempotent)
  try {
    await db.execute(sql`ALTER TABLE meeting_sessions ADD COLUMN IF NOT EXISTS series_name VARCHAR(255)`);
    await db.execute(sql`
      UPDATE meeting_sessions ms
      SET series_name = mr.name
      FROM meeting_series mr
      WHERE ms.series_id = mr.id AND ms.series_name IS NULL
    `);
  } catch (e) {
    console.error("DB startup migration warning:", e);
  }

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // Vite dev server only in development; static serving in production.
  if (isProd) {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // Listen options. `reusePort` is Linux-only; setting it on macOS/Windows
  // throws ENOTSUP, so we only enable it on Linux (Render, Replit, Docker).
  const port = parseInt(process.env.PORT || "5000", 10);
  const listenOptions: { port: number; host: string; reusePort?: boolean } = {
    port,
    host: "0.0.0.0",
  };
  if (process.platform === "linux") {
    listenOptions.reusePort = true;
  }
  httpServer.listen(listenOptions, () => {
    log(`serving on port ${port} (${process.env.NODE_ENV || "development"})`);
  });
})();
