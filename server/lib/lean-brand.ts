/**
 * Loader for LEAN Communications-merkevareprofilen. Sannhetskilde er
 * server/assets/lean-brand/tokens.json (kopiert fra lean-brand.skill).
 *
 * Eksponerer ferdigtraversede konstanter for PowerPoint-genereringen så
 * vi slipper å plukke gjennom tokens-objektet i hver call-site.
 *
 * Bygget kopierer server/assets → dist/assets (se script/build.ts), så
 * runtime-pathen er stabil enten vi kjører via tsx (dev) eller node
 * (prod-bundle).
 */
import fs from "fs";
import path from "path";

function resolveAssetsDir(): string {
  // I prod (dist/index.cjs) ligger ressursene under dist/assets. I dev (tsx)
  // ligger de fortsatt under server/assets. Vi sjekker hvilken som finnes.
  const distDir = path.resolve(process.cwd(), "dist/assets/lean-brand");
  if (fs.existsSync(distDir)) return distDir;
  return path.resolve(process.cwd(), "server/assets/lean-brand");
}

const ASSETS_DIR = resolveAssetsDir();
const TOKENS_PATH = path.join(ASSETS_DIR, "tokens.json");

interface ColorToken {
  hex: string;
  hexWithHash: string;
  rgb: [number, number, number];
  name?: string;
  usage?: string;
}

interface BrandTokens {
  colors: {
    primary: { darkBlue: ColorToken; green: ColorToken };
    surface: { paper: ColorToken; bone: ColorToken; rule: ColorToken };
    secondary: { tealLight: ColorToken; tealDark: ColorToken; lime: ColorToken };
    alert: { red: ColorToken };
    blueTints: Record<string, ColorToken>;
    neutral: Record<string, ColorToken>;
  };
  typography: {
    display: { name_powerpoint: string };
    body: { name_powerpoint: string };
    sizes_powerpoint: {
      title: [number, number];
      subtitle: [number, number];
      body: [number, number];
      caption: [number, number];
      eyebrow: number;
      slide_footer: number;
    };
  };
}

let cachedTokens: BrandTokens | null = null;

function loadTokens(): BrandTokens {
  if (cachedTokens) return cachedTokens;
  const raw = fs.readFileSync(TOKENS_PATH, "utf-8");
  cachedTokens = JSON.parse(raw) as BrandTokens;
  return cachedTokens;
}

/**
 * Forhåndstraverte brand-konstanter klare for PptxGenJS-bruk (hex uten #).
 */
export const brand = (() => {
  const t = loadTokens();
  return {
    colors: {
      darkBlue: t.colors.primary.darkBlue.hex,
      green: t.colors.primary.green.hex,
      paper: t.colors.surface.paper.hex,
      bone: t.colors.surface.bone.hex,
      rule: t.colors.surface.rule.hex,
      tealLight: t.colors.secondary.tealLight.hex,
      tealDark: t.colors.secondary.tealDark.hex,
      lime: t.colors.secondary.lime.hex,
      red: t.colors.alert.red.hex,
      blue80: t.colors.blueTints.blue80.hex,
      blue60: t.colors.blueTints.blue60.hex,
      blue40: t.colors.blueTints.blue40.hex,
      blue20: t.colors.blueTints.blue20.hex,
      greyMid: t.colors.neutral.greyMid.hex,
    },
    fonts: {
      display: t.typography.display.name_powerpoint,
      body: t.typography.body.name_powerpoint,
    },
    sizes: t.typography.sizes_powerpoint,
  };
})();

/**
 * Returnerer absolutt sti til en logo-variant. Brukes av PptxGenJS som kan
 * sluke en filsti direkte for bilde-elementer.
 */
export function logoPath(variant: "primer" | "negativ" | "svarthvitt"): string {
  return path.join(ASSETS_DIR, "assets", `logo-${variant}.png`);
}
