/**
 * Genererer en PowerPoint-oppsummering av et erfaringsmøte med Lean
 * Communications-profilstiling og AI-genererte illustrasjoner fra Lean
 * Image Generator-MCP-en.
 *
 * Brukeren velger lengde (3/5/8 sider) og bildefrekvens (hver/annenhver
 * innholdsside). Tittel-slidet og avslutningsslidet er alltid med, lengden
 * styrer hvor mange innholdsslider som ligger mellom.
 *
 * Følger lean-brand v3.0.0 (rent hvit innholdsslide, mørkblå brand-blekk,
 * grønn som krydder ≤15%, Century Gothic typografi).
 */
import PptxGenJS from "pptxgenjs";
import { z } from "zod";
import { brand, logoPath } from "./lean-brand";
import { generateLeanIllustration } from "./lean-illustrator";
import { trackedChatCompletion } from "./ai-tracker";
import { logger } from "./logger";
import type { TranscriptSegment, LessonLearned } from "@shared/schema";

export type SlideCount = 3 | 5 | 8;
export type ImageFrequency = "every" | "alternate";

const summarySchema = z.object({
  title: z.string().max(60),
  eyebrow: z.string().max(60),
  summary: z.string().max(380),
  // 3-8 takeaways så vi har nok materiale for 8-slide-layouten der hver
  // takeaway får sin egen side.
  takeaways: z.array(z.string().max(160)).min(3).max(8),
  nextStep: z.string().max(220),
  // Opptil 6 prompts, én per innholdsside. Vi bruker bare så mange som
  // layouten + bildefrekvensen trenger.
  imagePrompts: z.array(z.string().min(20).max(450)).min(1).max(6),
});

type SummaryStructure = z.infer<typeof summarySchema>;

