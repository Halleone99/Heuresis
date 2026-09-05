import { supabase } from "./supabase";
import { patchCardData, type CardWithStats } from "./heuresis";

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

export async function setSortInterest(cardId: string, rank: number | null) {
  const safeRank = rank == null ? null : Math.min(5, Math.max(1, Math.round(rank)));
  const { error } = await db().from("heuresis_cards").update({
    interest_rank: safeRank,
    interesting: Boolean(safeRank && safeRank >= 4),
  }).eq("id", cardId);
  if (error) throw error;
}

export async function markCardSorted(card: CardWithStats) {
  const existing = card.data[SORTED_AT_KEY];
  if (typeof existing === "string" && existing.trim()) return card.data;
  return patchCardData(card.id, { [SORTED_AT_KEY]: new Date().toISOString() });
}

export async function completeCardSort(card: CardWithStats, rank: number, tagIds: string[]) {
  const safeRank = Math.min(5, Math.max(1, Math.round(rank)));
  await setSortInterest(card.id, safeRank);
  await setSortTags(card.id, tagIds);
  await markCardSorted({ ...card, interest_rank: safeRank });
}
