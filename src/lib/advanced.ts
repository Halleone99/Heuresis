import { supabase } from "./supabase";
import { listCardTypes, type AccentKey, type CardType, type PackWithType, type HeuresisTag } from "./heuresis";

export type SearchCardResult = {
  id: string;
  pack_id: string;
  data: Record<string, string | string[] | null>;
  note: string | null;
};

export type CatalogueStatus = "all" | "new" | "favourites" | "interesting" | "again";
export type CatalogueCriteria = {
  collectionId: string;
  packId: string;
  tagIds: string[];
  status: CatalogueStatus;
  query: string;
};

export type SavedCatalogue = {
  id: string;
  title: string;
  description: string | null;
  criteria: CatalogueCriteria;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function cardData(value: unknown): Record<string, string | string[] | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | string[] | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || item === null) result[key] = item;
    else if (Array.isArray(item) && item.every((part) => typeof part === "string")) result[key] = item as string[];
  }
  return result;
}

function catalogueCriteria(value: unknown): CatalogueCriteria {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const status: CatalogueStatus = row.status === "new" || row.status === "favourites" || row.status === "interesting" || row.status === "again" ? row.status : "all";
  return {
    collectionId: typeof row.collectionId === "string" ? row.collectionId : "all",
    packId: typeof row.packId === "string" ? row.packId : "all",
    tagIds: Array.isArray(row.tagIds) ? row.tagIds.filter((item): item is string => typeof item === "string") : [],
    status,
    query: typeof row.query === "string" ? row.query : "",
  };
}

async function mapPackRows(rows: any[]): Promise<PackWithType[]> {
  const types = await listCardTypes();
  const typeMap = new Map(types.map((type) => [type.id, type]));
  return rows.flatMap((row) => {
    if (!row?.id || !row?.collection_id || !row?.card_type_id || !row?.title) return [];
    return [{
      id: String(row.id),
      collection_id: String(row.collection_id),
      card_type_id: String(row.card_type_id),
      title: String(row.title),
      description: typeof row.description === "string" ? row.description : null,
      sort_order: Number(row.sort_order ?? 0),
      card_count: Number(row.card_count ?? 0),
      encountered_cards: Number(row.encountered_cards ?? 0),
      open_count: Number(row.open_count ?? 0),
      last_opened_at: typeof row.last_opened_at === "string" ? row.last_opened_at : null,
      cardType: typeMap.get(String(row.card_type_id)) ?? null,
    } satisfies PackWithType];
  });
}

const PACK_SELECT = "id,collection_id,card_type_id,title,description,sort_order,card_count,encountered_cards,open_count,last_opened_at";

export async function listArchivedPacks(): Promise<PackWithType[]> {
  const { data, error } = await db().from("heuresis_pack_overview").select(PACK_SELECT).not("archived_at", "is", null).order("updated_at", { ascending: false });
  if (error) throw error;
  return mapPackRows((data ?? []) as any[]);
}

