import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * Device-local, account-scoped review queue for genuine Quick Captures.
 * Notebook records remain the source of truth; this only stores their IDs,
 * never their contents. Existing Notebook notes are intentionally not backfilled.
 */
const PREFIX = "heuresis.quick.captureReview.v1:";
const EVENT = "heuresis:quick-capture-review-change";
const MAX_IDS = 2000;
const keyFor = (userId: string) => `${PREFIX}${userId}`;

function readRaw(userId: string): string {
  try { return localStorage.getItem(keyFor(userId)) ?? "[]"; }
  catch { return "[]"; }
}
function parseIds(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string" && Boolean(id.trim())).slice(-MAX_IDS)
      : [];
  } catch { return []; }
}
function store(userId: string, ids: string[]) {
  try {
    localStorage.setItem(keyFor(userId), JSON.stringify(ids.slice(-MAX_IDS)));
    window.dispatchEvent(new CustomEvent(EVENT, { detail: userId }));
  } catch { /* The capture still exists safely in Notebook. */ }
}

/** Only call after a Quick Capture is saved (including restored pending saves). */
export function queueCaptureForReview(userId: string, recordId: string) {
  const ids = parseIds(readRaw(userId));
  if (ids.includes(recordId)) return;
  store(userId, [...ids, recordId]);
}

/** Review completion hides the capture here; it never deletes the actual note. */
export function markCaptureCleaned(userId: string, recordId: string) {
  const ids = parseIds(readRaw(userId));
  if (!ids.includes(recordId)) return;
  store(userId, ids.filter((id) => id !== recordId));
}

export function useCaptureReviewIds(userId: string): Set<string> {
  const subscribe = useCallback((notify: () => void) => {
    const key = keyFor(userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) notify();
    };
    const onLocal = (event: Event) => {
      if ((event as CustomEvent<string>).detail === userId) notify();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(EVENT, onLocal);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(EVENT, onLocal);
    };
  }, [userId]);
  const getSnapshot = useCallback(() => readRaw(userId), [userId]);
  const raw = useSyncExternalStore(subscribe, getSnapshot, () => "[]");
  return useMemo(() => new Set(parseIds(raw)), [raw]);
}
