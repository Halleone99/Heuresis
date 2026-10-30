import { supabase } from "../supabase";
import {
  cleanName, LIMITS, normaliseArticle, normaliseSubject, normaliseVolume, stableJson, validateArticle,
  type CatalogueArticle, type CatalogueSnapshot, type CatalogueSubject, type CatalogueVolume,
} from "./model";

/**
 * Persistence for Catalogue publications. Every row is built on the client
 * (id + timestamps) so a write queued while offline is already complete on
 * this device and replays idempotently through the shared offline layer.
 *
 * Article saves are revision-guarded (updated_at compare-and-swap), exactly like
 * Notebook notes: a save never silently replaces a newer edit made elsewhere.
 * Notebook tables are never read or written here.
 */

export type CatalogueSchema = "ready" | "missing";
const PAGE_SIZE = 500;
const ARTICLE_COLUMNS = "*";

function db() {
  if (!supabase) throw new Error("Sign in to use the Catalogue.");
  return supabase;
}

type PgError = { code?: string; message?: string; details?: string | null };
function isMissingTable(error: PgError | null | undefined) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200"
    || /relation .* does not exist|Could not find the table/i.test(error.message ?? "")));
}

export class ConflictError extends Error {
  constructor() {
    super("This article was changed on another device. Your version was not saved over it.");
    this.name = "ConflictError";
  }
}

export function catalogueError(error: unknown): string {
  const e = (error ?? {}) as PgError;
  const text = `${e.message ?? ""} ${e.details ?? ""}`;
  if (error instanceof ConflictError) return error.message;
  if (e.code === "23505" && /catalogue_subjects/.test(text)) return "You already have a subject with that name.";
  if (e.code === "23514" && /pages/.test(text)) return "This article is too large to save. Split it into two articles.";
  if (e.code === "23514") return "Some of the details are too long or not valid.";
  if (e.code === "42501") return "You do not have permission to change this item.";
  if (isMissingTable(e)) return "The Catalogue database update has not been applied yet.";
  if (/Failed to fetch|NetworkError|network timeout|offline/i.test(text)) return "Heuresis could not reach the server. Try again when you are online.";
  if (error instanceof Error) return error.message;
  return e.message || "Something went wrong.";
}

async function allRows(table: string, userId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < 40; page += 1) {
    const { data, error } = await db().from(table).select(table === "catalogue_articles" ? ARTICLE_COLUMNS : "*")
      .eq("user_id", userId).order("created_at", { ascending: true }).order("id", { ascending: true })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as unknown as Record<string, unknown>[]));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

export type LoadedCatalogue = { schema: CatalogueSchema; snapshot: CatalogueSnapshot; deleted: CatalogueArticle[] };

