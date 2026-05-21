/**
 * Genererer en én-sides PowerPoint-oppsummering av et erfaringsmøte med
 * Lean Communications-profilstiling og AI-genererte illustrasjoner fra
 * Lean Image Generator-MCP-en.
 *
 * Stilen følger lean-brand v3.0.0 (rent hvit innholdsslide, mørkblå
 * brand-blekk, grønn som krydder, Century Gothic typografi).
 */
import PptxGenJS from "pptxgenjs";
import { z } from "zod";
import { brand, logoPath } from "./lean-brand";
import { generateLeanIllustration } from "./lean-illustrator";
import { trackedChatCompletion } from "./ai-tracker";
import { logger } from "./logger";
import type { TranscriptSegment, LessonLearned } from "@shared/schema";

const summarySchema = z.object({
  title: z.string().max(80),
  date: z.string().optional(),
  eyebrow: z.string().max(60),
  summary: z.string().max(450),
  takeaways: z.array(z.string().max(160)).min(2).max(5),
  imagePrompts: z.array(z.string().min(20).max(450)).min(1).max(2),
});

type SummaryStructure = z.infer<typeof summarySchema>;

const SYSTEM_PROMPT = `Du analyserer et erfaringsmøte og produserer en strukturert
JSON-oppsummering som skal rendres på én PowerPoint-side med Lean Communications-
merkevaren. Skriv ALT på norsk (bokmål).

Felter:
- title: Kort overskrift, max 60 tegn (vil bli ALL CAPS i layouten)
- eyebrow: Liten label over tittelen, format: "ERFARINGSMØTE · <DATO>" eller
  "TAKTPLANLEGGING · LEAN CONSTRUCTION". Max 60 tegn, vil bli ALL CAPS
- summary: 2-3 setninger, 280-450 tegn. Direkte og kortfattet (vi/dere, ikke
  "kunden"). Punktum etter helte utsagn er greit.
- takeaways: 3-5 lærdom-bullets, hver max 160 tegn. Fokus på det leseren bør
  ta med seg fra møtet. Konkret, ikke gjenta hverandre.
- imagePrompts: 1-2 prompts for AI-illustrator. Hver prompt beskriver en
  illustrasjon i Byggeplass-stil (bygg-arbeidere med vernehjelm + vest)
  som kobler til møtets tematikk. F.eks. "To bygg-arbeidere ser på en
  takt-tavle med post-it-lapper på en byggeplass". Vær konkret om scene,
  handling og kontekst — ikke abstrakt.

Output: KUN gyldig JSON, ingen markdown-fences, ingen kommentarer.`;

