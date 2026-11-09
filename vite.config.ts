import { execFileSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Embed the Git revision in both Vercel and Tauri builds, without any secrets.
// Git is available for local/native builds; Vercel may inject the source SHA.
function sourceRevision() {
  const supplied = process.env.VERCEL_GIT_COMMIT_SHA || process.env.HEURESIS_BUILD_COMMIT;
  if (supplied && /^[0-9a-f]{7,40}$/i.test(supplied)) return supplied;
  try {
    const gitSha = execFileSync("git", ["rev-parse", "--verify", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return /^[0-9a-f]{7,40}$/i.test(gitSha) ? gitSha : "unknown";
  } catch {
    return "unknown";
  }
}

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
  define: { __HEURESIS_BUILD_COMMIT__: JSON.stringify(sourceRevision()) },
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
