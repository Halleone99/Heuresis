import { supabase } from "./supabase";

/** A real 14-day activity window. Missing/offline RPCs throw rather than returning invented zeros. */
export type StudyActivity = {
  days: Date[];
  new: number[];
  learn: number[];
  review: number[];
};
const cache = new Map<string, { time: number; data: StudyActivity }>();
const CACHE_MS = 60_000;

function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

export async function loadStudyActivity(packIds: string[], offset = 0): Promise<StudyActivity> {
  if (!supabase) throw new Error("Study activity needs a connection.");
  const ids = Array.from(new Set(packIds.filter(Boolean))).sort();
  if (!ids.length) throw new Error("No study topics selected.");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const end = new Date(today);
  end.setDate(today.getDate() - Math.max(0, offset) * 14);
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(end);
    date.setDate(end.getDate() - 13 + index);
    return date;
  });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const key = [ids.join(","), offset, localDate(today), zone].join("|");
  const cached = cache.get(key);
  if (cached && Date.now() - cached.time < CACHE_MS) return cached.data;
  const { data, error } = await supabase.rpc("heuresis_study_activity", {
    p_pack_ids: ids,
    p_from: localDate(days[0]),
    p_to: localDate(days[13]),
    p_tz: zone,
  });
  if (error) throw error;
  const counts = new Map<string, { n: number; l: number; r: number }>();
  for (const row of (data ?? []) as Array<{ day: string; new_cards: number; exercises: number; reviews: number }>) {
    if (typeof row.day !== "string") continue;
    const existing = counts.get(row.day) ?? { n: 0, l: 0, r: 0 };
    existing.n += Number(row.new_cards) || 0;
    // RPC keeps the legacy column name "exercises", now distinct Learn cards/day.
    existing.l += Number(row.exercises) || 0;
    existing.r += Number(row.reviews) || 0;
    counts.set(row.day, existing);
  }
  const result: StudyActivity = {
    days,
    new: days.map((day) => counts.get(localDate(day))?.n ?? 0),
    learn: days.map((day) => counts.get(localDate(day))?.l ?? 0),
    review: days.map((day) => counts.get(localDate(day))?.r ?? 0),
  };
  cache.set(key, { time: Date.now(), data: result });
  return result;
}
