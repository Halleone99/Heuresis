import { supabase } from "./supabase";

export const CARD_PAGE_SIZE = 200;
const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";
/**
 * A card discarded in Sort keeps its row, id and history; it is only marked in its
 * data (like _sorted_at), hidden from Heuresis lists and listed in Trash until it is
 * restored or deleted permanently. No schema change is needed, and the mark is written
 * through heuresis_patch_card_data, which also works offline.
 */
export const DISCARDED_AT_KEY = "_discarded_at";

export function isDiscarded(card: Pick<CardWithStats, "data">) {
  const value = card.data[DISCARDED_AT_KEY];
  return typeof value === "string" && Boolean(value.trim());
}

export type AccentKey = "cinnabar" | "indigo" | "amber" | "sage" | "burgundy" | "slate" | "ink";
export type FieldRole = "term" | "reading" | "meaning" | "extra" | "example" | "example_reading" | "example_translation";
export type CardRetention = "reference" | "learning";

export type FieldDef = {
  key: string;
  label: string;
  role?: FieldRole;
  required?: boolean;
};

export type Collection = {
  id: string;
  title: string;
  description: string | null;
  accent: AccentKey;
  glyph: string | null;
  sort_order: number;
};

export type CardType = {
  id: string;
  name: string;
  field_schema: FieldDef[];
};

export type Pack = {
  id: string;
  collection_id: string;
  card_type_id: string;
  title: string;
  description: string | null;
  sort_order: number;
  card_count: number;
  encountered_cards: number;
  open_count: number;
  last_opened_at: string | null;
};

export type PackWithType = Pack & { cardType: CardType | null };

export type HeuresisTag = {
  id: string;
  name: string;
  is_badge: boolean;
  shortcut: string | null;
  sort_order: number;
};

export type CardStats = {
  encounter_count: number;
  study_count: number;
  known_count: number;
  again_count: number;
  hard_count: number;
  good_count: number;
  easy_count: number;
  first_encountered_at: string | null;
  last_encountered_at: string | null;
  by_template: Record<string, Record<string, number>>;
};

export type CardWithStats = {
  id: string;
  pack_id: string;
  retention: CardRetention;
  data: Record<string, string | string[] | null>;
  note: string | null;
  favourite: boolean;
  interesting: boolean;
  interest_rank: number | null;
  created_at: string;
  updated_at: string;
  tags: HeuresisTag[];
  stats: CardStats;
};

export type CardPage = {
  items: CardWithStats[];
  offset: number;
  nextOffset: number | null;
  total: number;
};

const EMPTY_STATS: CardStats = {
  encounter_count: 0,
  study_count: 0,
  known_count: 0,
  again_count: 0,
  hard_count: 0,
  good_count: 0,
  easy_count: 0,
  first_encountered_at: null,
  last_encountered_at: null,
  by_template: {},
};

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function fieldSchema(value: unknown): FieldDef[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string" || typeof row.label !== "string") return [];
    const next: FieldDef = { key: row.key, label: row.label };
    if (typeof row.required === "boolean") next.required = row.required;
    if (typeof row.role === "string") next.role = row.role as FieldRole;
    return [next];
  });
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

function first<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function templateStats(value: unknown): Record<string, Record<string, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const [templateId, counts] of Object.entries(value as Record<string, unknown>)) {
    if (!counts || typeof counts !== "object" || Array.isArray(counts)) continue;
    result[templateId] = Object.fromEntries(Object.entries(counts as Record<string, unknown>).map(([key, count]) => [key, Number(count ?? 0)]));
  }
  return result;
}

function mapCardRow(row: any): CardWithStats {
  const stats = first(row.heuresis_card_stats) as Partial<CardStats> | null;
  const tags = (Array.isArray(row.heuresis_card_tags) ? row.heuresis_card_tags : [])
    .flatMap((link: any) => {
      const tag = first(link.heuresis_tags) as HeuresisTag | null;
      return tag?.id ? [tag] : [];
    });

  return {
    id: row.id,
    pack_id: row.pack_id,
    retention: row.retention === "reference" ? "reference" : "learning",
    data: cardData(row.data),
    note: row.note ?? null,
    favourite: Boolean(row.favourite),
    interesting: Boolean(row.interesting),
    interest_rank: row.interest_rank == null ? null : Number(row.interest_rank),
    created_at: row.created_at,
    updated_at: row.updated_at,
    tags,
    stats: stats ? {
      encounter_count: Number(stats.encounter_count ?? 0),
      study_count: Number(stats.study_count ?? 0),
      known_count: Number(stats.known_count ?? 0),
      again_count: Number(stats.again_count ?? 0),
      hard_count: Number(stats.hard_count ?? 0),
      good_count: Number(stats.good_count ?? 0),
      easy_count: Number(stats.easy_count ?? 0),
      first_encountered_at: typeof stats.first_encountered_at === "string" ? stats.first_encountered_at : null,
      last_encountered_at: typeof stats.last_encountered_at === "string" ? stats.last_encountered_at : null,
      by_template: templateStats(stats.by_template),
    } : { ...EMPTY_STATS },
  };
}

