import { supabase } from "./supabase";

/**
 * Learning rounds: exactly five exercises for one card, 10 points for each one answered
 * correctly at the first attempt (maximum 50).
 *
 * Supabase is the source of truth (migration 20261110120000_heuresis_learn_rounds.sql):
 *   heuresis_learn_rounds    the round, its five exercises as shown, score and readiness
 *   heuresis_learn_attempts  the first answer to each exercise — one row per (round, position)
 *
 * Points are computed by the database and a (round, position) can be written once, so a
 * double click, a refresh or a replayed offline request never scores twice.
 *
 * A small copy of the unfinished round is also kept on the device, so the same round is
 * resumed after a refresh even while the server cannot be reached.
 */
export const ROUND_SIZE = 5;
export const POINTS_PER_EXERCISE = 10;
export const ROUND_MAX = ROUND_SIZE * POINTS_PER_EXERCISE;
export const READY_SCORE = 40;

export type LearnStage = "recognition" | "reconstruction" | "completion" | "context" | "recall";
export const STAGE_ORDER: LearnStage[] = ["recognition", "reconstruction", "completion", "context", "recall"];
export const STAGE_LABEL: Record<LearnStage, string> = {
  recognition: "Recognition",
  reconstruction: "Reconstruction",
  completion: "Completion",
  context: "Context",
  recall: "Active recall",
};

export type LearnAttempt = {
  position: number;
  stage: LearnStage;
  exerciseType: string;
  /** The first answer only; a later correction never changes it. */
  correct: boolean;
  assisted: boolean;
  points: number;
  response: string;
  expected: string;
  createdAt: string;
};

export type LearnRound = {
  id: string;
  cardId: string;
  cycle: number;
  roundNumber: number;
  status: "active" | "completed" | "abandoned";
  plan: unknown[];
  attempts: LearnAttempt[];
};

export type RoundResult = {
  score: number;
  /** Exercises that earned their points: right at the first attempt, without a hint. */
  correctCount: number;
  answered: number;
  complete: boolean;
  recallCorrect: boolean;
  /** Ready for Review: at least 40/50 and the final active-recall exercise right, unaided. */
  ready: boolean;
};

/** The one scoring rule, mirrored by the database (which has the final word). */
export function pointsFor(correct: boolean, assisted: boolean): number {
  return correct && !assisted ? POINTS_PER_EXERCISE : 0;
}

export function roundResult(attempts: Array<Pick<LearnAttempt, "position" | "correct" | "assisted">>): RoundResult {
  const byPosition = new Map<number, Pick<LearnAttempt, "position" | "correct" | "assisted">>();
  for (const attempt of attempts) {
    if (attempt.position >= 1 && attempt.position <= ROUND_SIZE && !byPosition.has(attempt.position)) byPosition.set(attempt.position, attempt);
  }
  const rows = [...byPosition.values()];
  const score = rows.reduce((sum, row) => sum + pointsFor(row.correct, row.assisted), 0);
  const last = byPosition.get(ROUND_SIZE);
  const recallCorrect = Boolean(last && last.correct && !last.assisted);
  const complete = rows.length === ROUND_SIZE;
  return {
    score, correctCount: rows.filter((row) => pointsFor(row.correct, row.assisted) > 0).length, answered: rows.length,
    complete, recallCorrect, ready: complete && score >= READY_SCORE && recallCorrect,
  };
}

/** What Learn knows about one card: its unfinished round and its last completed one. */
export type CardLearnState = {
  cardId: string;
  cycle: number;
  active: { id: string; roundNumber: number; answered: number; score: number } | null;
  last: { id: string; roundNumber: number; score: number; correctCount: number; recallCorrect: boolean; ready: boolean; completedAt: string | null } | null;
};

export type PackLearnActivity = {
  packId: string;
  attemptsTotal: number;
  correctTotal: number;
  attemptsToday: number;
  attemptsWeek: number;
  correctWeek: number;
};

export type LearnOverview = {
  /** False when the Learning tables are not installed yet (migration not applied). */
  available: boolean;
  cards: Map<string, CardLearnState>;
  packs: Map<string, PackLearnActivity>;
};

export const LEARN_MIGRATION = "20261110120000_heuresis_learn_rounds.sql";
export const LEARN_SETUP_MESSAGE =
  `Learning needs a database update that has not been applied yet (supabase/migrations/${LEARN_MIGRATION}). Your cards and Review are not affected.`;

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

/** PostgREST answers PGRST202 / 404 when an RPC does not exist yet. */
export function learnSchemaMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return code === "PGRST202" || code === "42883"
    || (typeof message === "string" && /could not find the function|function .*heuresis_learn_.* does not exist/i.test(message));
}

function int(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0;
}

