import { supabase } from "./supabase";
import { repairPinyinToneMarks } from "./pinyinUnicode";

/**
 * Structured Knowledge (Notebook, lessons, Mistake Log).
 *
 * Tables: knowledge_subjects → knowledge_topics (nestable) → knowledge_records,
 * plus knowledge_practice_events for mistake recall history.
 *
 * These are separate from Personal OS's legacy `knowledge_entries` capture queue,
 * which Heuresis only ever reads. Records are never silently turned into cards.
 *
 * Writes go through the same offline-aware Supabase client as Study. Every row is
 * built on the client (id + timestamps) so a write that is queued offline is
 * already complete in the local store and replays idempotently.
 */

export type KnowledgeKind = "note" | "lesson" | "mistake";
export type NoteCategory = "note" | "question" | "grammar" | "vocabulary" | "phrase" | "reference";
export type MistakeStatus = "needs_practice" | "understood";
export type MistakeAccent = "red" | "amber" | "green" | "blue" | "violet";
const MISTAKE_ACCENTS = new Set<MistakeAccent>(["red", "amber", "green", "blue", "violet"]);
export type SchemaLevel = "v2" | "v1" | "missing";
export type PracticeOutcome = "correct" | "incorrect";

export type KnowledgeSubject = { id: string; user_id: string; name: string; created_at: string; updated_at: string };
export type KnowledgeTopic = {
  id: string; user_id: string; subject_id: string; parent_id: string | null;
  name: string; created_at: string; updated_at: string;
};
export type KnowledgeEntry = {
  id: string; user_id: string; topic_id: string; kind: KnowledgeKind;
  title: string; body: string; attempt: string; correction: string; explanation: string;
  accent_color: MistakeAccent | null;
  icon?: string | null;
  status: MistakeStatus | null; category: NoteCategory | null; mistake_mode_id: string | null;
  lesson_id: string | null; lesson_date: string | null; pinned: boolean;
  recall_streak: number; last_recalled_at: string | null; recall_due_at: string | null;
  created_at: string; updated_at: string;
};
export type PracticeEvent = {
  id: string; user_id: string; record_id: string; outcome: PracticeOutcome; answer: string; created_at: string;
};
export type KnowledgeSnapshot = {
  subjects: KnowledgeSubject[]; topics: KnowledgeTopic[]; entries: KnowledgeEntry[]; practice: PracticeEvent[];
  practiceError?: string | null;
};

export type EntryInput = {
  /** Optional client id, so a retried capture can never be stored twice. */
  id?: string;
  kind: KnowledgeKind; topicId: string; title?: string; body?: string;
  attempt?: string; correction?: string; explanation?: string; accentColor?: MistakeAccent | null; icon?: string | null;
  category?: NoteCategory | null; mistakeModeId?: string | null; lessonId?: string | null; lessonDate?: string | null;
};
export type EntryPatch = Partial<Pick<KnowledgeEntry,
  "topic_id" | "title" | "body" | "attempt" | "correction" | "explanation" | "accent_color" | "status" | "category" | "mistake_mode_id"
  | "lesson_id" | "lesson_date" | "icon" | "pinned" | "recall_streak" | "last_recalled_at" | "recall_due_at">>;

export const EMPTY_SNAPSHOT: KnowledgeSnapshot = { subjects: [], topics: [], entries: [], practice: [] };
export const LEGACY_LESSON_PREFIX = "Lesson · ";
export const CATEGORY_LABELS: Record<NoteCategory, string> = {
  note: "Note", question: "Question", grammar: "Grammar", vocabulary: "Vocabulary", phrase: "Expression", reference: "Reference",
};
export const LIMITS = { name: 120, title: 200, body: 50000, attempt: 5000, correction: 5000, explanation: 10000, answer: 5000 };

