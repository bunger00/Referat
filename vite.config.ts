import { defineConfig, type PluginOption } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const isReplit = process.env.REPL_ID !== undefined;
const isDev = process.env.NODE_ENV !== "production";

async function loadReplitPlugins(): Promise<PluginOption[]> {
  if (!isReplit) return [];
  const plugins: PluginOption[] = [];
  const errorModal = await import("@replit/vite-plugin-runtime-error-modal");
  plugins.push(errorModal.default());
  if (isDev) {
    const [{ cartographer }, { devBanner }] = await Promise.all([
      import("@replit/vite-plugin-cartographer"),
      import("@replit/vite-plugin-dev-banner"),
    ]);
    plugins.push(cartographer(), devBanner());
  }
  return plugins;
}

export default defineConfig(async () => ({
  plugins: [react(), ...(await loadReplitPlugins())],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
}));
