import { supabase } from "./supabase";
import { DISCARDED_AT_KEY, deleteCard, isDiscarded, patchCardData, type CardWithStats } from "./heuresis";

export { DISCARDED_AT_KEY, isDiscarded };

export const SORTED_AT_KEY = "_sorted_at";

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function gradedReviews(card: CardWithStats) {
  const { again_count, hard_count, good_count, easy_count } = card.stats;
  return Math.max(0, again_count + hard_count + good_count + easy_count);
}

export function cardHasCompletedSort(card: CardWithStats) {
  const marker = card.data[SORTED_AT_KEY];
  // Review is downstream of sorting in the Heuresis workflow. Historical cards that
  // already reached flashcard review (revealed or graded, including grades recorded by
  // Personal OS or older clients without a reveal event) never fall back into Sort.
  // Interest is deliberately NOT a completion signal: a user may set priority and then
  // Skip, in which case the card must remain available in Sort next time.
  return card.stats.study_count > 0
    || gradedReviews(card) > 0
    || (typeof marker === "string" && Boolean(marker.trim()));
}

export type CardStage = "unsorted" | "ready" | "reviewed";

/**
 * The one definition of a card's place in the learning workflow. Every surface
 * (Library, topic table, Sort, Browse, the Review launcher and the Review window)
 * uses this, so the counts they show always agree.
 */
export function cardStage(card: CardWithStats): CardStage {
  if (gradedReviews(card) > 0) return "reviewed";
  if (cardHasCompletedSort(card)) return "ready";
  return "unsorted";
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

/** Sort's Discard: recoverable (Undo, Trash). The card keeps its id and history. */
export async function discardCard(card: CardWithStats) {
  return patchCardData(card.id, { [DISCARDED_AT_KEY]: new Date().toISOString() });
}

export async function restoreDiscardedCard(cardId: string) {
  return patchCardData(cardId, { [DISCARDED_AT_KEY]: null });
}

/** Permanent deletion from Trash (the only irreversible step). */
export async function deleteDiscardedCard(cardId: string) {
  await deleteCard(cardId);
}
