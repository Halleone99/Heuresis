import type { CardWithStats } from "./heuresis";
import type { GradeEvent } from "./knowledgeState";
import type { StudyGrade } from "./study";

/**
 * The knowledge curve: spaced Review for Applied cards.
 *
 * Language cards are reviewed every day until they are Mastered (cardProgress.ts). Applied
 * knowledge is different: a definition, a rule or a deadline does not need to be seen daily, it
 * needs to be retrieved just before it would be forgotten, in a harder way each time. So an
 * Applied card climbs a curve of widening gaps, and the question it gets depends on where it is:
 *
 *   rung  next review   what Review asks
 *   0     now           Recognise   choose it among similar ones
 *   1     1 day         Recall      produce it with a cue (the term, the value, the next step)
 *   2     3 days        Explain     say it in your own words (define, state, list the steps)
 *   3     7 days        Apply       use it on a case or an example
 *   4     16 days       Long-term   a mix of the above, far apart
 *   5     35 days       Long-term
 *   6     80 days …     Long-term   (each success doubles the gap, up to 180 days)
 *
 *   Again  two rungs down, due again today       Hard  same rung, half the gap
 *   Good   one rung up                           Easy  two rungs up, gap × 1.3
 *
 * One climb per calendar day: answering again the same day, or before the card is due, is
 * practice and never moves it up (the same principle as Learn's daily limit and the four bars).
 *
 * Nothing new is stored. The curve is replayed from the grades Review already records
 * (heuresis_card_events), so it works on every existing card, offline from the synchronised
 * history, and needs no migration. When the history cannot be read, an estimate is made from
 * the card's counts and marked as estimated.
 */

export type CurveStage = "recognise" | "recall" | "explain" | "apply" | "maintain";

export const CURVE_DAYS: readonly number[] = [0, 1, 3, 7, 16, 35, 80];
export const MAX_INTERVAL_DAYS = 180;
const TOP = CURVE_DAYS.length - 1;

export const STAGE_INFO: Record<CurveStage, { label: string; asks: string }> = {
  recognise: { label: "Recognise", asks: "Choose it among similar ones" },
  recall: { label: "Recall", asks: "Produce it from a cue" },
  explain: { label: "Explain", asks: "Say it in your own words" },
  apply: { label: "Apply", asks: "Use it in a situation" },
  maintain: { label: "Long-term", asks: "A mix, far apart" },
};

export type Curve = {
  /** 0 = not yet reviewed (or relearning); 6 = the top of the curve. */
  rung: number;
  /** Days between the last review and the next. */
  intervalDays: number;
  /** Last graded review (ms), or null. */
  lastAt: number | null;
  /** When the card is due (ms, local midnight of the due day; "now" after Again), or null = due now. */
  dueAt: number | null;
  reviews: number;
  lapses: number;
  /** True when replayed from counts because the review history could not be read. */
  estimated: boolean;
};

export const NEW_CURVE: Curve = { rung: 0, intervalDays: 0, lastAt: null, dueAt: null, reviews: 0, lapses: 0, estimated: false };

export function stageOf(rung: number): CurveStage {
  return rung <= 0 ? "recognise" : rung === 1 ? "recall" : rung === 2 ? "explain" : rung === 3 ? "apply" : "maintain";
}

