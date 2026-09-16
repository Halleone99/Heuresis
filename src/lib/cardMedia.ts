import { supabase } from "./supabase";

const BUCKET = "heuresis-card-media";
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MEDIA_DB = "heuresis-card-media-v1";
const MEDIA_STORE = "blobs";
const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";
const objectUrls = new Map<string, string>();
let mediaDbPromise: Promise<IDBDatabase> | null = null;

type CachedMedia = { path: string; blob: Blob; cachedAt: string };

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function extensionFor(file: File) {
  const fromName = file.name.split(".").pop()?.toLocaleLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 5) return fromName;
  if (file.type === "image/png") return "png";
  if (file.type === "image/webp") return "webp";
  if (file.type === "image/gif") return "gif";
  if (file.type === "image/avif") return "avif";
  return "jpg";
}

function openMediaDb() {
  if (mediaDbPromise) return mediaDbPromise;
  mediaDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(MEDIA_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(MEDIA_STORE)) request.result.createObjectStore(MEDIA_STORE, { keyPath: "path" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the Heuresis media cache."));
  });
  return mediaDbPromise;
}

async function readCachedMedia(path: string): Promise<CachedMedia | null> {
  if (typeof indexedDB === "undefined") return null;
  const mediaDb = await openMediaDb();
  return new Promise((resolve, reject) => {
    const request = mediaDb.transaction(MEDIA_STORE, "readonly").objectStore(MEDIA_STORE).get(path);
    request.onsuccess = () => resolve((request.result as CachedMedia | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
}

async function writeCachedMedia(path: string, blob: Blob) {
  if (typeof indexedDB === "undefined") return;
  const mediaDb = await openMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = mediaDb.transaction(MEDIA_STORE, "readwrite");
    tx.objectStore(MEDIA_STORE).put({ path, blob, cachedAt: new Date().toISOString() } satisfies CachedMedia);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const previous = objectUrls.get(path);
  if (previous) URL.revokeObjectURL(previous);
  objectUrls.delete(path);
}

async function deleteCachedMedia(path: string) {
  if (typeof indexedDB === "undefined") return;
  const mediaDb = await openMediaDb();
  await new Promise<void>((resolve, reject) => {
    const tx = mediaDb.transaction(MEDIA_STORE, "readwrite");
    tx.objectStore(MEDIA_STORE).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  const previous = objectUrls.get(path);
  if (previous) URL.revokeObjectURL(previous);
  objectUrls.delete(path);
}

async function cachedObjectUrl(path: string) {
  const existing = objectUrls.get(path);
  if (existing) return existing;
  const cached = await readCachedMedia(path).catch(() => null);
  if (!cached) return null;
  const url = URL.createObjectURL(cached.blob);
  objectUrls.set(path, url);
  return url;
}

async function fetchBlob(url: string, timeoutMs = 8_000) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}.`);
    return await response.blob();
  } finally {
    window.clearTimeout(timer);
  }
}

async function signedUrls(paths: string[]) {
  const { data, error } = await db().storage.from(BUCKET).createSignedUrls(paths, 60 * 60);
  if (error) throw error;
  return data ?? [];
}

export async function uploadHeuresisCardImage(cardId: string, file: File) {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error("Use a JPEG, PNG, WebP, GIF or AVIF image.");
  if (file.size > MAX_BYTES) throw new Error("Keep card images under 12 MB.");
  const { data: authData, error: authError } = await db().auth.getUser();
  if (authError) throw authError;
  const user = authData.user;
  if (!user) throw new Error("Sign in before adding card images.");
  const path = `${user.id}/${cardId}/${crypto.randomUUID()}.${extensionFor(file)}`;
  const { error } = await db().storage.from(BUCKET).upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
  if (error) throw error;
  await writeCachedMedia(path, file).catch(() => undefined);
  return path;
}

export async function removeHeuresisCardImage(path: string) {
  if (!path) return;
  const { error } = await db().storage.from(BUCKET).remove([path]);
  if (error) throw error;
  await deleteCachedMedia(path).catch(() => undefined);
}

export async function cacheHeuresisCardImages(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  const missing: string[] = [];
  for (const path of unique) {
    if (!(await readCachedMedia(path).catch(() => null))) missing.push(path);
  }
  if (!missing.length) return;
  const signed = await signedUrls(missing);
  await Promise.all(signed.map(async (item, index) => {
    if (!item.signedUrl) return;
    const path = missing[index];
    const blob = await fetchBlob(item.signedUrl).catch(() => null);
    if (blob) await writeCachedMedia(path, blob).catch(() => undefined);
  }));
}

export async function signHeuresisCardImages(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {} as Record<string, string>;

  const result: Record<string, string> = {};
  await Promise.all(unique.map(async (path) => {
    const local = await cachedObjectUrl(path).catch(() => null);
    if (local) result[path] = local;
  }));

  // A path already held as a blob is final: upload paths carry a fresh UUID, so the
  // bytes behind one never change. Re-signing and re-downloading them on every card
  // change would pull the full image again and revoke the object URL still on screen.
  const missing = unique.filter((path) => !result[path]);
  if (!missing.length) return result;
  if (typeof navigator !== "undefined" && !navigator.onLine) return result;

  try {
    const signed = await signedUrls(missing);
    await Promise.all(signed.map(async (item, index) => {
      if (!item.signedUrl) return;
      const path = missing[index];
      const blob = await fetchBlob(item.signedUrl).catch(() => null);
      if (blob) {
        await writeCachedMedia(path, blob).catch(() => undefined);
        const local = await cachedObjectUrl(path).catch(() => null);
        result[path] = local ?? item.signedUrl;
      } else if (!result[path]) {
        result[path] = item.signedUrl;
      }
    }));
  } catch (error) {
    if (!Object.keys(result).length) throw error;
  }

  return result;
}

export function heuresisCardImagePaths(cards: Array<{ data: Record<string, string | string[] | null> }>) {
  const paths = new Set<string>();
  for (const card of cards) {
    const blocks = card.data[WORKSPACE_BLOCKS_KEY];
    if (!Array.isArray(blocks)) continue;
    for (const entry of blocks) {
      try {
        const parsed = JSON.parse(entry) as Record<string, unknown>;
        if (parsed.type === "image" && typeof parsed.path === "string" && parsed.path) paths.add(parsed.path);
      } catch {
        // Ignore malformed/legacy workspace entries here; card-data preservation handles them elsewhere.
      }
    }
  }
  return Array.from(paths);
}
