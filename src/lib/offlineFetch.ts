type CacheRecord = {
  ownerId?: string;
  key: string;
  url: string;
  method: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: ArrayBuffer;
  updatedAt: string;
};

type QueueRecord = {
  ownerId?: string;
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  createdAt: string;
  attempts: number;
  /** Set when the server refused this write (for example a newer edit exists elsewhere). */
  rejected?: { status: number; message: string; at: string };
};

export type OfflineSyncState = {
  online: boolean;
  syncing: boolean;
  pending: number;
  /** Pending writes the server has refused; they wait for review instead of uploading. */
  held: number;
  /** Old queued writes without an owner remain quarantined, not discarded. */
  legacyPending: number;
  lastSyncedAt: string | null;
  error: string;
};

const DB_NAME = "heuresis-offline-network-v1";
const DB_VERSION = 2;
const CACHE_STORE = "responses";
const RECOVERY_STORE = "knowledge-recovery";
const KNOWLEDGE_TABLES = new Set(["knowledge_subjects", "knowledge_topics", "knowledge_records", "knowledge_practice_events"]);
const QUEUE_STORE = "queue";
const LAST_SYNC_KEY = "heuresis.offline.lastSync.v1";
const READ_RPCS = new Set([
  "heuresis_list_related_catalogue",
  "heuresis_related_counts",
  "heuresis_learning_counts",
]);
const EVENT_RPC = "heuresis_record_events";
const REQUIRES_CONNECTION_RPCS = new Set(["heuresis_create_topic_from_related_words"]);
const TABLES_WITH_CLIENT_IDS = new Set([
  "heuresis_collections",
  "heuresis_packs",
  "heuresis_cards",
  "heuresis_catalogues",
  "heuresis_tags",
  "heuresis_sessions",
  "heuresis_study_templates",
]);

const networkFetch = globalThis.fetch.bind(globalThis);
// Offline data is device-local but belongs to exactly one authenticated user.
// Older unowned records are deliberately never exposed or replayed.
let activeOfflineOwner: string | null = null;
export function setOfflineAccount(userId: string | null) {
  const next = userId || null;
  if (next === activeOfflineOwner) return;
  activeOfflineOwner = next;
  emit({ lastSyncedAt: null, pending: 0, held: 0, legacyPending: 0, error: "" });
  void refreshOfflinePendingCount();
}
function cacheOwner() {
  return activeOfflineOwner;
}
function requestOwner(headers: Headers) {
  const auth = headers.get("authorization") ?? "";
  const jwt = auth.match(/^Bearer\s+([^.]+)\.([^.]+)\./i);
  if (!jwt) return null;
  try {
    const payload = jwt[2].replace(/-/g, "+").replace(/_/g, "/");
    const claims = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))) as { sub?: unknown };
    return typeof claims.sub === "string" && claims.sub ? claims.sub : null;
  } catch { return null; }
}
let dbPromise: Promise<IDBDatabase> | null = null;
let state: OfflineSyncState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  pending: 0,
  held: 0,
  legacyPending: 0,
  lastSyncedAt: typeof localStorage === "undefined" ? null : localStorage.getItem(LAST_SYNC_KEY),
  error: "",
};
const listeners = new Set<(next: OfflineSyncState) => void>();

function emit(patch: Partial<OfflineSyncState> = {}) {
  state = { ...state, ...patch, online: typeof navigator === "undefined" ? true : navigator.onLine };
  listeners.forEach((listener) => listener({ ...state }));
}

export function getOfflineSyncState() {
  return { ...state };
}

export function subscribeOfflineSync(listener: (next: OfflineSyncState) => void) {
  listeners.add(listener);
  listener({ ...state });
  return () => { listeners.delete(listener); };
}

export function setOfflineSyncing(syncing: boolean) {
  emit({ syncing, error: syncing ? "" : state.error });
}

export function setOfflineSyncError(error: string) {
  emit({ syncing: false, error });
}

export function markOfflineSyncComplete() {
  const timestamp = new Date().toISOString();
  try { localStorage.setItem(LAST_SYNC_KEY, timestamp); } catch { /* ignore */ }
  emit({ syncing: false, lastSyncedAt: timestamp, error: "" });
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Offline storage is unavailable on this device."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE)) db.createObjectStore(CACHE_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(RECOVERY_STORE)) db.createObjectStore(RECOVERY_STORE, { keyPath: "key" });
      if (!db.objectStoreNames.contains(QUEUE_STORE)) db.createObjectStore(QUEUE_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open offline storage."));
  });
  return dbPromise;
}

async function getRecord<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function getAllRecords<T>(storeName: string): Promise<T[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction(storeName, "readonly").objectStore(storeName).getAll();
    request.onsuccess = () => resolve((request.result ?? []) as T[]);
    request.onerror = () => reject(request.error);
  });
}

async function putRecord<T>(storeName: string, value: T) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteRecord(storeName: string, key: IDBValidKey) {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function headersObject(headers: Headers, includeAuthorization = true) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!includeAuthorization && key.toLowerCase() === "authorization") return;
    result[key] = value;
  });
  return result;
}

function keyFor(method: string, url: string, headers: Headers, body: string | null) {
  return [cacheOwner() ?? "NO_USER", method, url, headers.get("range") ?? "", headers.get("accept-profile") ?? "", body ?? ""].join("|");
}

function rpcName(urlString: string) {
  try { return new URL(urlString).pathname.match(/\/rest\/v1\/rpc\/([^/]+)$/)?.[1] ?? null; }
  catch { return null; }
}

function tableName(urlString: string) {
  try {
    const match = new URL(urlString).pathname.match(/\/rest\/v1\/([^/]+)$/);
    return match && match[1] !== "rpc" ? decodeURIComponent(match[1]) : null;
  } catch { return null; }
}

