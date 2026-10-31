import type { CardWithStats } from "./heuresis";
import type { GradeEvent, KnowledgeState } from "./knowledgeState";
import { reviewGradeCount } from "./learningSignals";

/**
 * The migration boundary preserves every existing progress bar. Grades recorded
 * before this change retain the original one-answer progression; from this date
 * forwards, reversible language cards need a successful answer in both directions.
 */
export const BIDIRECTIONAL_PROGRESS_SINCE = Date.parse("2026-10-31T13:00:00Z");

export type CardBarProgress = {
  bars: number;
  mastered: boolean;
  estimated: boolean;
  /** Successful directions awaiting the other side of the pair. */
  pendingDirections?: string[];
  /** A full pair was confirmed today; no further normal review is needed. */
  completedToday?: boolean;
};

function dayOf(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function approximateLegacy(card: CardWithStats, oldState: KnowledgeState | null): CardBarProgress {
  const attempts = reviewGradeCount(card);
  if (!attempts) return { bars: 0, mastered: false, estimated: false };
  const successes = Math.max(0, card.stats.good_count + card.stats.easy_count);
  if (oldState === "strong") return { bars: 4, mastered: true, estimated: true };
  if (oldState === "holding") return { bars: 4, mastered: false, estimated: true };
  if (!successes) return { bars: 0, mastered: false, estimated: true };
  return { bars: Math.min(3, Math.max(1, successes)), mastered: false, estimated: true };
}

/** Legacy, one-direction cards retain their original same-day lock. */
export function reviewedSuccessfullyToday(history: GradeEvent[] | null, now = Date.now()): boolean {
  if (!history) return false;
  const today = dayOf(now);
  let locked = false;
  for (const event of [...history].sort((a, b) => a.at - b.at)) {
    if (dayOf(event.at) !== today) continue;
    if (event.grade === "again") locked = false;
    if (event.grade === "good" || event.grade === "easy") locked = true;
  }
  return locked;
}

/**
 * A reversible card remains eligible after passing only one direction, including
 * in another session on the same day. Already-passed directions are not repeated
 * simply to earn another bar. One-direction cards keep the old eligibility rule.
 */
export function reviewEligible(
  progress: CardBarProgress,
  history: GradeEvent[] | null,
  lastReviewed: string | null,
  includeMastered = false,
  now = Date.now(),
  selectedDirectionIds?: string[],
): boolean {
  if (progress.pendingDirections !== undefined) {
    if (progress.completedToday) return false;
    if (selectedDirectionIds?.length && selectedDirectionIds.every((id) => progress.pendingDirections?.includes(id))) return false;
  } else if (reviewedSuccessfullyToday(history, now)) return false;
  if (includeMastered) return true;
  if (!progress.mastered) return true;
  const latest = history?.length ? Math.max(...history.map((event) => event.at)) : Date.parse(lastReviewed ?? "");
  return Number.isFinite(latest) && now - latest >= 180 * 86_400_000;
}

/**
 * Progress has four bars and a separate Mastered confirmation.
 *
 * For an exact inverse pair, Good/Easy validates one direction without awarding
 * a bar. The successful opposite direction completes the pair: +1 bar, or jump
 * straight to 4/4 if either successful answer was Easy. The directions may be
 * answered in separate sessions or on separate days. One completed pair can
 * advance progress at most once per calendar day; the next day's complete pair
 * can confirm Mastered after 4/4.
 *
 * Existing history is replayed under the old rules until the migration boundary.
 * Incomplete history is conservatively marked estimated rather than inventing
 * a reverse-direction success.
 */
export function cardBarProgress(
  card: CardWithStats,
  history: GradeEvent[] | null,
  oldState: KnowledgeState | null,
  directionIds: string[] = [],
  now = Date.now(),
): CardBarProgress {
  const pair = directionIds.length === 2 && directionIds[0] !== directionIds[1] ? directionIds : null;
  const pairedFields = (pendingDirections: string[] = [], completedToday = false) =>
    pair ? { pendingDirections, completedToday } : {};
  const recordedAttempts = reviewGradeCount(card);
  if (!recordedAttempts && !history?.length)
    return { bars: 0, mastered: false, estimated: false, ...pairedFields() };
  if (!history || history.length < recordedAttempts)
    return { ...approximateLegacy(card, oldState), ...pairedFields() };

  let bars = 0;
  let mastered = false;
  let currentDay = "";
  let dailyPeak = 0;
  let advancedToday = false;
  let completedDay = "";
  const validated = new Map<string, "good" | "easy">();

  function successful(grade: "good" | "easy") {
    if (mastered) return;
    if (bars < dailyPeak && grade !== "easy") {
      bars += 1; // Recover a missed bar; not a new daily advancement.
      advancedToday = true;
    } else if (!advancedToday) {
      if (bars === 4) mastered = true;
      else bars = grade === "easy" ? 4 : Math.min(4, bars + 1);
      advancedToday = true;
    } else if (bars < dailyPeak) {
      bars += 1;
    }
    dailyPeak = Math.max(dailyPeak, bars);
  }

  for (const event of [...history].sort((a, b) => a.at - b.at)) {
    const day = dayOf(event.at);
    if (day !== currentDay) {
      currentDay = day;
      dailyPeak = bars;
      advancedToday = false;
    }

    // Post-migration bidirectional cards are only advanced by a completed pair.
    if (pair && event.at >= BIDIRECTIONAL_PROGRESS_SINCE) {
      if (!event.templateId || !pair.includes(event.templateId)) continue;
      if (event.grade === "again") {
        bars = Math.max(0, bars - 1);
        mastered = false;
        completedDay = "";
        validated.delete(event.templateId);
      } else if (event.grade === "hard") {
        validated.delete(event.templateId);
      } else {
        validated.set(event.templateId, event.grade);
        if (validated.size === 2) {
          const combined = [...validated.values()].includes("easy") ? "easy" : "good";
          successful(combined);
          completedDay = day;
          validated.clear();
        }
      }
      continue;
    }

    // Pre-migration results and non-reversible cards keep the original behaviour.
    if (event.grade === "again") {
      bars = Math.max(0, bars - 1);
      mastered = false;
    } else if (event.grade === "good" || event.grade === "easy") {
      successful(event.grade);
    }
  }
  return { bars, mastered, estimated: false, ...pairedFields([...validated.keys()], completedDay === dayOf(now)) };
}
