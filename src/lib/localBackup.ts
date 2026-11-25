/**
 * Native Windows backup, separate from Supabase and the WebView offline cache.
 *
 * Online, authenticated, server-only paginated reads. The current-account offline
 * journal is preserved separately inside the snapshot (never silently treated
 * as uploaded). Publish only after every table, media file and journal check succeeds.
 * Incomplete attempts never replace an older dated backup.
 */
import { invoke, isTauri } from "@tauri-apps/api/core";
import { heuresisCardImagePaths } from "./cardMedia";
import { getOfflineSyncState, NETWORK_ONLY_HEADER, snapshotOfflineWritesForBackup } from "./offlineFetch";
import { supabase } from "./supabase";

const FORMAT = "heuresis-complete-local-v2";
const MEDIA_BUCKETS = ["heuresis-card-media", "page-background-media", "heuresis-catalogue-media", "heuresis-reading-media"] as const;
const CATALOGUE_BUCKET = "heuresis-catalogue-media";
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
  "page_backgrounds",
] as const;

/**
 * The Catalogue's publications (migration 20261030090000_catalogue_publications.sql) and
 * Learn's rounds and answers (migration 20261110120000_heuresis_learn_rounds.sql).
 * Until a migration is applied on the server its tables do not exist; the backup then
 * records them as absent instead of failing, so the rest of the library is still saved.
 */
export const OPTIONAL_BACKUP_TABLES = ["catalogue_subjects", "catalogue_volumes", "catalogue_articles", "heuresis_learn_rounds", "heuresis_learn_attempts", "heuresis_review_corrections", "heuresis_reading_author_profiles", "heuresis_highlight_rules", "heuresis_review_mistakes"] as const;

function isMissingTable(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST205" || error.code === "42P01" || /could not find the table|does not exist|schema cache/i.test(error.message ?? "");
}

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

async function entireTable(table: string, userId: string, optional = false): Promise<TableRow[] | null> {
  if (!supabase) throw new Error("The database is not configured.");
  const rows: TableRow[] = [];
  let expectedCount: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    // This header forbids falling back to an incomplete local cache.
    let query = supabase.from(table).select("*", { count: "exact" });
    query = table === "heuresis_card_types" || table === "heuresis_study_templates"
      ? query.or(`user_id.eq.${userId},user_id.is.null`) : query.eq("user_id", userId);
    // Include the shared wallpaper and every Heuresis page override, never other apps.
    if (table === "page_backgrounds") query = query.or("page_key.eq.heuresis,page_key.like.heuresis-%");
    // Four join/stat tables have no "id" column. Composite keys must also
    // have deterministic ordering so pagination never misses/repeats rows.
    const sortKeys: Record<string, string[]> = {
      heuresis_card_tags: ["card_id", "tag_id"],
      heuresis_card_stats: ["card_id"],
      heuresis_pack_stats: ["pack_id"],
      page_backgrounds: ["page_key"],
      heuresis_learn_attempts: ["round_id", "position"],
    };
    const keys = sortKeys[table] ?? ["id"];
    let ordered = query.order(keys[0], { ascending: true });
    for (const key of keys.slice(1)) ordered = ordered.order(key, { ascending: true });
    const { data, error, count } = await ordered
      .range(rows.length, rows.length + PAGE_SIZE - 1)
      .setHeader(NETWORK_ONLY_HEADER, "1");
    if (error && optional && page === 0 && isMissingTable(error)) return null;
    if (error) throw new Error(`Cannot back up ${table}: ${error.message}`);
    if (count === null || (expectedCount !== null && count !== expectedCount)) throw new Error(`The ${table} row count changed or could not be verified. Retry the backup.`);
    expectedCount = count;
    rows.push(...(data ?? []) as TableRow[]);
    if (rows.length === expectedCount) return rows;
    if (!data?.length || rows.length > expectedCount) throw new Error(`Incomplete read of ${table}. Retry the backup.`);
  }
  throw new Error(`The ${table} table exceeded the safe page limit; no incomplete backup was published.`);
}