export async function createCollection(input: { title: string; description?: string; accent: AccentKey; glyph?: string }) {
  const { data: last, error: lastError } = await db().from("heuresis_collections").select("sort_order").is("archived_at", null).order("sort_order", { ascending: false }).limit(1);
  if (lastError) throw lastError;
  const sortOrder = Number(last?.[0]?.sort_order ?? -1) + 1;
  const { data, error } = await db().from("heuresis_collections").insert({
    title: input.title.trim(), description: input.description?.trim() || null, accent: input.accent,
    glyph: input.glyph?.trim() || null, sort_order: sortOrder,
  }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function updateCollection(collectionId: string, patch: { title?: string; description?: string | null; accent?: AccentKey; glyph?: string | null; sort_order?: number }) {
  const next = { ...patch, title: patch.title === undefined ? undefined : patch.title.trim(), description: patch.description === undefined ? undefined : patch.description?.trim() || null, glyph: patch.glyph === undefined ? undefined : patch.glyph?.trim() || null };
  const { error } = await db().from("heuresis_collections").update(next).eq("id", collectionId);
  if (error) throw error;
}

export async function reorderCollections(orderedIds: string[]) {
  const { error } = await db().rpc("heuresis_reorder_collections", { p_ids: orderedIds });
  if (error) throw error;
}

export async function archiveCollection(collectionId: string) {
  const { count, error: countError } = await db().from("heuresis_packs").select("id", { count: "exact", head: true }).eq("collection_id", collectionId).is("archived_at", null);
  if (countError) throw countError;
  if ((count ?? 0) > 0) throw new Error("Move or archive the topics in this collection first.");
  const { error } = await db().from("heuresis_collections").update({ archived_at: new Date().toISOString() }).eq("id", collectionId);
  if (error) throw error;
}

export async function createPack(input: { collectionId: string; cardTypeId: string; title: string; description?: string }) {
  const { data, error } = await db().from("heuresis_packs").insert({ collection_id: input.collectionId, card_type_id: input.cardTypeId, title: input.title.trim(), description: input.description?.trim() || null }).select("id").single();
  if (error) throw error;
  return data.id;
}

export async function updatePack(packId: string, patch: { collection_id?: string; title?: string; description?: string | null; default_template_id?: string | null }) {
  const next = { ...patch, title: patch.title === undefined ? undefined : patch.title.trim(), description: patch.description === undefined ? undefined : patch.description?.trim() || null };
  const { error } = await db().from("heuresis_packs").update(next).eq("id", packId);
  if (error) throw error;
}

export async function archivePack(packId: string) {
  const { error } = await db().from("heuresis_packs").update({ archived_at: new Date().toISOString() }).eq("id", packId);
  if (error) throw error;
}
export async function restorePack(packId: string) { const { error } = await db().from("heuresis_packs").update({ archived_at: null }).eq("id", packId); if (error) throw error; }
export async function deletePack(packId: string) {
  const { data, error } = await db().from("heuresis_packs").delete().eq("id", packId).select("id");
  if (error) throw error;
  if (!data?.length) throw new Error("The topic was not deleted. Refresh Heuresis and try again.");
}

export async function searchCards(query: string): Promise<SearchCardResult[]> {
  const term = query.trim();
  if (term.length < 2) return [];
  const { data, error } = await db().from("heuresis_cards").select("id,pack_id,data,note").eq("role", "main").ilike("search_text", `%${term}%`).order("updated_at", { ascending: false }).limit(40);
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, pack_id: row.pack_id, data: cardData(row.data), note: row.note ?? null }));
}

export async function listCatalogues(): Promise<SavedCatalogue[]> {
  const { data, error } = await db().from("heuresis_catalogues").select("id,title,description,criteria,sort_order,created_at,updated_at").order("sort_order").order("created_at");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, title: row.title, description: row.description ?? null, criteria: catalogueCriteria(row.criteria), sort_order: Number(row.sort_order ?? 0), created_at: row.created_at, updated_at: row.updated_at }));
}

export async function createCatalogue(input: { title: string; description?: string; criteria: CatalogueCriteria }) {
  const { data: last, error: lastError } = await db().from("heuresis_catalogues").select("sort_order").order("sort_order", { ascending: false }).limit(1);
  if (lastError) throw lastError;
  const { data, error } = await db().from("heuresis_catalogues").insert({ title: input.title.trim(), description: input.description?.trim() || null, criteria: input.criteria, sort_order: Number(last?.[0]?.sort_order ?? -1) + 1 }).select("id,title,description,criteria,sort_order,created_at,updated_at").single();
  if (error) throw error;
  return { id: data.id, title: data.title, description: data.description ?? null, criteria: catalogueCriteria(data.criteria), sort_order: Number(data.sort_order ?? 0), created_at: data.created_at, updated_at: data.updated_at } satisfies SavedCatalogue;
}

