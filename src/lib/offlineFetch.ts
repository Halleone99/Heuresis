type CacheRecord = {
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
  id: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | null;
  createdAt: string;
  attempts: number;
};

export type OfflineSyncState = {
  online: boolean;
  syncing: boolean;
  pending: number;
  lastSyncedAt: string | null;
  error: string;
};

const DB_NAME = "heuresis-offline-network-v1";
const DB_VERSION = 1;
const CACHE_STORE = "responses";
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
let dbPromise: Promise<IDBDatabase> | null = null;
let state: OfflineSyncState = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  syncing: false,
  pending: 0,
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
  return [method, url, headers.get("range") ?? "", headers.get("accept-profile") ?? "", body ?? ""].join("|");
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

async function saveResponse(key: string, method: string, url: string, response: Response) {
  if (!response.ok) return;
  try {
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, name) => { responseHeaders[name] = value; });
    await putRecord<CacheRecord>(CACHE_STORE, {
      key,
      url,
      method,
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: await response.clone().arrayBuffer(),
      updatedAt: new Date().toISOString(),
    });
  } catch {
    // Live data remains authoritative if local caching fails.
  }
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
    if (record.method !== "GET" || tableName(record.url) !== table) continue;
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
    if (record.method !== "GET" || tableName(record.url) !== table) continue;
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
    const next = { ...current, ...patch };
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
  const table = tableName(urlString);
  const rpc = rpcName(urlString);
  if (rpc === EVENT_RPC) throw new TypeError("Offline: review events remain in the Heuresis event queue until synchronisation.");
  if (rpc && REQUIRES_CONNECTION_RPCS.has(rpc)) throw new TypeError("This particular action needs a connection. Everything else can remain open offline.");

  const parsed = addClientIds(table, parseJson(rawBody));
  const queuedBody = parsed === null ? rawBody : JSON.stringify(parsed);
  const item: QueueRecord = {
    id: crypto.randomUUID(),
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
  try { emit({ pending: (await getAllRecords<QueueRecord>(QUEUE_STORE)).length }); }
  catch { emit({ pending: 0 }); }
  return state.pending;
}

export async function flushOfflineRequests(accessToken: string | null | undefined) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return { sent: 0, pending: await refreshOfflinePendingCount() };
  const queued = (await getAllRecords<QueueRecord>(QUEUE_STORE)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let sent = 0;
  for (const item of queued) {
    const headers = new Headers(item.headers);
    if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
    try {
      const response = await networkFetch(item.url, { method: item.method, headers, body: item.body });
      if (!response.ok) throw new Error((await response.text().catch(() => "")) || `Sync failed with HTTP ${response.status}.`);
      await deleteRecord(QUEUE_STORE, item.id);
      sent += 1;
    } catch (error) {
      await putRecord(QUEUE_STORE, { ...item, attempts: item.attempts + 1 });
      await refreshOfflinePendingCount();
      throw error;
    }
  }
  return { sent, pending: await refreshOfflinePendingCount() };
}

export async function offlineFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const { method, headers, body, url } = await requestParts(input, init);
  const read = isRead(method, url);
  const mutation = isMutation(method, url);
  if (!read && !mutation) return networkFetch(input, init);

  if (read) {
    const key = keyFor(method, url, headers, body);
    if (typeof navigator === "undefined" || navigator.onLine) {
      try {
        const response = await networkFetch(input, init);
        if (response.ok) void saveResponse(key, method, url, response);
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
      if (response.ok) void applySuccessfulMutation(method, url, body, response).catch(() => undefined);
      return response;
    } catch {
      // Queue below.
    }
  }
  return queueMutation(method, url, headers, body);
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => emit({ online: true, error: "" }));
  window.addEventListener("offline", () => emit({ online: false, syncing: false }));
  void refreshOfflinePendingCount();
}