function isRead(method: string, url: string) {
  if (method === "GET" || method === "HEAD") return /\/rest\/v1\//.test(url) || /\/storage\/v1\/object\//.test(url);
  return method === "POST" && Boolean(rpcName(url) && READ_RPCS.has(rpcName(url)!));
}

function isMutation(method: string, url: string) {
  if (!/\/rest\/v1\//.test(url)) return false;
  if (method === "PATCH" || method === "DELETE") return true;
  if (method !== "POST") return false;
  const rpc = rpcName(url);
  return rpc ? !READ_RPCS.has(rpc) : Boolean(tableName(url));
}

async function requestParts(input: RequestInfo | URL, init?: RequestInit) {
  const request = input instanceof Request && !init ? input.clone() : new Request(input, init);
  const method = request.method.toUpperCase();
  const headers = new Headers(request.headers);
  let body: string | null = null;
  if (method !== "GET" && method !== "HEAD") {
    try { body = await request.clone().text(); } catch { body = null; }
  }
  return { method, headers, body, url: request.url };
}

async function saveResponse(key: string, method: string, url: string, response: Response, ownerId: string) {
  if (!response.ok) return;
  // Clone before the first await. The caller consumes the original response while
  // recovery-store reads run; cloning afterwards can throw and silently lose the cache.
  const responseCopy = response.clone();
  try {
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => { responseHeaders[name] = value; });
    // Preserve the FIRST non-empty earlier response separately before a newer
    // server read replaces it. Missing/deleted Notebook data must not erase the
    // only recoverable copy on this device. This is never used for normal reads.
    if (method === "GET" && KNOWLEDGE_TABLES.has(tableName(url) ?? "")) {
      const previous = await getRecord<CacheRecord>(CACHE_STORE, key);
      const preserved = await getRecord<CacheRecord>(RECOVERY_STORE, key);
      if (previous?.ownerId === ownerId && !preserved) {
        const original = decodeJson(previous);
        if (Array.isArray(original) ? original.length > 0 : Boolean(original && typeof original === "object"))
          await putRecord<CacheRecord>(RECOVERY_STORE, previous);
      }
    }
    await putRecord<CacheRecord>(CACHE_STORE, {
      key,
      ownerId,
      url,
      method,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: await responseCopy.arrayBuffer(),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Live data remains authoritative if local caching fails.
  }
}

/**
 * Read-only emergency export of earlier per-device API responses.
 * Never replays writes or silently restores stale rows into the live database.
 * All rows must belong to the currently authenticated user.
 */
export async function exportCachedKnowledgeForRecovery(userId: string): Promise<{ json: string; counts: Record<string, number> }> {
  if (!userId || userId !== cacheOwner()) throw new Error("Sign in to the original account before checking the device cache.");
  const tables = ["knowledge_subjects", "knowledge_topics", "knowledge_records", "knowledge_practice_events"] as const;
  type Table = typeof tables[number];
  const collected = Object.fromEntries(tables.map((table) => [table, new Map<string, Record<string, unknown>>()])) as Record<Table, Map<string, Record<string, unknown>>>;
  const cached = [
    ...await getAllRecords<CacheRecord>(RECOVERY_STORE),
    ...await getAllRecords<CacheRecord>(CACHE_STORE),
  ];
  for (const response of cached) {
    if (response.ownerId !== userId || response.method !== "GET") continue;
    const table = tableName(response.url);
    if (!table || !Object.prototype.hasOwnProperty.call(collected, table)) continue;
    const parsed = decodeJson(response);
    const rows = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const row = raw as Record<string, unknown>;
      if (row.user_id !== userId || typeof row.id !== "string") continue;
      collected[table as Table].set(row.id, row);
    }
  }
  const data = Object.fromEntries(tables.map((table) => [table, Array.from(collected[table].values())]));
  const counts = Object.fromEntries(tables.map((table) => [table, collected[table].size]));
  const json = JSON.stringify({
    format: "heuresis-device-cache-recovery-v1",
    exported_at: new Date().toISOString(),
    warning: "Private learning data from this device only. May be incomplete or out of date. Nothing was restored. Keep the file private.",
    counts, data,
  }, null, 2);
  return { json, counts };
}

function cachedResponse(record: CacheRecord) {
  return new Response(record.body.slice(0), { status: record.status, statusText: record.statusText, headers: record.headers });
}

function decodeJson(record: CacheRecord): unknown {
  try {
    const text = new TextDecoder().decode(record.body);
    return text ? JSON.parse(text) : null;
  } catch { return null; }
}

function encodeJson(value: unknown): ArrayBuffer {
  return new TextEncoder().encode(JSON.stringify(value)).buffer as ArrayBuffer;
}

function effectiveValue(row: Record<string, unknown>, key: string) {
  // JSON path filters such as data->>_discarded_at (a JSON null reads as SQL null).
  const arrow = key.indexOf("->>");
  if (arrow > 0) {
    const base = row[key.slice(0, arrow)];
    const value = base && typeof base === "object" && !Array.isArray(base) ? (base as Record<string, unknown>)[key.slice(arrow + 3)] : undefined;
    return value === undefined || value === null ? null : typeof value === "object" ? JSON.stringify(value) : String(value);
  }
  if (row[key] !== undefined) return row[key];
  if (key === "role" && row.pack_id) return "main";
  return row[key];
}

function matches(row: Record<string, unknown>, url: URL) {
  for (const [key, raw] of url.searchParams.entries()) {
    if (["select", "order", "limit", "offset", "on_conflict"].includes(key)) continue;
    const current = effectiveValue(row, key);
    if (raw.startsWith("eq.") && String(current ?? "") !== raw.slice(3)) return false;
    if (raw === "is.null" && current !== null && current !== undefined) return false;
    if (raw === "not.is.null" && (current === null || current === undefined)) return false;
    if (raw.startsWith("in.(") && raw.endsWith(")")) {
      const allowed = raw.slice(4, -1).split(",").map((part) => part.replace(/^"|"$/g, ""));
      if (!allowed.includes(String(current ?? ""))) return false;
    }
    if (raw.startsWith("ilike.")) {
      const needle = raw.slice(6).replace(/^%|%$/g, "").toLocaleLowerCase();
      const haystack = key === "search_text"
        ? JSON.stringify({ data: row.data, note: row.note }).toLocaleLowerCase()
        : String(current ?? "").toLocaleLowerCase();
      if (!haystack.includes(needle)) return false;
    }
  }
  return true;
}

function compareRows(a: Record<string, unknown>, b: Record<string, unknown>, order: string) {
  for (const part of order.split(",")) {
    const [key, direction = "asc"] = part.split(".");
    if (!key) continue;
    const av = effectiveValue(a, key);
    const bv = effectiveValue(b, key);
    if (av === bv) continue;
    if (av == null) return direction === "desc" ? 1 : -1;
    if (bv == null) return direction === "desc" ? -1 : 1;
    const cmp = typeof av === "number" && typeof bv === "number"
      ? av - bv
      : String(av).localeCompare(String(bv), undefined, { numeric: true });
    if (cmp) return direction === "desc" ? -cmp : cmp;
  }
  return 0;
}

async function cachedRows(table: string) {
  const records = await getAllRecords<CacheRecord>(CACHE_STORE);
  const rows = new Map<string, Record<string, unknown>>();
  let anonymous = 0;
  for (const record of records) {
    if (!activeOfflineOwner || record.ownerId !== activeOfflineOwner || record.method !== "GET" || tableName(record.url) !== table) continue;
    const parsed = decodeJson(record);
    const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === "object" ? [parsed] : [];
    for (const item of list) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const raw = item as Record<string, unknown>;
      const row = table === "heuresis_cards" && raw.role === undefined ? { ...raw, role: "main" } : raw;
      const id = typeof row.id === "string" ? row.id : `anonymous-${anonymous++}`;
      rows.set(id, { ...(rows.get(id) ?? {}), ...row });
    }
  }
  return Array.from(rows.values());
}