function isStage(value: unknown): value is LearnStage {
  return typeof value === "string" && (STAGE_ORDER as string[]).includes(value);
}

function mapAttempt(raw: unknown): LearnAttempt | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const position = int(row.position);
  if (position < 1 || position > ROUND_SIZE || !isStage(row.stage)) return null;
  return {
    position, stage: row.stage,
    exerciseType: typeof row.exercise_type === "string" ? row.exercise_type : "",
    correct: row.correct === true, assisted: row.assisted === true, points: int(row.points),
    response: typeof row.response === "string" ? row.response : "",
    expected: typeof row.expected === "string" ? row.expected : "",
    createdAt: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

function mapRound(raw: unknown): LearnRound | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  if (typeof row.id !== "string" || typeof row.card_id !== "string" || !Array.isArray(row.plan)) return null;
  const status = row.status === "completed" || row.status === "abandoned" ? row.status : "active";
  const attempts = (Array.isArray(row.attempts) ? row.attempts : []).map(mapAttempt)
    .filter((attempt): attempt is LearnAttempt => Boolean(attempt)).sort((a, b) => a.position - b.position);
  return { id: row.id, cardId: row.card_id, cycle: int(row.cycle), roundNumber: Math.max(1, int(row.round_number)), status, plan: row.plan, attempts };
}

/**
 * Learning state for the given cards and activity per topic, in a single request.
 * `dayStart` / `weekStart` are the caller's local boundaries, so "today" is the learner's day.
 */
export async function loadLearnOverview(cardIds: string[], now = Date.now()): Promise<LearnOverview> {
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(dayStart); weekStart.setDate(weekStart.getDate() - 6);
  const { data, error } = await db().rpc("heuresis_learn_overview", {
    p_card_ids: Array.from(new Set(cardIds.filter(Boolean))),
    p_day_start: dayStart.toISOString(),
    p_week_start: weekStart.toISOString(),
  });
  if (error) {
    if (learnSchemaMissing(error)) return { available: false, cards: new Map(), packs: new Map() };
    throw error;
  }
  const payload = (data && typeof data === "object" ? data : {}) as { cards?: unknown; packs?: unknown };
  const cards = new Map<string, CardLearnState>();
  for (const raw of Array.isArray(payload.cards) ? payload.cards : []) {
    const row = raw as Record<string, unknown>;
    if (typeof row.card_id !== "string") continue;
    const active = row.active && typeof row.active === "object" ? row.active as Record<string, unknown> : null;
    const last = row.last && typeof row.last === "object" ? row.last as Record<string, unknown> : null;
    cards.set(row.card_id, {
      cardId: row.card_id, cycle: int(row.cycle),
      active: active && typeof active.id === "string"
        ? { id: active.id, roundNumber: Math.max(1, int(active.round_number)), answered: Math.min(ROUND_SIZE, int(active.answered)), score: int(active.score) } : null,
      last: last && typeof last.id === "string" ? {
        id: last.id, roundNumber: Math.max(1, int(last.round_number)), score: int(last.score), correctCount: int(last.correct_count),
        recallCorrect: last.recall_correct === true, ready: last.ready === true,
        completedAt: typeof last.completed_at === "string" ? last.completed_at : null,
      } : null,
    });
  }
  const packs = new Map<string, PackLearnActivity>();
  for (const raw of Array.isArray(payload.packs) ? payload.packs : []) {
    const row = raw as Record<string, unknown>;
    if (typeof row.pack_id !== "string") continue;
    packs.set(row.pack_id, {
      packId: row.pack_id, attemptsTotal: int(row.attempts_total), correctTotal: int(row.correct_total),
      attemptsToday: int(row.attempts_today), attemptsWeek: int(row.attempts_week), correctWeek: int(row.correct_week),
    });
  }
  return { available: true, cards, packs };
}

/** The state that applies to a card's current Learning cycle (older cycles are history). */
export function stateForCycle(state: CardLearnState | undefined, cycle: number): CardLearnState | null {
  return state && state.cycle === cycle ? state : null;
}

/* ------------------------------------------------------------------------- */
/* Device copy of unfinished rounds                                           */
/* ------------------------------------------------------------------------- */

const CACHE_KEY = "heuresis.learn.rounds.v1";
type CachedRound = LearnRound & { savedAt: string };

function readCache(): Record<string, CachedRound> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, CachedRound> : {};
  } catch { return {}; }
}

function writeCache(next: Record<string, CachedRound>) {
  // Progress also lives on the server; a full or disabled store must not stop Learning.
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(next)); } catch { /* device convenience only */ }
}

