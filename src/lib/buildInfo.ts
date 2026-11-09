/** Same source revision is embedded by Vite in browser and Tauri bundles. */
declare const __HEURESIS_BUILD_COMMIT__: string;

export const BUILD_COMMIT = __HEURESIS_BUILD_COMMIT__;

/** Presentation only: native and browser clients share application code. */
export function buildPlatform(): "Tauri" | "Web" {
  if (typeof window === "undefined") return "Web";
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return "__TAURI_INTERNALS__" in window
    || (/\bAndroid\b/i.test(userAgent) && /\bwv\b/i.test(userAgent))
    ? "Tauri" : "Web";
}
