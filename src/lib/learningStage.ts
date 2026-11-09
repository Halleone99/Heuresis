import { patchCardData, type CardWithStats } from "./heuresis";

/** Initial acquisition is distinct from the existing retention='learning' (non-reference) field. */
export const LEARNING_STAGE_KEY = "_acquisition_v1";
export const EXERCISE_IDS = [
  "typing", "handwriting", "reconstruct", "missing", "meaning",
  "context", "pronunciation", "contrast", "sentence", "association",
] as const;
export type ExerciseId = typeof EXERCISE_IDS[number];
export type AcquisitionPhase = "learning" | "review";
export type AcquisitionEvent = {
  at: string;
  cycle: number;
  kind: "exercise" | "enter_learning" | "enter_review";
  exercise?: ExerciseId;
  evidence?: string;
  verification?: "automatic" | "self";
};
export type Acquisition = {
  phase: AcquisitionPhase;
  cycle: number;
  completed: ExerciseId[];
  history: AcquisitionEvent[];
};

const idSet = new Set<string>(EXERCISE_IDS);
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
      ? Array.from(new Set(state.completed.filter((id): id is ExerciseId => typeof id === "string" && idSet.has(id)))) : [];
    const history = Array.isArray(state.history) ? state.history.filter((event): event is AcquisitionEvent =>
      Boolean(event && typeof event === "object" && typeof event.at === "string"
        && ["exercise", "enter_learning", "enter_review"].includes(event.kind)
        && Number.isSafeInteger(event.cycle))) : [];
    return { phase: state.phase === "learning" ? "learning" : "review", cycle, completed, history };
  } catch { return blank(); }
}

export function acquisitionScore(state: Acquisition): number {
  return new Set(state.completed.filter((id) => idSet.has(id))).size * 10;
}

export function acquisitionReady(state: Acquisition): boolean {
  return acquisitionScore(state) === 100 && state.completed.includes("meaning") && state.completed.includes("context");
}

export function inLearning(card: CardWithStats): boolean {
  return readAcquisition(card.data).phase === "learning";
}

export function inReview(card: CardWithStats): boolean {
  return !inLearning(card);
}

function record(state: Acquisition, kind: AcquisitionEvent["kind"], extras: Partial<AcquisitionEvent> = {}): Acquisition {
  return { ...state, history: [...state.history, { at: stamp(), cycle: state.cycle, kind, ...extras }] };
}

export function enterInitialLearning(state: Acquisition): Acquisition {
  const cycle = Math.max(1, state.cycle + 1);
  return record({ ...state, cycle, phase: "learning", completed: [] }, "enter_learning");
}

export function finishAcquisition(state: Acquisition): Acquisition {
  if (!acquisitionReady(state)) throw new Error("Complete all ten exercise types, including meaning and context.");
  if (state.phase !== "learning") throw new Error("This card is not in Learning.");
  return record({ ...state, phase: "review" }, "enter_review");
}

export function bypassAcquisition(state: Acquisition): Acquisition {
  return record({ ...state, phase: "review" }, "enter_review");
}

export function awardExercise(state: Acquisition, exercise: ExerciseId, verification: "automatic" | "self", evidence: string): Acquisition {
  if (state.phase !== "learning") throw new Error("The card must be in Learning.");
  if (!idSet.has(exercise)) throw new Error("Unknown Learning exercise.");
  if (state.completed.includes(exercise)) return state; // Idempotent: +10 only once per type and cycle.
  if (!evidence.trim()) throw new Error("Complete the exercise before confirming.");
  const next: Acquisition = { ...state, completed: [...state.completed, exercise] };
  return record(next, "exercise", { exercise, verification, evidence: evidence.trim().slice(0, 500) });
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

/** Show an optional suggestion, never automatically return a card to Learning. */
export function suggestRelearning(grades: Array<{ grade: string }> | null): boolean {
  const recent = (grades ?? []).slice(-5);
  return recent.filter((grade) => grade.grade === "again" || grade.grade === "hard").length >= 2;
}
