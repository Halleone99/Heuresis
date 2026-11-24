import type { CardWithStats } from "./heuresis";
import type { GradeEvent, KnowledgeState } from "./knowledgeState";
import { reviewGradeCount } from "./learningSignals";

/**
 * The migration boundary preserves every existing progress bar. Grades recorded
 * before this change retain the original one-answer progression; from this date
 * forwards, reversible language cards need a successful answer in both directions.
 */
export const BIDIRECTIONAL_PROGRESS_SINCE = Date.parse("2026-10-31T13:00:00Z");

// Historical grades keep their original meaning. Existing mastered cards are
// gradually introduced to maintenance over the first 30 days.
export const MASTERY_MAINTENANCE_SINCE = Date.parse("2026-11-24T21:44:16Z");
export const MASTERY_INTERVAL_DAYS = [0, 7, 30, 90, 180, 365] as const;
const DAY_MS = 86_400_000;

function initialMasteryDue(cardId: string, at: number): number {
  if (at >= MASTERY_MAINTENANCE_SINCE) return at + 30 * DAY_MS;
  let hash = 0;
  for (const char of cardId) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return MASTERY_MAINTENANCE_SINCE + (1 + hash % 30) * DAY_MS;
}

export type CardBarProgress = {
  bars: number;
  mastered: boolean;
  estimated: boolean;
  /** Maintenance levels are separate from the four acquisition bars. */
  masteryLevel?: number;
  masteryDueAt?: number;
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
 * A successful answer completes a reversible card for this calendar day. The
 * opposite direction becomes eligible the next day; the passed side is retained
 * as pending evidence until its partner is successful. Mastered cards return to
 * ordinary review only when their maintenance interval is due.
 */
export function reviewEligible(
  progress: CardBarProgress,
  history: GradeEvent[] | null,
  _lastReviewed: string | null,
  includeMastered = false,
  now = Date.now(),
  selectedDirectionIds?: string[],
): boolean {
  if (progress.pendingDirections !== undefined) {
    // A successful answer finishes this card for today. The reverse direction
    // becomes eligible on a later day, without losing its pending pair progress.
    if (progress.completedToday || reviewedSuccessfullyToday(history, now)) return false;
    if (selectedDirectionIds?.length && selectedDirectionIds.every((id) => progress.pendingDirections?.includes(id))) return false;
  } else if (reviewedSuccessfullyToday(history, now)) return false;
  if (includeMastered) return true;
  return !progress.mastered || (!progress.estimated && progress.masteryDueAt !== undefined
    && now >= progress.masteryDueAt);
}

/** Ordinary review includes due maintenance; explicit mastered practice remains separate. */
export function reviewEligibleForMode(
  progress: CardBarProgress,
  history: GradeEvent[] | null,
  lastReviewed: string | null,
  masteredOnly: boolean,
  now = Date.now(),
  selectedDirectionIds?: string[],
): boolean {
  return (!masteredOnly || progress.mastered)
    && reviewEligible(progress, history, lastReviewed, masteredOnly, now, selectedDirectionIds);
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
  let masteryLevel = 0;
  let masteryDueAt = 0;
  let maintenanceDay = "";
  let currentDay = "";
  let dailyPeak = 0;
  let advancedToday = false;
  let completedDay = "";
  const validated = new Map<string, "good" | "easy">();
  let maintenanceStarted = false;

  function successful(grade: "good" | "easy", at: number) {
    if (mastered) return;
    if (bars < dailyPeak && grade !== "easy") {
      bars += 1; // Recover a missed bar; not a new daily advancement.
      advancedToday = true;
    } else if (!advancedToday) {
      if (bars === 4) {
        mastered = true;
        masteryLevel = 2;
        masteryDueAt = initialMasteryDue(card.id, at);
        maintenanceDay = dayOf(at);
      }
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

    // Maintenance replays the same durable grade history as acquisition.
    // Early voluntary practice cannot advance or postpone the scheduled check.
    // A failure lowers the level once per day; correction retries cannot farm it.
    if (event.at >= MASTERY_MAINTENANCE_SINCE && !maintenanceStarted) {
      maintenanceStarted = true;
      if (mastered) validated.clear();
    }
    if (mastered && event.at >= MASTERY_MAINTENANCE_SINCE) {
      if (pair && (!event.templateId || !pair.includes(event.templateId))) continue;
      if (day === maintenanceDay) continue;
      if (event.grade === "again" || event.grade === "hard") {
        masteryLevel = Math.max(0, masteryLevel - (event.grade === "again" ? 2 : 1));
        maintenanceDay = day;
        validated.clear();
        completedDay = "";
        if (!masteryLevel) {
          mastered = false;
          masteryDueAt = 0;
          if (event.grade === "again") bars = Math.max(0, bars - 1);
          // Relearning may recover a bar today, but never re-confirm mastery today.
          advancedToday = true;
        } else {
          masteryDueAt = event.at + MASTERY_INTERVAL_DAYS[masteryLevel] * DAY_MS;
        }
        continue;
      }
      if (event.at < masteryDueAt) continue;
      if (pair) {
        validated.set(event.templateId!, event.grade);
        if (validated.size < 2) continue;
        validated.clear();
        completedDay = day;
      }
      masteryLevel = Math.min(5, masteryLevel + 1);
      masteryDueAt = event.at + MASTERY_INTERVAL_DAYS[masteryLevel] * DAY_MS;
      maintenanceDay = day;
      continue;
    }

    // Post-migration bidirectional cards are only advanced by a completed pair.
    if (pair && event.at >= BIDIRECTIONAL_PROGRESS_SINCE) {
      if (!event.templateId || !pair.includes(event.templateId)) continue;
      if (event.grade === "again") {
        bars = Math.max(0, bars - 1);
        mastered = false;
        masteryLevel = 0;
        masteryDueAt = 0;
        completedDay = "";
        validated.delete(event.templateId);
      } else if (event.grade === "hard") {
        validated.delete(event.templateId);
      } else {
        validated.set(event.templateId, event.grade);
        if (validated.size === 2) {
          const combined = [...validated.values()].includes("easy") ? "easy" : "good";
          successful(combined, event.at);
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
      masteryLevel = 0;
      masteryDueAt = 0;
    } else if (event.grade === "good" || event.grade === "easy") {
      successful(event.grade, event.at);
    }
  }
  return { bars, mastered, estimated: false,
    ...(mastered ? { masteryLevel, masteryDueAt } : {}),
    ...pairedFields(mastered && !maintenanceStarted ? [] : [...validated.keys()], completedDay === dayOf(now)) };
}
