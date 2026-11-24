import { supabase } from "./supabase";
import { getOfflineSyncState } from "./offlineFetch";
import type { CardWithStats } from "./heuresis";

/** A narrow, revision-checked update for the opt-in batch tool. Never rewrites content, tags or study history. */
export type CardMetadata = Pick<CardWithStats, "favourite" | "interest_rank" | "interesting">;
export async function updateCardMetadata(
  card: Pick<CardWithStats, "id" | "pack_id" | "updated_at">, patch: Partial<CardMetadata>,
): Promise<string> {
  const sync = getOfflineSyncState();
  if (!navigator.onLine || !sync.online || sync.syncing || sync.pending || sync.held) {
    throw new Error("Finish synchronising before changing multiple cards.");
  }
  const safe: Partial<CardMetadata> = {};
  if (typeof patch.favourite === "boolean") safe.favourite = patch.favourite;
  if (patch.interest_rank !== undefined) {
    if (patch.interest_rank !== null && (!Number.isInteger(patch.interest_rank) || patch.interest_rank < 1 || patch.interest_rank > 5)) {
      throw new Error("Invalid importance.");
    }
    safe.interest_rank = patch.interest_rank;
    safe.interesting = typeof patch.interesting === "boolean" ? patch.interesting : (patch.interest_rank ?? 0) >= 4;
  }
  if (!Object.keys(safe).length) throw new Error("No card change selected.");
  if (!supabase) throw new Error("Supabase is not configured.");
  const { data: saved, error } = await supabase.from("heuresis_cards").update(safe)
    .eq("id", card.id).eq("pack_id", card.pack_id).eq("updated_at", card.updated_at)
    .select("id,updated_at").maybeSingle();
  if (error) throw new Error(error.message || "Could not update card.");
  if (!saved) throw new Error("A card changed on another device. Refresh before trying again.");
  // The offline transport may queue a write if the connection drops mid-request.
  // Its synthetic response has no server revision; do not claim success or build Undo from it.
  if (typeof saved.updated_at !== "string" || !saved.updated_at || saved.updated_at === card.updated_at) {
    throw new Error("A change could not be confirmed. Check synchronisation and refresh before retrying.");
  }
  return saved.updated_at;
}
