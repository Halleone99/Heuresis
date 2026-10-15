import type { CardWithStats } from "./heuresis";
import { isSuccess } from "./reviewResults";
import type { StudyGrade } from "./study";

/**
 * Direction-specific knowledge states, read from evidence only:
 *   Not tried → Needs work → Developing → Holding → Strong.
 * They describe what the recorded results show. They are not deadlines, not
 * permanent mastery, and repetition on a single day does not count as lasting
 * knowledge (Holding and Strong need successes on separate days).
 */
export type KnowledgeState = "not-tried" | "needs-work" | "developing" | "holding" | "strong";

export const STATE_LABEL: Record<KnowledgeState, string> = {
  "not-tried": "Not tried",
  "needs-work": "Needs work",
  developing: "Developing",
  holding: "Holding",
  strong: "Strong",
};

/** Progression order (for display: left = earliest). */
export const STATE_PROGRESSION: readonly KnowledgeState[] = ["not-tried", "needs-work", "developing", "holding", "strong"];

/** Attention order: which state most deserves a look first. */
export const STATE_ATTENTION: readonly KnowledgeState[] = ["needs-work", "not-tried", "developing", "holding", "strong"];

export type GradeEvent = { cardId: string; templateId: string | null; grade: StudyGrade; at: number };

export type DirectionEvidence = {
  templateId: string | null;
  attempts: number;
  misses: number;
  partials: number;
  successes: number;
  /** Most recent results in this direction, oldest first (empty when history is unavailable). */
  recent: StudyGrade[];
  /** Time of the last result in this direction, or the card's last exposure when only that is known. */
  lastAt: number | null;
  lastAtApproximate: boolean;
  /**
   * Distinct calendar days with a successful result; null when the event history does
   * not cover every recorded result (unavailable offline, or older than the loaded window).
   */
  successDays: number | null;
};

export type StateAssessment = {
  state: KnowledgeState;
  /** Holding/Strong lowered one step because the latest evidence is old. */
  agedFrom: KnowledgeState | null;
};

const DAY = 86_400_000;
/** Evidence older than this is treated as less certain (one step lower). */
export const OLD_EVIDENCE_DAYS = 120;
const RECENT_WINDOW = 5;

function count(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
}

