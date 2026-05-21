/**
 * Genererer en flersides PowerPoint-oppsummering av et erfaringsmøte med
 * Lean Communications-profilstiling og AI-genererte illustrasjoner fra
 * Lean Image Generator-MCP-en.
 *
 * Layout (4 slides):
 *   1) Tittel — mørkblå bakgrunn, negativ logo, ALL CAPS tittel, dato
 *   2) Sammendrag — hvit bakgrunn, paragraf + 1 illustrasjon
 *   3) Lærdommer — hvit bakgrunn, bullet-liste + 1 illustrasjon
 *   4) Avslutning — mørkblå bakgrunn, "Neste skritt" + logo
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

const summarySchema = z.object({
  title: z.string().max(60),
  eyebrow: z.string().max(60),
  // Kort sammendrag som passer i én tekstboks uten å bli klemt
  summary: z.string().max(380),
  // 3-5 takeaways, hver max 140 tegn — holder linje-bryt under kontroll
  takeaways: z.array(z.string().max(140)).min(3).max(5),
  // Neste skritt / avslutning — 1-2 setninger til closing slide
  nextStep: z.string().max(220),
  // 2 illustrator-prompts, én for sammendrag-slide og én for lærdom-slide
  imagePrompts: z.array(z.string().min(20).max(450)).length(2),
});

type SummaryStructure = z.infer<typeof summarySchema>;

const SYSTEM_PROMPT = `Du analyserer et erfaringsmøte og produserer en strukturert
JSON-oppsummering som skal rendres som en flersides PowerPoint med Lean
Communications-merkevaren. Skriv ALT på norsk (bokmål).

Output-felter:
- title: Kort overskrift, max 50 tegn (vil bli ALL CAPS i layouten — så pass
  på at den ser bra ut i caps. Eksempel: "TAKTPLAN — FINLAND 2026")
- eyebrow: Liten label over tittelen, format som "ERFARINGSMØTE · 21. MAI 2026"
  eller "TAKTPLANLEGGING · LEAN CONSTRUCTION". Max 50 tegn. Vil bli ALL CAPS
- summary: 2-3 setninger som svarer "hva snakket vi om og hva er
  konklusjonen". STRIKT max 380 tegn — telles og avkortes ellers. Direkte,
  vi/dere-form, ingen "kunden"/"brukeren".
- takeaways: 3-5 lærdom-bullets, hver STRIKT max 140 tegn — vi vil unngå
  linje-bryt midt i en setning. Konkret, ikke gjenta hverandre.
- nextStep: 1-2 korte setninger om neste skritt eller den ene innsikten du
  ville løftet frem. Max 220 tegn. Skal stå alene på avslutningsslidet.
- imagePrompts: NØYAKTIG 2 prompts for AI-illustrator i Byggeplass-stil
  (norske bygg-arbeidere med vernehjelm, gul vest, hørselsvern). Hver
  prompt skal beskrive en SCENE — ikke abstrakt. Eksempler:
  * "To bygg-arbeidere studerer en takt-tavle med kolonner for uke 10-13
    og post-it-lapper i grønt og hvitt. En peker, en holder tegninger."
  * "Tre bygg-arbeidere i diskusjon foran en byggeplass-modell der noen
    arbeidspakker er markert med rød tape som forsinkelser."
  Prompt 1 visualiserer hovedtemaet i møtet. Prompt 2 visualiserer en
  konkret lærdom eller forbedring.

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

// Slide-dimensjoner (LAYOUT_WIDE: 13.333 × 7.5 ")
const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const MARGIN_X = 0.6;

// Hjelpefunksjon: rad av små grønne sirkler som signaturelement
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

/**
 * Bygg flersides PPTX. Returnerer Buffer.
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
  logger.info(
    { takeaways: structure.takeaways.length, prompts: structure.imagePrompts.length },
    "Summary structure generated",
  );

  // Parallelle illustrasjoner. Skulle en feile får vi null på den, slide
  // rendres uten bilde. Loggføring skjer inne i klienten.
  const illustrations = await Promise.all(
    structure.imagePrompts.map(async (prompt) => {
      try {
        return await generateLeanIllustration({ prompt, style: "Byggeplass" });
      } catch (err: any) {
        logger.error({ err: err.message, prompt }, "Illustrator call failed");
        return null;
      }
    }),
  );

  const dateLabel = args.startedAt
    ? new Date(args.startedAt).toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" })
    : null;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = `Erfaringsmøte — ${structure.title}`;
  pptx.author = "LEAN Communications";

  const TOTAL_SLIDES = 4;

  // ============================================================
  // Slide 1 — Tittel (mørkblå bakgrunn, negativ logo)
  // ============================================================
  {
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

    // Negativ logo nederst til høyre
    slide.addImage({
      path: logoPath("negativ"),
      x: SLIDE_W - 2.6, y: 0.5, w: 1.9, h: 0.65,
      sizing: { type: "contain", w: 1.9, h: 0.65 },
    });

    addFooter(slide, 1, TOTAL_SLIDES, dateLabel, true);
  }

  // ============================================================
  // Slide 2 — Sammendrag (hvit, summary + illustrasjon 1)
  // ============================================================
  {
    const slide = pptx.addSlide();
    slide.background = { color: brand.colors.paper };

    // Primer-logo øverst til høyre
    slide.addImage({
      path: logoPath("primer"),
      x: SLIDE_W - 2.3, y: 0.3, w: 1.7, h: 0.55,
      sizing: { type: "contain", w: 1.7, h: 0.55 },
    });

    addEyebrow(slide, "Sammendrag", 0.5, brand.colors.green);

    slide.addText("HVA VI SNAKKET OM", {
      x: MARGIN_X, y: 0.85, w: SLIDE_W - 2 * MARGIN_X - 2.5, h: 0.8,
      fontFace: brand.fonts.display,
      fontSize: 28,
      bold: true,
      color: brand.colors.darkBlue,
      charSpacing: -1,
    });

    // Hårstrek under tittelen
    slide.addShape("line", {
      x: MARGIN_X, y: 1.65, w: SLIDE_W - 2 * MARGIN_X, h: 0,
      line: { color: brand.colors.rule, width: 1 },
    });

    // Summary-paragraf: venstre kolonne, 6.5" bred
    slide.addText(structure.summary, {
      x: MARGIN_X, y: 1.95, w: 6.5, h: 5.0,
      fontFace: brand.fonts.body,
      fontSize: 16,
      color: brand.colors.darkBlue,
      lineSpacing: 26,
      valign: "top",
    });

    // Illustrasjon 1: høyre kolonne
    const imgX = MARGIN_X + 6.5 + 0.4;
    const imgW = SLIDE_W - imgX - MARGIN_X;
    const imgH = 4.5;
    const img1 = illustrations[0];
    if (img1) {
      slide.addImage({
        data: `data:${img1.mimeType};base64,${img1.buffer.toString("base64")}`,
        x: imgX, y: 1.95, w: imgW, h: imgH,
        sizing: { type: "contain", w: imgW, h: imgH },
      });
    } else {
      // Placeholder-boks med tynn ramme så slide ikke ser tom ut
      slide.addShape("rect", {
        x: imgX, y: 1.95, w: imgW, h: imgH,
        fill: { color: brand.colors.rule },
        line: { color: brand.colors.rule, width: 0 },
      });
    }

    addFooter(slide, 2, TOTAL_SLIDES, dateLabel, false);
  }

  // ============================================================
  // Slide 3 — Lærdommer (hvit, bullets + illustrasjon 2)
  // ============================================================
  {
    const slide = pptx.addSlide();
    slide.background = { color: brand.colors.paper };

    slide.addImage({
      path: logoPath("primer"),
      x: SLIDE_W - 2.3, y: 0.3, w: 1.7, h: 0.55,
      sizing: { type: "contain", w: 1.7, h: 0.55 },
    });

    addEyebrow(slide, "Lærdommer", 0.5, brand.colors.green);

    slide.addText("DETTE TAR VI MED OSS", {
      x: MARGIN_X, y: 0.85, w: SLIDE_W - 2 * MARGIN_X - 2.5, h: 0.8,
      fontFace: brand.fonts.display,
      fontSize: 28,
      bold: true,
      color: brand.colors.darkBlue,
      charSpacing: -1,
    });

    slide.addShape("line", {
      x: MARGIN_X, y: 1.65, w: SLIDE_W - 2 * MARGIN_X, h: 0,
      line: { color: brand.colors.rule, width: 1 },
    });

    // Bullets-listen — venstre kolonne, hver bullet i et solid område
    const bulletRuns = structure.takeaways.map((t, idx) => ({
      text: t,
      options: {
        bullet: { code: "25CF" },
        paraSpaceAfter: 14,
        paraSpaceBefore: idx === 0 ? 0 : 4,
      },
    }));
    slide.addText(bulletRuns, {
      x: MARGIN_X, y: 1.95, w: 6.5, h: 5.0,
      fontFace: brand.fonts.body,
      fontSize: 15,
      color: brand.colors.darkBlue,
      lineSpacing: 22,
      valign: "top",
    });

    // Illustrasjon 2: høyre kolonne
    const imgX = MARGIN_X + 6.5 + 0.4;
    const imgW = SLIDE_W - imgX - MARGIN_X;
    const imgH = 4.5;
    const img2 = illustrations[1];
    if (img2) {
      slide.addImage({
        data: `data:${img2.mimeType};base64,${img2.buffer.toString("base64")}`,
        x: imgX, y: 1.95, w: imgW, h: imgH,
        sizing: { type: "contain", w: imgW, h: imgH },
      });
    } else {
      slide.addShape("rect", {
        x: imgX, y: 1.95, w: imgW, h: imgH,
        fill: { color: brand.colors.rule },
        line: { color: brand.colors.rule, width: 0 },
      });
    }

    addFooter(slide, 3, TOTAL_SLIDES, dateLabel, false);
  }

  // ============================================================
  // Slide 4 — Avslutning (mørkblå, neste skritt + logo)
  // ============================================================
  {
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

    slide.addImage({
      path: logoPath("negativ"),
      x: SLIDE_W - 2.6, y: 0.5, w: 1.9, h: 0.65,
      sizing: { type: "contain", w: 1.9, h: 0.65 },
    });

    addFooter(slide, 4, TOTAL_SLIDES, dateLabel, true);
  }

  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  const safeTitle = structure.title
    .replace(/[^\wæøåÆØÅ\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  const filename = `${safeTitle || "erfaringsmote"}.pptx`;
  return { buffer: out, filename };
}
