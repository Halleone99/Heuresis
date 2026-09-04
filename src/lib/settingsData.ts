import { supabase } from "./supabase";

export type StructureRole = "term" | "reading" | "meaning" | "extra" | "example" | "example_reading" | "example_translation";
export type StructureScript = "han" | "cyrl" | "latn";
export type StructureField = {
  key: string;
  label: string;
  script?: StructureScript;
  role?: StructureRole;
  required?: boolean;
};

export type StructureTemplate = {
  id: string;
  user_id: string | null;
  card_type_id: string;
  name: string;
  front: string[];
  back: string[];
  details: string[];
  sort_order: number;
};

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function fields(value: unknown): StructureField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.key !== "string" || typeof row.label !== "string") return [];
    return [{
      key: row.key,
      label: row.label,
      script: row.script === "han" || row.script === "cyrl" ? row.script : "latn",
      role: typeof row.role === "string" ? row.role as StructureRole : "extra",
      required: typeof row.required === "boolean" ? row.required : undefined,
    }];
  });
}

function normaliseShortcut(value: string | null | undefined) {
  const next = value?.trim().toLocaleLowerCase().replace(/\s+/g, "") ?? "";
  return next || null;
}

export async function createBadge(input: { name: string; shortcut?: string | null }) {
  const name = input.name.trim().replace(/\s+/g, " ");
  if (!name) throw new Error("Badge name cannot be empty.");
  if (name.length > 48) throw new Error("Keep badge names under 48 characters.");
  const { data: last, error: lastError } = await db().from("heuresis_tags").select("sort_order").eq("is_badge", true).order("sort_order", { ascending: false }).limit(1);
  if (lastError) throw lastError;
  const { error } = await db().from("heuresis_tags").insert({ name, shortcut: normaliseShortcut(input.shortcut), is_badge: true, sort_order: Number(last?.[0]?.sort_order ?? -1) + 1 });
  if (error) throw error;
}

export async function updateBadge(id: string, patch: Partial<{ name: string; shortcut: string | null; sort_order: number; is_badge: boolean }>) {
  const next: Record<string, string | number | boolean | null> = {};
  if (patch.name !== undefined) {
    const name = patch.name.trim().replace(/\s+/g, " ");
    if (!name) throw new Error("Badge name cannot be empty.");
    if (name.length > 48) throw new Error("Keep badge names under 48 characters.");
    next.name = name;
  }
  if (patch.shortcut !== undefined) next.shortcut = normaliseShortcut(patch.shortcut);
  if (patch.sort_order !== undefined) next.sort_order = patch.sort_order;
  if (patch.is_badge !== undefined) next.is_badge = patch.is_badge;
  const { error } = await db().from("heuresis_tags").update(next).eq("id", id);
  if (error) throw error;
}

export async function promoteTagToBadge(id: string) {
  const { data: last, error: lastError } = await db().from("heuresis_tags").select("sort_order").eq("is_badge", true).order("sort_order", { ascending: false }).limit(1);
  if (lastError) throw lastError;
  await updateBadge(id, { is_badge: true, shortcut: null, sort_order: Number(last?.[0]?.sort_order ?? -1) + 1 });
}

export async function demoteBadge(id: string) {
  await updateBadge(id, { is_badge: false, shortcut: null });
}

export async function loadCardTypeStructure(cardTypeId: string) {
  const { data, error } = await db().from("heuresis_card_types").select("id,name,field_schema").eq("id", cardTypeId).single();
  if (error) throw error;
  return { id: data.id, name: data.name, fields: fields(data.field_schema) };
}

export async function customisePackStructure(packId: string, nextFields: StructureField[]) {
  if (nextFields.length < 2) throw new Error("Keep at least two fields on a card.");
  const cleaned = nextFields.map((field) => ({ ...field, key: field.key.trim(), label: field.label.trim() }));
  if (cleaned.some((field) => !field.key || !field.label)) throw new Error("Every field needs a name and key.");
  const keys = cleaned.map((field) => field.key.toLocaleLowerCase());
  if (new Set(keys).size !== keys.length) throw new Error("Each field needs a unique key.");
  const { data, error } = await db().rpc("heuresis_customize_pack_structure", { p_pack_id: packId, p_fields: cleaned });
  if (error) throw error;
  return String(data ?? "");
}

export async function listStructureTemplates(cardTypeId: string): Promise<StructureTemplate[]> {
  const { data, error } = await db().from("heuresis_study_templates").select("id,user_id,card_type_id,name,front,back,details,sort_order").eq("card_type_id", cardTypeId).order("sort_order").order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    user_id: row.user_id ?? null,
    card_type_id: row.card_type_id,
    name: row.name,
    front: stringArray(row.front),
    back: stringArray(row.back),
    details: stringArray(row.details),
    sort_order: Number(row.sort_order ?? 0),
  }));
}

async function currentUserId() {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error("Sign in to edit study directions.");
  return data.user.id;
}

export async function createStudyTemplate(input: { cardTypeId: string; name: string; front: string[]; back: string[]; details: string[]; sortOrder: number }) {
  if (!input.front.length || !input.back.length) throw new Error("Choose at least one field for each side.");
  const userId = await currentUserId();
  const { error } = await db().from("heuresis_study_templates").insert({ user_id: userId, card_type_id: input.cardTypeId, name: input.name.trim() || "Study direction", front: input.front, back: input.back, details: input.details, sort_order: input.sortOrder });
  if (error) throw error;
}

export async function updateStudyTemplate(templateId: string, patch: { name: string; front: string[]; back: string[]; details: string[]; sortOrder: number }) {
  if (!patch.front.length || !patch.back.length) throw new Error("Choose at least one field for each side.");
  const { error } = await db().from("heuresis_study_templates").update({ name: patch.name.trim() || "Study direction", front: patch.front, back: patch.back, details: patch.details, sort_order: patch.sortOrder }).eq("id", templateId);
  if (error) throw error;
}

export async function deleteStudyTemplate(templateId: string) {
  const { error } = await db().from("heuresis_study_templates").delete().eq("id", templateId);
  if (error) throw error;
}