export function fieldByRole(type: CardType | null | undefined, role: FieldRole) {
  return type?.field_schema.find((field) => field.role === role) ?? null;
}

export function fieldText(data: CardWithStats["data"], key: string | undefined) {
  if (!key) return "";
  const value = data[key];
  return Array.isArray(value) ? value.join(" · ") : value ?? "";
}

export async function listCollections(): Promise<Collection[]> {
  const { data, error } = await db()
    .from("heuresis_collections")
    .select("id,title,description,accent,glyph,sort_order")
    .is("archived_at", null)
    .order("sort_order")
    .order("created_at");
  if (error) throw error;
  return (data ?? []) as Collection[];
}

export async function listCardTypes(): Promise<CardType[]> {
  const { data, error } = await db()
    .from("heuresis_card_types")
    .select("id,name,field_schema")
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, field_schema: fieldSchema(row.field_schema) }));
}

/** Cards discarded in Sort, per topic (they stay in the database until deleted from Trash). */
async function discardedCountsByPack(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await db().from("heuresis_cards").select("pack_id").eq("role", "main").not(`data->>${DISCARDED_AT_KEY}`, "is", null).limit(10000);
  if (error) throw error;
  for (const row of data ?? []) if (typeof row.pack_id === "string") counts.set(row.pack_id, (counts.get(row.pack_id) ?? 0) + 1);
  return counts;
}

export async function listPacks(): Promise<PackWithType[]> {
  const [packsResult, types, discarded] = await Promise.all([
    db()
      .from("heuresis_pack_overview")
      .select("id,collection_id,card_type_id,title,description,sort_order,card_count,encountered_cards,open_count,last_opened_at")
      .is("archived_at", null)
      .order("sort_order")
      .order("created_at"),
    listCardTypes(),
    // Counts are a convenience: if this read fails, topics still list (counts include discarded cards).
    discardedCountsByPack().catch(() => new Map<string, number>()),
  ]);

  if (packsResult.error) throw packsResult.error;
  const typeMap = new Map(types.map((type) => [type.id, type]));
  return (packsResult.data ?? []).flatMap((row) => {
    if (!row.id || !row.collection_id || !row.card_type_id || !row.title) return [];
    return [{
      id: row.id,
      collection_id: row.collection_id,
      card_type_id: row.card_type_id,
      title: row.title,
      description: row.description ?? null,
      sort_order: Number(row.sort_order ?? 0),
      card_count: Math.max(0, Number(row.card_count ?? 0) - (discarded.get(row.id) ?? 0)),
      encountered_cards: Number(row.encountered_cards ?? 0),
      open_count: Number(row.open_count ?? 0),
      last_opened_at: row.last_opened_at ?? null,
      cardType: typeMap.get(row.card_type_id) ?? null,
    }];
  });
}

export async function listTags(): Promise<HeuresisTag[]> {
  const { data, error } = await db()
    .from("heuresis_tags")
    .select("id,name,is_badge,shortcut,sort_order")
    .order("is_badge", { ascending: false })
    .order("sort_order")
    .order("name");
  if (error) throw error;
  return (data ?? []) as HeuresisTag[];
}

const CARD_SELECT = "id,pack_id,retention,data,note,favourite,interesting,interest_rank,created_at,updated_at,heuresis_card_stats(encounter_count,study_count,known_count,again_count,hard_count,good_count,easy_count,first_encountered_at,last_encountered_at,by_template),heuresis_card_tags(tag_id,heuresis_tags(id,name,is_badge,shortcut,sort_order))";