async function synthesiseRead(method: string, urlString: string, headers: Headers) {
  const table = tableName(urlString);
  if (!table) return null;
  const url = new URL(urlString);
  let rows = (await cachedRows(table)).filter((row) => matches(row, url));
  const order = url.searchParams.get("order");
  if (order) rows.sort((a, b) => compareRows(a, b, order));
  const total = rows.length;
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0) || 0);
  const queryLimit = Number(url.searchParams.get("limit") ?? 0) || 0;
  if (offset || queryLimit) rows = rows.slice(offset, queryLimit ? offset + queryLimit : undefined);
  const range = headers.get("range");
  if (range) {
    const [startRaw, endRaw] = range.split("-");
    const start = Math.max(0, Number(startRaw) || 0);
    const end = Math.max(start, Number(endRaw) || start);
    rows = rows.slice(start, end + 1);
  }
  const responseHeaders = new Headers({ "content-type": "application/json" });
  responseHeaders.set("content-range", total ? `0-${Math.max(0, rows.length - 1)}/${total}` : "*/0");
  if (method === "HEAD") return new Response(null, { status: 200, headers: responseHeaders });
  const wantsObject = (headers.get("accept") ?? "").includes("application/vnd.pgrst.object+json");
  return new Response(JSON.stringify(wantsObject ? (rows[0] ?? null) : rows), { status: 200, headers: responseHeaders });
}

async function rewriteCachedTable(table: string, transform: (parsed: unknown, url: URL) => unknown) {
  const records = await getAllRecords<CacheRecord>(CACHE_STORE);
  for (const record of records) {
    if (!activeOfflineOwner || record.ownerId !== activeOfflineOwner || record.method !== "GET" || tableName(record.url) !== table) continue;
    record.body = encodeJson(transform(decodeJson(record), new URL(record.url)));
    record.updatedAt = new Date().toISOString();
    await putRecord(CACHE_STORE, record);
  }
}

async function upsertCachedRow(table: string, row: Record<string, unknown>) {
  const id = typeof row.id === "string" ? row.id : null;
  if (!id) return;
  await rewriteCachedTable(table, (parsed, url) => {
    if (Array.isArray(parsed)) {
      const previous = parsed.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
      const without = previous.filter((item) => item.id !== id);
      return matches(row, url) ? [...without, row] : without;
    }
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const current = parsed as Record<string, unknown>;
      if (current.id !== id) return parsed;
      return matches(row, url) ? row : null;
    }
    return parsed;
  });
}

async function deleteCachedRow(table: string, id: string) {
  await rewriteCachedTable(table, (parsed) => {
    if (Array.isArray(parsed)) return parsed.filter((item) => !(item && typeof item === "object" && !Array.isArray(item) && (item as Record<string, unknown>).id === id));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && (parsed as Record<string, unknown>).id === id) return null;
    return parsed;
  });
}

function localCard(row: Record<string, unknown>): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: row.id,
    pack_id: row.pack_id,
    role: row.role ?? "main",
    retention: row.retention ?? "learning",
    data: row.data ?? {},
    note: row.note ?? null,
    favourite: Boolean(row.favourite),
    interesting: Boolean(row.interesting),
    interest_rank: row.interest_rank ?? null,
    created_at: row.created_at ?? now,
    updated_at: row.updated_at ?? now,
    heuresis_card_stats: row.heuresis_card_stats ?? [],
    heuresis_card_tags: row.heuresis_card_tags ?? [],
  };
}

