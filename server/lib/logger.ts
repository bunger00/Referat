import pino from "pino";

/**
 * Strukturert logger med pino. JSON-output i prod (parsbar i Render),
 * pretty-output i dev (lesbar i terminal).
 *
 * Bruk:
 *   import { logger } from "./lib/logger";
 *   logger.info({ userId, sessionId }, "Møte startet");
 *   logger.error({ err }, "Transkripsjon feilet");
 */
const isProd = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  transport: isProd
    ? undefined
    : {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss",
          ignore: "pid,hostname",
        },
      },
  redact: {
    // Aldri logg sensitive felt — viktig fordi vi har store JSON-payloads
    paths: [
      "*.password",
      "*.access_token",
      "*.refresh_token",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.audio", // base64-lyd, gigantisk og ikke nyttig
      "*.imageData",
    ],
    censor: "[redacted]",
  },
});

/** Lager en child-logger med ekstra kontekst (f.eks. userId per request). */
export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
