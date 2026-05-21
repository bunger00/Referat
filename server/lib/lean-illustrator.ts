/**
 * Klient for "Lean Image Generator" MCP-serveren. Bruker direkte JSON-RPC
 * over Streamable HTTP istedenfor MCP SDK-en — SDK-en feilet stille på
 * Render og vi vil ha full synlighet i hva som skjer.
 *
 * Protokoll: https://spec.modelcontextprotocol.io/specification/2025-03-26/
 *  1) POST initialize → henter sessionId fra Mcp-Session-Id-header
 *  2) POST notifications/initialized
 *  3) POST tools/call med generate_image
 *  4) Respons kan være JSON eller SSE; vi håndterer begge.
 *
 * Responsen fra generate_image inneholder 3 content-blokker:
 *  text (URL-melding), text (JSON med download_url), image (base64).
 * Vi laster fra download_url for høyest kvalitet.
 */
import { logger } from "./logger";

const ILLUSTRATOR_URL =
  process.env.LEAN_ILLUSTRATOR_URL ||
  "https://lean-illustrator-backend.redground-cd4c18c6.norwayeast.azurecontainerapps.io/mcp";

// Auth-token for Lean Image Generator MCP-serveren. Settes som
// Authorization: Bearer <token> på alle requests. Hvis ikke satt vil
// serveren returnere 401 invalid_token.
const ILLUSTRATOR_TOKEN = process.env.LEAN_ILLUSTRATOR_TOKEN || "";

const PROTOCOL_VERSION = "2025-03-26";
const TIMEOUT_MS = 120_000;

function authHeaders(): Record<string, string> {
  return ILLUSTRATOR_TOKEN ? { Authorization: `Bearer ${ILLUSTRATOR_TOKEN}` } : {};
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: any;
  error?: { code: number; message: string; data?: any };
}

interface ContentBlock {
  type: string;
  data?: string;
  mimeType?: string;
  text?: string;
}

/** Parser SSE-respons og henter den siste JSON-RPC-meldingen ut. */
function parseSseFinalMessage(text: string): JsonRpcResponse | null {
  const events = text.split(/\n\n/).filter((b) => b.trim());
  for (let i = events.length - 1; i >= 0; i--) {
    const lines = events[i].split("\n");
    let event = "message";
    const dataLines: string[] = [];
    for (const line of lines) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (event === "message" && dataLines.length > 0) {
      try {
        return JSON.parse(dataLines.join("\n")) as JsonRpcResponse;
      } catch {
        // Ikke gyldig JSON — prøv neste event
      }
    }
  }
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`Timeout etter ${ms}ms`)), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(resp: Response): Promise<JsonRpcResponse> {
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  const text = await resp.text();
  if (ct.includes("text/event-stream")) {
    const msg = parseSseFinalMessage(text);
    if (!msg) throw new Error(`SSE-respons inneholdt ingen gyldig JSON-RPC-melding: ${text.slice(0, 200)}`);
    return msg;
  }
  try {
    return JSON.parse(text) as JsonRpcResponse;
  } catch {
    throw new Error(`Klarte ikke parse JSON-respons (status ${resp.status}, ct ${ct}): ${text.slice(0, 200)}`);
  }
}

function extractDownloadUrl(content: ContentBlock[]): { url: string; mimeType?: string } | null {
  for (const block of content) {
    if (block.type !== "text" || !block.text) continue;
    try {
      const parsed = JSON.parse(block.text);
      if (typeof parsed?.download_url === "string") {
        return {
          url: parsed.download_url,
          mimeType: typeof parsed.mime_type === "string" ? parsed.mime_type : undefined,
        };
      }
    } catch {
      // ikke JSON — fortsett
    }
  }
  for (const block of content) {
    if (block.type !== "text" || !block.text) continue;
    const match = block.text.match(/https?:\/\/[^\s)]+\.(?:png|jpe?g|webp)(?:\?[^\s)]*)?/i);
    if (match) return { url: match[0] };
  }
  return null;
}

