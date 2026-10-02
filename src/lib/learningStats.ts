import { supabase } from "./supabase";
import type { StudyGrade } from "./study";

export type RecentGradesByCard = Record<string, StudyGrade[]>;

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function isStudyGrade(value: unknown): value is StudyGrade {
  return value === "again" || value === "hard" || value === "good" || value === "easy";
}

export async function getRecentReviewGrades(cardIds: string[], limit = 3): Promise<RecentGradesByCard> {
  const ids = Array.from(new Set(cardIds.filter(Boolean)));
  if (!ids.length) return {};

  const safeLimit = Math.max(1, Math.min(10, Math.floor(limit || 3)));
  const result: RecentGradesByCard = Object.fromEntries(ids.map((id) => [id, []]));
  const { data, error } = await db().rpc("heuresis_recent_review_grades", {
    p_card_ids: ids,
    p_limit: safeLimit,
  });
  if (error) throw error;

  for (const raw of data ?? []) {
    const row = raw as { card_id?: unknown; grades?: unknown };
    if (typeof row.card_id !== "string" || !Array.isArray(row.grades)) continue;
    result[row.card_id] = row.grades.filter(isStudyGrade).slice(-safeLimit);
  }

  return result;
}
