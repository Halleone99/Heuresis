import { supabase } from "./supabase";
import type { KnowledgeEntry, NoteCategory } from "./knowledgeWorkspace";

/** A mode is a personal practice category. Its label and symbol are editable. */
export type MistakeMode = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  symbol: string;
  sort_order: number;
  legacy_category: NoteCategory | null;
  archived: boolean;
};
export type ModeInput = Pick<MistakeMode, "name" | "description" | "symbol">;
const defaults: Array<Omit<MistakeMode, "id" | "user_id" | "archived">> = [
  { name: "Grammar", description: "Cases, tenses, sentence structure and rules.", symbol: "icon:graduation", sort_order: 0, legacy_category: "grammar" },
  { name: "Vocabulary", description: "Words, meanings, forms and usage.", symbol: "icon:book", sort_order: 1, legacy_category: "vocabulary" },
  { name: "Expressions", description: "Natural phrasing, idioms and blocks of meaning.", symbol: "icon:message", sort_order: 2, legacy_category: "phrase" },
  { name: "Other mistakes", description: "Unclassified mistakes and anything else to revisit.", symbol: "icon:warning", sort_order: 3, legacy_category: "note" },
];
export const ICON_CHOICES = [
  "icon:graduation", "icon:book", "icon:message", "icon:warning", "icon:brain", "icon:target",
  "icon:headphones", "icon:pen", "📐", "📚", "🔤", "✍️", "🧠", "🎯", "🗣️", "🎧", "🧩", "💬", "🌍", "⭐", "📝", "⚡", "🔍", "🛠️",
];
export const FALLBACK_MODES: MistakeMode[] = defaults.map((item, i) => ({
  ...item, id: `fallback-${i}`, user_id: "", archived: false,
}));
const SORT = (a: MistakeMode, b: MistakeMode) => a.sort_order - b.sort_order || a.name.localeCompare(b.name);

function database() {
  if (!supabase) throw new Error("Sign in to customise mistake modes.");
  return supabase;
}
function check(input: ModeInput) {
  if (!input.name.trim() || input.name.trim().length > 80) throw new Error("Use a name of 1–80 characters.");
  if (input.description.length > 220) throw new Error("Keep descriptions under 220 characters.");
  if (!input.symbol.trim() || input.symbol.length > 60) throw new Error("Choose an icon or emoji.");
}
function asModes(data: unknown): MistakeMode[] {
  return ((data ?? []) as MistakeMode[]).sort(SORT);
}
export async function loadMistakeModes(userId: string): Promise<MistakeMode[]> {
  const db = database();
  const first = await db.from("knowledge_mistake_modes").select("*").eq("user_id", userId);
  if (first.error) throw first.error;
  const existing = asModes(first.data);
  const missing = defaults.filter((item) => !existing.some((record) => record.legacy_category === item.legacy_category));
  if (!missing.length) return existing.filter((m) => !m.archived);
  // The unique constraint makes this safe against simultaneous app windows.
  const inserted = await db.from("knowledge_mistake_modes")
    .upsert(missing.map((item) => ({ ...item, user_id: userId })), { onConflict: "user_id,legacy_category", ignoreDuplicates: true });
  if (inserted.error) throw inserted.error;
  const second = await db.from("knowledge_mistake_modes").select("*").eq("user_id", userId);
  if (second.error) throw second.error;
  return asModes(second.data).filter((m) => !m.archived);
}
export async function createMistakeMode(userId: string, input: ModeInput, order: number): Promise<void> {
  check(input);
  const { error } = await database().from("knowledge_mistake_modes").insert({
    id: crypto.randomUUID(), user_id: userId, name: input.name.trim(), description: input.description.trim(),
    symbol: input.symbol.trim(), sort_order: order, legacy_category: null,
  });
  if (error) throw error;
}
export async function updateMistakeMode(userId: string, id: string, input: ModeInput): Promise<void> {
  check(input);
  const { data, error } = await database().from("knowledge_mistake_modes")
    .update({ name: input.name.trim(), description: input.description.trim(), symbol: input.symbol.trim() })
    .eq("id", id).eq("user_id", userId).select("id").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("This mode no longer exists.");
}
export async function deleteMistakeMode(userId: string, mode: MistakeMode): Promise<void> {
  const q = database().from("knowledge_mistake_modes");
  const result = mode.legacy_category
    ? await q.update({ archived: true }).eq("id", mode.id).eq("user_id", userId).select("id").maybeSingle()
    : await q.delete().eq("id", mode.id).eq("user_id", userId).select("id").maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new Error("This mode no longer exists.");
}
export async function moveMistakeMode(userId: string, one: MistakeMode, two: MistakeMode): Promise<void> {
  const db = database();
  const a = await db.from("knowledge_mistake_modes").update({ sort_order: two.sort_order }).eq("id", one.id).eq("user_id", userId);
  if (a.error) throw a.error;
  const b = await db.from("knowledge_mistake_modes").update({ sort_order: one.sort_order }).eq("id", two.id).eq("user_id", userId);
  if (b.error) throw b.error;
}
export function resolveMistakeMode(entry: KnowledgeEntry, modes: MistakeMode[]): string | null {
  if (entry.mistake_mode_id && modes.some((m) => m.id === entry.mistake_mode_id)) return entry.mistake_mode_id;
  const legacyCategory = entry.category === "grammar" || entry.category === "vocabulary" || entry.category === "phrase"
    ? entry.category : "note";
  const exact = modes.find((m) => m.legacy_category === legacyCategory);
  if (exact) return exact.id;
  return modes.find((m) => m.legacy_category === "note")?.id ?? null;
}
