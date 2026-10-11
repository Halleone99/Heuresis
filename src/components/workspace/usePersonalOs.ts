import { useEffect, useState } from "react";
import { loadCapturedLanguageEntries, loadLanguageObjectives, type CapturedLanguageEntry, type LanguageObjectivesSnapshot } from "../../lib/personalOsLanguageSources";

/**
 * Read-only Personal OS context (language list, objectives, earlier captures).
 * Cached per session so switching sections does not refetch it every time.
 */
let objectivesCache: { userId: string; value: LanguageObjectivesSnapshot | null; at: number } | null = null;
let capturesCache: { userId: string; value: CapturedLanguageEntry[]; at: number } | null = null;
const FRESH_MS = 5 * 60 * 1000;

export function usePersonalOsObjectives(userId: string) {
  const [value, setValue] = useState<LanguageObjectivesSnapshot | null>(objectivesCache?.userId === userId ? objectivesCache.value : null);
  const [loaded, setLoaded] = useState(objectivesCache?.userId === userId);
  useEffect(() => {
    if (objectivesCache?.userId === userId && Date.now() - objectivesCache.at < FRESH_MS) return;
    let cancelled = false;
    void loadLanguageObjectives(userId)
      .then((data) => { objectivesCache = { userId, value: data, at: Date.now() }; if (!cancelled) setValue(data); })
      .catch(() => undefined)
      .finally(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [userId]);
  return { objectives: value, loaded };
}

export function usePersonalOsCaptures(userId: string) {
  const [value, setValue] = useState<CapturedLanguageEntry[]>(capturesCache?.userId === userId ? capturesCache.value : []);
  useEffect(() => {
    if (capturesCache?.userId === userId && Date.now() - capturesCache.at < FRESH_MS) return;
    let cancelled = false;
    void loadCapturedLanguageEntries(userId)
      .then((data) => { capturesCache = { userId, value: data, at: Date.now() }; if (!cancelled) setValue(data); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [userId]);
  return value;
}

export const DEFAULT_LANGUAGE_SUGGESTIONS = ["Chinese", "German", "Russian"];