function localDay(at: number) {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/**
 * Results recorded without a direction (older sessions, or packs that had no
 * directions at the time): card totals minus everything attributed to a direction.
 */
export function unattributedCounts(card: CardWithStats) {
  const sum = (grade: string) => Object.values(card.stats.by_template ?? {}).reduce((total, row) => total + count(row?.[grade]), 0);
  return {
    again: Math.max(0, count(card.stats.again_count) - sum("again")),
    hard: Math.max(0, count(card.stats.hard_count) - sum("hard")),
    good: Math.max(0, count(card.stats.good_count) - sum("good")),
    easy: Math.max(0, count(card.stats.easy_count) - sum("easy")),
  };
}

export type EvidenceOptions = {
  /**
   * Count results recorded without a direction as evidence for this direction.
   * Used for the pack's default direction only: that is the direction older,
   * direction-less sessions showed, so history is not silently reset to "Not tried".
   */
  includeUnattributed?: boolean;
};

/**
 * Evidence for one card in one direction. Stored per-direction counts (complete
 * history) give the totals; the event list, when available, adds order, recency and
 * the number of separate days with a success. Events may be a recent subset only.
 */
export function directionEvidence(card: CardWithStats, templateId: string | null, events: GradeEvent[] | null, options: EvidenceOptions = {}): DirectionEvidence {
  const row = templateId ? card.stats.by_template?.[templateId] : null;
  let misses = templateId ? count(row?.again) : card.stats.again_count;
  let partials = templateId ? count(row?.hard) : card.stats.hard_count;
  let successes = templateId ? count(row?.good) + count(row?.easy) : card.stats.good_count + card.stats.easy_count;
  const legacy = Boolean(templateId && options.includeUnattributed);
  if (legacy) {
    const extra = unattributedCounts(card);
    misses += extra.again;
    partials += extra.hard;
    successes += extra.good + extra.easy;
  }

  const mine = events
    ? events.filter((event) => event.cardId === card.id
      && (templateId === null || event.templateId === templateId || (legacy && event.templateId === null))).sort((a, b) => a.at - b.at)
    : [];
  // Counts can lag behind events recorded in this session (or be missing for very old
  // rows); never report fewer attempts than the events show.
  const eventMisses = mine.filter((event) => event.grade === "again").length;
  const eventPartials = mine.filter((event) => event.grade === "hard").length;
  const eventSuccesses = mine.filter((event) => isSuccess(event.grade)).length;
  if (mine.length > misses + partials + successes) { misses = eventMisses; partials = eventPartials; successes = eventSuccesses; }
  const attempts = misses + partials + successes;

  if (events && mine.length) {
    // Events can be a subset (only this session's answers offline, or a long history cut
    // off at the loaded window). Then the days count is unknown rather than too small, so
    // a new success can never lower a state that the stored counts support.
    const complete = mine.length >= attempts;
    return {
      templateId, attempts, misses, partials, successes,
      recent: mine.slice(-RECENT_WINDOW).map((event) => event.grade),
      lastAt: mine[mine.length - 1].at,
      lastAtApproximate: false,
      successDays: complete ? new Set(mine.filter((event) => isSuccess(event.grade)).map((event) => localDay(event.at))).size : null,
    };
  }
  const seen = attempts && card.stats.last_encountered_at ? Date.parse(card.stats.last_encountered_at) : NaN;
  return {
    templateId, attempts, misses, partials, successes,
    recent: [],
    lastAt: Number.isFinite(seen) ? seen : null,
    lastAtApproximate: true,
    successDays: null,
  };
}

export function successRate(evidence: DirectionEvidence) {
  return evidence.attempts ? (evidence.successes + 0.5 * evidence.partials) / evidence.attempts : null;
}

function step(state: KnowledgeState): KnowledgeState {
  return state === "strong" ? "holding" : state === "holding" ? "developing" : state;
}

export function assessState(evidence: DirectionEvidence, now = Date.now()): StateAssessment {
  if (!evidence.attempts) return { state: "not-tried", agedFrom: null };
  const rate = successRate(evidence) ?? 0;
  const last = evidence.recent.length ? evidence.recent[evidence.recent.length - 1] : null;
  const recentAllSuccess = (n: number) => evidence.recent.length >= n && evidence.recent.slice(-n).every((grade) => isSuccess(grade));

  if (last === "again"
    || (evidence.attempts >= 2 && rate < 0.5)
    || (!evidence.recent.length && evidence.misses > evidence.successes)) {
    return { state: "needs-work", agedFrom: null };
  }

  let state: KnowledgeState = "developing";
  const days = evidence.successDays;
  const lastIsSuccess = last === null || isSuccess(last);
  if (evidence.attempts >= 5 && rate >= 0.85 && recentAllSuccess(3) && (days ?? 0) >= 3) state = "strong";
  else if (evidence.attempts >= 3 && rate >= 0.7 && (days === null
    // Without the full history, the counts decide (never more than Holding).
    ? evidence.attempts >= 4 && rate >= 0.8 && lastIsSuccess
    : recentAllSuccess(2) && days >= 2)) state = "holding";

  if ((state === "strong" || state === "holding") && evidence.lastAt !== null && now - evidence.lastAt > OLD_EVIDENCE_DAYS * DAY) {
    return { state: step(state), agedFrom: state };
  }
  return { state, agedFrom: null };
}

/** Days since the last evidence in this direction (null when never seen). */
export function daysSinceEvidence(evidence: DirectionEvidence, now = Date.now()) {
  return evidence.lastAt === null ? null : Math.max(0, Math.floor((now - evidence.lastAt) / DAY));
}

/** The state that most deserves attention across a card's directions. */
export function summaryState(states: KnowledgeState[]): KnowledgeState {
  for (const candidate of STATE_ATTENTION) if (states.includes(candidate)) return candidate;
  return "not-tried";
}