async function adjustPackCardCount(packId: string, delta: number) {
  const row = (await cachedRows("heuresis_pack_overview")).find((item) => item.id === packId);
  if (!row) return;
  await upsertCachedRow("heuresis_pack_overview", { ...row, card_count: Math.max(0, Number(row.card_count ?? 0) + delta) });
}

async function patchCard(cardId: string, patch: Record<string, unknown>) {
  const current = (await cachedRows("heuresis_cards")).find((row) => row.id === cardId);
  if (!current) return null;
  const next = { ...current, ...patch, role: current.role ?? "main", updated_at: new Date().toISOString() };
  await upsertCachedRow("heuresis_cards", next);
  return next;
}

function packOverview(row: Record<string, unknown>) {
  return {
    id: row.id,
    collection_id: row.collection_id,
    card_type_id: row.card_type_id,
    title: row.title,
    description: row.description ?? null,
    sort_order: Number(row.sort_order ?? 0),
    card_count: Number(row.card_count ?? 0),
    encountered_cards: Number(row.encountered_cards ?? 0),
    open_count: Number(row.open_count ?? 0),
    last_opened_at: row.last_opened_at ?? null,
    archived_at: row.archived_at ?? null,
  } satisfies Record<string, unknown>;
}

async function applyTableMutation(table: string, method: string, url: URL, body: unknown) {
  if (method === "POST") {
    const inputs = (Array.isArray(body) ? body : [body]).filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)));
    for (const input of inputs) {
      const row: Record<string, unknown> = table === "heuresis_cards" ? localCard(input) : { ...input, archived_at: input.archived_at ?? null };
      await upsertCachedRow(table, row);
      if (table === "heuresis_packs") await upsertCachedRow("heuresis_pack_overview", packOverview(row));
      if (table === "heuresis_cards" && typeof row.pack_id === "string") await adjustPackCardCount(row.pack_id, 1);
    }
    return;
  }

  const idFilter = url.searchParams.get("id");
  const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
  if (!id) return;
  const current = (await cachedRows(table)).find((row) => row.id === id);
  if (method === "DELETE") {
    await deleteCachedRow(table, id);
    if (table === "heuresis_packs") await deleteCachedRow("heuresis_pack_overview", id);
    if (table === "heuresis_cards" && typeof current?.pack_id === "string") await adjustPackCardCount(current.pack_id, -1);
    return;
  }
  const patch = body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown> : {};
  if (current) {
    const next = { ...current, ...patch, id: current.id };
    await upsertCachedRow(table, next);
    if (table === "heuresis_packs") await upsertCachedRow("heuresis_pack_overview", packOverview(next));
  }
}

async function applyRpcMutation(name: string, body: Record<string, unknown>): Promise<unknown> {
  if (name === "heuresis_patch_card_data" && typeof body.p_card_id === "string") {
    const current = (await cachedRows("heuresis_cards")).find((row) => row.id === body.p_card_id);
    const previous = current?.data && typeof current.data === "object" && !Array.isArray(current.data) ? current.data as Record<string, unknown> : {};
    const patch = body.p_patch && typeof body.p_patch === "object" && !Array.isArray(body.p_patch) ? body.p_patch as Record<string, unknown> : {};
    const data = { ...previous, ...patch };
    await patchCard(body.p_card_id, { data });
    return data;
  }
  if (name === "heuresis_set_card_retention" && typeof body.p_card_id === "string") {
    await patchCard(body.p_card_id, { retention: body.p_retention === "reference" ? "reference" : "learning" });
    return null;
  }
  if (name === "heuresis_set_card_tags" && typeof body.p_card_id === "string") {
    const tags = await cachedRows("heuresis_tags");
    const ids = Array.isArray(body.p_tag_ids) ? body.p_tag_ids.filter((id): id is string => typeof id === "string") : [];
    const tagMap = new Map(tags.map((tag) => [tag.id, tag]));
    await patchCard(body.p_card_id, { heuresis_card_tags: ids.map((id) => ({ tag_id: id, heuresis_tags: tagMap.get(id) ?? null })) });
    return null;
  }
  if (name === "heuresis_reorder_collections" && Array.isArray(body.p_ids)) {
    const order = body.p_ids.filter((id): id is string => typeof id === "string");
    for (const collection of await cachedRows("heuresis_collections")) {
      const index = order.indexOf(String(collection.id ?? ""));
      if (index >= 0) await upsertCachedRow("heuresis_collections", { ...collection, sort_order: index });
    }
    return null;
  }
  if (name === "heuresis_toggle_learning_action") {
    return { selected: true, count: 1, action: body.p_action ?? "handwrite" };
  }
  if (name === "heuresis_import_cards" || name === "heuresis_import_cards_with_tags") return Array.isArray(body.p_rows) ? body.p_rows.length : 0;
  if (name === "heuresis_update_imported_cards") return Array.isArray(body.p_updates) ? body.p_updates.length : 0;
  if (name === "heuresis_connect_cards") return crypto.randomUUID();
  if (name === "heuresis_add_related_word") return [];
  return null;
}

function parseJson(raw: string | null): unknown {
  if (!raw) return null;
  try { return JSON.parse(raw) as unknown; } catch { return null; }
}

