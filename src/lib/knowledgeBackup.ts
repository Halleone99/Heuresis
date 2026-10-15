import { supabase } from "./supabase";
import { NETWORK_ONLY_HEADER } from "./offlineFetch";
import type { KnowledgeEntry } from "./knowledgeWorkspace";

export type ArchivedKnowledgeRow = KnowledgeEntry & { deleted_at: string };
const PAGE_SIZE = 800;
const MAX_PAGES = 100; // fail loudly instead of silently truncating a large export

function client() {
  if (!supabase) throw new Error("Sign in to access your saved knowledge.");
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("Connect to the Internet to retrieve a complete Trash or export. Your offline drafts are not affected.");
  return supabase;
}

/** Every query is filtered by the signed-in user and server RLS remains enforced. */
export async function listArchivedKnowledge(userId: string): Promise<ArchivedKnowledgeRow[]> {
  const result: ArchivedKnowledgeRow[] = [];
  const db = client();
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await db.from("knowledge_records")
      .select("*").eq("user_id", userId).not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }).order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .setHeader(NETWORK_ONLY_HEADER, "1");
    if (error) throw error;
    result.push(...(data ?? []) as ArchivedKnowledgeRow[]);
    if ((data?.length ?? 0) < PAGE_SIZE) return result;
  }
  throw new Error("Trash is too large to display completely. No records were changed.");
}

export async function restoreArchivedKnowledge(userId: string, id: string, deletedAt: string) {
  // Not queued offline: the result must be confirmed while the user watches.
  const { data, error } = await client().from("knowledge_records")
    .update({ deleted_at: null }).eq("user_id", userId).eq("id", id)
    .eq("deleted_at", deletedAt).select("id").setHeader(NETWORK_ONLY_HEADER, "1").maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("The archived record has changed. Refresh Trash and try again.");
}

async function entireTable(table: string, userId: string): Promise<Record<string, unknown>[]> {
  const records: Record<string, unknown>[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    // Straight from the server: a dropped connection must fail the export,
    // not quietly fill it from this device's partial offline copy.
    const { data, error } = await client().from(table).select("*").eq("user_id", userId)
      .order("id", { ascending: true }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .setHeader(NETWORK_ONLY_HEADER, "1");
    if (error) throw error;
    records.push(...(data ?? []) as Record<string, unknown>[]);
    if ((data?.length ?? 0) < PAGE_SIZE) return records;
  }
  throw new Error(`Export stopped: ${table} exceeded the safe size limit. No partial backup will be downloaded.`);
}

/** A complete, versioned JSON backup including archived notes and recall attempts. */
export async function exportKnowledgeJson(userId: string): Promise<string> {
  const tables = ["knowledge_subjects", "knowledge_topics", "knowledge_records", "knowledge_practice_events", "knowledge_mistake_modes"];
  const results = await Promise.all(tables.map((table) => entireTable(table, userId)));
  return JSON.stringify({
    format: "heuresis-knowledge-backup-v1",
    generated_at: new Date().toISOString(),
    note: "Contains personal learning data. Keep private. Study cards are not included. Offline unsynced writes must be exported separately from Offline recovery.",
    counts: Object.fromEntries(tables.map((table, index) => [table, results[index].length])),
    data: Object.fromEntries(tables.map((table, index) => [table, results[index]])),
  }, null, 2);
}
