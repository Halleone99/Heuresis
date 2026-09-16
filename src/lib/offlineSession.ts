import type { Session } from "@supabase/supabase-js";

const OFFLINE_SESSION_KEY = "heuresis.offline.session.v1";

export function readOfflineSession(): Session | null {
  try {
    const raw = localStorage.getItem(OFFLINE_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return parsed?.user?.id ? parsed : null;
  } catch {
    return null;
  }
}

export function rememberOfflineSession(next: Session | null) {
  try {
    if (next) localStorage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(next));
    else if (typeof navigator === "undefined" || navigator.onLine) localStorage.removeItem(OFFLINE_SESSION_KEY);
  } catch {
    // Authentication still works normally if local persistence is unavailable.
  }
}

export function offlineUserId() {
  return readOfflineSession()?.user?.id ?? null;
}
