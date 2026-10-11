import { useEffect, useState } from "react";
import { readTheme, writeTheme, type ThemePreference } from "./workspaceMemory";

const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

export function effectiveTheme(preference: ThemePreference): "light" | "dark" {
  if (preference === "system") return media()?.matches ? "dark" : "light";
  return preference;
}

/** Apply the stored appearance to this window (main app, Capture and review windows alike). */
export function applyTheme(preference: ThemePreference = readTheme()) {
  if (typeof document === "undefined") return;
  const theme = effectiveTheme(preference);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readTheme);
  useEffect(() => {
    applyTheme(preference);
    const query = media();
    const onSystem = () => { if (preference === "system") applyTheme(preference); };
    const onStorage = (event: StorageEvent) => { if (event.key === "heuresis.theme.v1") setPreference(readTheme()); };
    query?.addEventListener?.("change", onSystem);
    window.addEventListener("storage", onStorage);
    return () => { query?.removeEventListener?.("change", onSystem); window.removeEventListener("storage", onStorage); };
  }, [preference]);
  const update = (next: ThemePreference) => { writeTheme(next); setPreference(next); };
  return [preference, update] as const;
}