/** Image paths stored anywhere inside Catalogue rows (article pages, covers, volume covers). */
function catalogueImagePaths(rows: TableRow[], userId: string): string[] {
  const found: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 12 || !value || typeof value !== "object") return;
    if (Array.isArray(value)) { for (const item of value) visit(item, depth + 1); return; }
    const record = value as Record<string, unknown>;
    if (typeof record.path === "string" && record.path.startsWith(`${userId}/`) && typeof record.mime === "string") found.push(record.path);
    for (const item of Object.values(record)) visit(item, depth + 1);
  };
  for (const row of rows) visit(row, 0);
  return found;
}

async function mediaPathsForAccount(userId: string, cardRows: TableRow[], backgroundRows: TableRow[], catalogueRows: TableRow[] | null, authorRows: TableRow[] | null): Promise<string[]> {
  if (!supabase) throw new Error("The database is not configured.");
  const result = new Set<string>();
  for (const row of cardRows) {
    const data = row.data as Record<string, string | string[] | null> | undefined;
    if (data) for (const path of heuresisCardImagePaths([{ data }])) {
      result.add("heuresis-card-media/" + path);
    }
  }
  for (const row of backgroundRows) {
    if (typeof row.storage_path === "string" && row.storage_path)
      result.add("page-background-media/" + row.storage_path);
  }
  if (catalogueRows) for (const path of catalogueImagePaths(catalogueRows, userId)) result.add(`${CATALOGUE_BUCKET}/${path}`);
  for (const row of authorRows ?? []) if (typeof row.portrait_path === "string" && row.portrait_path) result.add("heuresis-reading-media/" + row.portrait_path);
  let visited = 0;
  async function walk(bucket: string, prefix: string, depth: number): Promise<void> {
    if (depth > 7) throw new Error("Media folder depth exceeded backup limit.");
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const { data, error } = await supabase!.storage.from(bucket).list(prefix, {
        limit: PAGE_SIZE, offset: page * PAGE_SIZE, sortBy: { column: "name", order: "asc" },
      });
      if (error) throw new Error(`Cannot list all ${bucket} files in ${prefix}: ${error.message}`);
      for (const item of data ?? []) {
        if (!item.name || item.name === "." || item.name === ".." || item.name.includes("/"))
          throw new Error("Unsafe media listing path.");
        visited += 1;
        if (visited > 100000) throw new Error("Too many media objects; backup aborted safely.");
        const path = prefix + "/" + item.name;
        if (item.id) result.add(bucket + "/" + path);
        else await walk(bucket, path, depth + 1);
      }
      if ((data?.length ?? 0) < PAGE_SIZE) return;
    }
    throw new Error("Media listing exceeded safe pagination limit.");
  }
  // The Catalogue bucket is created by the same migration as its tables.
  for (const bucket of MEDIA_BUCKETS) if ((bucket !== CATALOGUE_BUCKET || catalogueRows) && (bucket !== "heuresis-reading-media" || authorRows)) await walk(bucket, userId, 0);
  for (const item of result) {
    const [bucket, ...segments] = item.split("/");
    if (!(MEDIA_BUCKETS as readonly string[]).includes(bucket) || segments[0] !== userId)
      throw new Error("A media path belongs to another account.");
  }
  return [...result].sort();
}