export async function loadCatalogue(userId: string): Promise<LoadedCatalogue> {
  if (!userId) throw new Error("A signed-in account is required.");
  try {
    const [subjects, volumes, articles] = await Promise.all([
      allRows("catalogue_subjects", userId), allRows("catalogue_volumes", userId), allRows("catalogue_articles", userId),
    ]);
    const all = articles.map(normaliseArticle).filter((row) => row.id);
    const deletedIds = new Set(articles.filter((row) => typeof row.deleted_at === "string" && row.deleted_at).map((row) => String(row.id)));
    return {
      schema: "ready",
      snapshot: {
        subjects: subjects.map(normaliseSubject).filter((row) => row.id).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)),
        volumes: volumes.map(normaliseVolume).filter((row) => row.id),
        articles: all.filter((row) => !deletedIds.has(row.id)),
      },
      deleted: all.filter((row) => deletedIds.has(row.id)),
    };
  } catch (error) {
    if (isMissingTable(error as PgError)) return { schema: "missing", snapshot: { subjects: [], volumes: [], articles: [] }, deleted: [] };
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------
export async function createSubject(userId: string, name: string, sortOrder = 0): Promise<CatalogueSubject> {
  const now = new Date().toISOString();
  const row: CatalogueSubject = { id: crypto.randomUUID(), user_id: userId, name: cleanName(name), sort_order: sortOrder, created_at: now, updated_at: now };
  const { error } = await db().from("catalogue_subjects").insert(row);
  if (error) throw error;
  return row;
}
export async function renameSubject(userId: string, id: string, name: string) {
  const clean = cleanName(name);
  const { error } = await db().from("catalogue_subjects").update({ name: clean }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  return clean;
}
/** Volumes and articles of the subject are kept; they simply have no subject afterwards. */
export async function deleteSubject(userId: string, id: string) {
  const { error } = await db().from("catalogue_subjects").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Volumes
// ---------------------------------------------------------------------------
export type VolumeInput = Pick<CatalogueVolume, "title" | "subtitle" | "edition" | "edition_date" | "subject_id" | "cover">;
function cleanVolume(input: Partial<VolumeInput>) {
  const clean: Partial<VolumeInput> = { ...input };
  if (input.title !== undefined) clean.title = cleanName(input.title, LIMITS.title, "The title");
  if (input.subtitle !== undefined) clean.subtitle = input.subtitle.trim().slice(0, LIMITS.subtitle);
  if (input.edition !== undefined) clean.edition = input.edition.trim().slice(0, LIMITS.edition);
  if (input.edition_date !== undefined) clean.edition_date = input.edition_date && /^\d{4}-\d{2}-\d{2}$/.test(input.edition_date) ? input.edition_date : null;
  return clean;
}
export async function createVolume(userId: string, input: VolumeInput, sortOrder = 0): Promise<CatalogueVolume> {
  const now = new Date().toISOString();
  const clean = cleanVolume(input);
  const row: CatalogueVolume = {
    id: crypto.randomUUID(), user_id: userId,
    title: cleanName(input.title, LIMITS.title, "The title"), subtitle: clean.subtitle ?? "", edition: clean.edition ?? "",
    edition_date: clean.edition_date ?? null, cover: clean.cover ?? null, subject_id: clean.subject_id ?? null,
    sort_order: sortOrder, created_at: now, updated_at: now,
  };
  const { error } = await db().from("catalogue_volumes").insert(row);
  if (error) throw error;
  return row;
}
export async function updateVolume(userId: string, volume: CatalogueVolume, patch: Partial<VolumeInput>): Promise<CatalogueVolume> {
  const clean = cleanVolume(patch);
  const { error } = await db().from("catalogue_volumes").update(clean).eq("id", volume.id).eq("user_id", userId);
  if (error) throw error;
  return { ...volume, ...clean, updated_at: new Date().toISOString() };
}
/** Articles of the volume are kept; they remain in the volume's subject. */
export async function deleteVolume(userId: string, id: string) {
  const { error } = await db().from("catalogue_volumes").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Articles
// ---------------------------------------------------------------------------
type ArticleRow = Omit<CatalogueArticle, never> & { deleted_at?: string | null };
function articleRow(article: CatalogueArticle): ArticleRow {
  return { ...article };
}

export async function createArticle(article: CatalogueArticle): Promise<CatalogueArticle> {
  validateArticle(article);
  const { error } = await db().from("catalogue_articles").insert(articleRow(article));
  // The same id already exists: an earlier attempt reached the server.
  if (error && !(error.code === "23505" && /Key \(id\)=/.test(error.details ?? ""))) throw error;
  return article;
}

export type ArticlePatch = Partial<Pick<CatalogueArticle,
  "title" | "subtitle" | "author" | "subject_id" | "volume_id" | "volume_order" | "status" | "published_at"
  | "typography_preset" | "colour_preset" | "page_numbers" | "running_header" | "cover" | "pages">>;

/** Compare-and-swap update: refuses to overwrite a newer revision of the article. */
export async function updateArticle(current: CatalogueArticle, patch: ArticlePatch): Promise<CatalogueArticle> {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    const before = (current as Record<string, unknown>)[key];
    if (stableJson(before) !== stableJson(value)) changed[key] = value;
  }
  if (!Object.keys(changed).length) return current;
  const next: CatalogueArticle = { ...current, ...(changed as ArticlePatch) };
  validateArticle(next);
  const { data, error } = await db().from("catalogue_articles").update(changed)
    .eq("id", current.id).eq("user_id", current.user_id)
    .eq("updated_at", current.updated_at).is("deleted_at", null)
    // A plain array, not maybeSingle(): for an update that matches no row (a newer revision
    // exists) maybeSingle asks for a single object and the server answers 406.
    .select(ARTICLE_COLUMNS);
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] ?? null : data) as Record<string, unknown> | null;
  // A complete server row: the authoritative new revision.
  if (row && typeof row.updated_at === "string" && "pages" in row) return normaliseArticle(row);
  if (typeof navigator === "undefined" || navigator.onLine) {
    if (!row) throw new ConflictError();
  }
  // Queued offline: the change is kept on this device and replays with its
  // revision filter (re-based on the server's revision by the offline layer).
  return { ...next, updated_at: new Date().toISOString() };
}

export async function deleteArticle(article: CatalogueArticle) {
  const { error } = await db().from("catalogue_articles").update({ deleted_at: new Date().toISOString() })
    .eq("id", article.id).eq("user_id", article.user_id);
  if (error) throw error;
}
export async function restoreArticle(article: CatalogueArticle) {
  const { error } = await db().from("catalogue_articles").update({ deleted_at: null })
    .eq("id", article.id).eq("user_id", article.user_id);
  if (error) throw error;
}
/** Permanent removal from the library (images stay in storage; nothing else is affected). */
export async function purgeArticle(article: CatalogueArticle) {
  const { error } = await db().from("catalogue_articles").delete().eq("id", article.id).eq("user_id", article.user_id);
  if (error) throw error;
}

/** Re-read one article from the server (used after a conflict). */
export async function fetchArticle(userId: string, id: string): Promise<CatalogueArticle | null> {
  const { data, error } = await db().from("catalogue_articles").select(ARTICLE_COLUMNS)
    .eq("id", id).eq("user_id", userId).is("deleted_at", null).maybeSingle();
  if (error) throw error;
  return data ? normaliseArticle(data as Record<string, unknown>) : null;
}
