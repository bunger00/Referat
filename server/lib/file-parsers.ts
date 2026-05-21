/**
 * Felles fil-parsere for opplastede dokumenter. Brukes både av
 * /api/brain/upload (mating av hjernen direkte) og /api/experience/.../
 * attachments (vedlegg på erfaringsmøter). Sentralisert her slik at vi
 * har én kilde til sannhet for hva vi støtter og hvordan vi parser.
 *
 * Konvensjon: returnerer ren UTF-8 tekst. Bilder gir AI-generert
 * beskrivelse (vision-tolkning). Excel gir tab-separert tekst med
 * ark-navn som overskrift.
 *
 * For bilder returnerer vi i tillegg den bearbeidede bytene (HEIC-konvertert
 * til JPEG der det trengs), slik at kalleren kan lagre selve bildet på
 * vedlegget — ikke bare AI-tolkningen.
 */
import { openai } from "./openai-client";

export type ParsedFileResult = {
  text: string;
  sourceTypeHint: "uploaded_doc" | "uploaded_image";
  // Hvis kilden er et bilde: bytene + mimetype etter eventuell HEIC→JPEG-
  // konvertering. Brukes til å persistere bildet på vedlegget så brukeren
  // kan se det igjen senere. Udefinert for dokumenter.
  imageBuffer?: Buffer;
  imageMimeType?: string;
};

export async function parsePdfBuffer(buf: Buffer): Promise<string> {
  const mod = await import("pdf-parse");
  const fn = (mod as any).default ?? mod;
  const result = await fn(buf);
  return result.text || "";
}

export async function parseDocxBuffer(buf: Buffer): Promise<string> {
  const mod = await import("mammoth");
  const fn = (mod as any).default?.extractRawText ?? (mod as any).extractRawText;
  const result = await fn({ buffer: buf });
  return result.value || "";
}

/**
 * Parser et Excel-regneark til ren tekst. Hver ark blir et avsnitt med
 * tab-separerte rader og ark-navn som overskrift slik at AI kan lese
 * tabellen som strukturert tekst.
 */
export async function parseXlsxBuffer(buf: Buffer): Promise<string> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const sheets: string[] = [];
  for (const sheet of wb.worksheets) {
    const rows: string[] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        if (v === null || v === undefined) return;
        if (typeof v === "object" && "text" in v) cells.push(String((v as any).text));
        else if (typeof v === "object" && "result" in v) cells.push(String((v as any).result));
        else cells.push(String(v));
      });
      if (cells.length) rows.push(cells.join("\t"));
    });
    if (rows.length) sheets.push(`## Ark: ${sheet.name}\n${rows.join("\n")}`);
  }
  return sheets.join("\n\n");
}

/**
 * Konverterer HEIC/HEIF til JPEG hvis nødvendig. OpenAI vision aksepterer
 * PNG/JPEG/WEBP/GIF men ikke HEIC. Vi vil også lagre bildet i ferdig-
 * konvertert form så browseren kan vise det uten ekstra arbeid.
 */
async function ensureWebFriendlyImage(buf: Buffer, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
  if (mimeType !== "image/heic" && mimeType !== "image/heif") {
    return { buffer: buf, mimeType };
  }
  try {
    // @ts-ignore — heic-convert har ikke offisielle @types-pakke
    const heicConvert = (await import("heic-convert")).default;
    const out = await heicConvert({
      buffer: buf as any,
      format: "JPEG",
      quality: 0.85,
    });
    return { buffer: Buffer.from(out), mimeType: "image/jpeg" };
  } catch (err: any) {
    throw new Error(`Kunne ikke konvertere HEIC-bildet: ${err?.message ?? err}`);
  }
}

export async function describeImageWithVision(buf: Buffer, mimeType: string): Promise<string> {
  const { buffer: processedBuf, mimeType: processedMime } = await ensureWebFriendlyImage(buf, mimeType);
  const base64 = processedBuf.toString("base64");
  const resp = await openai.chat.completions.create({
    model: "gpt-5",
    messages: [
      {
        role: "system",
        content:
          "Du er en analytisk leser av bilder. Beskriv hva som vises slik at noen kan slå opp innholdet senere uten å se bildet. Inkluder tekst som synes, diagrammer, viktige objekter og kontekst. Svar på norsk.",
      },
      {
        role: "user",
        content: [
          { type: "text", text: "Beskriv dette bildet med fokus på kunnskapsverdi:" },
          { type: "image_url", image_url: { url: `data:${processedMime};base64,${base64}` } },
        ] as any,
      },
    ],
  });
  return resp.choices[0]?.message?.content?.trim() ?? "";
}

/**
 * Sentral parsing-funksjon som dispatcher til riktig parser basert på mimetype
 * eller filendelse. Returnerer både tekst og en hint om hvilken sourceType
 * tekst-resultatet bør embeddes som. For bilder returnerer vi også den
 * web-vennlige bytene (HEIC → JPEG) så kalleren kan lagre bildet på vedlegget.
 *
 * Kaster en `UnsupportedFileTypeError` ved ukjent filtype — kalleren kan
 * vise en presis feilmelding.
 */
export class UnsupportedFileTypeError extends Error {
  constructor(public mimeType: string) {
    super(`Filtype ikke støttet (${mimeType}). Støttede typer: PDF, Word (.docx), Excel (.xlsx), bilde, tekst.`);
    this.name = "UnsupportedFileTypeError";
  }
}

export async function parseUploadedFile(args: {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}): Promise<ParsedFileResult> {
  const { buffer, mimeType, filename } = args;
  const lower = filename.toLowerCase();

  if (mimeType === "application/pdf" || lower.endsWith(".pdf")) {
    return { text: await parsePdfBuffer(buffer), sourceTypeHint: "uploaded_doc" };
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    lower.endsWith(".docx")
  ) {
    return { text: await parseDocxBuffer(buffer), sourceTypeHint: "uploaded_doc" };
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    lower.endsWith(".xlsx") ||
    lower.endsWith(".xls")
  ) {
    return { text: await parseXlsxBuffer(buffer), sourceTypeHint: "uploaded_doc" };
  }
  if (mimeType.startsWith("image/") || lower.endsWith(".heic") || lower.endsWith(".heif")) {
    // Noen browsere/OS sender HEIC med tom mimetype — utled fra filendelse.
    const effectiveMime =
      mimeType.startsWith("image/") ? mimeType :
      lower.endsWith(".heic") ? "image/heic" :
      "image/heif";
    // Konverter en gang så vi kan bruke samme bytene til både Vision og lagring.
    const { buffer: webBuf, mimeType: webMime } = await ensureWebFriendlyImage(buffer, effectiveMime);
    const text = await describeImageWithVision(webBuf, webMime);
    return {
      text,
      sourceTypeHint: "uploaded_image",
      imageBuffer: webBuf,
      imageMimeType: webMime,
    };
  }
  if (mimeType === "text/plain" || lower.endsWith(".txt")) {
    return { text: buffer.toString("utf-8"), sourceTypeHint: "uploaded_doc" };
  }
  throw new UnsupportedFileTypeError(mimeType);
}