async function writeMedia(userId: string, day: string, mediaPath: string): Promise<void> {
  if (!supabase) throw new Error("The database is not configured.");
  const split = mediaPath.indexOf("/");
  const bucket = mediaPath.slice(0, split);
  const objectPath = mediaPath.slice(split + 1);
  if (split < 0 || !(MEDIA_BUCKETS as readonly string[]).includes(bucket))
    throw new Error("Unknown backup media bucket.");
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
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
    if (getOfflineSyncState().syncing)
      throw new Error("Synchronisation is running; backup will retry afterwards.");
    if (!supabase) throw new Error("Supabase is not configured.");
    const { data: auth, error: authError } = await supabase.auth.getUser();
    if (authError || auth.user?.id !== userId) throw new Error("Sign in to the correct account before backing up.");
    // Copy unuploaded current-account edits into the recovery section, rather
    // than indefinitely withholding all PC backups because one edit was held.
    // If the journal changes while collecting the server snapshot, retry.
    const offlineAtStart = await snapshotOfflineWritesForBackup(userId);

    const tables: Record<string, TableRow[]> = {};
    // Read sequentially to keep memory/traffic predictable. Never silently skip
    // a table, archived record, Study relation or session history.
    for (const table of BACKUP_TABLES) tables[table] = (await entireTable(table, userId))!;
    const absentTables: string[] = [];
    for (const table of OPTIONAL_BACKUP_TABLES) {
      const rows = await entireTable(table, userId, true);
      if (rows) tables[table] = rows;
      else absentTables.push(table);
    }
    // Only the Catalogue tables decide whether Catalogue media can be listed: the Learning
    // tables (migration 20261110120000) may be absent without affecting it.
    const catalogueRows = !tables.catalogue_volumes || !tables.catalogue_articles ? null
      : [...(tables.catalogue_subjects ?? []), ...tables.catalogue_volumes, ...tables.catalogue_articles];
    const mediaPaths = await mediaPathsForAccount(userId, tables.heuresis_cards, tables.page_backgrounds, catalogueRows, tables.heuresis_reading_author_profiles ?? null);
    const snapshot = {
      format: FORMAT, day, user_id: userId, created_at: new Date().toISOString(),
      tables, media_paths: mediaPaths,
      ...(absentTables.length ? { absent_optional_tables: absentTables } : {}),
      offline_recovery: {
        format: "heuresis-account-offline-journal-v1",
        ...offlineAtStart,
        note: "Device-only unsent changes for manual recovery. Not merged into server tables or automatically replayed. Older unassigned edits remain in Offline recovery on the original device.",
      },
      note: "Server library plus any current-account unsent edits. Private data. Read-only until a separately tested restore tool is provided.",
    };
    await invoke("local_backup_begin", { userId, day, snapshot });
    for (const path of mediaPaths) await writeMedia(userId, day, path);
    if (getOfflineSyncState().syncing ||
      JSON.stringify(offlineAtStart) !== JSON.stringify(await snapshotOfflineWritesForBackup(userId))) {
      throw new Error("Offline edits changed during backup; the incomplete attempt will be retried.");
    }
    const path = await invoke<string>("local_backup_finish", { userId, day });
    return { path, alreadyExists: false };
  })().finally(() => { inFlight = null; });
  return inFlight;
}


/** Only explicitly recognised device data. Never copy session tokens, other
 * accounts' drafts, or the complete browser storage. Device-only data is not
 * replayed as server writes. */
export function deviceRecoveryForExport(userId: string, tables: Record<string, TableRow[]>) {
  const packIds = new Set((tables.heuresis_packs ?? []).map(row => row.id));
  const cardIds = new Set((tables.heuresis_cards ?? []).map(row => row.id));
  const scoped: Record<string, string> = {};
  const preferences: Record<string, string> = {};
  const knownPreferences = new Set(["heuresis.palette.v1", "heuresis.design.v1", "heuresis.theme.v1", "heuresis.review.method.v1", "heuresis.workspace.section.v1"]);
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key) continue;
    const value = localStorage.getItem(key);
    if (value === null) continue;
    if (key === `heuresis.workspace.memory.v2:${userId}` || key === `heuresis.capture.draft.v2:${userId}` ||
      key === `heuresis.capture.draft.v2:${userId}:floating` || key.startsWith(`heuresis.doc.draft.v2:${userId}:`)) scoped[key] = value;
    else if (knownPreferences.has(key) || (key.startsWith("heuresis.review.prefs.v1:") && packIds.has(key.slice("heuresis.review.prefs.v1:".length)))) preferences[key] = value;
  }
  function queue(key: string): TableRow[] {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data) || data.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw new Error("A device review queue could not be read. Preserve this device's data.");
    return data as TableRow[];
  }
  const events = queue("heuresis.desktop.eventqueue.v1");
  const ownedEvents = events.filter(row => packIds.has(row.pack_id) && cardIds.has(row.card_id));
  return {
    account_drafts: scoped, device_preferences: preferences,
    pending_review_events: ownedEvents,
    unverified_review_event_count: events.length - ownedEvents.length,
    pending_review_corrections: queue("heuresis.review.corrections.pending.v1").filter(row => row.user_id === userId),
  };
}

