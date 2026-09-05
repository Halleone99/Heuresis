import { supabase } from "./supabase";

const BUCKET = "heuresis-card-media";
const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);

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
  return path;
}

export async function removeHeuresisCardImage(path: string) {
  if (!path) return;
  const { error } = await db().storage.from(BUCKET).remove([path]);
  if (error) throw error;
}

export async function signHeuresisCardImages(paths: string[]) {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (!unique.length) return {} as Record<string, string>;
  const { data, error } = await db().storage.from(BUCKET).createSignedUrls(unique, 60 * 60);
  if (error) throw error;
  const result: Record<string, string> = {};
  data?.forEach((item, index) => { if (item.signedUrl) result[unique[index]] = item.signedUrl; });
  return result;
}
