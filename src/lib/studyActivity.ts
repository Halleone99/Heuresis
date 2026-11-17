import { supabase } from "./supabase";

/** A real 14-day activity window. Missing/offline RPCs throw rather than returning invented zeros. */
type DailyStageCounts = { new: number[]; learn: number[]; review: number[] };
export type StudyActivity = DailyStageCounts & {
  days: Date[];
  /** Counts per topic, so chart tooltips can show subject totals without another request. */
  byPack: Record<string, DailyStageCounts>;
};
export type StudyActivityRow = {
  day: string; pack_id?: string | null; new_cards: number; exercises: number; reviews: number;
};
const cache = new Map<string, { time: number; data: StudyActivity }>();
const CACHE_MS = 60_000;

function localDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + d;
}

function emptyCounts(length: number): DailyStageCounts {
  return { new: Array(length).fill(0), learn: Array(length).fill(0), review: Array(length).fill(0) };
}

/** Preserve the RPC's per-topic counts alongside the existing day totals. */
export function aggregateStudyActivity(days: Date[], rows: StudyActivityRow[]): StudyActivity {
  const indices = new Map(days.map((day, index) => [localDate(day), index]));
  const totals = emptyCounts(days.length);
  const byPack: Record<string, DailyStageCounts> = {};
  for (const row of rows) {
    const index = indices.get(row.day);
    if (index === undefined) continue;
    const counts = {
      new: Number(row.new_cards) || 0,
      learn: Number(row.exercises) || 0, // RPC retains the legacy "exercises" column name.
      review: Number(row.reviews) || 0,
    };
    for (const stage of ["new", "learn", "review"] as const) totals[stage][index] += counts[stage];
    if (typeof row.pack_id === "string" && row.pack_id) {
      const pack = byPack[row.pack_id] ?? (byPack[row.pack_id] = emptyCounts(days.length));
      for (const stage of ["new", "learn", "review"] as const) pack[stage][index] += counts[stage];
    }
  }
  return { days, ...totals, byPack };
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
  const result = aggregateStudyActivity(days, (data ?? []) as StudyActivityRow[]);
  cache.set(key, { time: Date.now(), data: result });
  return result;
}