async function assertExportAccount(userId: string) {
  if (!supabase || !navigator.onLine) throw new Error("Connect to the Internet to export the complete library.");
  if (getOfflineSyncState().syncing) throw new Error("Synchronisation is running. Retry once it finishes.");
  const { data, error } = await supabase.auth.getUser();
  if (error || data.user?.id !== userId) throw new Error("The signed-in account changed or could not be verified.");
}

/** A fresh portable JSON backup, including original uploaded media as base64.
 * No daily-cache shortcut and no dependency on native desktop commands. */
export async function exportAccountJson(userId: string): Promise<string> {
  await assertExportAccount(userId);
  const offlineAtStart = await snapshotOfflineWritesForBackup(userId);
  const tables: Record<string, TableRow[]> = {};
  for (const table of BACKUP_TABLES) tables[table] = (await entireTable(table, userId))!;
  const absentTables: string[] = [];
  for (const table of OPTIONAL_BACKUP_TABLES) {
    const rows = await entireTable(table, userId, true);
    if (rows === null) absentTables.push(table);
    else tables[table] = rows;
  }
  const catalogueRows = tables.catalogue_volumes && tables.catalogue_articles
    ? [...(tables.catalogue_subjects ?? []), ...tables.catalogue_volumes, ...tables.catalogue_articles] : null;
  const recovery = deviceRecoveryForExport(userId, tables);
  const paths = await mediaPathsForAccount(userId, tables.heuresis_cards, tables.page_backgrounds, catalogueRows, tables.heuresis_reading_author_profiles ?? null);
  const media: { path: string; mime: string; size: number; base64: string }[] = [];
  for (const path of paths) {
    const slash = path.indexOf("/");
    const { data, error } = await supabase!.storage.from(path.slice(0, slash)).download(path.slice(slash + 1));
    if (error || !data || !data.size) throw new Error(`Cannot export media: ${path}`);
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error("Could not read media."));
      reader.onload = () => {
        const result = String(reader.result ?? "");
        const comma = result.indexOf(",");
        if (comma < 0) reject(new Error("Invalid media encoding."));
        else resolve(result.slice(comma + 1));
      };
      reader.readAsDataURL(data);
    });
    media.push({ path, mime: data.type, size: data.size, base64 });
  }
  await assertExportAccount(userId);
  if (JSON.stringify(offlineAtStart) !== JSON.stringify(await snapshotOfflineWritesForBackup(userId)) ||
      JSON.stringify(recovery) !== JSON.stringify(deviceRecoveryForExport(userId, tables)))
    throw new Error("Device edits changed during export. Retry to avoid an incomplete backup.");
  return JSON.stringify({
    format: "heuresis-account-export-v1", user_id: userId, created_at: new Date().toISOString(),
    counts: Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.length])),
    tables, absent_optional_tables: absentTables, media_count: media.length, media,
    offline_recovery: offlineAtStart, device_recovery: recovery,
    limitations: ["Other accounts and unassigned legacy writes are excluded; export legacy writes separately.",
      "External linked files, credentials, unknown local-only settings and in-memory drafts are not included.",
      "This is a multi-read snapshot, not a transactional database dump; automated restore is not available."],
  }, null, 2);
}
