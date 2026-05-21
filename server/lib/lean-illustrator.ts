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
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "./logger";

const ILLUSTRATOR_URL =
  process.env.LEAN_ILLUSTRATOR_URL ||
  "https://lean-illustrator-backend.redground-cd4c18c6.norwayeast.azurecontainerapps.io/mcp";

/**
 * Generer ett illustrasjonsbilde basert på prompt. Returnerer rå bytes +
 * mimetype klar til å embeddes i PPTX (PptxGenJS aksepterer data-URL).
 *
 * Style er "Byggeplass" som default — passer for taktplanlegging og
 * erfaringsmøter fra bygg-bransjen. "Kontor" er alternativet.
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

    // MCP-svaret kan inneholde flere content-blokker. Vi leter etter første
    // image-blokk (base64) — tilstrekkelig for embedding i PPTX.
    const content = (result.content ?? []) as Array<{
      type: string;
      data?: string;
      mimeType?: string;
      text?: string;
    }>;
    const imageBlock = content.find((b) => b.type === "image" && b.data);
    if (imageBlock?.data) {
      return {
        buffer: Buffer.from(imageBlock.data, "base64"),
        mimeType: imageBlock.mimeType || "image/png",
      };
    }

    // Fallback: tekst-blokk har ofte download_url. Last ned via fetch.
    const textBlocks = content.filter((b) => b.type === "text" && b.text);
    for (const tb of textBlocks) {
      // Forsøk å hente download_url fra en JSON-formatert tekstblokk
      try {
        const parsed = JSON.parse(tb.text!);
        if (typeof parsed?.download_url === "string") {
          const resp = await fetch(parsed.download_url);
          if (resp.ok) {
            const arrayBuf = await resp.arrayBuffer();
            const contentType = resp.headers.get("content-type") || "image/png";
            return { buffer: Buffer.from(arrayBuf), mimeType: contentType };
          }
        }
      } catch {
        // ikke JSON — fortsett
      }
      // Rå-URL i tekstblokk?
      const urlMatch = tb.text!.match(/https?:\/\/\S+\.(?:png|jpg|jpeg|webp)/i);
      if (urlMatch) {
        const resp = await fetch(urlMatch[0]);
        if (resp.ok) {
          const arrayBuf = await resp.arrayBuffer();
          const contentType = resp.headers.get("content-type") || "image/png";
          return { buffer: Buffer.from(arrayBuf), mimeType: contentType };
        }
      }
    }

    throw new Error("Illustrator-svar inneholdt verken bilde-data eller download_url");
  } finally {
    try {
      await client.close();
    } catch (err: any) {
      logger.warn({ err: err?.message }, "MCP client close failed");
    }
  }
}
