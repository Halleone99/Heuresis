import { supabase } from "./supabase";

export type StudyGrade = "again" | "hard" | "good" | "easy";
export type StudyEventType = "encountered" | "revealed" | StudyGrade;
export type HeuresisSessionMode = "flashcards" | "sort" | "browse" | "related";

export type StudyTemplate = {
  id: string;
  card_type_id: string;
  name: string;
  front: string[];
  back: string[];
  details: string[];
  sort_order: number;
};

type QueuedStudyEvent = {
  client_event_id: string;
  card_id: string;
  pack_id: string;
  session_id: string;
  template_id: string | null;
  event_type: StudyEventType;
  created_at: string;
  attempts: number;
};

export type StudyQueueState = { pending: number; parked: number };

const QUEUE_KEY = "heuresis.desktop.eventqueue.v1";
const PARK_AFTER = 5;
const BATCH_SIZE = 200;
let flushTimer: number | undefined;
let flushing = false;

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isStudyEventType(value: unknown): value is StudyEventType {
  return value === "encountered" || value === "revealed" || value === "again" || value === "hard" || value === "good" || value === "easy";
}

function isQueuedStudyEvent(value: unknown): value is QueuedStudyEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.client_event_id === "string"
    && typeof row.card_id === "string"
    && typeof row.pack_id === "string"
    && typeof row.session_id === "string"
    && (typeof row.template_id === "string" || row.template_id === null)
    && isStudyEventType(row.event_type)
    && typeof row.created_at === "string"
    && typeof row.attempts === "number";
}

function readQueue(): QueuedStudyEvent[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isQueuedStudyEvent);
  } catch (error) {
    throw new Error("Review history cannot be read from local storage. Preserve this device's data; do not clear it.", { cause: error });
  }
}

function writeQueue(events: QueuedStudyEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(events));
  } catch (error) {
    // Never claim a grade was saved when storage refused the write.
    throw new Error("Cannot save review history on this device. Free storage or export your data before continuing.", { cause: error });
  }
}

function networkUnavailable(error?: unknown) {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /offline|failed to fetch|networkerror|network request failed|load failed/i.test(message);
}

/** Grades recorded on this device that have not reached the server yet (offline evidence). */
export function pendingStudyGrades(packId: string): Array<{ card_id: string; template_id: string | null; event_type: StudyGrade; created_at: string }> {
  return readQueue()
    .filter((event) => event.pack_id === packId && (event.event_type === "again" || event.event_type === "hard" || event.event_type === "good" || event.event_type === "easy"))
    .map((event) => ({ card_id: event.card_id, template_id: event.template_id, event_type: event.event_type as StudyGrade, created_at: event.created_at }));
}

export function getStudyQueueState(): StudyQueueState {
  const events = readQueue();
  return {
    pending: events.filter((event) => event.attempts < PARK_AFTER).length,
    parked: events.filter((event) => event.attempts >= PARK_AFTER).length,
  };
}

function queueStudyEvent(input: Omit<QueuedStudyEvent, "client_event_id" | "created_at" | "attempts">) {
  const event: QueuedStudyEvent = {
    ...input,
    client_event_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    attempts: 0,
  };
  const queue = readQueue();
  queue.push(event);
  writeQueue(queue);

  if (typeof window !== "undefined") {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      void flushStudyEvents().catch(() => undefined);
    }, 220);
  }
  return event.client_event_id;
}

function isInvalidStudyEvent(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code: unknown }).code) : "";
  // Referential-integrity, invalid-input and check-constraint failures are
  // deterministic. An authentication, network or server failure must NOT park
  // otherwise valid events.
  if (/^(22|23)/.test(code)) return true;
  const message = typeof error === "object" && error !== null && "message" in error
    ? String((error as { message: unknown }).message) : "";
  // A single event can violate ownership RLS even when the user's session is
  // valid. Split those batches too; network/expired-token failures still stop.
  return code === "42501" && /row.level security policy/i.test(message);
}

