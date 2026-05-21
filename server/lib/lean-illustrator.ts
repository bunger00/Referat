/**
 * Klient for "Lean Image Generator" MCP-serveren. Brukes til å generere
 * profileriktige illustrasjoner (Byggeplass-stil med vernehjelm/vest) for
 * PowerPoint-eksporten av erfaringsmøter.
 *
 * Endepunkt er en Streamable-HTTP MCP-server hosted på Azure Container
 * Apps. Vi bruker MCP SDK-klienten med HTTP transport — server-til-server,
 * ingen browser involvert.
 *
 * NB: generate_image bruker ~30 sek. Kall flere bilder i parallell hvis
 * du trenger flere.
 *
 * Responsformat (verifisert): generate_image returnerer 3 content-blokker:
 *  1) text: human-readable melding med "Download the full-quality image: <URL>"
 *  2) text: JSON-objekt med {download_url, mime_type, size_bytes, suggested_filename}
 *  3) image: base64-data + mimeType
 *
 * Vi laster fra download_url (mest robust og gir høyere kvalitet enn
 * base64-blokken som er nedskalert).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "./logger";

const ILLUSTRATOR_URL =
  process.env.LEAN_ILLUSTRATOR_URL ||
  "https://lean-illustrator-backend.redground-cd4c18c6.norwayeast.azurecontainerapps.io/mcp";

interface ContentBlock {
  type: string;
  data?: string;
  mimeType?: string;
  text?: string;
}

function extractDownloadUrl(content: ContentBlock[]): { url: string; mimeType?: string } | null {
  // Forsøk 1: JSON-blokk med download_url
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
  // Forsøk 2: regex-match på URL i text-blokk
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
 * Generer ett illustrasjonsbilde basert på prompt. Returnerer rå bytes +
 * mimetype klar til å embeddes i PPTX (PptxGenJS aksepterer data-URL).
 *
 * Style er "Byggeplass" som default — passer for taktplanlegging og
 * erfaringsmøter fra bygg-bransjen. "Kontor" er alternativet.
 *
 * Kaster ved feil i stedet for å returnere null — kalleren får dermed
 * synlig loggføring og kan eventuelt fallbacke.
 */
export async function generateLeanIllustration(args: {
  prompt: string;
  style?: "Byggeplass" | "Kontor";
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const client = new Client(
    { name: "referat-pptx-exporter", version: "1.0.0" },
    { capabilities: {} },
  );

  const transport = new StreamableHTTPClientTransport(new URL(ILLUSTRATOR_URL));
  await client.connect(transport);

  try {
    const result = await client.callTool({
      name: "generate_image",
      arguments: {
        prompt: args.prompt,
        style: args.style ?? "Byggeplass",
      },
    });

    const content = (result.content ?? []) as ContentBlock[];

    // 1) Prøv download_url først — gir høyere kvalitet enn inline base64
    const urlMatch = extractDownloadUrl(content);
    if (urlMatch) {
      const resp = await fetch(urlMatch.url);
      if (resp.ok) {
        const arrayBuf = await resp.arrayBuffer();
        const headerMime = resp.headers.get("content-type") || urlMatch.mimeType || "image/jpeg";
        return { buffer: Buffer.from(arrayBuf), mimeType: headerMime.split(";")[0].trim() };
      }
      logger.warn({ url: urlMatch.url, status: resp.status }, "Lean illustrator download URL failed");
    }

    // 2) Fallback: inline image-blokk
    const inline = extractInlineImage(content);
    if (inline) return inline;

    // 3) Logg responsen for diagnostikk og kast feil
    const debug = content.map((b) => ({
      type: b.type,
      hasData: !!b.data,
      hasText: !!b.text,
      textSample: b.text?.slice(0, 100),
    }));
    logger.error({ content: debug }, "Lean illustrator returned no usable image content");
    throw new Error("Illustrator-svar inneholdt ingen brukbart bilde-data");
  } finally {
    try {
      await client.close();
    } catch (err: any) {
      logger.warn({ err: err?.message }, "MCP client close failed");
    }
  }
}
