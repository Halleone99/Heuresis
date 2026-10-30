import type { CardWithStats } from "./heuresis";
import type { LearningCounts } from "./learning";
import type { ReviewMethod } from "./reviewPrefs";

export const REVIEW_METHOD_COUNTS_KEY = "_review_method_counts";
export const REVIEW_LAST_METHOD_KEY = "_review_last_method";
export type MethodCounts = Record<"think" | "say" | "type" | "handwrite", number>;

/** Read persistent lifetime counts. Legacy learning-action counters are retained as a starting point. */
export function reviewMethodCounts(card: CardWithStats, legacy?: LearningCounts): MethodCounts {
  const baseline: MethodCounts = {
    think: 0,
    say: legacy?.say ?? 0,
    type: legacy?.type ?? 0,
    handwrite: legacy?.handwrite ?? 0,
  };
  const raw = card.data[REVIEW_METHOD_COUNTS_KEY];
  if (typeof raw !== "string") return baseline;
  try {
    const parsed = JSON.parse(raw) as Partial<MethodCounts>;
    return Object.fromEntries((["think", "say", "type", "handwrite"] as const)
      .map((key) => [key, Math.max(0, Math.floor(Number(parsed[key] ?? baseline[key]) || 0))])) as MethodCounts;
  } catch { return baseline; }
}

export function countReviewMethod(counts: MethodCounts, method: ReviewMethod): MethodCounts {
  if (method === "hear") return counts;
  return { ...counts, [method]: counts[method] + 1 };
}