const PAGE_SIZE = 1000;
const SCHEMA_KEY = "heuresis.knowledge.schema.v2";
const CONTENT_FIELDS: Array<keyof EntryPatch> = ["topic_id", "title", "body", "attempt", "correction", "explanation", "accent_color", "icon", "status", "category", "mistake_mode_id", "lesson_id", "lesson_date"];

let schemaLevel: SchemaLevel = readStoredSchema();

function readStoredSchema(): SchemaLevel {
  try {
    const value = localStorage.getItem(SCHEMA_KEY);
    return value === "v1" || value === "missing" ? value : "v2";
  } catch { return "v2"; }
}
function storeSchema(level: SchemaLevel) {
  schemaLevel = level;
  try { localStorage.setItem(SCHEMA_KEY, level); } catch { /* optional */ }
}

function db() {
  if (!supabase) throw new Error("Sign in to use the Notebook.");
  return supabase;
}

type PgError = { code?: string; message?: string; details?: string | null; hint?: string | null };

/** Translate database errors into sentences that say what to do next. */
export function friendlyError(error: unknown): string {
  const e = (error ?? {}) as PgError;
  const text = `${e.message ?? ""} ${e.details ?? ""}`;
  if (e.code === "23505" && /knowledge_subjects/.test(text)) return "You already have a subject with that name.";
  if (e.code === "23505" && /knowledge_topics/.test(text)) return "A topic with that name already exists in this place.";
  if (e.code === "23503" && /parent_topic/.test(text)) return "This topic still contains sub-topics. Move or delete them first.";
  if (e.code === "23514" && /content_check/.test(text)) return "Write something before saving.";
  if (e.code === "42703" || e.code === "PGRST204") return "The Notebook database update has not been applied yet.";
  if (e.code === "42501") return "You do not have permission to change this item.";
  if (/Failed to fetch|NetworkError|network timeout|offline/i.test(text)) return "Heuresis could not reach the server. Try again when you are online.";
  if (error instanceof Error) return error.message;
  return e.message || "Something went wrong.";
}

