import { supabase } from "./supabase";

export type AccentKey = "cinnabar" | "indigo" | "amber" | "sage" | "burgundy" | "slate" | "ink";
export type FieldRole = "term" | "reading" | "meaning" | "extra" | "example" | "example_reading" | "example_translation";

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
};

export type PackWithType = Pack & { cardType: CardType | null };

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
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    field_schema: fieldSchema(row.field_schema),
  }));
}

export async function listPacks(): Promise<PackWithType[]> {
  const [packsResult, types] = await Promise.all([
    db()
      .from("heuresis_packs")
      .select("id,collection_id,card_type_id,title,description,sort_order")
      .is("archived_at", null)
      .order("sort_order")
      .order("created_at"),
    listCardTypes(),
  ]);

  if (packsResult.error) throw packsResult.error;
  const typeMap = new Map(types.map((type) => [type.id, type]));
  return ((packsResult.data ?? []) as Pack[]).map((pack) => ({
    ...pack,
    cardType: typeMap.get(pack.card_type_id) ?? null,
  }));
}

export async function createCard(pack: PackWithType, values: Record<string, string>, note?: string) {
  const schema = pack.cardType?.field_schema ?? [];
  for (const field of schema) {
    if (field.required && !values[field.key]?.trim()) {
      throw new Error(`${field.label} is required.`);
    }
  }

  const data = Object.fromEntries(
    Object.entries(values)
      .map(([key, value]) => [key, value.trim()])
      .filter(([, value]) => Boolean(value)),
  );

  if (!Object.keys(data).length) throw new Error("Add at least one card field.");

  const { data: created, error } = await db()
    .from("heuresis_cards")
    .insert({
      pack_id: pack.id,
      data,
      note: note?.trim() || null,
    })
    .select("id,created_at")
    .single();

  if (error) throw error;
  return created;
}
