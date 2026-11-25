import { useSyncExternalStore } from "react";

export type NotesVersion = "classic" | "2.0";
const KEY = "heuresis.notes.version.v1";
const EVENT = "heuresis:notes-version-changed";
let fallback: NotesVersion = "classic";

function readNotesVersion(): NotesVersion {
  try { return localStorage.getItem(KEY) === "2.0" ? "2.0" : "classic"; }
  catch { return fallback; }
}

export function writeNotesVersion(version: NotesVersion) {
  fallback = version;
  try { localStorage.setItem(KEY, version); } catch { /* Optional device preference. */ }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => { if (event.key === KEY || event.key === null) onChange(); };
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useNotesVersion() {
  return useSyncExternalStore<NotesVersion>(subscribe, readNotesVersion, () => "classic");
}
