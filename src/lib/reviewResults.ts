import type { CardStats } from "./heuresis";
import type { StudyGrade } from "./study";

/**
 * What happened when a card was reviewed. The stored values stay again / hard /
 * good / easy, so existing history, Progress, the database and Personal OS keep
 * working; only the words change. Secure is a successful result, not mastery.
 */
export const RESULT_ORDER: readonly StudyGrade[] = ["again", "hard", "good", "easy"];

export const RESULT_LABEL: Record<StudyGrade, string> = {
  again: "Missed",
  hard: "Partial",
  good: "Recalled",
  easy: "Secure",
};

export const RESULT_HINT: Record<StudyGrade, string> = {
  again: "Did not come, or the meaning was lost",
  hard: "Incomplete, or needed a hint",
  good: "Correct, with some effort",
  easy: "Correct immediately, without hesitation",
};

export function isSuccess(grade: StudyGrade | null | undefined) {
  return grade === "good" || grade === "easy";
}

/** "2 missed · 3 recalled · 1 secure" from a card's stored counts (empty when never graded). */
export function resultCountsText(stats: Pick<CardStats, "again_count" | "hard_count" | "good_count" | "easy_count">) {
  const parts: string[] = [];
  if (stats.again_count) parts.push(`${stats.again_count} missed`);
  if (stats.hard_count) parts.push(`${stats.hard_count} partial`);
  if (stats.good_count) parts.push(`${stats.good_count} recalled`);
  if (stats.easy_count) parts.push(`${stats.easy_count} secure`);
  return parts.join(" · ");
}