function addClientIds(table: string | null, value: unknown): unknown {
  if (!table || !TABLES_WITH_CLIENT_IDS.has(table)) return value;
  const add = (item: unknown): unknown => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const row: Record<string, unknown> = { ...(item as Record<string, unknown>) };
    if (!row.id) row.id = crypto.randomUUID();
    if (table === "heuresis_cards" && row.role === undefined) row.role = "main";
    return row;
  };
  return Array.isArray(value) ? value.map(add) : add(value);
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function syntheticResponse(method: string, url: URL, table: string | null, rpc: string | null, body: unknown, rpcResult: unknown) {
  if (table && method === "POST") {
    const now = new Date().toISOString();
    const list = (Array.isArray(body) ? body : [body]).map((item) => item && typeof item === "object" && !Array.isArray(item) ? { created_at: now, updated_at: now, ...(item as Record<string, unknown>) } : item);
    return jsonResponse(Array.isArray(body) ? list : list[0], 201);
  }
  if (table && method === "PATCH" && url.searchParams.get("select")) {
    // The offline PATCH is provisional; the revision predicate still runs on replay.
    const idFilter = url.searchParams.get("id");
    const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
    return jsonResponse(id ? [{ id }] : []);
  }
  if (table && method === "DELETE" && url.searchParams.get("select")) {
    const idFilter = url.searchParams.get("id");
    const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
    return jsonResponse(id ? [{ id }] : []);
  }
  if (rpc) return jsonResponse(rpcResult);
  if (method === "PATCH" || method === "DELETE") return new Response(null, { status: 204 });
  return jsonResponse(null);
}

async function applySuccessfulMutation(method: string, urlString: string, rawBody: string | null, response: Response) {
  const table = tableName(urlString);
  const rpc = rpcName(urlString);
  const parsed = parseJson(rawBody);
  if (table) {
    let body = parsed;
    if (method === "POST") {
      const server = await response.clone().json().catch(() => null) as unknown;
      const merge = (local: unknown, remote: unknown) => local && typeof local === "object" && !Array.isArray(local) && remote && typeof remote === "object" && !Array.isArray(remote)
        ? { ...(local as Record<string, unknown>), ...(remote as Record<string, unknown>) }
        : remote ?? local;
      if (Array.isArray(parsed) && Array.isArray(server)) body = parsed.map((item, index) => merge(item, server[index]));
      else body = merge(parsed, server);
    }
    await applyTableMutation(table, method, new URL(urlString), body);
  }
  if (rpc && parsed && typeof parsed === "object" && !Array.isArray(parsed)) await applyRpcMutation(rpc, parsed as Record<string, unknown>);
}

async function queueMutation(method: string, urlString: string, headers: Headers, rawBody: string | null) {
  if (!cacheOwner()) throw new TypeError("Sign in to save changes offline.");
  const table = tableName(urlString);
  const rpc = rpcName(urlString);
  if (rpc === EVENT_RPC) throw new TypeError("Offline: review events remain in the Heuresis event queue until synchronisation.");
  if (rpc && REQUIRES_CONNECTION_RPCS.has(rpc)) throw new TypeError("This particular action needs a connection. Everything else can remain open offline.");

  // Client ids belong to new rows only. Adding one to a PATCH would ask the server to
  // change the row's primary key on replay (rejected with 409, or worse) and would
  // re-key the cached row so later offline edits of the same card miss it.
  const parsed = method === "POST" ? addClientIds(table, parseJson(rawBody)) : parseJson(rawBody);
  const queuedBody = parsed === null ? rawBody : JSON.stringify(parsed);
  const item: QueueRecord = {
    id: crypto.randomUUID(),
    ownerId: cacheOwner() ?? undefined,
    url: urlString,
    method,
    headers: headersObject(headers, false),
    body: queuedBody,
    createdAt: new Date().toISOString(),
    attempts: 0,
  };
  await putRecord(QUEUE_STORE, item);
  if (table) await applyTableMutation(table, method, new URL(urlString), parsed);
  const rpcResult = rpc && parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? await applyRpcMutation(rpc, parsed as Record<string, unknown>)
    : null;
  await refreshOfflinePendingCount();
  return syntheticResponse(method, new URL(urlString), table, rpc, parsed, rpcResult);
}

export async function refreshOfflinePendingCount() {
  try {
    const owner = cacheOwner();
    const rows = await getAllRecords<QueueRecord>(QUEUE_STORE);
    const owned = owner ? rows.filter((row) => row.ownerId === owner) : [];
    emit({
      pending: owned.length,
      held: owned.filter((row) => row.rejected).length,
      legacyPending: rows.filter((row) => !row.ownerId).length,
    });
  } catch { emit({ pending: 0, held: 0, legacyPending: 0 }); }
  return state.pending;
}

/**
 * A queued insert whose primary key already exists was applied by an earlier
 * attempt whose response never arrived (e.g. the connection dropped mid-request).
 * Replaying it can never succeed, and keeping it would block every later write.
 */
function isAlreadyAppliedInsert(method: string, status: number, responseText: string) {
  if (method !== "POST" || status !== 409) return false;
  try {
    const parsed = JSON.parse(responseText) as { code?: string; details?: string };
    return parsed.code === "23505" && /^Key \(id\)=/.test(parsed.details ?? "");
  } catch { return false; }
}

// Only unrelated writes may pass a permanently rejected offline operation.
// An ID-scoped PATCH following a failed INSERT of the same record must stay queued.
function queuedRecordKey(item: QueueRecord): string | null {
  const table = tableName(item.url);
  if (!table) return null;
  const idFilter = new URL(item.url).searchParams.get("id");
  const id = idFilter?.startsWith("eq.") ? idFilter.slice(3) : null;
  const body = parseJson(item.body);
  const bodyId = body && typeof body === "object" && !Array.isArray(body)
    && typeof (body as Record<string, unknown>).id === "string"
    ? (body as Record<string, string>).id : null;
  return id || bodyId ? `${table}:${id ?? bodyId}` : null;
}

/**
 * Notebook edits are guarded by the record's revision (`updated_at=eq.<revision>`),
 * so a write never silently replaces a newer edit made on another device.
 * Offline, the app can only give each later edit a provisional local revision.
 * Those later edits were made on this device on top of the earlier queued edit,
 * so once the earlier edit has been accepted, the server's new revision is the
 * correct base for them. Without this, only the first offline edit of a note
 * could ever be replayed and every later one stayed blocked forever.
 */
