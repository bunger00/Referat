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
 * MERK: ingen filer lagres til disk. Buffer-inn, text-ut.
 */
import { openai } from "./openai-client";

export type ParsedFileResult = {
  text: string;
  sourceTypeHint: "uploaded_doc" | "uploaded_image";
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

export async function describeImageWithVision(buf: Buffer, mimeType: string): Promise<string> {
  // OpenAI vision aksepterer PNG/JPEG/WEBP/GIF, men IKKE HEIC (Apple-format
  // som iPhones tar bilder i). Konverter HEIC til JPEG først.
  let processedBuf = buf;
  let processedMime = mimeType;
  if (mimeType === "image/heic" || mimeType === "image/heif") {
    try {
      // @ts-ignore — heic-convert har ikke offisielle @types-pakke
      const heicConvert = (await import("heic-convert")).default;
      const out = await heicConvert({
        buffer: buf as any,
        format: "JPEG",
        quality: 0.85,
      });
      processedBuf = Buffer.from(out);
      processedMime = "image/jpeg";
    } catch (err: any) {
      throw new Error(`Kunne ikke konvertere HEIC-bildet: ${err?.message ?? err}`);
    }
  }

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
 * tekst-resultatet bør embeddes som.
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
    return { text: await describeImageWithVision(buffer, effectiveMime), sourceTypeHint: "uploaded_image" };
  }
  if (mimeType === "text/plain" || lower.endsWith(".txt")) {
    return { text: buffer.toString("utf-8"), sourceTypeHint: "uploaded_doc" };
  }
  throw new UnsupportedFileTypeError(mimeType);
}
