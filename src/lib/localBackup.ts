/**
 * Native Windows backup, separate from Supabase and the WebView offline cache.
 *
 * Online, authenticated, no pending edits; server-only paginated reads. A complete
 * snapshot is atomically published only after EVERY table and media file succeeds.
 * Incomplete attempts never replace an older dated backup.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { heuresisCardImagePaths } from "./cardMedia";
import { getOfflineSyncState, NETWORK_ONLY_HEADER } from "./offlineFetch";
import { supabase } from "./supabase";

const FORMAT = "heuresis-complete-local-v1";
const BUCKET = "heuresis-card-media";
const PAGE_SIZE = 800;
const MAX_PAGES = 500;
const MEDIA_CHUNK_SIZE = 256 * 1024;

export const BACKUP_TABLES = [
  "knowledge_subjects", "knowledge_topics", "knowledge_records",
  "knowledge_practice_events", "knowledge_mistake_modes", "knowledge_entries",
  "heuresis_collections", "heuresis_packs", "heuresis_cards",
  "heuresis_card_types", "heuresis_tags", "heuresis_card_tags",
  "heuresis_study_templates", "heuresis_catalogues", "heuresis_card_relations",
  "heuresis_card_stats", "heuresis_pack_stats", "heuresis_sessions",
  "heuresis_card_events", "heuresis_card_state_changes",
  "capital_reading_items", "capital_reading_quotes", "capital_reading_history",
] as const;

type TableRow = Record<string, unknown>;
export type LocalBackupStatus = {
  directory: string;
  today_exists: boolean;
  latest_day: string | null;
  backup_count: number;
};
export type BackupResult = { path: string; alreadyExists: boolean };

export function supportsLocalBackup(): boolean {
  return isTauri() && /Windows NT/i.test(navigator.userAgent);
}

function todayLocal(): string {
  const now = new Date();
  return [now.getFullYear(), String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0")].join("-");
}

export async function localBackupStatus(userId: string): Promise<LocalBackupStatus | null> {
  if (!supportsLocalBackup()) return null;
  return invoke<LocalBackupStatus>("local_backup_status", { userId, day: todayLocal() });
}

async function entireTable(table: string, userId: string): Promise<TableRow[]> {
  if (!supabase) throw new Error("The database is not configured.");
  const rows: TableRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // This header forbids falling back to an incomplete local cache.
    const { data, error } = await supabase.from(table).select("*")
      .eq("user_id", userId).order("id", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)
      .setHeader(NETWORK_ONLY_HEADER, "1");
    if (error) throw new Error(`Cannot back up ${table}: ${error.message}`);
    rows.push(...(data ?? []) as TableRow[]);
    if ((data?.length ?? 0) < PAGE_SIZE) return rows;
  }
  throw new Error(`The ${table} table exceeded the safe page limit; no incomplete backup was published.`);
}

async function mediaPathsForAccount(userId: string, cardRows: TableRow[]): Promise<string[]> {
  if (!supabase) throw new Error("The database is not configured.");
  const result = new Set<string>();
  // Include every referenced card/workspace image, even if a listing omits it.
  for (const row of cardRows) {
    const data = row.data as Record<string, string | string[] | null> | undefined;
    if (data) for (const path of heuresisCardImagePaths([{ data }])) result.add(path);
  }

  // Also include every image under this user's private bucket prefix, including
  // older/unlinked images. Paths stay in their original form for later recovery.
  let visited = 0;
  async function walk(prefix: string, depth: number): Promise<void> {
    if (depth > 7) throw new Error("Media folder depth exceeded backup limit.");
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await supabase!.storage.from(BUCKET).list(prefix, {
        limit: PAGE_SIZE, offset: page * PAGE_SIZE, sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Could not list all media in ${prefix}: ${error.message}`);
      for (const item of data ?? []) {
        if (!item.name || item.name === "." || item.name === ".." || item.name.includes("/")) {
          throw new Error("Unsafe name returned in media listing.");
        }
        visited += 1;
        if (visited > 100000) throw new Error("Too many media objects; backup aborted safely.");
        const path = prefix + "/" + item.name;
        if (item.id) result.add(path);
        else await walk(path, depth + 1);
      }
      if ((data?.length ?? 0) < PAGE_SIZE) return;
    }
    throw new Error("Media listing exceeded safe pagination limit.");
  }
  await walk(userId, 0);
  for (const path of result) {
    if (!path.startsWith(userId + "/")) throw new Error("An image path belongs to another account.");
  }
  return [...result].sort();
}

async function writeMedia(userId: string, day: string, mediaPath: string): Promise<void> {
  if (!supabase) throw new Error("The database is not configured.");
  const { data, error } = await supabase.storage.from(BUCKET).download(mediaPath);
  if (error || !data) throw new Error(`Could not download ${mediaPath}: ${error?.message ?? "empty response"}`);
  const bytes = new Uint8Array(await data.arrayBuffer());
  if (!bytes.length) throw new Error(`Empty media file: ${mediaPath}`);
  for (let offset = 0; offset < bytes.length; offset += MEDIA_CHUNK_SIZE) {
    await invoke("local_backup_media_chunk", {
      userId, day, mediaPath, offset,
      bytes: Array.from(bytes.subarray(offset, offset + MEDIA_CHUNK_SIZE)),
    });
  }
}

// A single in-flight backup across startup, reconnect, and manual requests.
let inFlight: Promise<BackupResult> | null = null;
export function ensureDailyLocalBackup(userId: string): Promise<BackupResult> {
  if (!supportsLocalBackup()) return Promise.reject(new Error("Local backup requires the Heuresis Windows desktop app."));
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const day = todayLocal();
    const status = await invoke<LocalBackupStatus>("local_backup_status", { userId, day });
    if (status.today_exists) {
      return { path: status.directory + "\\Heuresis-" + day, alreadyExists: true };
    }
    if (!navigator.onLine) throw new Error("Connect to the Internet to create a complete daily backup.");
    const pending = getOfflineSyncState();
    if (pending.pending > 0 || pending.legacyPending > 0 || pending.held > 0)
      throw new Error("Synchronise or review pending offline changes before creating a complete backup.");
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || auth.user?.id !== userId) throw new Error("Sign in to the correct account before backing up.");

    const tables: Record<string, TableRow[]> = {};
    // Read sequentially to keep memory/traffic predictable. Never silently skip
    // a table, archived record, Study relation or session history.
    for (const table of BACKUP_TABLES) tables[table] = await entireTable(table, userId);
    const mediaPaths = await mediaPathsForAccount(userId, tables.heuresis_cards);
    const snapshot = {
      format: FORMAT, day, user_id: userId, created_at: new Date().toISOString(),
      tables, media_paths: mediaPaths,
      note: "Complete local account export. Private data. Read-only until a separately tested restore tool is provided.",
    };
    await invoke("local_backup_begin", { userId, day, snapshot });
    for (const path of mediaPaths) await writeMedia(userId, day, path);
    const path = await invoke<string>("local_backup_finish", { userId, day });
    return { path, alreadyExists: false };
  })().finally(() => { inFlight = null; });
  return inFlight;
}