function extractInlineImage(content: ContentBlock[]): { buffer: Buffer; mimeType: string } | null {
  for (const block of content) {
    if (block.type === "image" && typeof block.data === "string") {
      return {
        buffer: Buffer.from(block.data, "base64"),
        mimeType: block.mimeType || "image/jpeg",
      };
    }
  }
  return null;
}

/**
 * Generer ett illustrasjonsbilde basert på prompt. Kaster ved feil med
 * detaljerte meldinger så kalleren kan logge eller surface'e dem.
 */
export async function generateLeanIllustration(args: {
  prompt: string;
  style?: "Byggeplass" | "Kontor";
}): Promise<{ buffer: Buffer; mimeType: string }> {
  // ===== Steg 1: initialize =====
  const initResp = await fetchWithTimeout(
    ILLUSTRATOR_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...authHeaders(),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "referat-pptx-exporter", version: "1.0.0" },
        },
      }),
    },
    30_000,
  );

  if (!initResp.ok) {
    const body = await initResp.text();
    throw new Error(`Illustrator initialize feilet (${initResp.status}): ${body.slice(0, 200)}`);
  }

  const sessionId = initResp.headers.get("Mcp-Session-Id") || initResp.headers.get("mcp-session-id");
  if (!sessionId) {
    logger.warn("Illustrator initialize gav ingen Mcp-Session-Id header — fortsetter uten");
  }

  // Forbruk init-respons så connection-en frigjøres
  await parseResponse(initResp).catch(() => null);

  // ===== Steg 2: notifications/initialized (best-effort, ingen forventet respons) =====
  try {
    await fetchWithTimeout(
      ILLUSTRATOR_URL,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json, text/event-stream",
          ...authHeaders(),
          ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      },
      10_000,
    );
  } catch (err: any) {
    logger.warn({ err: err.message }, "notifications/initialized feilet — ignorert");
  }

  // ===== Steg 3: tools/call generate_image =====
  const callResp = await fetchWithTimeout(
    ILLUSTRATOR_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        ...authHeaders(),
        ...(sessionId ? { "Mcp-Session-Id": sessionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "generate_image",
          arguments: {
            prompt: args.prompt,
            style: args.style ?? "Byggeplass",
          },
        },
      }),
    },
    TIMEOUT_MS,
  );

  if (!callResp.ok) {
    const body = await callResp.text();
    throw new Error(`tools/call feilet (${callResp.status}): ${body.slice(0, 300)}`);
  }

  const msg = await parseResponse(callResp);
  if (msg.error) {
    throw new Error(`JSON-RPC error: ${msg.error.message} (code ${msg.error.code})`);
  }

  const content = (msg.result?.content ?? []) as ContentBlock[];
  if (content.length === 0) {
    throw new Error("Illustrator-svar manglet content");
  }

  // Foretrukket vei: download_url (høyere kvalitet enn inline base64)
  const urlMatch = extractDownloadUrl(content);
  if (urlMatch) {
    const dlResp = await fetchWithTimeout(urlMatch.url, {}, 30_000);
    if (dlResp.ok) {
      const arrayBuf = await dlResp.arrayBuffer();
      const headerMime = dlResp.headers.get("content-type") || urlMatch.mimeType || "image/jpeg";
      return { buffer: Buffer.from(arrayBuf), mimeType: headerMime.split(";")[0].trim() };
    }
    logger.warn({ url: urlMatch.url, status: dlResp.status }, "Lean illustrator download URL HTTP-feilet — prøver inline");
  }

  // Fallback: inline image-blokk
  const inline = extractInlineImage(content);
  if (inline) return inline;

  const debug = content.map((b) => ({
    type: b.type,
    hasData: !!b.data,
    hasText: !!b.text,
    textSample: b.text?.slice(0, 100),
  }));
  logger.error({ content: debug }, "Lean illustrator returned no usable image content");
  throw new Error(`Illustrator ga ingen brukbart bildedata (blocks: ${JSON.stringify(debug)})`);
}
