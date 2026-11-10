import { patchCardData, type CardWithStats } from "./heuresis";

/**
 * Where a card stands between NEW → LEARN → REVIEW.
 *
 * The phase lives on the card itself (data._acquisition_v1), so one card row moves
 * through the stages and nothing is ever duplicated. Exercises, points and readiness
 * are NOT stored here: they belong to Learning rounds (src/lib/learnRounds.ts).
 *
 * Distinct from the existing retention = 'learning' column, which only means
 * "not a reference card".
 */
export const LEARNING_STAGE_KEY = "_acquisition_v1";
export type AcquisitionPhase = "learning" | "review";
/** Why a card changed phase; kept with the transition for the card's history. */
export type TransitionReason = "new" | "relearn" | "repeated-mistakes" | "ready" | "direct";
export type AcquisitionEvent = {
  at: string;
  cycle: number;
  /** "exercise" entries were written by the earlier ten-exercise Learning and are kept as history. */
  kind: "exercise" | "enter_learning" | "enter_review";
  reason?: TransitionReason;
  exercise?: string;
  evidence?: string;
  verification?: "automatic" | "self";
};
export type Acquisition = {
  phase: AcquisitionPhase;
  /** 1 = first acquisition; each Relearn starts the next cycle. */
  cycle: number;
  /** Exercise types completed under the earlier ten-exercise Learning (read-only history). */
  completed: string[];
  history: AcquisitionEvent[];
};

const LEGACY_EXERCISES = new Set([
  "typing", "handwriting", "reconstruct", "missing", "meaning",
  "context", "pronunciation", "contrast", "sentence", "association",
]);
const blank = (): Acquisition => ({ phase: "review", cycle: 0, completed: [], history: [] });
const stamp = () => new Date().toISOString();

export function readAcquisition(data: CardWithStats["data"]): Acquisition {
  const raw = data[LEARNING_STAGE_KEY];
  if (typeof raw !== "string") return blank(); // Existing cards remain in Review.
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return blank();
    const state = parsed as Partial<Acquisition>;
    const cycle = Number.isSafeInteger(state.cycle) && Number(state.cycle) >= 0 ? Number(state.cycle) : 0;
    const completed = Array.isArray(state.completed)
      ? Array.from(new Set(state.completed.filter((id): id is string => typeof id === "string" && LEGACY_EXERCISES.has(id)))) : [];
    const history = Array.isArray(state.history) ? state.history.filter((event): event is AcquisitionEvent =>
      Boolean(event && typeof event === "object" && typeof event.at === "string"
        && ["exercise", "enter_learning", "enter_review"].includes(event.kind)
        && Number.isSafeInteger(event.cycle))) : [];
    return { phase: state.phase === "learning" ? "learning" : "review", cycle, completed, history };
  } catch { return blank(); }
}

export function inLearning(card: CardWithStats): boolean {
  return readAcquisition(card.data).phase === "learning";
}

export function inReview(card: CardWithStats): boolean {
  return !inLearning(card);
}

/**
 * A card that reached the earlier 100-point target (all ten exercise types) keeps the
 * readiness it earned, until it is moved to Review or sent back to Learning.
 */
export function legacyReady(state: Acquisition): boolean {
  return state.phase === "learning" && state.completed.length === LEGACY_EXERCISES.size;
}

/** Exercises recorded by the earlier Learning; they still count as past activity. */
export function legacyExerciseTimes(state: Acquisition): number[] {
  return state.history.filter((event) => event.kind === "exercise")
    .map((event) => Date.parse(event.at)).filter(Number.isFinite);
}

function record(state: Acquisition, kind: AcquisitionEvent["kind"], reason: TransitionReason): Acquisition {
  return { ...state, history: [...state.history, { at: stamp(), cycle: state.cycle, kind, reason }] };
}

/** New → Learn, or Review → Learn (Relearn). Starts a new cycle; Review history is untouched. */
export function enterLearning(state: Acquisition, reason: TransitionReason = "new"): Acquisition {
  const cycle = Math.max(1, state.cycle + 1);
  return record({ ...state, cycle, phase: "learning", completed: [] }, "enter_learning", reason);
}

/**
 * Learn → Review ("ready") or New → Review ("direct"). Only the phase changes:
 * no review grade, no statistic and no schedule is written.
 */
export function enterReview(state: Acquisition, reason: TransitionReason = "ready"): Acquisition {
  return record({ ...state, phase: "review" }, "enter_review", reason);
}

export function serializeAcquisition(state: Acquisition): string {
  return JSON.stringify(state);
}

/** Existing patch RPC is owner-scoped, merges metadata without changing card identity,
 * and is handled by the existing authenticated offline queue. */
export async function saveAcquisition(card: CardWithStats, state: Acquisition): Promise<CardWithStats> {
  const data = await patchCardData(card.id, { [LEARNING_STAGE_KEY]: serializeAcquisition(state) });
  return { ...card, data };
}

/** Enough recent difficulty in Review to offer the card back to Learning. Never automatic. */
export function suggestRelearning(grades: Array<{ grade: string }> | null): boolean {
  const recent = (grades ?? []).slice(-5);
  return recent.filter((grade) => grade.grade === "again" || grade.grade === "hard").length >= 2;
}
