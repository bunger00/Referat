import pino from "pino";

/**
 * Strukturert logger med pino. JSON-output i prod (parsbar i Render),
 * pretty-output i dev (lesbar i terminal).
 *
 * To bruksmønstre:
 *  - Strict (foretrukket): logger.info({ userId }, "msg") → strukturert
 *  - Backward-compat: logger.info("text:", value) → "text: value" som message
 *
 * Den ekste compat-laget over pino-instansen lar oss migrere gradvis fra
 * console.* uten å rebearbeide hver call-site.
 */
const isProd = process.env.NODE_ENV === "production";

const pinoInstance = pino({
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
    paths: [
      "*.password",
      "*.access_token",
      "*.refresh_token",
      "req.headers.authorization",
      "req.headers.cookie",
      "*.audio",
      "*.imageData",
    ],
    censor: "[redacted]",
  },
});

function safeStringify(arg: unknown): string {
  if (arg === null || arg === undefined) return String(arg);
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function makeMethod(level: "info" | "warn" | "error" | "debug" | "fatal" | "trace") {
  return (...args: unknown[]) => {
    if (args.length === 0) return;
    const first = args[0];
    // Strict pino-style: (obj, msg)
    if (typeof first === "object" && first !== null && !(first instanceof Error)) {
      const rest = args.slice(1);
      const msg = rest.map(safeStringify).join(" ");
      (pinoInstance as any)[level](first, msg);
      return;
    }
    // Backward-compat console-style: ("msg", arg, arg)
    if (first instanceof Error) {
      (pinoInstance as any)[level]({ err: first }, args.slice(1).map(safeStringify).join(" "));
      return;
    }
    const msg = args.map(safeStringify).join(" ");
    (pinoInstance as any)[level](msg);
  };
}

export const logger = {
  info: makeMethod("info"),
  warn: makeMethod("warn"),
  error: makeMethod("error"),
  debug: makeMethod("debug"),
  fatal: makeMethod("fatal"),
  trace: makeMethod("trace"),
  child: (bindings: Record<string, unknown>) => pinoInstance.child(bindings),
};

export function childLogger(bindings: Record<string, unknown>) {
  return pinoInstance.child(bindings);
}
