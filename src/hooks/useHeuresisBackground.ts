import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

export type BackgroundSettings = {
  enabled: boolean;
  opacity: number;
  veil: number;
  blur: number;
  position: "center" | "top" | "bottom";
  fit: "cover" | "contain";
};

export const DEFAULT_BACKGROUND_SETTINGS: BackgroundSettings = {
  enabled: true,
  opacity: Math.sqrt(0.6),
  veil: 1 - Math.sqrt(0.6),
  blur: 0,
  position: "center",
  fit: "cover",
};

export const PAGE_BACKGROUND_CHOICES = [
  { key: "heuresis", label: "All pages" },
  { key: "heuresis-overview", label: "Overview" },
  { key: "heuresis-study", label: "Study" },
  { key: "heuresis-notebook", label: "Notebook" },
  { key: "heuresis-mistakes", label: "Mistake Log" },
  { key: "heuresis-reading", label: "Reading" },
  { key: "heuresis-quotations", label: "Quotations" },
  { key: "heuresis-reference", label: "Catalogue" },
  { key: "heuresis-queue", label: "Captures" },
] as const;
export type BackgroundPageKey = typeof PAGE_BACKGROUND_CHOICES[number]["key"];
// The original 'heuresis' background is retained as the all-pages fallback.
function settingsKey(page: BackgroundPageKey) {
  return page === "heuresis" ? "pos.pageBackground.heuresis.v1" : `pos.pageBackground.${page}.v1`;
}
const BUCKET = "page-background-media";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const DB_NAME = "personal-os-media";
const STORE_NAME = "page-backgrounds";
const DB_VERSION = 1;

function clamp(settings: BackgroundSettings): BackgroundSettings {
  const number = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
  return { ...settings, opacity: number(settings.opacity, 0, 1), veil: number(settings.veil, 0, 1), blur: number(settings.blur, 0, 20), fit: "cover" };
}

function readSettings(page: BackgroundPageKey) {
  try {
    const raw = localStorage.getItem(settingsKey(page));
    return raw ? clamp({ ...DEFAULT_BACKGROUND_SETTINGS, ...JSON.parse(raw) as Partial<BackgroundSettings> }) : { ...DEFAULT_BACKGROUND_SETTINGS };
  } catch {
    return { ...DEFAULT_BACKGROUND_SETTINGS };
  }
}

function writeSettings(page: BackgroundPageKey, settings: BackgroundSettings) {
  try { localStorage.setItem(settingsKey(page), JSON.stringify(clamp(settings))); } catch { /* local preference only */ }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open background cache."));
  });
}

async function readCachedBlob(page: BackgroundPageKey): Promise<Blob | null> {
  if (typeof indexedDB === "undefined") return null;
  try {
    const database = await openDb();
    return await new Promise<Blob | null>((resolve) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(page);
      request.onsuccess = () => { database.close(); resolve(request.result ?? null); };
      request.onerror = () => { database.close(); resolve(null); };
    });
  } catch { return null; }
}