async function sendStudyBatch(batch: QueuedStudyEvent[]): Promise<void> {
  const payload = batch.map(({ attempts: _attempts, ...event }) => event);
  const { error } = await db().rpc("heuresis_record_events", { events: payload });
  if (!error) {
    const sentIds = new Set(batch.map((event) => event.client_event_id));
    writeQueue(readQueue().filter((event) => !sentIds.has(event.client_event_id)));
    return;
  }
  if (networkUnavailable(error) || !isInvalidStudyEvent(error)) throw error;
  if (batch.length === 1) {
    const badId = batch[0].client_event_id;
    // Preserve rejected evidence for explicit manual recovery rather than
    // letting one malformed result hold up hundreds of valid review grades.
    writeQueue(readQueue().map((event) => event.client_event_id === badId
      ? { ...event, attempts: PARK_AFTER } : event));
    return;
  }
  const middle = Math.floor(batch.length / 2);
  await sendStudyBatch(batch.slice(0, middle));
  await sendStudyBatch(batch.slice(middle));
}

async function flushStudyEventsUnlocked(): Promise<StudyQueueState> {
  while (true) {
    const batch = readQueue().filter((event) => event.attempts < PARK_AFTER).slice(0, BATCH_SIZE);
    if (!batch.length) break;
    await sendStudyBatch(batch);
  }
  return getStudyQueueState();
}

export async function flushStudyEvents(): Promise<StudyQueueState> {
  if (flushing) return getStudyQueueState();
  if (typeof navigator !== "undefined" && !navigator.onLine) return getStudyQueueState();
  flushing = true;
  try {
    // Web Locks coordinate separate Tauri windows, unlike the local flag alone.
    if (typeof navigator !== "undefined" && navigator.locks) {
      return await navigator.locks.request("heuresis-study-event-flush", flushStudyEventsUnlocked);
    }
    return await flushStudyEventsUnlocked();
  } finally {
    flushing = false;
  }
}

export async function retryParkedStudyEvents() {
  writeQueue(readQueue().map((event) => ({ ...event, attempts: 0 })));
  return flushStudyEvents();
}

export async function loadStudySetup(packId: string, cardTypeId: string) {
  const [packResult, templatesResult] = await Promise.all([
    db().from("heuresis_packs").select("default_template_id").eq("id", packId).maybeSingle(),
    db()
      .from("heuresis_study_templates")
      .select("id,card_type_id,name,front,back,details,sort_order")
      .eq("card_type_id", cardTypeId)
      .order("sort_order")
      .order("name"),
  ]);

  if (packResult.error) throw packResult.error;
  if (templatesResult.error) throw templatesResult.error;

  const templates: StudyTemplate[] = (templatesResult.data ?? []).map((row) => ({
    id: row.id,
    card_type_id: row.card_type_id,
    name: row.name,
    front: stringArray(row.front),
    back: stringArray(row.back),
    details: stringArray(row.details),
    sort_order: Number(row.sort_order ?? 0),
  }));

  return {
    templates,
    defaultTemplateId: packResult.data?.default_template_id ?? templates[0]?.id ?? null,
  };
}

export async function startHeuresisSession(packId: string, mode: HeuresisSessionMode, templateId: string | null = null) {
  const { data, error } = await db()
    .from("heuresis_sessions")
    .insert({ pack_id: packId, mode, template_id: templateId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function startStudySession(packId: string, templateId: string | null) {
  return startHeuresisSession(packId, "flashcards", templateId);
}

export async function finishStudySession(sessionId: string) {
  if (typeof navigator === "undefined" || navigator.onLine) await flushStudyEvents().catch(() => undefined);
  const { error } = await db()
    .from("heuresis_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

/**
 * Records locally first, then flushes in the background. A temporary network
 * failure never loses a grade or blocks the review flow.
 */
export async function recordStudyEvent(input: {
  cardId: string;
  packId: string;
  sessionId: string;
  templateId: string | null;
  eventType: StudyEventType;
}) {
  queueStudyEvent({
    card_id: input.cardId,
    pack_id: input.packId,
    session_id: input.sessionId,
    template_id: input.templateId,
    event_type: input.eventType,
  });
  if (typeof navigator === "undefined" || navigator.onLine) void flushStudyEvents().catch(() => undefined);
}
