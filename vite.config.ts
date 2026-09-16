import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

function stripRemoteFontImport(): Plugin {
  return {
    name: "heuresis-strip-remote-font-import",
    enforce: "pre",
    transform(code, id) {
      if (!id.replace(/\\/g, "/").endsWith("/src/styles.css")) return null;
      return {
        code: code.replace(/^@import url\(['\"]https:\/\/fonts\.googleapis\.com\/[^\n]+\);\s*/m, ""),
        map: null,
      };
    },
  };
}

export default defineConfig({
  plugins: [stripRemoteFontImport(), react()],
  clearScreen: false,
  server: {
    port: 1421,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