async function writeCachedBlob(page: BackgroundPageKey, blob: Blob | null) {
  if (typeof indexedDB === "undefined") return;
  try {
    const database = await openDb();
    await new Promise<void>((resolve, reject) => {
      const store = database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
      const request = blob ? store.put(blob, page) : store.delete(page);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    database.close();
  } catch { /* cache is optional */ }
}

function extensionFor(blob: Blob) {
  if (blob.type === "image/jpeg") return "jpg";
  if (blob.type === "image/png") return "png";
  if (blob.type === "image/webp") return "webp";
  if (blob.type === "image/gif") return "gif";
  if (blob.type === "image/avif") return "avif";
  return "bin";
}

function cloudSettings(value: unknown): BackgroundSettings {
  const row = value && typeof value === "object" && !Array.isArray(value) ? value as Partial<BackgroundSettings> : {};
  return clamp({
    enabled: typeof row.enabled === "boolean" ? row.enabled : true,
    opacity: typeof row.opacity === "number" ? row.opacity : DEFAULT_BACKGROUND_SETTINGS.opacity,
    veil: typeof row.veil === "number" ? row.veil : DEFAULT_BACKGROUND_SETTINGS.veil,
    blur: typeof row.blur === "number" ? row.blur : DEFAULT_BACKGROUND_SETTINGS.blur,
    position: row.position === "top" || row.position === "bottom" ? row.position : "center",
    fit: "cover",
  });
}

export function useHeuresisBackground(page: BackgroundPageKey = "heuresis") {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<BackgroundSettings>(() => readSettings(page));
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [cloudPath, setCloudPath] = useState<string | null>(null);
  const objectUrl = useRef<string | null>(null);
  const saveTimer = useRef<number | null>(null);

  const showBlob = useCallback((blob: Blob | null) => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = blob ? URL.createObjectURL(blob) : null;
    setImageUrl(objectUrl.current);
  }, []);

  const loadCloud = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    const { data: userData, error: userError } = await client.auth.getUser();
    if (userError) throw userError;
    if (!userData.user) return;
    const db = client as any;
    const { data: row, error } = await db.from("page_backgrounds").select("storage_path,settings").eq("user_id", userData.user.id).eq("page_key", page).maybeSingle();
    if (error) throw error;
    if (!row?.storage_path) return;
    const download = await client.storage.from(BUCKET).download(String(row.storage_path));
    if (download.error) throw download.error;
    if (!download.data) return;
    const next = cloudSettings(row.settings);
    showBlob(download.data);
    setCloudPath(String(row.storage_path));
    setSettings(next);
    writeSettings(page, next);
    await writeCachedBlob(page, download.data);
  }, [page, showBlob]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const cached = await readCachedBlob(page);
      if (!active) return;
      if (cached) showBlob(cached);
      setSettings(readSettings(page));
      try { await loadCloud(); } catch (error) { console.warn("Could not load the Personal OS Heuresis background.", error); }
      if (active) setLoading(false);
    })();
    return () => { active = false; if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); };
  }, [loadCloud, showBlob]);

  const syncSettings = useCallback((next: BackgroundSettings) => {
    const client = supabase;
    if (!client || !cloudPath) return;
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void (async () => {
        try {
          const { data: userData } = await client.auth.getUser();
          if (!userData.user) return;
          const db = client as any;
          const { error } = await db.from("page_backgrounds").update({ settings: next, updated_at: new Date().toISOString() }).eq("user_id", userData.user.id).eq("page_key", page);
          if (error) throw error;
          setSyncError("");
        } catch {
          setSyncError("Appearance changed locally, but could not sync yet.");
        }
      })();
    }, 350);
  }, [cloudPath, page]);

  const updateSettings = useCallback((patch: Partial<BackgroundSettings>) => {
    setSettings((current) => {
      const next = clamp({ ...current, ...patch });
      writeSettings(page, next);
      syncSettings(next);
      return next;
    });
  }, [page, syncSettings]);

  const chooseImage = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) throw new Error("Choose an image file.");
    if (file.size > MAX_UPLOAD_BYTES) throw new Error("Keep the background image under 12 MB.");
    const client = supabase;
    if (!client) throw new Error("Supabase is not configured.");
    setSyncing(true); setSyncError("");
    try {
      const { data: userData, error: userError } = await client.auth.getUser();
      if (userError) throw userError;
      if (!userData.user) throw new Error("Sign in before changing the background.");
      const userId = userData.user.id;
      const db = client as any;
      const current = await db.from("page_backgrounds").select("storage_path").eq("user_id", userId).eq("page_key", page).maybeSingle();
      if (current.error) throw current.error;
      const path = `${userId}/${page}/${crypto.randomUUID()}.${extensionFor(file)}`;
      const upload = await client.storage.from(BUCKET).upload(path, file, { cacheControl: "3600", contentType: file.type, upsert: false });
      if (upload.error) throw upload.error;
      const next = clamp({ ...settings, enabled: true });
      const metadata = await db.from("page_backgrounds").upsert({ user_id: userId, page_key: page, storage_path: path, settings: next, updated_at: new Date().toISOString() }, { onConflict: "user_id,page_key" });
      if (metadata.error) { await client.storage.from(BUCKET).remove([path]); throw metadata.error; }
      if (current.data?.storage_path && current.data.storage_path !== path) void client.storage.from(BUCKET).remove([String(current.data.storage_path)]);
      setCloudPath(path); setSettings(next); writeSettings(page, next); showBlob(file); await writeCachedBlob(page, file);
    } finally { setSyncing(false); }
  }, [page, settings, showBlob]);

  const removeImage = useCallback(async () => {
    const client = supabase;
    if (!client) return;
    setSyncing(true); setSyncError("");
    try {
      const { data: userData } = await client.auth.getUser();
      if (userData.user) {
        const db = client as any;
        const current = await db.from("page_backgrounds").select("storage_path").eq("user_id", userData.user.id).eq("page_key", page).maybeSingle();
        const deletion = await db.from("page_backgrounds").delete().eq("user_id", userData.user.id).eq("page_key", page);
        if (deletion.error) throw deletion.error;
        if (current.data?.storage_path) void client.storage.from(BUCKET).remove([String(current.data.storage_path)]);
      }
      setCloudPath(null); showBlob(null); await writeCachedBlob(page, null);
    } finally { setSyncing(false); }
  }, [page, showBlob]);

  return { imageUrl, hasImage: Boolean(imageUrl), settings, loading, syncing, syncError, updateSettings, chooseImage, removeImage };
}
