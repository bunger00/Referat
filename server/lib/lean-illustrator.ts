/**
 * Genererer illustrasjoner i Lean Communications-stil via OpenAI's
 * gpt-image-1. Bruker samme OPENAI_API_KEY som resten av appen.
 *
 * Stil: stick-figures med grønn hjelm/hørselsvern, svart arbeidsklær
 * med grønt slips, hvit bakgrunn, strenge farger (kun hvit/svart/
 * lime-grønn). Tilsvarer brukerens egne brand-illustrasjoner.
 *
 * Funksjons-signaturen matcher den gamle MCP-baserte klienten så
 * pptx-summary.ts ikke trenger endringer.
 */
import { openai } from "./openai-client";
import { logger } from "./logger";

const STYLE_PREAMBLE = `Illustration in the Lean Communications brand
style — friendly minimal vector-cartoon.

STRICT visual rules:
- Pure white background, completely flat (no gradient, no texture).
- Bold black outlines, 3-4 pixels thick, hand-drawn feel.
- Color palette is RESTRICTED to ONLY these three colors:
  * White
  * Black
  * Lime green (hex #79B929)
- No other colors. No shadows. No gradients. No shading.

Characters: simple stick-figures with oval heads. Faces show only two
small black dots for eyes and a small simple smile — no other facial
features. Each worker wears:
  * Bright lime green construction hard hat with brim
  * Round safety goggles (two circular white lenses with black frames)
  * Black hearing protection earmuffs with green ear cups
  * Black coveralls or work shirt with a thick lime green tie running
    down the chest
  * Arms and legs drawn as bold black lines

Construction equipment (cranes, excavators, mixers, trucks, work
tables, takt boards, post-it notes) follows the same outlined style
with green and white fills only.

Composition: lots of white space, characters and objects arranged
purposefully. Friendly, approachable, suitable for a corporate Lean
Construction brand presentation.

SCENE TO DRAW:
`;

export async function generateLeanIllustration(args: {
  prompt: string;
  style?: "Byggeplass" | "Kontor";
}): Promise<{ buffer: Buffer; mimeType: string }> {
  const fullPrompt = STYLE_PREAMBLE + args.prompt;

  logger.info(
    { promptPreview: args.prompt.slice(0, 80) },
    "Generating Lean illustration via OpenAI",
  );

  const resp = await openai.images.generate({
    model: "gpt-image-1",
    prompt: fullPrompt,
    n: 1,
    size: "1536x1024",
    quality: "medium",
    background: "opaque",
    output_format: "png",
  });

  const b64 = resp.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image-svar manglet b64_json");
  }

  return {
    buffer: Buffer.from(b64, "base64"),
    mimeType: "image/png",
  };
}
