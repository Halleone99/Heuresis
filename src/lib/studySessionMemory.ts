/** A lightweight, per-topic continuation for fixed-size Study sessions.
 * It is deliberately local: no new database tables or user records.
 */
export type OpenStudySession = {
  kind: "new" | "review";
  packId: string;
  remainingIds: string[];
  /** Accepted into Learn or Review; visits, Later and Discard do not count. */
  validated?: number;
  toLearning?: number;
  toReview?: number;
  discarded?: number;
  leftForLater?: number;
  total: number;
  updatedAt: number;
};
const KEY = "heuresis.study.open.v1";
const TTL = 7 * 24 * 60 * 60 * 1000;
function readAll(): Record<string, OpenStudySession> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, OpenStudySession> : {};
  } catch { return {}; }
}
export function rememberOpenStudy(session: OpenStudySession | null, packId: string): void {
  try {
    const entries = readAll();
    if (!session || !session.remainingIds.length) delete entries[packId];
    else entries[packId] = { ...session, packId, updatedAt: Date.now() };
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch { /* Continuation is optional when storage is disabled. */ }
}
export function readOpenStudy(packId: string): OpenStudySession | null {
  const entry = readAll()[packId];
  if (!entry || entry.packId !== packId || !["new", "review"].includes(entry.kind)
      || !Array.isArray(entry.remainingIds) || !entry.remainingIds.every((id) => typeof id === "string")
      || !Number.isInteger(entry.total) || entry.total < 1
      || !Number.isFinite(entry.updatedAt) || Date.now() - entry.updatedAt > TTL
      || entry.remainingIds.length === 0) {
    if (entry) rememberOpenStudy(null, packId);
    return null;
  }
  return entry;
}