export async function updateCatalogue(id: string, patch: Partial<{ title: string; description: string | null; criteria: CatalogueCriteria; sort_order: number }>) {
  const next = {
    title: patch.title?.trim(),
    description: patch.description === undefined ? undefined : patch.description?.trim() || null,
    criteria: patch.criteria,
    sort_order: patch.sort_order,
    updated_at: new Date().toISOString(),
  };
  const { error } = await db().from("heuresis_catalogues").update(next).eq("id", id);
  if (error) throw error;
}
export async function deleteCatalogue(id: string) { const { error } = await db().from("heuresis_catalogues").delete().eq("id", id); if (error) throw error; }

export async function ensureTag(name: string): Promise<HeuresisTag> {
  const clean = name.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Tag name cannot be empty.");
  if (clean.length > 48) throw new Error("Keep tags under 48 characters.");
  const select = "id,name,is_badge,shortcut,sort_order";
  const { data: existing, error: lookupError } = await db().from("heuresis_tags").select(select).ilike("name", clean).limit(1);
  if (lookupError) throw lookupError;
  if (existing?.[0]) return existing[0] as HeuresisTag;
  const { data, error } = await db().from("heuresis_tags").insert({ name: clean }).select(select).single();
  if (!error) return data as HeuresisTag;
  if (error.code === "23505") {
    const { data: raced, error: racedError } = await db().from("heuresis_tags").select(select).ilike("name", clean).limit(1).single();
    if (racedError) throw racedError;
    return raced as HeuresisTag;
  }
  throw error;
}

export async function importCardsWithProgress(packId: string, rows: Array<Record<string, string>>, onProgress?: (done: number, total: number) => void) {
  let created = 0;
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500);
    const { data, error } = await db().rpc("heuresis_import_cards", { p_pack_id: packId, p_rows: batch });
    if (error) throw Object.assign(error, { created });
    created += Number(data ?? batch.length);
    onProgress?.(created, rows.length);
  }
  return created;
}

export async function importCardsWithTagsProgress(packId: string, rows: Array<{ data: Record<string, string>; tagIds: string[] }>, onProgress?: (done: number, total: number) => void) {
  let created = 0;
  for (let start = 0; start < rows.length; start += 500) {
    const batch = rows.slice(start, start + 500).map((row) => ({ data: row.data, tag_ids: row.tagIds }));
    const { data, error } = await db().rpc("heuresis_import_cards_with_tags", { p_pack_id: packId, p_rows: batch });
    if (error) throw Object.assign(error, { created });
    created += Number(data ?? batch.length);
    onProgress?.(created, rows.length);
  }
  return created;
}

export async function updateImportedCards(updates: Array<{ id: string; data: Record<string, string> }>, onProgress?: (done: number, total: number) => void) {
  let done = 0;
  for (let start = 0; start < updates.length; start += 500) {
    const batch = updates.slice(start, start + 500);
    const { data, error } = await db().rpc("heuresis_update_imported_cards", { p_updates: batch });
    if (error) throw Object.assign(error, { updated: done });
    done += Number(data ?? batch.length);
    onProgress?.(done, updates.length);
  }
  return done;
}

export async function importCards(packId: string, rows: Array<Record<string, string>>) { return importCardsWithProgress(packId, rows); }

export async function startSession(packId: string, mode: "browse" | "related", templateId: string | null = null) {
  const { data, error } = await db().from("heuresis_sessions").insert({ pack_id: packId, mode, template_id: templateId }).select("id").single();
  if (error) throw error;
  return data.id;
}
export async function finishSession(sessionId: string) { const { error } = await db().from("heuresis_sessions").update({ ended_at: new Date().toISOString() }).eq("id", sessionId); if (error) throw error; }
export async function recordEncounter(cardId: string, packId: string, sessionId: string) {
  const { error } = await db().from("heuresis_card_events").insert({ client_event_id: crypto.randomUUID(), card_id: cardId, pack_id: packId, session_id: sessionId, template_id: null, event_type: "encountered" });
  if (error) throw error;
}
export function typesById(types: CardType[]) { return new Map(types.map((type) => [type.id, type])); }
