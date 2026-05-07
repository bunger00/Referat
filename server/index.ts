// IMPORTANT: env validation must run before any module that reads env at
// import time (db.ts, etc). Keep this as the first import.
import "./env";

import express, { type Request, type Response, type NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { db } from "./db";
import { sql } from "drizzle-orm";

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

const isProd = process.env.NODE_ENV === "production";

// Trust proxy when behind reverse proxy (Render, Replit, nginx, etc.)
// Needed so req.protocol/req.secure reflect the original HTTPS request even
// though express receives plain HTTP from the proxy. Auth tokens are validated
// from headers, not cookies, but we still want correct request metadata.
if (isProd) {
  app.set("trust proxy", 1);
}

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
  // Drizzle migrations are applied via `npm run db:push` at build time, so by
  // the time the server boots all tables already match the current schema.
  // No runtime ALTER TABLE patching is needed anymore.

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