async function generateStructuredSummary(args: {
  userId: string;
  transcript: TranscriptSegment[];
  lessons: LessonLearned[];
  meetingTitle?: string | null;
  topic?: string | null;
  startedAt?: Date | null;
}): Promise<SummaryStructure> {
  const transcriptText = args.transcript
    .map((s) => `[${s.timestamp}] ${s.speaker}: ${s.text}`)
    .join("\n")
    .slice(0, 30000); // ikke sprenge context-budsjettet

  const lessonsBlock = args.lessons.length
    ? args.lessons
        .map((l) => `• [${l.status}] ${l.title}: ${l.problem} → ${l.solution}`)
        .join("\n")
    : "(ingen lagrede lærdommer ennå)";

  const dateLabel = args.startedAt
    ? new Date(args.startedAt).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const userPrompt = [
    args.topic?.trim() ? `TEMA: ${args.topic.trim()}` : null,
    args.meetingTitle ? `MØTETITTEL: ${args.meetingTitle}` : null,
    dateLabel ? `DATO: ${dateLabel}` : null,
    `LAGREDE LÆRDOMMER:\n${lessonsBlock}`,
    `\nTRANSKRIPT:\n${transcriptText || "(tomt)"}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const resp = (await trackedChatCompletion(
    { endpoint: "/api/experience/export-pptx", userId: args.userId },
    {
      model: "gpt-5",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
    },
  )) as any;

  const raw = resp.choices?.[0]?.message?.content ?? "{}";
  const parsed = summarySchema.parse(JSON.parse(raw));
  if (!parsed.date && dateLabel) parsed.date = dateLabel;
  return parsed;
}

/**
 * Bygg én-side PPTX. Returnerer Buffer som rute-håndtereren kan stream-e
 * ut som application/vnd.openxmlformats-officedocument.presentationml.presentation.
 */
export async function buildExperiencePptx(args: {
  userId: string;
  transcript: TranscriptSegment[];
  lessons: LessonLearned[];
  meetingTitle?: string | null;
  topic?: string | null;
  startedAt?: Date | null;
}): Promise<{ buffer: Buffer; filename: string }> {
  const structure = await generateStructuredSummary(args);
  logger.info({ takeaways: structure.takeaways.length, prompts: structure.imagePrompts.length }, "Summary structure generated");

  // Generer illustrasjoner i parallell — hver tar ~30s
  const illustrations = await Promise.all(
    structure.imagePrompts.map(async (prompt) => {
      try {
        const img = await generateLeanIllustration({ prompt, style: "Byggeplass" });
        return img;
      } catch (err: any) {
        logger.warn({ err: err.message, prompt }, "Illustrator failed (slide vil mangle bilde)");
        return null;
      }
    }),
  );

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.333 x 7.5"
  pptx.title = `Erfaringsmøte — ${structure.title}`;
  pptx.author = "LEAN Communications";

  const slide = pptx.addSlide();
  slide.background = { color: brand.colors.paper };

  // ===== Header-band: eyebrow + logo =====
  slide.addText(structure.eyebrow.toUpperCase(), {
    x: 0.6, y: 0.4, w: 8, h: 0.3,
    fontFace: brand.fonts.display,
    fontSize: brand.sizes.eyebrow + 1,
    bold: true,
    color: brand.colors.green,
    charSpacing: 4, // ≈ letter-spacing 0.14em
  });

  // Liten logo øverst til høyre (primer på hvit bakgrunn)
  slide.addImage({
    path: logoPath("primer"),
    x: 11.2, y: 0.3, w: 1.7, h: 0.55,
    sizing: { type: "contain", w: 1.7, h: 0.55 },
  });

  // ===== Tittel =====
  slide.addText(structure.title.toUpperCase(), {
    x: 0.6, y: 0.75, w: 9.5, h: 0.9,
    fontFace: brand.fonts.display,
    fontSize: 32,
    bold: true,
    color: brand.colors.darkBlue,
    charSpacing: -1, // tett tracking
  });

  // Hårstrek-linje under tittelen
  slide.addShape("line", {
    x: 0.6, y: 1.7, w: 12.1, h: 0,
    line: { color: brand.colors.rule, width: 1 },
  });

  // ===== Summary-paragraf =====
  slide.addText(structure.summary, {
    x: 0.6, y: 1.95, w: 7.0, h: 1.2,
    fontFace: brand.fonts.body,
    fontSize: 14,
    color: brand.colors.darkBlue,
    lineSpacing: 22,
    valign: "top",
  });

  // ===== Lærdommer (venstre kolonne under summary) =====
  slide.addText("LÆRDOMMER", {
    x: 0.6, y: 3.3, w: 7.0, h: 0.3,
    fontFace: brand.fonts.display,
    fontSize: brand.sizes.eyebrow + 1,
    bold: true,
    color: brand.colors.green,
    charSpacing: 4,
  });

  const takeawaysText = structure.takeaways.map((t) => ({
    text: t,
    options: {
      bullet: { code: "25CF" }, // ● solid mørk-blå
      indentLevel: 0,
      paraSpaceAfter: 6,
    },
  }));
  slide.addText(takeawaysText, {
    x: 0.6, y: 3.65, w: 7.0, h: 3.0,
    fontFace: brand.fonts.body,
    fontSize: 13,
    color: brand.colors.darkBlue,
    valign: "top",
    lineSpacing: 18,
  });

  // ===== Illustrasjoner (høyre kolonne) =====
  const imageX = 8.0;
  const imageW = 4.7;
  const imageH = 2.4;
  illustrations.forEach((img, idx) => {
    if (!img) return;
    const y = 1.95 + idx * (imageH + 0.25);
    slide.addImage({
      data: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
      x: imageX, y, w: imageW, h: imageH,
      sizing: { type: "cover", w: imageW, h: imageH },
    });
  });

  // ===== Stiplet linje (LEAN-signaturen) — rad av små grønne sirkler =====
  // Tegn ~30 sirkler horisontalt nederst som rytme-element
  const dotY = 6.85;
  const dotSpacing = 0.22;
  for (let i = 0; i < 28; i++) {
    slide.addShape("ellipse", {
      x: 0.6 + i * dotSpacing, y: dotY, w: 0.08, h: 0.08,
      fill: { color: brand.colors.green },
      line: { color: brand.colors.green, width: 0 },
    });
  }

  // ===== Footer =====
  slide.addText(`01 / 01  ·  LEAN COMMUNICATIONS`, {
    x: 0.6, y: 7.15, w: 6, h: 0.25,
    fontFace: brand.fonts.display,
    fontSize: brand.sizes.slide_footer,
    color: brand.colors.darkBlue,
    transparency: 40,
    charSpacing: 3,
    bold: true,
  });

  if (structure.date) {
    slide.addText(structure.date, {
      x: 7, y: 7.15, w: 5.7, h: 0.25,
      fontFace: brand.fonts.display,
      fontSize: brand.sizes.slide_footer,
      color: brand.colors.darkBlue,
      transparency: 40,
      align: "right",
      bold: true,
    });
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeTitle = structure.title.replace(/[^\wæøåÆØÅ\s-]/g, "").trim().replace(/\s+/g, "-");
  const filename = `${safeTitle || "erfaringsmote"}.pptx`;
  return { buffer: out, filename };
}