function isMissingColumn(error: PgError | null) {
  return Boolean(error && (error.code === "42703" || error.code === "PGRST204" || /column .* does not exist/i.test(error.message ?? "")));
}
function isMissingTable(error: PgError | null) {
  return Boolean(error && (error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST200" || /relation .* does not exist|Could not find the table/i.test(error.message ?? "")));
}

/**
 * Detect whether the v2 migration has been applied. While offline the last known
 * answer is used, because a synthesised offline read cannot reveal missing columns.
 */
export async function detectKnowledgeSchema(): Promise<SchemaLevel> {
  if (typeof navigator !== "undefined" && !navigator.onLine) return schemaLevel;
  // With at least one row, the row's own columns answer the question without an error response.
  const sample = await db().from("knowledge_records").select("*").limit(1);
  if (sample.error && isMissingTable(sample.error)) { storeSchema("missing"); return "missing"; }
  const row = Array.isArray(sample.data) ? sample.data[0] as Record<string, unknown> | undefined : undefined;
  if (row) {
    const level: SchemaLevel = "lesson_id" in row && "recall_due_at" in row ? "v2" : "v1";
    storeSchema(level);
    return level;
  }
  const probe = await db().from("knowledge_records").select("id,lesson_id,recall_due_at").limit(1);
  if (!probe.error) { storeSchema("v2"); return "v2"; }
  if (isMissingTable(probe.error)) { storeSchema("missing"); return "missing"; }
  if (isMissingColumn(probe.error)) {
    const base = await db().from("knowledge_records").select("id").limit(1);
    const level: SchemaLevel = base.error && isMissingTable(base.error) ? "missing" : "v1";
    storeSchema(level);
    return level;
  }
  return schemaLevel;
}

async function allRows(table: string, userId: string, order = "created_at", cap = 50) {
  const rows: Record<string, unknown>[] = [];
  for (let page = 0; page < cap; page += 1) {
    const offset = page * PAGE_SIZE;
    let query = db().from(table).select("*").eq("user_id", userId);
    if (table === "knowledge_records") query = query.is("deleted_at", null);
    const { data, error } = await query.order(order, { ascending: false }).order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const contentStr = (value: unknown) => repairPinyinToneMarks(str(value));
const nullableStr = (value: unknown) => (typeof value === "string" && value ? value : null);

export function normaliseSubject(row: Record<string, unknown>): KnowledgeSubject {
  const created = str(row.created_at, new Date().toISOString());
  return { id: str(row.id), user_id: str(row.user_id), name: contentStr(row.name), created_at: created, updated_at: str(row.updated_at, created) };
}
export function normaliseTopic(row: Record<string, unknown>): KnowledgeTopic {
  const created = str(row.created_at, new Date().toISOString());
  return {
    id: str(row.id), user_id: str(row.user_id), subject_id: str(row.subject_id), parent_id: nullableStr(row.parent_id),
    name: contentStr(row.name), created_at: created, updated_at: str(row.updated_at, created),
  };
}
const CATEGORIES = new Set<NoteCategory>(["note", "question", "grammar", "vocabulary", "phrase", "reference"]);
export function normaliseEntry(row: Record<string, unknown>): KnowledgeEntry {
  const created = str(row.created_at, new Date().toISOString());
  const kind: KnowledgeKind = row.kind === "mistake" ? "mistake" : row.kind === "lesson" ? "lesson" : "note";
  const category = typeof row.category === "string" && CATEGORIES.has(row.category as NoteCategory) ? row.category as NoteCategory : null;
  return {
    id: str(row.id), user_id: str(row.user_id), topic_id: str(row.topic_id), kind,
    title: contentStr(row.title), body: contentStr(row.body), attempt: contentStr(row.attempt), correction: contentStr(row.correction),
    explanation: contentStr(row.explanation),
    accent_color: typeof row.accent_color === "string" && MISTAKE_ACCENTS.has(row.accent_color as MistakeAccent) ? row.accent_color as MistakeAccent : null,
    icon: typeof row.icon === "string" && row.icon.trim().length <= 32 ? row.icon.trim() || null : null,
    status: kind === "mistake" ? (row.status === "understood" ? "understood" : "needs_practice") : null,
    category, mistake_mode_id: nullableStr(row.mistake_mode_id), lesson_id: nullableStr(row.lesson_id), lesson_date: nullableStr(row.lesson_date),
    pinned: row.pinned === true, recall_streak: typeof row.recall_streak === "number" ? row.recall_streak : 0,
    last_recalled_at: nullableStr(row.last_recalled_at), recall_due_at: nullableStr(row.recall_due_at),
    created_at: created, updated_at: str(row.updated_at, created),
  };
}
function normaliseEvent(row: Record<string, unknown>): PracticeEvent {
  return {
    id: str(row.id), user_id: str(row.user_id), record_id: str(row.record_id),
    outcome: row.outcome === "correct" ? "correct" : "incorrect", answer: contentStr(row.answer),
    created_at: str(row.created_at, new Date().toISOString()),
  };
}

export async function loadKnowledge(userId: string): Promise<{ snapshot: KnowledgeSnapshot; schema: SchemaLevel }> {
  if (!userId) throw new Error("A signed-in account is required.");
  const schema = await detectKnowledgeSchema().catch(() => schemaLevel);
  if (schema === "missing") return { snapshot: EMPTY_SNAPSHOT, schema };
  let practiceError: string | null = null;
  const [subjects, topics, entries, practice] = await Promise.all([
    allRows("knowledge_subjects", userId),
    allRows("knowledge_topics", userId),
    allRows("knowledge_records", userId),
    schema === "v2" ? allRows("knowledge_practice_events", userId, "created_at", 10).catch((error: unknown) => {
      practiceError = friendlyError(error);
      return [];
    }) : Promise.resolve([]),
  ]);
  return {
    schema,
    snapshot: {
      subjects: subjects.map(normaliseSubject).filter((row) => row.id),
      topics: topics.map(normaliseTopic).filter((row) => row.id),
      entries: entries.map(normaliseEntry).filter((row) => row.id),
      practice: practice.map(normaliseEvent).filter((row) => row.id),
      practiceError,
    },
  };
}

function requireWritable() {
  if (schemaLevel === "missing") throw new Error("The Notebook tables do not exist in this database yet. Apply the Knowledge workspace migrations first.");
  if (schemaLevel === "v1") throw new Error("Apply the Notebook database update (20261012090000_knowledge_workspace_v2.sql) to save changes.");
}

export function cleanName(value: string) {
  const clean = repairPinyinToneMarks(value).trim().replace(/\s+/g, " ");
  if (!clean) throw new Error("Give it a name first.");
  if (clean.length > LIMITS.name) throw new Error(`Names can be at most ${LIMITS.name} characters.`);
  return clean;
}

export async function createSubject(userId: string, rawName: string): Promise<KnowledgeSubject> {
  requireWritable();
  const now = new Date().toISOString();
  const row = { id: crypto.randomUUID(), user_id: userId, name: cleanName(rawName), created_at: now, updated_at: now };
  const { error } = await db().from("knowledge_subjects").insert(row);
  if (error) throw error;
  return row;
}
export async function renameSubject(userId: string, id: string, rawName: string) {
  requireWritable();
  const name = cleanName(rawName);
  const { error } = await db().from("knowledge_subjects").update({ name }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  return name;
}
export async function deleteSubject(userId: string, id: string) {
  requireWritable();
  // Check the server, not only this device's snapshot: subjects are shared
  // with Notebook and Mistake Log and must never cascade-delete their contents.
  const { count, error: checkError } = await db().from("knowledge_topics")
    .select("id", { count: "exact", head: true }).eq("subject_id", id).eq("user_id", userId);
  if (checkError) throw checkError;
  if (count === null) throw new Error("Cannot verify that this subject is empty. Nothing was deleted.");
  if (count > 0) throw new Error("This subject still has topics. Move or delete empty topics first; your knowledge has not been deleted.");
  const { error } = await db().from("knowledge_subjects").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

export async function createTopic(userId: string, subjectId: string, rawName: string, parentId: string | null = null): Promise<KnowledgeTopic> {
  requireWritable();
  const now = new Date().toISOString();
  const row: KnowledgeTopic = { id: crypto.randomUUID(), user_id: userId, subject_id: subjectId, parent_id: parentId, name: cleanName(rawName), created_at: now, updated_at: now };
  const { error } = await db().from("knowledge_topics").insert(row);
  if (error) throw error;
  return row;
}
export async function updateTopic(userId: string, id: string, patch: { name?: string; parent_id?: string | null }) {
  requireWritable();
  const clean: Record<string, unknown> = {};
  if (patch.name !== undefined) clean.name = cleanName(patch.name);
  if (patch.parent_id !== undefined) clean.parent_id = patch.parent_id;
  const { error } = await db().from("knowledge_topics").update(clean).eq("id", id).eq("user_id", userId);
  if (error) throw error;
  return clean as { name?: string; parent_id?: string | null };
}
export async function deleteTopic(userId: string, id: string) {
  requireWritable();
  // Query ALL records including archived ones. Deleting a topic must never
  // cascade-delete notes, mistakes, recall history or recoverable Trash.
  const [children, contents] = await Promise.all([
    db().from("knowledge_topics").select("id", { count: "exact", head: true }).eq("parent_id", id).eq("user_id", userId),
    db().from("knowledge_records").select("id", { count: "exact", head: true }).eq("topic_id", id).eq("user_id", userId),
  ]);
  if (children.error) throw children.error;
  if (contents.error) throw contents.error;
  if (children.count === null || contents.count === null) throw new Error("Cannot verify that this topic is empty. Nothing was deleted.");
  if (children.count > 0 || contents.count > 0)
    throw new Error("This topic still has subtopics, notes, mistakes or archived records. Move the contents first; nothing was deleted.");
  const { error } = await db().from("knowledge_topics").delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

function limit(value: string, max: number, label: string) {
  if (value.length > max) throw new Error(`${label} can be at most ${max.toLocaleString()} characters.`);
  return value;
}

export function validateEntry(entry: Pick<KnowledgeEntry, "kind" | "title" | "body" | "attempt" | "correction" | "explanation">) {
  limit(entry.title, LIMITS.title, "The title");
  limit(entry.body, LIMITS.body, "A note");
  limit(entry.attempt, LIMITS.attempt, "The attempt");
  limit(entry.correction, LIMITS.correction, "The correction");
  limit(entry.explanation, LIMITS.explanation, "The explanation");
  if (entry.kind === "note" && !entry.body.trim()) throw new Error("Write something before saving.");
  if (entry.kind === "mistake" && !entry.attempt.trim() && !entry.correction.trim()) throw new Error("Write what you said or the correct form.");
}

export async function createEntry(userId: string, input: EntryInput): Promise<KnowledgeEntry> {
  requireWritable();
  if (!input.topicId) throw new Error("Choose where to save it first.");
  const now = new Date().toISOString();
  const kind = input.kind;
  const entry: KnowledgeEntry = {
    id: input.id ?? crypto.randomUUID(), user_id: userId, topic_id: input.topicId, kind,
    title: repairPinyinToneMarks(input.title ?? "").trim(),
    body: kind === "mistake" ? "" : repairPinyinToneMarks(input.body ?? "").replace(/\s+$/, ""),
    attempt: kind === "mistake" ? repairPinyinToneMarks(input.attempt ?? "").trim() : "",
    correction: kind === "mistake" ? repairPinyinToneMarks(input.correction ?? "").trim() : "",
    explanation: kind === "mistake" ? repairPinyinToneMarks(input.explanation ?? "").trim() : "",
    accent_color: input.accentColor ?? null,
    icon: input.icon ? limit(input.icon.trim(), 32, "The icon") : null,
    status: kind === "mistake" ? "needs_practice" : null,
    category: kind === "note" ? (input.category ?? "note") : kind === "mistake" ? (input.category ?? null) : null,
    mistake_mode_id: kind === "mistake" ? (input.mistakeModeId ?? null) : null,
    lesson_id: kind === "lesson" ? null : (input.lessonId ?? null),
    lesson_date: kind === "lesson" ? (input.lessonDate ?? localDateKey(new Date())) : null,
    pinned: false, recall_streak: 0, last_recalled_at: null, recall_due_at: null,
    created_at: now, updated_at: now,
  };
  validateEntry(entry);
  const { error } = await db().from("knowledge_records").insert(entry);
  // The same id already exists: an earlier attempt reached the server.
  if (error && !(error.code === "23505" && /Key \(id\)=/.test(error.details ?? ""))) throw error;
  return entry;
}

/** Undo a soft deletion without touching its lesson relationships or practice events. */
export async function restoreEntry(entry: KnowledgeEntry) {
  requireWritable();
  const { error } = await db().from("knowledge_records")
    .update({ deleted_at: null }).eq("id", entry.id).eq("user_id", entry.user_id);
  if (error) throw error;
}

export async function updateEntry(userId: string, current: KnowledgeEntry, patch: EntryPatch): Promise<KnowledgeEntry> {
  requireWritable();
  const changed: EntryPatch = {};
  for (const [key, value] of Object.entries(patch) as Array<[keyof EntryPatch, unknown]>) {
    const normalized = typeof value === "string" && ["title", "body", "attempt", "correction", "explanation"].includes(key)
      ? repairPinyinToneMarks(value) : value;
    if (current[key] !== normalized) (changed as Record<string, unknown>)[key] = normalized;
  }
  if (!Object.keys(changed).length) return current;
  // Previous recall successes were for the old answer, not the new one.
  if (current.kind === "mistake" && typeof changed.correction === "string"
      && changed.correction.trim() !== current.correction.trim()) {
    changed.recall_streak = 0;
    changed.last_recalled_at = null;
    changed.recall_due_at = null;
    changed.status = "needs_practice";
  }
  if ("icon" in changed && changed.icon !== null && changed.icon !== undefined) {
    if (typeof changed.icon !== "string") throw new Error("Choose a valid icon.");
    changed.icon = limit(changed.icon.trim(), 32, "The icon") || null;
  }
  const next: KnowledgeEntry = { ...current, ...changed };
  validateEntry(next);
  const contentChanged = CONTENT_FIELDS.some((key) => key in changed);
  // Compare-and-swap: do not silently replace a newer edit from another
  // device. The server returns its exact updated_at for the next save.
  const { data, error } = await db().from("knowledge_records").update(changed)
    .eq("id", current.id).eq("user_id", userId)
    .eq("updated_at", current.updated_at).is("deleted_at", null)
    .select("*").maybeSingle();
  if (error) throw error;
  if (data) return normaliseEntry(data as Record<string, unknown>);
  if (typeof navigator === "undefined" || navigator.onLine) {
    throw new Error("This note changed on another device, or was deleted. Your edit was not overwritten. Reopen it to reconcile the changes.");
  }
  // The offline request has been durably queued; replay retains its original
  // revision filter rather than overwriting changes made elsewhere.
  return contentChanged ? { ...next, updated_at: new Date().toISOString() } : next;
}

export async function deleteEntry(userId: string, id: string) {
  requireWritable();
  // Archiving instead of DELETE preserves cascading practice history and
  // lesson capture links, so Undo restores the complete document.
  const { error } = await db().from("knowledge_records")
    .update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("user_id", userId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Mistake recall: a deliberately small schedule, not a second SRS.
// A correct recall only extends the interval when it happens on a later day than
// the previous correct recall, so repeating an answer five times in a row in one
// sitting is not counted as long-term retention.
// ---------------------------------------------------------------------------
export const RECALL_INTERVAL_DAYS = [1, 3, 7, 21, 60];
export const RETAINED_STREAK = 3;

export function nextRecallState(entry: KnowledgeEntry, outcome: PracticeOutcome, now = new Date()) {
  if (outcome === "incorrect") {
    return { recall_streak: 0, last_recalled_at: now.toISOString(), recall_due_at: addDays(now, 1).toISOString() };
  }
  const sameDay = entry.last_recalled_at && entry.recall_streak > 0 && localDateKey(new Date(entry.last_recalled_at)) === localDateKey(now);
  const streak = sameDay ? entry.recall_streak : entry.recall_streak + 1;
  const interval = RECALL_INTERVAL_DAYS[Math.min(streak, RECALL_INTERVAL_DAYS.length) - 1] ?? 1;
  return {
    recall_streak: streak,
    last_recalled_at: sameDay ? entry.last_recalled_at : now.toISOString(),
    recall_due_at: sameDay && entry.recall_due_at ? entry.recall_due_at : addDays(now, interval).toISOString(),
  };
}

export async function recordPractice(userId: string, entry: KnowledgeEntry, outcome: PracticeOutcome, answer: string) {
  requireWritable();
  const event: PracticeEvent = {
    id: crypto.randomUUID(), user_id: userId, record_id: entry.id, outcome,
    answer: limit(answer.trim(), LIMITS.answer, "The answer"), created_at: new Date().toISOString(),
  };
  // One database transaction inserts the event and updates its schedule.
  // An offline call can be queued with the same event ID; the UI uses the
  // deterministic local calculation until its server response arrives.
  const { data, error } = await db().rpc("heuresis_record_knowledge_recall", {
    p_record_id: entry.id,
    p_event_id: event.id,
    p_outcome: outcome,
    p_answer: event.answer,
    p_tz_offset_minutes: new Date().getTimezoneOffset(),
  });
  if (error) throw error;
  const saved = data && typeof data === "object" && !Array.isArray(data)
    ? data as Record<string, unknown> : null;
  const fallback = nextRecallState(entry, outcome, new Date(event.created_at));
  const next: KnowledgeEntry = {
    ...entry,
    recall_streak: typeof saved?.recall_streak === "number" ? saved.recall_streak : fallback.recall_streak,
    last_recalled_at: typeof saved?.last_recalled_at === "string" ? saved.last_recalled_at : fallback.last_recalled_at,
    recall_due_at: typeof saved?.recall_due_at === "string" ? saved.recall_due_at : fallback.recall_due_at,
  };
  return { event: {
    ...event, created_at: typeof saved?.created_at === "string" ? saved.created_at : event.created_at,
  }, entry: next };
}

// ---------------------------------------------------------------------------
// Helpers shared by the interface
// ---------------------------------------------------------------------------
export function localDateKey(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
export function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
export function isLesson(entry: Pick<KnowledgeEntry, "kind" | "title">) {
  return entry.kind === "lesson" || (entry.kind === "note" && entry.title.startsWith(LEGACY_LESSON_PREFIX));
}
export function isLegacyLesson(entry: Pick<KnowledgeEntry, "kind" | "title">) {
  return entry.kind === "note" && entry.title.startsWith(LEGACY_LESSON_PREFIX);
}
export function isDocument(entry: Pick<KnowledgeEntry, "kind">) {
  return entry.kind === "note" || entry.kind === "lesson";
}
export function isOpenQuestion(entry: KnowledgeEntry) {
  return entry.kind === "note" && entry.category === "question";
}
export type MistakeStage = "to_correct" | "practising" | "understood";
export function mistakeStage(entry: KnowledgeEntry): MistakeStage {
  if (!entry.correction.trim()) return "to_correct";
  return entry.status === "understood" ? "understood" : "practising";
}
export function isRecallDue(entry: KnowledgeEntry, now = Date.now()) {
  if (entry.kind !== "mistake" || !entry.correction.trim()) return false;
  if (!entry.recall_due_at) return entry.status === "needs_practice";
  return new Date(entry.recall_due_at).getTime() <= now;
}

/** First meaningful line of a note, stripped of markup, for titles and previews. */
export function plainLine(text: string) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|>\s?(\[![a-z]+\]\s*)?)/i, "")
      .replace(/\*\*|==|~~|\[\[|\]\]/g, "").replace(/(^|\s)\*(\S)/g, "$1$2").trim();
    if (line && line !== "---") return repairPinyinToneMarks(line);
  }
  return "";
}
export function entryTitle(entry: KnowledgeEntry) {
  if (entry.kind === "mistake") return repairPinyinToneMarks(entry.title.trim() || entry.correction.trim() || entry.attempt.trim() || "Mistake");
  const title = entry.title.trim();
  if (title) return repairPinyinToneMarks(title);
  return plainLine(entry.body) || (entry.kind === "lesson" ? "Untitled lesson" : "Untitled note");
}
export function entryPreview(entry: KnowledgeEntry, max = 180) {
  if (entry.kind === "mistake") return repairPinyinToneMarks([entry.attempt, entry.correction].filter(Boolean).join(" → "));
  const lines = entry.body.split(/\r?\n/).map((line) => plainLine(line)).filter(Boolean);
  const title = entry.title.trim();
  const body = (title ? lines : lines.slice(1)).join(" · ");
  const repaired = repairPinyinToneMarks(body);
  return repaired.length > max ? `${repaired.slice(0, max - 1).trimEnd()}…` : repaired;
}

export function normaliseSearch(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}