const SYSTEM_PROMPT = `Du analyserer et erfaringsmøte og produserer en strukturert
JSON-oppsummering som rendres som en flersides PowerPoint med Lean
Communications-merkevaren. Skriv ALT på norsk (bokmål).

Output-felter:
- title: Kort overskrift, max 50 tegn (vil bli ALL CAPS).
- eyebrow: Liten label, max 50 tegn (vil bli ALL CAPS). Format:
  "ERFARINGSMØTE · 21. MAI 2026" eller "TAKTPLANLEGGING · LEAN CONSTRUCTION".
- summary: 2-3 setninger, STRIKT max 380 tegn. Direkte, vi/dere-form.
- takeaways: 3-8 lærdom-bullets, hver STRIKT max 160 tegn. Konkrete,
  ikke gjenta hverandre. Disse kan brukes hver for seg på egne slides
  i den detaljerte layouten — så hver bullet må stå alene.
- nextStep: 1-2 korte setninger om neste skritt. Max 220 tegn.
- imagePrompts: 4-6 prompts for AI-illustrator i Byggeplass-stil
  (norske bygg-arbeidere med vernehjelm, gul vest, hørselsvern).
  Hver prompt skal beskrive en KONKRET SCENE — ikke abstrakt. Eksempler:
  * "To bygg-arbeidere studerer en takt-tavle med kolonner for uke 10-13
    og post-it-lapper i grønt og hvitt. En peker, en holder tegninger."
  * "Tre bygg-arbeidere i diskusjon foran en byggeplass-modell der noen
    arbeidspakker er markert med rød tape som forsinkelser."
  Varier scenene — ikke gjentakelser av samme oppsett. Hver scene
  skal visualisere et tematisk poeng fra møtet.

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
    .slice(0, 30000);

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
  return summarySchema.parse(JSON.parse(raw));
}

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN_X = 0.6;

function addDashedSignature(slide: PptxGenJS.Slide, yPos: number, dotColor: string) {
  const dotSpacing = 0.22;
  const count = Math.floor((SLIDE_W - 2 * MARGIN_X) / dotSpacing);
  for (let i = 0; i < count; i++) {
    slide.addShape("ellipse", {
      x: MARGIN_X + i * dotSpacing,
      y: yPos,
      w: 0.08,
      h: 0.08,
      fill: { color: dotColor },
      line: { color: dotColor, width: 0 },
    });
  }
}

function addEyebrow(slide: PptxGenJS.Slide, text: string, y: number, color: string) {
  slide.addText(text.toUpperCase(), {
    x: MARGIN_X, y, w: SLIDE_W - 2 * MARGIN_X, h: 0.3,
    fontFace: brand.fonts.display,
    fontSize: brand.sizes.eyebrow + 1,
    bold: true,
    color,
    charSpacing: 4,
  });
}

function addFooter(slide: PptxGenJS.Slide, slideNum: number, total: number, dateLabel: string | null, onDark: boolean) {
  const color = onDark ? brand.colors.paper : brand.colors.darkBlue;
  const num = `${String(slideNum).padStart(2, "0")} / ${String(total).padStart(2, "0")}  ·  LEAN COMMUNICATIONS`;
  slide.addText(num, {
    x: MARGIN_X, y: 7.15, w: 8, h: 0.25,
    fontFace: brand.fonts.display,
    fontSize: brand.sizes.slide_footer,
    color,
    transparency: 40,
    charSpacing: 3,
    bold: true,
  });
  if (dateLabel) {
    slide.addText(dateLabel, {
      x: SLIDE_W - 5 - MARGIN_X, y: 7.15, w: 5, h: 0.25,
      fontFace: brand.fonts.display,
      fontSize: brand.sizes.slide_footer,
      color,
      transparency: 40,
      align: "right",
      bold: true,
    });
  }
}

function addSmallLogo(slide: PptxGenJS.Slide) {
  slide.addImage({
    path: logoPath("primer"),
    x: SLIDE_W - 2.3, y: 0.3, w: 1.7, h: 0.55,
    sizing: { type: "contain", w: 1.7, h: 0.55 },
  });
}

function addLargeLogo(slide: PptxGenJS.Slide) {
  slide.addImage({
    path: logoPath("negativ"),
    x: SLIDE_W - 2.6, y: 0.5, w: 1.9, h: 0.65,
    sizing: { type: "contain", w: 1.9, h: 0.65 },
  });
}

function addHairline(slide: PptxGenJS.Slide, y: number) {
  slide.addShape("line", {
    x: MARGIN_X, y, w: SLIDE_W - 2 * MARGIN_X, h: 0,
    line: { color: brand.colors.rule, width: 1 },
  });
}

function addImageOrPlaceholder(
  slide: PptxGenJS.Slide,
  img: { buffer: Buffer; mimeType: string } | null | undefined,
  geom: { x: number; y: number; w: number; h: number },
) {
  if (img) {
    slide.addImage({
      data: `data:${img.mimeType};base64,${img.buffer.toString("base64")}`,
      x: geom.x, y: geom.y, w: geom.w, h: geom.h,
      sizing: { type: "contain", w: geom.w, h: geom.h },
    });
  } else {
    slide.addShape("rect", {
      x: geom.x, y: geom.y, w: geom.w, h: geom.h,
      fill: { color: brand.colors.rule },
      line: { color: brand.colors.rule, width: 0 },
    });
  }
}

// ============================================================
// Slide-byggere
// ============================================================

function addTitleSlide(pptx: PptxGenJS, structure: SummaryStructure, slideNum: number, total: number, dateLabel: string | null) {
  const slide = pptx.addSlide();
  slide.background = { color: brand.colors.darkBlue };
  addEyebrow(slide, structure.eyebrow, 2.4, brand.colors.green);
  slide.addText(structure.title.toUpperCase(), {
    x: MARGIN_X, y: 2.85, w: SLIDE_W - 2 * MARGIN_X, h: 2.5,
    fontFace: brand.fonts.display,
    fontSize: 60,
    bold: true,
    color: brand.colors.paper,
    charSpacing: -2,
    valign: "top",
  });
  addDashedSignature(slide, 5.6, brand.colors.green);
  addLargeLogo(slide);
  addFooter(slide, slideNum, total, dateLabel, true);
}

function addClosingSlide(pptx: PptxGenJS, structure: SummaryStructure, slideNum: number, total: number, dateLabel: string | null) {
  const slide = pptx.addSlide();
  slide.background = { color: brand.colors.darkBlue };
  addEyebrow(slide, "Neste skritt", 2.5, brand.colors.green);
  slide.addText(structure.nextStep, {
    x: MARGIN_X, y: 2.95, w: SLIDE_W - 2 * MARGIN_X - 3, h: 3.0,
    fontFace: brand.fonts.display,
    fontSize: 36,
    bold: true,
    color: brand.colors.paper,
    charSpacing: -1,
    lineSpacing: 44,
    valign: "top",
  });
  addDashedSignature(slide, 6.1, brand.colors.green);
  addLargeLogo(slide);
  addFooter(slide, slideNum, total, dateLabel, true);
}

interface ContentSlideArgs {
  pptx: PptxGenJS;
  eyebrow: string;
  title: string;
  body: string | Array<{ text: string; options: any }>;
  image: { buffer: Buffer; mimeType: string } | null | undefined;
  showImage: boolean;
  slideNum: number;
  total: number;
  dateLabel: string | null;
  bodyFontSize?: number;
  lineSpacing?: number;
}

function addContentSlide(args: ContentSlideArgs) {
  const slide = args.pptx.addSlide();
  slide.background = { color: brand.colors.paper };
  addSmallLogo(slide);
  addEyebrow(slide, args.eyebrow, 0.5, brand.colors.green);
  slide.addText(args.title.toUpperCase(), {
    x: MARGIN_X, y: 0.85, w: SLIDE_W - 2 * MARGIN_X - 2.5, h: 0.8,
    fontFace: brand.fonts.display,
    fontSize: 28,
    bold: true,
    color: brand.colors.darkBlue,
    charSpacing: -1,
  });
  addHairline(slide, 1.65);

  if (args.showImage) {
    // 2-kolonne med bilde høyre
    const bodyW = 6.5;
    slide.addText(args.body as any, {
      x: MARGIN_X, y: 1.95, w: bodyW, h: 5.0,
      fontFace: brand.fonts.body,
      fontSize: args.bodyFontSize ?? 15,
      color: brand.colors.darkBlue,
      lineSpacing: args.lineSpacing ?? 24,
      valign: "top",
    });
    const imgX = MARGIN_X + bodyW + 0.4;
    const imgW = SLIDE_W - imgX - MARGIN_X;
    addImageOrPlaceholder(slide, args.image, { x: imgX, y: 1.95, w: imgW, h: 4.5 });
  } else {
    // Full-bredde body, ingen bilde
    slide.addText(args.body as any, {
      x: MARGIN_X, y: 1.95, w: SLIDE_W - 2 * MARGIN_X, h: 5.0,
      fontFace: brand.fonts.body,
      fontSize: args.bodyFontSize ?? 16,
      color: brand.colors.darkBlue,
      lineSpacing: args.lineSpacing ?? 26,
      valign: "top",
    });
  }

  addFooter(slide, args.slideNum, args.total, args.dateLabel, false);
}

// ============================================================
// Layout-strategier per slide-count
// ============================================================

interface ContentSlideSpec {
  eyebrow: string;
  title: string;
  body: string | Array<{ text: string; options: any }>;
  bodyFontSize?: number;
  lineSpacing?: number;
}

function buildContentSpecs(structure: SummaryStructure, slideCount: SlideCount): ContentSlideSpec[] {
  if (slideCount === 3) {
    // Sammendrag + lærdommer kombinert på én side
    const bullets = structure.takeaways.slice(0, 4).map((t, idx) => ({
      text: t,
      options: { bullet: { code: "25CF" }, paraSpaceAfter: 10, paraSpaceBefore: idx === 0 ? 0 : 4 },
    }));
    return [
      {
        eyebrow: "Sammendrag og lærdommer",
        title: "Hva vi tar med oss",
        body: [
          { text: structure.summary + "\n\n", options: { paraSpaceAfter: 12 } },
          ...bullets,
        ],
        bodyFontSize: 14,
        lineSpacing: 22,
      },
    ];
  }

  if (slideCount === 5) {
    // Sammendrag, lærdommer, neste skritt
    const bullets = structure.takeaways.slice(0, 5).map((t, idx) => ({
      text: t,
      options: { bullet: { code: "25CF" }, paraSpaceAfter: 14, paraSpaceBefore: idx === 0 ? 0 : 4 },
    }));
    return [
      {
        eyebrow: "Sammendrag",
        title: "Hva vi snakket om",
        body: structure.summary,
        bodyFontSize: 16,
        lineSpacing: 26,
      },
      {
        eyebrow: "Lærdommer",
        title: "Dette tar vi med oss",
        body: bullets,
        bodyFontSize: 15,
        lineSpacing: 22,
      },
      {
        eyebrow: "Neste skritt",
        title: "Slik følger vi opp",
        body: structure.nextStep,
        bodyFontSize: 18,
        lineSpacing: 28,
      },
    ];
  }

  // slideCount === 8: tittel + sammendrag + en-per-lærdom (max 5) + neste-skritt + avslutning
  // Innholdsslider blir derfor 6 (sammendrag + opp til 5 lærdommer)
  const lessonSpecs: ContentSlideSpec[] = structure.takeaways
    .slice(0, 5)
    .map((t, idx) => ({
      eyebrow: `Lærdom ${idx + 1} av ${Math.min(structure.takeaways.length, 5)}`,
      title: t.split(/[—–:.]/)[0].trim().slice(0, 60) || `Lærdom ${idx + 1}`,
      body: t,
      bodyFontSize: 22,
      lineSpacing: 34,
    }));
  return [
    {
      eyebrow: "Sammendrag",
      title: "Hva vi snakket om",
      body: structure.summary,
      bodyFontSize: 16,
      lineSpacing: 26,
    },
    ...lessonSpecs,
  ];
}

/**
 * Bygg PPTX. Returnerer Buffer + foreslått filnavn.
 */
export async function buildExperiencePptx(args: {
  userId: string;
  transcript: TranscriptSegment[];
  lessons: LessonLearned[];
  meetingTitle?: string | null;
  topic?: string | null;
  startedAt?: Date | null;
  slideCount?: SlideCount;
  imageFrequency?: ImageFrequency;
}): Promise<{ buffer: Buffer; filename: string }> {
  const slideCount: SlideCount = args.slideCount ?? 5;
  const imageFrequency: ImageFrequency = args.imageFrequency ?? "every";

  const structure = await generateStructuredSummary(args);

  // Først bygg layout-spesifikasjoner så vi vet hvor mange bilder vi
  // faktisk trenger — så slipper vi å fyre av MCP-kall for slides som
  // ikke skal ha bilde uansett.
  const contentSpecs = buildContentSpecs(structure, slideCount);
  const slidesWithImageFlags = contentSpecs.map((_, idx) =>
    imageFrequency === "every" ? true : idx % 2 === 0,
  );
  const imagesNeeded = slidesWithImageFlags.filter(Boolean).length;
  const prompts = structure.imagePrompts.slice(0, imagesNeeded);

  logger.info(
    { slideCount, imageFrequency, contentSlides: contentSpecs.length, imagesNeeded, promptsAvailable: structure.imagePrompts.length },
    "PPTX layout planned",
  );

  // Parallelle illustrasjoner — vi kjører bare det antallet vi trenger.
  const illustrations: Array<{ buffer: Buffer; mimeType: string } | null> = await Promise.all(
    prompts.map(async (prompt) => {
      try {
        return await generateLeanIllustration({ prompt, style: "Byggeplass" });
      } catch (err: any) {
        logger.error({ err: err.message, prompt }, "Illustrator call failed");
        return null;
      }
    }),
  );

  // Map illustrasjon til riktig innholdsside ut fra bilde-flags
  const slideImages: Array<{ buffer: Buffer; mimeType: string } | null> = [];
  let nextImg = 0;
  for (const showImage of slidesWithImageFlags) {
    slideImages.push(showImage ? (illustrations[nextImg++] ?? null) : null);
  }

  const dateLabel = args.startedAt
    ? new Date(args.startedAt).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `Erfaringsmøte — ${structure.title}`;
  pptx.author = "LEAN Communications";

  const TOTAL = slideCount;

  // 1. Tittel
  addTitleSlide(pptx, structure, 1, TOTAL, dateLabel);

  // 2..N-1: innholdsslider
  contentSpecs.forEach((spec, idx) => {
    addContentSlide({
      pptx,
      eyebrow: spec.eyebrow,
      title: spec.title,
      body: spec.body,
      image: slideImages[idx],
      showImage: slidesWithImageFlags[idx],
      slideNum: idx + 2,
      total: TOTAL,
      dateLabel,
      bodyFontSize: spec.bodyFontSize,
      lineSpacing: spec.lineSpacing,
    });
  });

  // N: avslutning
  addClosingSlide(pptx, structure, TOTAL, TOTAL, dateLabel);

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeTitle = structure.title
    .replace(/[^\wæøåÆØÅ\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const filename = `${safeTitle || "erfaringsmote"}.pptx`;
  return { buffer: out, filename };
}