export function revisionFilter(urlString: string): string | null {
  try {
    const value = new URL(urlString).searchParams.get("updated_at");
    return value?.startsWith("eq.") ? value.slice(3) : null;
  } catch { return null; }
}

export function withRevisionFilter(urlString: string, revision: string): string {
  const url = new URL(urlString);
  url.searchParams.set("updated_at", `eq.${revision}`);
  return url.toString();
}

function serverRow(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    const row = Array.isArray(parsed) ? parsed[0] : parsed;
    return row && typeof row === "object" && !Array.isArray(row) ? row as Record<string, unknown> : null;
  } catch { return null; }
}

export type ReplayedRow = { table: string; row: Record<string, unknown> };
const replayListeners = new Set<(replayed: ReplayedRow) => void>();
/** Rows the server returned while queued offline writes were replayed. */
export function subscribeReplayedRows(listener: (replayed: ReplayedRow) => void) {
  replayListeners.add(listener);
  return () => { replayListeners.delete(listener); };
}

let activeFlush: Promise<{ sent: number; pending: number }> | null = null;

/** Replays queued writes in order. Concurrent callers share one run so nothing is sent twice. */
export function flushOfflineRequests(accessToken: string | null | undefined) {
  if (activeFlush) return activeFlush;
  const replay = typeof navigator !== "undefined" && navigator.locks
    ? navigator.locks.request("heuresis-offline-request-flush", () => flushQueue(accessToken))
    : flushQueue(accessToken);
  activeFlush = replay.finally(() => { activeFlush = null; });
  return activeFlush;
}

/**
 * Updates queued by earlier versions carried a client id (and role) meant for inserts;
 * sent as they are, the server would try to change the row's primary key. Strip them.
 */
export function withoutInjectedIds(item: { method: string; url: string; body: string | null }) {
  if (item.method !== "PATCH" || !item.body) return item.body;
  const table = tableName(item.url);
  if (!table || !TABLES_WITH_CLIENT_IDS.has(table)) return item.body;
  const parsed = parseJson(item.body);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return item.body;
  const body = { ...(parsed as Record<string, unknown>) };
  const target = new URL(item.url).searchParams.get("id");
  if ("id" in body && (!target?.startsWith("eq.") || body.id !== target.slice(3))) delete body.id;
  if (table === "heuresis_cards" && body.role === "main") delete body.role;
  return JSON.stringify(body);
}

async function flushQueue(accessToken: string | null | undefined) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { sent: 0, pending: await refreshOfflinePendingCount() };
  const owner = accessToken ? requestOwner(new Headers({ authorization: `Bearer ${accessToken}` })) : null;
  if (!owner || owner !== cacheOwner()) {
    throw new Error("Offline sync paused: sign in with the account that created these changes.");
  }
  const queued = (await getAllRecords<QueueRecord>(QUEUE_STORE))
    .filter((row) => row.ownerId === owner)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sent = 0;
  let held = 0;
  const blockedRecords = new Set<string>();
  for (const [position, item] of queued.entries()) {
    if (cacheOwner() !== owner) throw new Error("Offline sync paused because the signed-in account changed.");
    const key = queuedRecordKey(item);
    if (key && blockedRecords.has(key)) {
      // Depends on an earlier edit of the same record that was refused: it waits
      // for review with it, rather than counting as an upload still to come.
      held += 1;
      if (!item.rejected) await putRecord(QUEUE_STORE, { ...item, rejected: { status: 0, message: "Waits for an earlier refused edit of the same record.", at: new Date().toISOString() } });
      continue;
    }
    const headers = new Headers(item.headers);
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    try {
      const response = await networkFetch(item.url, { method: item.method, headers, body: withoutInjectedIds(item) });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        if (!isAlreadyAppliedInsert(item.method, response.status, text)) {
          // A rejected row must not block captures and cards unrelated to it.
          // Keep the original write locally for a future retry or recovery.
          if (response.status >= 400 && response.status < 500 && response.status !== 401 && key) {
            blockedRecords.add(key);
            held += 1;
            await putRecord(QUEUE_STORE, { ...item, attempts: item.attempts + 1,
              rejected: { status: response.status, message: rejectionMessage(response.status, text), at: new Date().toISOString() } });
            continue;
          }
          throw new Error(text || `Sync failed with HTTP ${response.status}.`);
        }
      } else if (item.method === "PATCH" && key && revisionFilter(item.url)) {
        const row = serverRow(await response.text().catch(() => ""));
        const revision = typeof row?.updated_at === "string" ? row.updated_at : null;
        if (revision) {
          // Re-base this device's later edits of the same record on the revision
          // the server has just accepted. Persist first: an interrupted flush
          // must resume with the rewritten filter, not the provisional one.
          for (const later of queued.slice(position + 1)) {
            if (later.method !== "PATCH" || queuedRecordKey(later) !== key || !revisionFilter(later.url)) continue;
            later.url = withRevisionFilter(later.url, revision);
            await putRecord(QUEUE_STORE, later);
          }
          const table = tableName(item.url);
          if (table && row) replayListeners.forEach((listener) => listener({ table, row }));
        }
      }
      await deleteRecord(QUEUE_STORE, item.id);
      sent += 1;
    } catch (error) {
      await putRecord(QUEUE_STORE, { ...item, attempts: item.attempts + 1 });
      await refreshOfflinePendingCount();
      throw error;
    }
  }
  const pending = await refreshOfflinePendingCount();
  if (held) throw new Error(`${held} offline ${held === 1 ? "change needs" : "changes need"} attention. Other independent changes were synced; nothing was discarded.`);
  return { sent, pending };
}