function startOfDay(at: number) {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
/** Local midnight `days` days after the day of `at` (safe across daylight-saving changes). */
export function addDays(at: number, days: number) {
  const date = new Date(startOfDay(at));
  date.setDate(date.getDate() + days);
  return date.getTime();
}

function intervalFor(rung: number, previous: number) {
  if (rung < TOP) return CURVE_DAYS[rung];
  return Math.min(MAX_INTERVAL_DAYS, Math.max(CURVE_DAYS[TOP], Math.round(previous * 2)));
}

/** One graded review applied to the curve. Pure. */
export function stepCurve(curve: Curve, grade: StudyGrade, at: number): Curve {
  const next: Curve = { ...curve, reviews: curve.reviews + 1, lastAt: at };
  if (grade === "again") {
    return { ...next, rung: Math.max(0, curve.rung - 2), intervalDays: 0, dueAt: at, lapses: curve.lapses + 1 };
  }
  const sameDay = curve.lastAt !== null && startOfDay(curve.lastAt) === startOfDay(at);
  const early = curve.dueAt !== null && at < curve.dueAt;
  if (sameDay || early) {
    // Practice, not spacing: the card does not climb. A hard answer brings it back tomorrow.
    const tomorrow = addDays(at, 1);
    const dueAt = grade === "hard" ? Math.min(curve.dueAt ?? tomorrow, tomorrow) : Math.max(curve.dueAt ?? 0, tomorrow);
    return { ...next, dueAt };
  }
  let rung = curve.rung;
  let intervalDays: number;
  if (grade === "hard") intervalDays = Math.max(1, Math.round(Math.max(curve.intervalDays, CURVE_DAYS[Math.min(rung, TOP)]) * 0.5));
  else if (grade === "good") { rung = Math.min(TOP, rung + 1); intervalDays = intervalFor(rung, curve.intervalDays); }
  else { rung = Math.min(TOP, rung + 2); intervalDays = Math.min(MAX_INTERVAL_DAYS, Math.round(intervalFor(rung, curve.intervalDays) * 1.3)); }
  return { ...next, rung, intervalDays, dueAt: addDays(at, intervalDays) };
}

/**
 * How a card last arrived in Review: from Learn ("ready": it was just practised to criterion, so
 * it starts on the Recall rung and comes back tomorrow) or straight from New ("direct": it starts
 * at Recognise, due now).
 */
export type ReviewEntry = { at: number; fromLearn: boolean };

function enter(curve: Curve, entry: ReviewEntry): Curve {
  if (!entry.fromLearn) return { ...curve, dueAt: curve.dueAt === null ? null : Math.min(curve.dueAt, entry.at) };
  const rung = Math.max(curve.rung, 1);
  return { ...curve, rung, intervalDays: 1, dueAt: addDays(entry.at, 1) };
}

/** The curve of one card, replayed from its graded reviews (any order; other cards ignored). */
export function replayCurve(cardId: string, events: GradeEvent[], entry: ReviewEntry | null = null): Curve {
  const mine = events.filter((event) => event.cardId === cardId).sort((a, b) => a.at - b.at);
  let curve = NEW_CURVE;
  let entered = !entry;
  for (const event of mine) {
    if (!entered && entry && event.at >= entry.at) { curve = enter(curve, entry); entered = true; }
    curve = stepCurve(curve, event.grade, event.at);
  }
  return entered || !entry ? curve : enter(curve, entry);
}

/**
 * The curve of a card: replayed from its history when it is available and complete, else
 * estimated from its stored counts (successes climb, misses fall back) and its last review.
 */
export function cardCurve(card: Pick<CardWithStats, "id" | "stats">, history: GradeEvent[] | null, entry: ReviewEntry | null = null): Curve {
  const counted = card.stats.again_count + card.stats.hard_count + card.stats.good_count + card.stats.easy_count;
  const mine = history?.filter((event) => event.cardId === card.id) ?? null;
  if (mine && mine.length >= counted) return replayCurve(card.id, mine, entry);
  const last = card.stats.last_encountered_at ? Date.parse(card.stats.last_encountered_at) : NaN;
  if (!counted || !Number.isFinite(last)) return mine?.length ? { ...replayCurve(card.id, mine, entry), estimated: true } : entry ? enter(NEW_CURVE, entry) : NEW_CURVE;
  const rung = Math.max(0, Math.min(4, card.stats.good_count + 2 * card.stats.easy_count - 2 * card.stats.again_count));
  const intervalDays = CURVE_DAYS[rung];
  return { rung, intervalDays, lastAt: last, dueAt: rung ? addDays(last, intervalDays) : last, reviews: counted, lapses: card.stats.again_count, estimated: true };
}

export function isDue(curve: Curve, now = Date.now()) {
  return curve.dueAt === null || now >= curve.dueAt;
}

/** Days from today until the card is due (0 = today or overdue). */
export function daysUntilDue(curve: Curve, now = Date.now()) {
  if (curve.dueAt === null || curve.dueAt <= now) return 0;
  return Math.max(0, Math.round((startOfDay(curve.dueAt) - startOfDay(now)) / 86_400_000));
}

/**
 * Estimated chance of recalling it now: the curve is set so that it is about 90% on the due day
 * (exp(-t/S) with S = gap / ln(1/0.9)). An estimate for display, never used to grade.
 */
export function recallChance(curve: Curve, now = Date.now()): number | null {
  if (curve.lastAt === null) return null;
  const gap = Math.max(0.5, curve.intervalDays);
  const elapsed = Math.max(0, (now - curve.lastAt) / 86_400_000);
  return Math.exp(-elapsed * Math.log(1 / 0.9) / gap);
}

/** When the card would come back after each grade given now: what the grade buttons show. */
export function previewNext(curve: Curve, now = Date.now()): Record<StudyGrade, number> {
  const days = (grade: StudyGrade) => daysUntilDue(stepCurve(curve, grade, now), now);
  return { again: days("again"), hard: days("hard"), good: days("good"), easy: days("easy") };
}

/** "now", "1 day", "4 days", "2 wk", "3 mo". */
export function formatGap(days: number): string {
  if (days <= 0) return "now";
  if (days === 1) return "1 day";
  if (days < 14) return `${days} days`;
  if (days < 60) return `${Math.round(days / 7)} wk`;
  return `${Math.round(days / 30)} mo`;
}

/** How a collection of Applied cards sits on the curve, for a compact overview. */
export function curveSummary(curves: Curve[], now = Date.now()) {
  const byStage: Record<CurveStage, number> = { recognise: 0, recall: 0, explain: 0, apply: 0, maintain: 0 };
  let dueNow = 0; let dueWeek = 0; let chance = 0; let measured = 0;
  for (const curve of curves) {
    byStage[stageOf(curve.rung)] += 1;
    const days = daysUntilDue(curve, now);
    if (days === 0) dueNow += 1; else if (days <= 7) dueWeek += 1;
    const value = recallChance(curve, now);
    if (value !== null) { chance += value; measured += 1; }
  }
  return { byStage, dueNow, dueWeek, averageRecall: measured ? chance / measured : null };
}
