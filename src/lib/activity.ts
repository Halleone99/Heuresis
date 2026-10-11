import { supabase } from "./supabase";

/**
 * Read-only Study activity for Overview and Progress. Uses Heuresis's own
 * session and review-event tables — never Personal OS's Anki Tracker.
 */
export type StudySession = { id: string; pack_id: string; mode: string; started_at: string; ended_at: string | null; cards_encountered: number };
export type ReviewEvent = { event_type: string; created_at: string; pack_id: string };
export type StudyActivity = { sessions: StudySession[]; reviews: ReviewEvent[]; since: string; loadedAt: number };

export const GRADE_EVENTS = ["again", "hard", "good", "easy"] as const;
const PAGE = 1000;
let cache: { key: string; value: StudyActivity } | null = null;

async function paged<T>(query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>, cap = 20): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < cap; page += 1) {
    const { data, error } = await query(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw error;
    const list = (Array.isArray(data) ? data : []) as T[];
    rows.push(...list);
    if (list.length < PAGE) break;
  }
  return rows;
}

export async function loadStudyActivity(userId: string, days = 84, maxAgeMs = 60_000): Promise<StudyActivity> {
  const since = new Date(Date.now() - days * 86400000);
  since.setHours(0, 0, 0, 0);
  const key = `${userId}:${days}`;
  if (cache?.key === key && Date.now() - cache.value.loadedAt < maxAgeMs) return cache.value;
  if (!supabase) throw new Error("Supabase is not configured.");
  const client = supabase;
  const sinceIso = since.toISOString();
  const [sessions, reviews] = await Promise.all([
    paged<StudySession>((from, to) => client.from("heuresis_sessions")
      .select("id,pack_id,mode,started_at,ended_at,cards_encountered")
      .eq("user_id", userId).gte("started_at", sinceIso).order("started_at", { ascending: false }).range(from, to)),
    paged<ReviewEvent>((from, to) => client.from("heuresis_card_events")
      .select("event_type,created_at,pack_id")
      .eq("user_id", userId).gte("created_at", sinceIso).in("event_type", [...GRADE_EVENTS])
      .order("created_at", { ascending: false }).range(from, to)),
  ]);
  // The offline cache cannot apply range filters, so filter again on the client.
  const value: StudyActivity = {
    sessions: sessions.filter((row) => row.started_at >= sinceIso),
    reviews: reviews.filter((row) => row.created_at >= sinceIso && (GRADE_EVENTS as readonly string[]).includes(row.event_type)),
    since: sinceIso,
    loadedAt: Date.now(),
  };
  cache = { key, value };
  return value;
}

export async function loadLastStudySession(userId: string): Promise<StudySession | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.from("heuresis_sessions")
    .select("id,pack_id,mode,started_at,ended_at,cards_encountered")
    .eq("user_id", userId).order("started_at", { ascending: false }).limit(1);
  if (error) throw error;
  return (data?.[0] as StudySession | undefined) ?? null;
}

/** Monday-based week start, as a local date key. */
export function weekStart(date: Date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  return copy;
}
