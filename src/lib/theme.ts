import { useEffect, useState } from "react";
import { readTheme, writeTheme, type ThemePreference } from "./workspaceMemory";

export type PalettePreference = "slate" | "forest" | "sepia" | "neutral";
const PALETTE_KEY = "heuresis.palette.v1";
const EVENT = "heuresis:appearance-changed";

export function readPalette(): PalettePreference {
  try {
    const value = localStorage.getItem(PALETTE_KEY);
    if (value === "slate" || value === "forest" || value === "sepia" || value === "neutral") return value;
  } catch { /* storage may not be available */ }
  // Preserve the familiar look on existing devices until the user chooses.
  return "sepia";
}
export function writePalette(value: PalettePreference) {
  try { localStorage.setItem(PALETTE_KEY, value); } catch { /* optional */ }
}
const media = () => typeof window !== "undefined" && window.matchMedia
  ? window.matchMedia("(prefers-color-scheme: dark)") : null;
export function effectiveTheme(preference: ThemePreference): "light" | "dark" {
  return preference === "system" ? (media()?.matches ? "dark" : "light") : preference;
}

/** One source of truth across main, Capture and Cosmos windows. */
export function applyAppearance(mode: ThemePreference = readTheme(), palette: PalettePreference = readPalette()) {
  if (typeof document === "undefined") return;
  const resolved = effectiveTheme(mode);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.palette = palette;
  document.documentElement.style.colorScheme = resolved;
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--ws-page").trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = hex || (resolved === "dark" ? "#161412" : "#f2efe9");
  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().setTheme(resolved).catch(() => undefined)).catch(() => undefined);
  }
}
export const applyTheme = applyAppearance;

export function watchAppearance() {
  const update = () => applyAppearance();
  const q = media();
  const changed = () => { update(); };
  window.addEventListener("storage", changed);
  window.addEventListener("focus", changed);
  window.addEventListener(EVENT, changed);
  q?.addEventListener?.("change", changed);
  return () => {
    window.removeEventListener("storage", changed);
    window.removeEventListener("focus", changed);
    window.removeEventListener(EVENT, changed);
    q?.removeEventListener?.("change", changed);
  };
}
function signal() {
  applyAppearance();
  window.dispatchEvent(new Event(EVENT));
}

export function useAppearance() {
  const [mode, setMode] = useState<ThemePreference>(readTheme);
  const [palette, setPalette] = useState<PalettePreference>(readPalette);
  useEffect(() => {
    const refresh = () => { setMode(readTheme()); setPalette(readPalette()); };
    window.addEventListener(EVENT, refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(EVENT, refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const chooseMode = (next: ThemePreference) => { writeTheme(next); signal(); setMode(next); };
  const choosePalette = (next: PalettePreference) => { writePalette(next); signal(); setPalette(next); };
  return { mode, palette, chooseMode, choosePalette } as const;
}

// Retain compatibility for any existing appearance consumers.
export function useThemePreference() {
  const { mode, chooseMode } = useAppearance();
  return [mode, chooseMode] as const;
}
