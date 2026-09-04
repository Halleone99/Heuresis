import { supabase } from "./supabase";
import type { CardWithStats } from "./heuresis";

export const SORTED_AT_KEY = "_sorted_at";

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

export function cardHasCompletedSort(card: CardWithStats) {
  const marker = card.data[SORTED_AT_KEY];
  return (typeof marker === "string" && Boolean(marker.trim())) || card.interest_rank != null;
}

export async function setSortTags(cardId: string, tagIds: string[]) {
  const { error } = await db().rpc("heuresis_set_card_tags", {
    p_card_id: cardId,
    p_tag_ids: Array.from(new Set(tagIds)),
  });
  if (error) throw error;
}

export async function completeCardSort(card: CardWithStats, rank: number, tagIds: string[]) {
  const safeRank = Math.min(5, Math.max(1, Math.round(rank)));
  const data = { ...card.data, [SORTED_AT_KEY]: new Date().toISOString() };
  const { error } = await db().from("heuresis_cards").update({
    data,
    interest_rank: safeRank,
    interesting: safeRank >= 4,
  }).eq("id", card.id);
  if (error) throw error;
  await setSortTags(card.id, tagIds);
}