export function cachedRound(cardId: string, cycle: number): LearnRound | null {
  const round = readCache()[cardId];
  if (!round || round.cycle !== cycle || round.status !== "active" || !Array.isArray(round.plan) || round.plan.length !== ROUND_SIZE) return null;
  return { ...round, attempts: Array.isArray(round.attempts) ? round.attempts : [] };
}

export function cacheRound(round: LearnRound) {
  const cache = readCache();
  // Kept until the server has the final answer (see forgetCachedRound), so nothing answered
  // on this device is lost when the last write fails.
  if (round.status === "active") cache[round.cardId] = { ...round, savedAt: new Date().toISOString() };
  else delete cache[round.cardId];
  // Keep the store small: only the most recent unfinished rounds are worth resuming.
  const entries = Object.entries(cache).sort((a, b) => b[1].savedAt.localeCompare(a[1].savedAt)).slice(0, 40);
  writeCache(Object.fromEntries(entries));
}

export function forgetCachedRound(cardId: string) {
  const cache = readCache();
  if (!(cardId in cache)) return;
  delete cache[cardId];
  writeCache(cache);
}

/** Recorded answers win; answers this device gave that the server has not seen yet are kept. */
function mergeAttempts(server: LearnAttempt[], local: LearnAttempt[]): LearnAttempt[] {
  const merged = new Map(server.map((attempt) => [attempt.position, attempt]));
  for (const attempt of local) if (!merged.has(attempt.position)) merged.set(attempt.position, attempt);
  const ordered = [...merged.values()].sort((a, b) => a.position - b.position);
  // Answers are sequential: stop at the first gap.
  const result: LearnAttempt[] = [];
  for (const attempt of ordered) { if (attempt.position !== result.length + 1) break; result.push(attempt); }
  return result;
}

export type OpenedRound = {
  round: LearnRound;
  /** Positions answered on this device that the server has not recorded yet. */
  unsent: LearnAttempt[];
  /** False when the server could not be reached and the device copy is being used. */
  synced: boolean;
};

/**
 * Starts a round or resumes the unfinished one. `proposal` builds the five exercises for
 * a fresh round; it is ignored when a round is already in progress for this card.
 */
export async function openLearnRound(input: {
  cardId: string;
  cycle: number;
  proposal: () => { roundNumber: number; plan: unknown[] };
}): Promise<OpenedRound> {
  const local = cachedRound(input.cardId, input.cycle);
  const proposed = local ?? (() => {
    const fresh = input.proposal();
    if (fresh.plan.length !== ROUND_SIZE) throw new Error("A Learning round needs exactly five exercises.");
    return { id: crypto.randomUUID(), cardId: input.cardId, cycle: input.cycle, roundNumber: fresh.roundNumber, status: "active" as const, plan: fresh.plan, attempts: [] };
  })();
  const { data, error } = await db().rpc("heuresis_learn_begin_round", {
    p_round_id: proposed.id, p_card_id: input.cardId, p_cycle: input.cycle, p_plan: proposed.plan,
  });
  if (error) throw error;
  const server = mapRound(data);
  if (!server) {
    // Stored for upload by the offline queue: continue from the device copy.
    cacheRound(proposed);
    return { round: proposed, unsent: proposed.attempts, synced: false };
  }
  if (server.status !== "active") {
    // The proposed id belonged to a round that has since been completed elsewhere.
    forgetCachedRound(input.cardId);
    return openLearnRound(input);
  }
  const localAttempts = local && local.id === server.id ? local.attempts : [];
  const attempts = mergeAttempts(server.attempts, localAttempts);
  const round: LearnRound = { ...server, attempts };
  cacheRound(round);
  return { round, unsent: attempts.filter((attempt) => !server.attempts.some((row) => row.position === attempt.position)), synced: true };
}

/**
 * Records the first answer to one exercise. Safe to repeat: the database keeps one row
 * per (round, position). Resolves with the server's view of the round, or null while the
 * request is waiting in the offline queue.
 */
export async function recordLearnAttempt(roundId: string, attempt: LearnAttempt): Promise<LearnRound | null> {
  const { data, error } = await db().rpc("heuresis_learn_record_attempt", {
    p_round_id: roundId, p_position: attempt.position, p_stage: attempt.stage,
    p_exercise_type: attempt.exerciseType, p_correct: attempt.correct, p_assisted: attempt.assisted,
    p_response: attempt.response.slice(0, 1000), p_expected: attempt.expected.slice(0, 1000),
  });
  if (error) throw error;
  return mapRound(data);
}

/** The learner practised the right answer after feedback. Worth recording; worth no points. */
export async function markLearnCorrected(roundId: string, position: number): Promise<void> {
  const { error } = await db().rpc("heuresis_learn_mark_corrected", { p_round_id: roundId, p_position: position });
  if (error) throw error;
}
