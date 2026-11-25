import { useEffect, useState } from "react";
import { readTheme, writeTheme, type ThemePreference } from "./workspaceMemory";

export const PALETTES = [
  { id: "slate", label: "Slate", detail: "Blue grey" },
  { id: "forest", label: "Forest", detail: "Graphite with sage accents" },
  { id: "sepia", label: "Sepia", detail: "Parchment and copper" },
  { id: "neutral", label: "Neutral", detail: "Graphite and white" },
  { id: "editorial", label: "Editorial", detail: "Salmon paper and teal" },
  { id: "atelier", label: "Atelier", detail: "Ivory and burgundy" },
  { id: "aegean", label: "Aegean", detail: "Cobalt and sea glass" },
  { id: "marigold", label: "Marigold", detail: "Gold and graphite" },
] as const;

export type PalettePreference = (typeof PALETTES)[number]["id"];
const PALETTE_KEY = "heuresis.palette.v1";
const BLUE_UPGRADE_KEY = "heuresis.appearance.blue.v1";
const EVENT = "heuresis:appearance-changed";
export const DESIGNS = [
  { id: "classic", label: "Classic", detail: "Dashboard above collections" },
  { id: "refined", label: "Refined", detail: "Collections first, large serif headings" },
  { id: "aperture", label: "Aperture", detail: "Top navigation, gallery grid" },
  { id: "forma", label: "Forma", detail: "Split dashboard, compact controls" },
  { id: "studio", label: "Studio", detail: "Centred column, right navigation" },
] as const;

export type DesignPreference = (typeof DESIGNS)[number]["id"];
const DESIGN_KEY = "heuresis.design.v1";
export function readDesign(): DesignPreference {
  try {
    const saved = localStorage.getItem(DESIGN_KEY);
    return DESIGNS.find((option) => option.id === saved)?.id ?? "classic";
  }
  catch { return "classic"; }
}

export function readPalette(): PalettePreference {
  try {
    let value = localStorage.getItem(PALETTE_KEY);
    // One-time visual upgrade: replace the old sepia default on existing installs.
    // Later explicit palette choices remain untouched, including Sepia if reselected.
    if (!localStorage.getItem(BLUE_UPGRADE_KEY)) {
      if (!value || value === "sepia") {
        value = "slate";
        localStorage.setItem(PALETTE_KEY, value);
      }
      localStorage.setItem(BLUE_UPGRADE_KEY, "1");
    }
    return PALETTES.find((option) => option.id === value)?.id ?? "slate";
  } catch { /* storage may not be available */ }
  return "slate";
}
export function writePalette(value: PalettePreference) {
  try {
    localStorage.setItem(PALETTE_KEY, value);
    localStorage.setItem(BLUE_UPGRADE_KEY, "1");
  } catch { /* optional */ }
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
  document.documentElement.dataset.design = readDesign();
  document.documentElement.style.colorScheme = resolved;
  const hex = getComputedStyle(document.documentElement).getPropertyValue("--ws-page").trim();
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = hex || (resolved === "dark" ? "#1f2733" : "#eef1f4");
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
  const [design, setDesign] = useState<DesignPreference>(readDesign);
  useEffect(() => {
    const refresh = () => { setMode(readTheme()); setPalette(readPalette()); setDesign(readDesign()); };
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
  const chooseDesign = (next: DesignPreference) => {
    try { localStorage.setItem(DESIGN_KEY, next); } catch { /* optional */ }
    signal(); setDesign(readDesign());
  };
  return { mode, palette, design, chooseMode, choosePalette, chooseDesign } as const;
}

// Retain compatibility for any existing appearance consumers.
export function useThemePreference() {
  const { mode, chooseMode } = useAppearance();
  return [mode, chooseMode] as const;
}
