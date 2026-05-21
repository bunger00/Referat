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
  // Fyldig sammendrag — bærer hele sammendragsslidet. 400-700 tegn.
  summary: z.string().min(200).max(700),
  // Korte one-liners til 3/5-slide-layouten der de listes som bullets.
  takeaways: z.array(z.string().max(180)).min(3).max(8),
  // For 8-slide-layouten: én utdypet lærdom per slide. Bodyen elaborer
  // hvorfor lærdommen er viktig og hva den betyr i praksis (400-700 tegn).
  detailedLessons: z
    .array(
      z.object({
        title: z.string().max(60),
        body: z.string().min(200).max(700),
      }),
    )
    .min(3)
    .max(5),
  nextStep: z.string().min(80).max(280),
  imagePrompts: z.array(z.string().min(20).max(450)).min(1).max(6),
});

type SummaryStructure = z.infer<typeof summarySchema>;

const SYSTEM_PROMPT = `Du produserer en JSON-strukturert PowerPoint-oppsummering av et
erfaringsmøte med Lean Communications-merkevaren. Skriv ALT på norsk
(bokmål).

## VIKTIG: Bruk LAGREDE LÆRDOMMER som autoritativ kilde

Hvis brukerinputen inneholder LAGREDE LÆRDOMMER, er disse brukerens
ferdig-kurerte liste. Bygg takeaways og detailedLessons FRA disse
lærdommene — IKKE gjenoppfinn nye fra transkriptet.

- Velg de mest representative og handlingsorienterte (3-8 totalt for
  takeaways, 3-5 for detailedLessons)
- Bruk lærdommenes egne title/solution som utgangspunkt
- Ikke parafraser unødig — brukeren har allerede godkjent formuleringen
- Hvis det er flere enn 8 lagrede lærdommer, prioriter de mest
  fundamentale og dekkende, og kombinér beslektede

Hvis det IKKE finnes lagrede lærdommer, generer fra transkriptet selv.

## Felter

- title: Kort overskrift, max 50 tegn (vil bli ALL CAPS).
- eyebrow: Liten label, max 50 tegn (vil bli ALL CAPS). Format:
  "ERFARINGSMØTE · 21. MAI 2026" eller "TAKTPLANLEGGING · LEAN CONSTRUCTION".
- summary: 3-5 setninger som FYLLER sammendragsslidet, 400-700 tegn.
  Forklar hva møtet handlet om, hvilke spørsmål dere jobbet med, og
  hva hovedinnsikten er. Direkte, vi/dere-form.
- takeaways: 3-8 korte bullets (max 180 tegn hver) for lista-slidet.
  Hvis lagrede lærdommer finnes, hent fra dem.
- detailedLessons: 3-5 utdypede lærdommer for 8-side-layouten — én per
  slide. Hver har title (max 60 tegn, blir ALL CAPS) og body (300-700
  tegn). Hvis lagrede lærdommer finnes: bruk title fra lærdommen og bygg
  body fra problem + løsning som tett prosa med konkret kontekst og
  praktisk anvendelse. IKKE bare én setning — bodyen skal fylle en slide.
- nextStep: 2-3 setninger (80-280 tegn) om konkrete neste skritt.
  Vær konkret om hva, hvem, når. Skal stå alene på mørkblå closing
  slide. UNNGÅ klisjéer som "implementer det vi har lært" — vær spesifikk.
- imagePrompts: 4-6 prompts for AI-illustrator i Byggeplass-stil
  (norske bygg-arbeidere med vernehjelm, gul vest, hørselsvern).
  KONKRET SCENE — ikke abstrakt. Eksempler:
  * "To bygg-arbeidere studerer en takt-tavle med kolonner for uke 10-13
    og post-it-lapper i grønt og hvitt. En peker, en holder tegninger."
  * "Tre bygg-arbeidere i diskusjon foran en byggeplass-modell der noen
    arbeidspakker er markert med rød tape som forsinkelser."
  Varier scenene.

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

  // Negativ logo øverst til høyre, samme som tittelslidet
  slide.addImage({
    path: logoPath("negativ"),
    x: SLIDE_W - 2.6, y: 0.5, w: 1.9, h: 0.65,
    sizing: { type: "contain", w: 1.9, h: 0.65 },
  });

  // Topp-stiplet linje (LEAN-signaturen)
  addDashedSignature(slide, 1.95, brand.colors.green);

  // Eyebrow + stor takk-tittel — gir slidet en tydeligere visuell tyngde
  addEyebrow(slide, "Avslutning", 2.4, brand.colors.green);

  slide.addText("TUSEN TAKK.", {
    x: MARGIN_X, y: 2.8, w: SLIDE_W - 2 * MARGIN_X, h: 1.4,
    fontFace: brand.fonts.display,
    fontSize: 72,
    bold: true,
    color: brand.colors.paper,
    charSpacing: -2,
    valign: "top",
  });

  // Hårstrek under tittelen
  slide.addShape("line", {
    x: MARGIN_X, y: 4.4, w: SLIDE_W - 2 * MARGIN_X, h: 0,
    line: { color: brand.colors.green, width: 1 },
  });

  // Eyebrow + neste-skritt-tekst i 2-kolonne under
  slide.addText("NESTE SKRITT", {
    x: MARGIN_X, y: 4.7, w: 4, h: 0.3,
    fontFace: brand.fonts.display,
    fontSize: brand.sizes.eyebrow + 1,
    bold: true,
    color: brand.colors.green,
    charSpacing: 4,
  });

  slide.addText(structure.nextStep, {
    x: MARGIN_X, y: 5.05, w: 7.5, h: 1.9,
    fontFace: brand.fonts.body,
    fontSize: 16,
    color: brand.colors.paper,
    lineSpacing: 24,
    valign: "top",
  });

  // Høyre kolonne: kontakt-blokk i grønn per brand-guide for closing slides
  slide.addText("LEAN COMMUNICATIONS", {
    x: SLIDE_W - 4.5, y: 4.7, w: 4, h: 0.3,
    fontFace: brand.fonts.display,
    fontSize: brand.sizes.eyebrow + 1,
    bold: true,
    color: brand.colors.green,
    charSpacing: 4,
    align: "right",
  });
  slide.addText("leancommunications.no", {
    x: SLIDE_W - 4.5, y: 5.05, w: 4, h: 0.35,
    fontFace: brand.fonts.display,
    fontSize: 18,
    color: brand.colors.green,
    align: "right",
  });

  // Bunn-stiplet linje
  addDashedSignature(slide, 6.85, brand.colors.green);

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

  // Bare bygg 2-kolonne-layout hvis vi har et faktisk bilde. Hvis
  // illustrator feilet får brukeren en clean full-bredde slide istedenfor
  // en stygg grå plassholder.
  if (args.showImage && args.image) {
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
    slide.addImage({
      data: `data:${args.image.mimeType};base64,${args.image.buffer.toString("base64")}`,
      x: imgX, y: 1.95, w: imgW, h: 4.5,
      sizing: { type: "contain", w: imgW, h: 4.5 },
    });
  } else {
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
  // Innholdsslider blir derfor 6 (sammendrag + opp til 5 utdypede lærdommer)
  const lessonSlides: ContentSlideSpec[] = structure.detailedLessons
    .slice(0, 5)
    .map((lesson, idx) => ({
      eyebrow: `Lærdom ${idx + 1} av ${Math.min(structure.detailedLessons.length, 5)}`,
      title: lesson.title,
      body: lesson.body,
      bodyFontSize: 14,
      lineSpacing: 22,
    }));
  return [
    {
      eyebrow: "Sammendrag",
      title: "Hva vi snakket om",
      body: structure.summary,
      bodyFontSize: 15,
      lineSpacing: 24,
    },
    ...lessonSlides,
  ];
}

/**
 * Bygg PPTX. Returnerer Buffer + foreslått filnavn.
 */
export interface UserImage {
  filename: string;
  mimeType: string;
  buffer: Buffer;
  extractedText: string;
}

export async function buildExperiencePptx(args: {
  userId: string;
  transcript: TranscriptSegment[];
  lessons: LessonLearned[];
  // Brukerens egne opplastede bilder fra møtet (kamera, QR, fil). Brukes
  // som primære visualer på innholdsslidene — AI-illustrasjoner brukes bare
  // hvis vi har for få brukerbilder til å dekke layout-en.
  userImages?: UserImage[];
  meetingTitle?: string | null;
  topic?: string | null;
  startedAt?: Date | null;
  slideCount?: SlideCount;
  imageFrequency?: ImageFrequency;
}): Promise<{ buffer: Buffer; filename: string; illustratorStats: { attempted: number; succeeded: number; firstError: string | null } }> {
  const slideCount: SlideCount = args.slideCount ?? 5;
  const imageFrequency: ImageFrequency = args.imageFrequency ?? "every";

  const structure = await generateStructuredSummary(args);
  const userImages = args.userImages ?? [];

  // Først bygg layout-spesifikasjoner så vi vet hvor mange bilder vi
  // faktisk trenger.
  const contentSpecs = buildContentSpecs(structure, slideCount);
  const slidesWithImageFlags = contentSpecs.map((_, idx) =>
    imageFrequency === "every" ? true : idx % 2 === 0,
  );
  const slotsNeeded = slidesWithImageFlags.filter(Boolean).length;

  // Prioritert bilde-strategi:
  //   1) Brukerens egne opplastede bilder (kamera/QR/fil) — primær,
  //      siden de viser det faktiske møte-innholdet
  //   2) AI-genererte Byggeplass-illustrasjoner — fyller resterende slots
  //   3) Ingen bilde — body-tekst får full bredde
  const userImageCount = Math.min(userImages.length, slotsNeeded);
  const aiPromptsNeeded = Math.max(0, slotsNeeded - userImageCount);
  const prompts = structure.imagePrompts.slice(0, aiPromptsNeeded);

  logger.info(
    {
      slideCount, imageFrequency,
      contentSlides: contentSpecs.length, slotsNeeded,
      userImageCount, aiPromptsNeeded,
    },
    "PPTX layout planned",
  );

  let firstIllustratorError: string | null = null;
  const illustrations: Array<{ buffer: Buffer; mimeType: string } | null> = await Promise.all(
    prompts.map(async (prompt) => {
      try {
        return await generateLeanIllustration({ prompt, style: "Byggeplass" });
      } catch (err: any) {
        if (!firstIllustratorError) firstIllustratorError = err.message;
        logger.error({ err: err.message, prompt }, "Illustrator call failed");
        return null;
      }
    }),
  );
  const succeededCount = illustrations.filter((x) => x !== null).length;

  // Bygg bilde-queue: bruker-bilder først, deretter AI-illustrasjoner
  const imageQueue: Array<{ buffer: Buffer; mimeType: string } | null> = [
    ...userImages.slice(0, userImageCount).map((u) => ({ buffer: u.buffer, mimeType: u.mimeType })),
    ...illustrations,
  ];

  // Map til innholdsslider basert på bilde-flags
  const slideImages: Array<{ buffer: Buffer; mimeType: string } | null> = [];
  let nextImg = 0;
  for (const showImage of slidesWithImageFlags) {
    slideImages.push(showImage ? (imageQueue[nextImg++] ?? null) : null);
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
  return {
    buffer: out,
    filename,
    illustratorStats: {
      attempted: prompts.length,
      succeeded: succeededCount,
      firstError: firstIllustratorError,
    },
  };
}