export async function listCardsPage(packId: string, options: { offset?: number; limit?: number } = {}): Promise<CardPage> {
  const offset = Math.max(0, Math.floor(options.offset ?? 0));
  const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? CARD_PAGE_SIZE)));
  const { data, error, count } = await db()
    .from("heuresis_cards")
    .select(CARD_SELECT, { count: "exact" })
    .eq("pack_id", packId)
    .eq("role", "main")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  const items = (data ?? []).map(mapCardRow);
  const total = Number(count ?? offset + items.length);
  const nextOffset = offset + items.length < total ? offset + items.length : null;
  return { items, offset, nextOffset, total };
}

export async function listAllCards(packId: string, onProgress?: (loaded: number, total: number) => void): Promise<CardWithStats[]> {
  const result: CardWithStats[] = [];
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;
  while (offset < total) {
    const page = await listCardsPage(packId, { offset, limit: CARD_PAGE_SIZE });
    result.push(...page.items.filter((card) => !isDiscarded(card)));
    total = page.total;
    onProgress?.(result.length, total);
    if (page.nextOffset == null || page.nextOffset <= offset) break;
    offset = page.nextOffset;
  }
  return result;
}

/** Ordinary topic/review surfaces contain learning cards only. Catalogue reads use listAllCards. */
export async function listCards(packId: string): Promise<CardWithStats[]> {
  return (await listAllCards(packId)).filter((card) => card.retention === "learning");
}

/** Learning and reference cards of a topic in one read (the topic page shows both). */
export async function listTopicCards(packId: string): Promise<{ learning: CardWithStats[]; reference: CardWithStats[] }> {
  const all = await listAllCards(packId);
  return { learning: all.filter((card) => card.retention === "learning"), reference: all.filter((card) => card.retention === "reference") };
}

/** Discarded cards across the given topics, newest first (for Trash). */
export async function listDiscardedCards(packIds?: string[]): Promise<CardWithStats[]> {
  if (packIds && !packIds.length) return [];
  // Only the discarded cards are read (JSON-path filter; the offline cache understands it too).
  let query = db()
    .from("heuresis_cards")
    .select(CARD_SELECT)
    .eq("role", "main")
    .not(`data->>${DISCARDED_AT_KEY}`, "is", null);
  if (packIds) query = query.in("pack_id", packIds);
  const { data, error } = await query.order("updated_at", { ascending: false }).limit(2000);
  if (error) throw error;
  const at = (card: CardWithStats) => String(card.data[DISCARDED_AT_KEY] ?? "");
  return (data ?? []).map(mapCardRow).filter(isDiscarded).sort((a, b) => at(b).localeCompare(at(a)));
}

export async function getCard(cardId: string): Promise<CardWithStats | null> {
  const { data, error } = await db().from("heuresis_cards").select(CARD_SELECT).eq("id", cardId).maybeSingle();
  if (error) throw error;
  return data ? mapCardRow(data) : null;
}

/** Deliberate role-blind lookup for explicit card-id sessions such as Related review and connection previews. */
export async function listCardsByIds(ids: string[]): Promise<CardWithStats[]> {
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const rows: CardWithStats[] = [];
  for (let start = 0; start < uniqueIds.length; start += CARD_PAGE_SIZE) {
    const batch = uniqueIds.slice(start, start + CARD_PAGE_SIZE);
    const { data, error } = await db().from("heuresis_cards").select(CARD_SELECT).in("id", batch);
    if (error) throw error;
    rows.push(...(data ?? []).map(mapCardRow));
  }
  const byId = new Map(rows.map((card) => [card.id, card]));
  return uniqueIds.map((id) => byId.get(id)).filter((card): card is CardWithStats => Boolean(card));
}

export async function setCardRetention(cardId: string, retention: CardRetention) {
  const { error } = await db().rpc("heuresis_set_card_retention", { p_card_id: cardId, p_retention: retention });
  if (error) throw error;
}

function cleanCardValues(pack: PackWithType, values: Record<string, string>) {
  const schema = pack.cardType?.field_schema ?? [];
  for (const field of schema) {
    if (field.required && !values[field.key]?.trim()) throw new Error(`${field.label} is required.`);
  }
  const data = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value.trim()]).filter(([, value]) => Boolean(value)));
  if (!Object.keys(data).length) throw new Error("Add at least one card field.");
  return data;
}

