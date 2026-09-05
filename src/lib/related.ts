import { supabase } from "./supabase";
import { listCardsByIds, type CardWithStats } from "./heuresis";

export type RelationType = "synonym" | "antonym" | "related";

export type RelatedCatalogueRow = {
  relation_id: string;
  relation_type: RelationType;
  created_at: string;
  source_card_id: string;
  pack_id: string;
  pack_title: string;
  source_term: string;
  source_reading: string;
  source_meaning: string;
  source_tags: string[];
  target_card_id: string;
  target_role: "main" | "related";
  term: string;
  reading: string;
  meaning: string;
};

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function relationType(value: unknown): RelationType {
  return value === "synonym" || value === "antonym" ? value : "related";
}

function mapRow(value: any): RelatedCatalogueRow | null {
  if (!value?.relation_id || !value?.source_card_id || !value?.target_card_id || !value?.pack_id) return null;
  return {
    relation_id: String(value.relation_id),
    relation_type: relationType(value.relation_type),
    created_at: typeof value.created_at === "string" ? value.created_at : "",
    source_card_id: String(value.source_card_id),
    pack_id: String(value.pack_id),
    pack_title: typeof value.pack_title === "string" ? value.pack_title : "",
    source_term: typeof value.source_term === "string" ? value.source_term : "",
    source_reading: typeof value.source_reading === "string" ? value.source_reading : "",
    source_meaning: typeof value.source_meaning === "string" ? value.source_meaning : "",
    source_tags: Array.isArray(value.source_tags) ? value.source_tags.filter((item: unknown): item is string => typeof item === "string") : [],
    target_card_id: String(value.target_card_id),
    target_role: value.target_role === "main" ? "main" : "related",
    term: typeof value.term === "string" ? value.term : "",
    reading: typeof value.reading === "string" ? value.reading : "",
    meaning: typeof value.meaning === "string" ? value.meaning : "",
  };
}

export async function listRelatedCatalogue(packId: string | null = null, sourceCardId: string | null = null): Promise<RelatedCatalogueRow[]> {
  const { data, error } = await db().rpc("heuresis_list_related_catalogue", {
    p_pack_id: packId,
    p_source_card_id: sourceCardId,
  });
  if (error) throw error;
  return (data ?? []).map(mapRow).filter((row: RelatedCatalogueRow | null): row is RelatedCatalogueRow => Boolean(row));
}

/** Related review deliberately loads explicit target identities, ignoring role='main'. */
export async function listRelatedCards(packId: string): Promise<CardWithStats[]> {
  const catalogue: RelatedCatalogueRow[] = await listRelatedCatalogue(packId);
  const ids: string[] = Array.from(new Set(catalogue.map((row: RelatedCatalogueRow) => row.target_card_id)));
  return listCardsByIds(ids);
}

export async function addRelatedWord(input: {
  sourceCardId: string;
  term: string;
  reading?: string;
  meaning?: string;
  relationType: RelationType;
}) {
  const term = input.term.normalize("NFC").trim();
  if (!term) throw new Error("Give the related word or expression.");
  const { data, error } = await db().rpc("heuresis_add_related_word", {
    p_source_card_id: input.sourceCardId,
    p_term: term,
    p_reading: input.reading?.normalize("NFKC").trim() || null,
    p_meaning: input.meaning?.trim() || null,
    p_relation_type: input.relationType,
  });
  if (error) throw error;
  return data?.[0] ?? null;
}

export async function removeRelatedRelation(relationId: string) {
  const { error } = await db().rpc("heuresis_remove_related_relation", { p_relation_id: relationId });
  if (error) throw error;
}

export async function promoteRelatedCard(cardId: string) {
  const { error } = await db().rpc("heuresis_promote_related_card", { p_card_id: cardId });
  if (error) throw error;
}