function rejectionMessage(status: number, text: string) {
  try {
    const parsed = JSON.parse(text) as { code?: string; message?: string };
    // A revision-guarded edit that matched no row: the record changed elsewhere.
    if (status === 406 || parsed.code === "PGRST116") return "The record was changed or deleted on another device before this edit could be uploaded.";
    return parsed.message || `The server refused this change (HTTP ${status}).`;
  } catch {
    return status === 406 ? "The record was changed or deleted on another device before this edit could be uploaded." : `The server refused this change (HTTP ${status}).`;
  }
}

/** Number of writes made offline that have not reached the server yet. */
export function pendingOfflineWrites() {
  return state.pending;
}

/**
 * Requests carrying this header must reflect the server, never the device cache:
 * a backup that silently fell back to a partial offline copy would look complete.
 * The header is removed before the request leaves the app.
 */
export const NETWORK_ONLY_HEADER = "x-heuresis-network-only";

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { method, headers, body, url } = await requestParts(input, init);
  if (headers.get(NETWORK_ONLY_HEADER)) {
    headers.delete(NETWORK_ONLY_HEADER);
    return networkFetch(url, { ...init, method, headers, body: method === "GET" || method === "HEAD" ? undefined : body });
  }
  const owner = requestOwner(headers);
  // Tokens are read only to identify the client-side cache partition.
  // Online RLS continues to decide whether the request is authorised.
  if (owner && owner !== cacheOwner()) setOfflineAccount(owner);
  const read = isRead(method, url);
  const mutation = isMutation(method, url);
  if (!read && !mutation) return networkFetch(input, init);
  // Never use private offline state without a current signed-in identity.
  // This also prevents old unowned v1 caches being used for private reads.
  if (!cacheOwner() || !owner || owner !== cacheOwner()) return networkFetch(input, init);

  if (read) {
    const key = keyFor(method, url, headers, body);
    if (typeof navigator === "undefined" || navigator.onLine) {
      try {
        const response = await networkFetch(input, init);
        if (response.ok && cacheOwner() === owner) void saveResponse(key, method, url, response, owner);
        return response;
      } catch {
        // Fall back to the local copy.
      }
    }
    const exact = await getRecord<CacheRecord>(CACHE_STORE, key).catch(() => undefined);
    if (exact) return cachedResponse(exact);
    if (method === "GET" || method === "HEAD") {
      const synthesised = await synthesiseRead(method, url, headers).catch(() => null);
      if (synthesised) return synthesised;
    }
    throw new TypeError("Heuresis is offline and this item has not been synchronised to this device yet.");
  }

  if (typeof navigator === "undefined" || navigator.onLine) {
    try {
      const response = await networkFetch(input, init);
      if (response.ok && cacheOwner() === owner) void applySuccessfulMutation(method, url, body, response).catch(() => undefined);
      return response;
    } catch {
      // Queue below.
    }
  }
  if (cacheOwner() !== owner) throw new TypeError("The signed-in account changed before this change was stored. Please try again.");
  return queueMutation(method, url, headers, body);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => emit({ online: true, error: "" }));
  window.addEventListener("offline", () => emit({ online: false, syncing: false }));
  void refreshOfflinePendingCount();
}


/* Recovery of unowned queue entries from the original offline implementation.
   Deliberate opt-in only: never automatically assign legacy writes to a user. */
export type LegacyOfflineWrite = {
  id: string;
  createdAt: string;
  method: string;
  target: string;
  attempts: number;
  preview: string;
  canReplay: boolean;
  reason: string;
};

