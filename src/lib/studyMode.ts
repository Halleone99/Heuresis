import { useSyncExternalStore } from "react";

export type StudyModeChoice = "classic" | "2.1";
const KEY = "heuresis.study.mode.v1";
const EVENT = "heuresis-study-mode-changed";

export function readStudyMode(): StudyModeChoice {
  try { return localStorage.getItem(KEY) === "2.1" ? "2.1" : "classic"; }
  catch { return "classic"; }
}
export function writeStudyMode(mode: StudyModeChoice): void {
  try { localStorage.setItem(KEY, mode); } catch { /* Device preference only. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}
function subscribe(callback: () => void): () => void {
  window.addEventListener(EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}
export function useStudyMode(): StudyModeChoice {
  return useSyncExternalStore(subscribe, readStudyMode, () => "classic");
}
