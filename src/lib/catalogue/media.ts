import { useEffect, useState } from "react";
import { supabase } from "../supabase";

/**
 * Catalogue images live in their own private bucket (heuresis-catalogue-media),
 * one folder per account, so the flashcard image bucket and its permissions are
 * untouched. Upload paths carry a fresh UUID: the bytes behind a path never
 * change, so a downloaded copy can be kept on the device indefinitely and the
 * page keeps its images offline and after a restart.
 */
export const CATALOGUE_BUCKET = "heuresis-catalogue-media";
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
/** Longest side kept: comfortably above 300 dpi for a full A4 width (2480 px). */
const MAX_DIMENSION = 3600;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const MEDIA_DB = "heuresis-catalogue-media-v1";
const STORE = "blobs";

const objectUrls = new Map<string, string>();
const inflight = new Map<string, Promise<string>>();
let mediaDb: Promise<IDBDatabase> | null = null;

function db() {
  if (!supabase) throw new Error("Sign in to add images.");
  return supabase;
}

function openMediaDb() {
  if (mediaDb) return mediaDb;
  mediaDb = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("No device storage.")); return; }
    const request = indexedDB.open(MEDIA_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "path" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the Catalogue image cache."));
  });
  return mediaDb;
}
async function readCached(path: string): Promise<Blob | null> {
  try {
    const store = await openMediaDb();
    return await new Promise((resolve, reject) => {
      const request = store.transaction(STORE, "readonly").objectStore(STORE).get(path);
      request.onsuccess = () => resolve((request.result as { blob?: Blob } | undefined)?.blob ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
}
async function writeCached(path: string, blob: Blob) {
  try {
    const store = await openMediaDb();
    await new Promise<void>((resolve, reject) => {
      const tx = store.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ path, blob, cachedAt: new Date().toISOString() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* the server copy remains authoritative */ }
}

export type StoredImage = { path: string; width: number; height: number; mime: string };

export function imageDimensions(blob: Blob): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { resolve({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 }); URL.revokeObjectURL(url); };
    image.onerror = () => { reject(new Error("This file could not be read as an image.")); URL.revokeObjectURL(url); };
    image.src = url;
  });
}

/** Re-encode very large images (keeps orientation; PNG stays PNG to keep transparency). */
async function prepare(blob: Blob, mime: string): Promise<{ blob: Blob; mime: string; width: number; height: number }> {
  const size = await imageDimensions(blob);
  const longest = Math.max(size.width, size.height);
  if (longest <= MAX_DIMENSION && blob.size <= MAX_UPLOAD_BYTES && mime !== "image/gif") return { blob, mime, ...size };
  const scale = Math.min(1, MAX_DIMENSION / longest);
  const width = Math.max(1, Math.round(size.width * scale));
  const height = Math.max(1, Math.round(size.height * scale));
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This device cannot prepare the image.");
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();
  const outType = mime === "image/png" ? "image/png" : "image/jpeg";
  const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, outType, 0.9));
  if (!out) throw new Error("The image could not be prepared.");
  if (out.size > MAX_UPLOAD_BYTES) throw new Error("This image is too large even after resizing. Use a smaller file.");
  return { blob: out, mime: outType, width, height };
}

function extension(mime: string) {
  return mime === "image/png" ? "png" : mime === "image/webp" ? "webp" : mime === "image/gif" ? "gif" : mime === "image/avif" ? "avif" : "jpg";
}

export async function uploadCatalogueImage(userId: string, input: Blob): Promise<StoredImage> {
  const mime = input.type || "image/jpeg";
  if (!ALLOWED.has(mime)) throw new Error("Use a JPEG, PNG, WebP, GIF or AVIF image.");
  if (!userId) throw new Error("Sign in before adding images.");
  const prepared = await prepare(input, mime);
  const path = `${userId}/${crypto.randomUUID()}.${extension(prepared.mime)}`;
  const { error } = await db().storage.from(CATALOGUE_BUCKET).upload(path, prepared.blob, {
    cacheControl: "31536000", contentType: prepared.mime, upsert: false,
  });
  if (error) {
    if (/bucket not found/i.test(error.message)) throw new Error("The Catalogue image storage has not been created yet. Apply the Catalogue database update.");
    throw error;
  }
  await writeCached(path, prepared.blob);
  return { path, width: prepared.width, height: prepared.height, mime: prepared.mime };
}

async function download(path: string): Promise<Blob> {
  const { data, error } = await db().storage.from(CATALOGUE_BUCKET).createSignedUrl(path, 60 * 60);
  if (error || !data?.signedUrl) throw error ?? new Error("The image could not be found.");
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(data.signedUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`Image download failed (HTTP ${response.status}).`);
    return await response.blob();
  } finally { window.clearTimeout(timer); }
}

/** The image bytes: from this device if already downloaded, otherwise from the server (then kept). */
export async function catalogueImageBlob(path: string): Promise<Blob> {
  const cached = await readCached(path);
  if (cached) return cached;
  if (typeof navigator !== "undefined" && !navigator.onLine) throw new Error("This image has not been downloaded to this device yet.");
  const blob = await download(path);
  await writeCached(path, blob);
  return blob;
}

export function catalogueImageUrl(path: string): Promise<string> {
  const existing = objectUrls.get(path);
  if (existing) return Promise.resolve(existing);
  const pending = inflight.get(path);
  if (pending) return pending;
  const job = catalogueImageBlob(path).then((blob) => {
    const url = URL.createObjectURL(blob);
    objectUrls.set(path, url);
    return url;
  }).finally(() => inflight.delete(path));
  inflight.set(path, job);
  return job;
}

/** Synchronously known object URL (after an image has been shown once). */
export function knownImageUrl(path: string | null | undefined) {
  return path ? objectUrls.get(path) ?? null : null;
}

export function useCatalogueImage(path: string | null | undefined): { url: string | null; error: string } {
  const [state, setState] = useState<{ path: string | null; url: string | null; error: string }>(() => ({ path: path ?? null, url: knownImageUrl(path), error: "" }));
  useEffect(() => {
    let active = true;
    if (!path) { setState({ path: null, url: null, error: "" }); return; }
    const known = knownImageUrl(path);
    if (known) { setState({ path, url: known, error: "" }); return; }
    setState({ path, url: null, error: "" });
    catalogueImageUrl(path)
      .then((url) => { if (active) setState({ path, url, error: "" }); })
      .catch((error: unknown) => { if (active) setState({ path, url: null, error: error instanceof Error ? error.message : "Image unavailable." }); });
    return () => { active = false; };
  }, [path]);
  return state.path === (path ?? null) ? { url: state.url, error: state.error } : { url: knownImageUrl(path), error: "" };
}

/** Make every image of a set available on this device (used before reading offline or exporting). */
export async function prefetchCatalogueImages(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  const results = await Promise.allSettled(unique.map((path) => catalogueImageUrl(path)));
  return results.filter((result) => result.status === "rejected").length;
}