function legacyReplayCheck(row: QueueRecord, owner: string): string | null {
  // Only idempotent-ish, ID-addressed INSERTs can be adopted automatically.
  // PATCH, DELETE and RPC calls could overwrite or delete unrelated records.
  const table = tableName(row.url);
  if (row.method !== "POST" || !table || !/^https?:\/\//.test(row.url)) return "Only new records can be safely restored automatically.";
  const url = new URL(row.url);
  if (url.searchParams.has("on_conflict")) return "Upsert behaviour needs manual review.";
  if (/resolution=merge-duplicates/i.test(row.headers.prefer ?? "")) return "Updates to existing records need manual review.";
  const payload = parseJson(row.body);
  const records = Array.isArray(payload) ? payload : [payload];
  if (!records.length || records.some((r) => !r || typeof r !== "object" || Array.isArray(r)
    || typeof (r as Record<string, unknown>).id !== "string")) return "The original records have no stable IDs.";
  const ownerFields = ["user_id", "owner_id", "profile_id"];
  for (const record of records) {
    const data = record as Record<string, unknown>;
    for (const field of ownerFields) if (typeof data[field] === "string" && data[field] !== owner) {
      return "This record refers to another account; it cannot be assigned here.";
    }
  }
  for (const [key, value] of url.searchParams) {
    if (ownerFields.includes(key) && value.startsWith("eq.") && value.slice(3) !== owner) {
      return "The request targets another account.";
    }
  }
  return null;
}

function legacyTarget(row: QueueRecord): string {
  return tableName(row.url) ?? (rpcName(row.url) ? `RPC: ${rpcName(row.url)}` : "Unknown action");
}

export async function listLegacyOfflineWrites(): Promise<LegacyOfflineWrite[]> {
  const rows = (await getAllRecords<QueueRecord>(QUEUE_STORE))
    .filter((row) => !row.ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const owner = cacheOwner();
  return rows.map((row) => {
    const reason = owner ? legacyReplayCheck(row, owner) : "Sign in before restoring.";
    const raw = typeof row.body === "string" ? row.body : "";
    return {
      id: row.id, createdAt: row.createdAt, method: row.method, target: legacyTarget(row),
      attempts: row.attempts ?? 0, preview: raw.slice(0, 3000),
      canReplay: !reason, reason: reason ?? "Eligible for a manual retry with the current account.",
    };
  });
}

/** Export the full original request bodies for backup, without old credentials. */
export async function exportLegacyOfflineWrites() {
  const rows = (await getAllRecords<QueueRecord>(QUEUE_STORE))
    .filter((row) => !row.ownerId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return JSON.stringify({
    format: "heuresis-legacy-offline-recovery-v1",
    exportedAt: new Date().toISOString(),
    warning: "May contain private notes and unsent changes. Keep securely. Not an automatic import.",
    entries: rows.map((row) => ({
      id: row.id, url: row.url, method: row.method, body: row.body,
      createdAt: row.createdAt, attempts: row.attempts,
      headers: Object.fromEntries(Object.entries(row.headers).filter(([key]) =>
        !["authorization", "apikey", "cookie", "x-api-key"].includes(key.toLowerCase()))),
    })),
  }, null, 2);
}

/** Explicitly adopt safe original inserts for the active user; replay still uses normal RLS. */
export async function adoptLegacyOfflineWrites(ids: string[], userId: string): Promise<number> {
  if (!userId || userId !== cacheOwner()) throw new Error("Sign in to the account that owns these records.");
  if (activeFlush) throw new Error("Wait for the current synchronisation to finish.");
  const wanted = new Set(ids);
  if (!wanted.size) return 0;
  const rows = (await getAllRecords<QueueRecord>(QUEUE_STORE)).filter((row) => wanted.has(row.id));
  if (rows.length !== wanted.size || rows.some((row) => row.ownerId)) throw new Error("Some legacy records changed. Refresh the recovery list.");
  for (const row of rows) {
    const reason = legacyReplayCheck(row, userId);
    if (reason) throw new Error(`Cannot restore ${legacyTarget(row)}: ${reason}`);
  }
  // Each row is an independent IndexedDB transaction; any completed adoption
  // remains visible as an owned pending write on partial failure.
  for (const row of rows) await putRecord(QUEUE_STORE, { ...row, ownerId: userId, attempts: 0 });
  await refreshOfflinePendingCount();
  return rows.length;
}

/** Only selected unowned entries may be discarded; export must happen first in the UI. */
export async function discardLegacyOfflineWrites(ids: string[]): Promise<number> {
  if (!cacheOwner()) throw new Error("Sign in before using the recovery tools.");
  if (activeFlush) throw new Error("Wait for the current synchronisation to finish.");
  const wanted = new Set(ids);
  const rows = (await getAllRecords<QueueRecord>(QUEUE_STORE)).filter((row) => wanted.has(row.id) && !row.ownerId);
  if (rows.length !== wanted.size) throw new Error("Some entries have changed. Refresh before discarding.");
  for (const row of rows) await deleteRecord(QUEUE_STORE, row.id);
  await refreshOfflinePendingCount();
  return rows.length;
}


/* Current-account writes the server refused. They are never dropped silently:
   the user can export them and then discard them after review. */
export type HeldOfflineWrite = {
  id: string;
  createdAt: string;
  method: string;
  target: string;
  status: number;
  message: string;
  preview: string;
};

async function heldRows() {
  const owner = cacheOwner();
  if (!owner) return [];
  return (await getAllRecords<QueueRecord>(QUEUE_STORE))
    .filter((row) => row.ownerId === owner && row.rejected)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listHeldOfflineWrites(): Promise<HeldOfflineWrite[]> {
  return (await heldRows()).map((row) => ({
    id: row.id, createdAt: row.createdAt, method: row.method, target: legacyTarget(row),
    status: row.rejected?.status ?? 0, message: row.rejected?.message ?? "",
    preview: (typeof row.body === "string" ? row.body : "").slice(0, 3000),
  }));
}

export async function exportHeldOfflineWrites() {
  const rows = await heldRows();
  return JSON.stringify({
    format: "heuresis-refused-offline-writes-v1",
    exportedAt: new Date().toISOString(),
    warning: "Contains your own unsent edits that the server refused. Keep securely. Not an automatic import.",
    entries: rows.map((row) => ({
      id: row.id, url: row.url, method: row.method, body: row.body, createdAt: row.createdAt,
      rejected: row.rejected,
    })),
  }, null, 2);
}

export async function discardHeldOfflineWrites(ids: string[]): Promise<number> {
  if (!cacheOwner()) throw new Error("Sign in before using the recovery tools.");
  if (activeFlush) throw new Error("Wait for the current synchronisation to finish.");
  const wanted = new Set(ids);
  const rows = (await heldRows()).filter((row) => wanted.has(row.id));
  if (rows.length !== wanted.size) throw new Error("Some entries have changed. Refresh before discarding.");
  for (const row of rows) await deleteRecord(QUEUE_STORE, row.id);
  await refreshOfflinePendingCount();
  return rows.length;
}


/**
 * Read the full current-account offline mutation journal for the native daily
 * backup. Unlike the UI counter this deliberately propagates IndexedDB errors:
 * a failed queue read must never produce a falsely complete backup.
 *
 * These are recovery records, not commands to replay on restore. The unowned
 * legacy queue is counted but deliberately not exported into an account backup.
 */
export async function snapshotOfflineWritesForBackup(userId: string) {
  if (!userId || cacheOwner() !== userId) throw new Error("The signed-in backup account has changed.");
  const rows = await getAllRecords<QueueRecord>(QUEUE_STORE);
  if (cacheOwner() !== userId) throw new Error("The signed-in backup account changed while reading offline edits.");
  return {
    entries: rows.filter((row) => row.ownerId === userId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
      .map((row) => ({
        id: row.id, method: row.method, url: row.url, body: row.body,
        created_at: row.createdAt, attempts: row.attempts,
        rejected: row.rejected ?? null,
      })),
    legacy_unassigned_count: rows.filter((row) => !row.ownerId).length,
  };
}
