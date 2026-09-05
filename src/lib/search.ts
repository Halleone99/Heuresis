import { supabase } from "./supabase";

export type SearchCardResult = {
  id: string;
  pack_id: string;
  role: "main" | "related";
  data: Record<string, string | string[] | null>;
  note: string | null;
};

function cardData(value: unknown): Record<string, string | string[] | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, string | string[] | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string" || item === null) result[key] = item;
    else if (Array.isArray(item) && item.every((part) => typeof part === "string")) result[key] = item as string[];
  }
  return result;
}

export async function searchCards(query: string): Promise<SearchCardResult[]> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const term = query.trim();
  if (term.length < 2) return [];
  const { data, error } = await supabase
    .from("heuresis_cards")
    .select("id,pack_id,role,data,note")
    .ilike("search_text", `%${term}%`)
    .order("updated_at", { ascending: false })
    .limit(40);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    pack_id: row.pack_id,
    role: row.role === "related" ? "related" : "main",
    data: cardData(row.data),
    note: row.note ?? null,
  }));
}
