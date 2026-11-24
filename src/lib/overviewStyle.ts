import { useSyncExternalStore } from "react";

export type OverviewStyle = "serif" | "panel";
const KEY = "heuresis.overview.style.v1";
const EVENT = "heuresis:overview-style";

export function readOverviewStyle(): OverviewStyle {
  try { return localStorage.getItem(KEY) === "panel" ? "panel" : "serif"; }
  catch { return "serif"; }
}
export function saveOverviewStyle(style: OverviewStyle) {
  try { localStorage.setItem(KEY, style); } catch { /* device storage may be unavailable */ }
  window.dispatchEvent(new Event(EVENT));
}
function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener("storage", onChange); };
}
export function useOverviewStyle() {
  const style = useSyncExternalStore<OverviewStyle>(subscribe, readOverviewStyle, () => "serif");
  return { style, chooseStyle: saveOverviewStyle } as const;
}
