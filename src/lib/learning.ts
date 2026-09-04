import { supabase } from "./supabase";

export type LearningAction = "handwrite" | "type" | "sentence" | "rephrase" | "example" | "say" | "hear";
export type LearningCounts = Record<LearningAction, number>;

export const EMPTY_LEARNING_COUNTS: LearningCounts = {
  handwrite: 0,
  type: 0,
  sentence: 0,
  rephrase: 0,
  example: 0,
  say: 0,
  hear: 0,
};

export const LEARNING_ACTION_LABELS: Record<LearningAction, string> = {
  handwrite: "Write",
  type: "Type",
  sentence: "Sentence",
  rephrase: "Rephrase",
  example: "Own example",
  say: "Say aloud",
  hear: "Hear",
};

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function blankCounts(): LearningCounts {
  return { ...EMPTY_LEARNING_COUNTS };
}

function isLearningAction(value: unknown): value is LearningAction {
  return value === "handwrite"
    || value === "type"
    || value === "sentence"
    || value === "rephrase"
    || value === "example"
    || value === "say"
    || value === "hear";
}

export async function getLearningCounts(cardIds: string[]): Promise<Record<string, LearningCounts>> {
  const ids = Array.from(new Set(cardIds.filter(Boolean)));
  if (!ids.length) return {};
  const { data, error } = await db().rpc("heuresis_learning_counts", { p_card_ids: ids });
  if (error) throw error;

  const result: Record<string, LearningCounts> = {};
  for (const row of (data ?? []) as Array<{ card_id?: unknown; action?: unknown; action_count?: unknown }>) {
    if (typeof row.card_id !== "string" || !isLearningAction(row.action)) continue;
    const counts = result[row.card_id] ?? blankCounts();
    counts[row.action] = Math.max(0, Number(row.action_count ?? 0) || 0);
    result[row.card_id] = counts;
  }
  return result;
}

export async function toggleLearningAction(input: {
  cardId: string;
  packId: string;
  sessionId: string;
  action: LearningAction;
}): Promise<{ selected: boolean; count: number; action: LearningAction }> {
  const { data, error } = await db().rpc("heuresis_toggle_learning_action", {
    p_card_id: input.cardId,
    p_pack_id: input.packId,
    p_session_id: input.sessionId,
    p_action: input.action,
  });
  if (error) throw error;
  const action = isLearningAction(data?.action) ? data.action : input.action;
  return {
    selected: Boolean(data?.selected),
    count: Math.max(0, Number(data?.count ?? 0) || 0),
    action,
  };
}