export async function createCard(pack: PackWithType, values: Record<string, string>, note?: string, tagIds: string[] = []) {
  const data = cleanCardValues(pack, values);
  const { data: created, error } = await db().from("heuresis_cards").insert({ pack_id: pack.id, data, note: note?.trim() || null }).select("id,created_at").single();
  if (error) throw error;
  if (tagIds.length) {
    const { error: tagError } = await db().rpc("heuresis_set_card_tags", { p_card_id: created.id, p_tag_ids: tagIds });
    if (tagError) throw tagError;
  }
  return created;
}

function canDesktopRoundTripWorkspaceEntry(entry: string) {
  try {
    const value = JSON.parse(entry) as Record<string, unknown>;
    if (value?.type === "text") return typeof value.id === "string" && typeof value.text === "string";
    if (value?.type === "image") return typeof value.id === "string" && typeof value.path === "string";
    return false;
  } catch {
    return false;
  }
}

function preserveUnsupportedWorkspaceEntries(current: Record<string, string | string[] | null>, patch: Record<string, string | string[] | null>) {
  const existing = current[WORKSPACE_BLOCKS_KEY];
  const incoming = patch[WORKSPACE_BLOCKS_KEY];
  if (!Array.isArray(existing) || !Array.isArray(incoming)) return patch;
  const next = [...incoming];
  const seen = new Set(next);
  for (const entry of existing) {
    if (!canDesktopRoundTripWorkspaceEntry(entry) && !seen.has(entry)) {
      next.push(entry);
      seen.add(entry);
    }
  }
  return { ...patch, [WORKSPACE_BLOCKS_KEY]: next };
}

export async function patchCardData(cardId: string, patch: Record<string, string | string[] | null>) {
  let safePatch = patch;
  if (Array.isArray(patch[WORKSPACE_BLOCKS_KEY])) {
    const { data: existing, error: readError } = await db().from("heuresis_cards").select("data").eq("id", cardId).single();
    if (readError) throw readError;
    safePatch = preserveUnsupportedWorkspaceEntries(cardData(existing?.data), patch);
  }
  const { data, error } = await db().rpc("heuresis_patch_card_data", { p_card_id: cardId, p_patch: safePatch });
  if (error) throw error;
  return cardData(data);
}

export async function saveCardNote(cardId: string, note: string | null) {
  const { error } = await db().from("heuresis_cards").update({ note: note?.trim() || null }).eq("id", cardId);
  if (error) throw error;
}

export async function updateCard(pack: PackWithType, cardId: string, values: Record<string, string>, extras: {
  note?: string;
  favourite?: boolean;
  interest_rank?: number | null;
  tagIds?: string[];
  expectedUpdatedAt?: string;
}) {
  const visibleData = cleanCardValues(pack, values);
  const { data: existing, error: readError } = await db().from("heuresis_cards").select("data").eq("id", cardId).single();
  if (readError) throw readError;
  const previous = cardData(existing?.data);
  // Editing only the current topic's fields must not erase values from earlier structures.
  // A field that is still visible can deliberately be cleared; an unseen field cannot.
  const visibleKeys = new Set((pack.cardType?.field_schema ?? []).map((field) => field.key));
  const preserved = Object.fromEntries(Object.entries(previous).filter(([key]) => !visibleKeys.has(key)));
  const data = { ...preserved, ...visibleData };
  const rank = extras.interest_rank == null ? null : Math.min(5, Math.max(1, Math.round(extras.interest_rank)));
  let mutation = db().from("heuresis_cards").update({
    data,
    note: extras.note?.trim() || null,
    favourite: Boolean(extras.favourite),
    interesting: Boolean(rank && rank >= 4),
    interest_rank: rank,
  }).eq("id", cardId);
  // The editor must not overwrite an edit made since its card was opened.
  if (extras.expectedUpdatedAt) mutation = mutation.eq("updated_at", extras.expectedUpdatedAt);
  const { data: saved, error } = await mutation.select("id").maybeSingle();
  if (error) throw error;
  if (!saved) throw new Error("This card changed on another device. Reopen it before saving.");
  if (extras.tagIds) {
    const { error: tagError } = await db().rpc("heuresis_set_card_tags", { p_card_id: cardId, p_tag_ids: extras.tagIds });
    if (tagError) throw tagError;
  }
}

export async function deleteCard(cardId: string) {
  const { error } = await db().from("heuresis_cards").delete().eq("id", cardId);
  if (!error) return;
  if (error.code === "23503") throw new Error("Remove this card's Related connections before deleting it.");
  throw error;
}
