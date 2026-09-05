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
const MAX_QUEUE = 3000;
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
    return parsed.filter(isQueuedStudyEvent).slice(-MAX_QUEUE);
  } catch {
    return [];
  }
}

function writeQueue(events: QueuedStudyEvent[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(QUEUE_KEY, JSON.stringify(events.slice(-MAX_QUEUE)));
  } catch {
    // Storage may be unavailable in restrictive browser modes; review remains usable.
  }
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

export async function flushStudyEvents(): Promise<StudyQueueState> {
  if (flushing) return getStudyQueueState();
  flushing = true;
  try {
    while (true) {
      const batch = readQueue().filter((event) => event.attempts < PARK_AFTER).slice(0, BATCH_SIZE);
      if (!batch.length) break;
      try {
        const payload = batch.map(({ attempts: _attempts, ...event }) => event);
        const { error } = await db().rpc("heuresis_record_events", { events: payload });
        if (error) throw error;
        const sentIds = new Set(batch.map((event) => event.client_event_id));
        writeQueue(readQueue().filter((event) => !sentIds.has(event.client_event_id)));
      } catch (error) {
        const failedIds = new Set(batch.map((event) => event.client_event_id));
        writeQueue(readQueue().map((event) => failedIds.has(event.client_event_id)
          ? { ...event, attempts: Math.min(PARK_AFTER, event.attempts + 1) }
          : event));
        throw error;
      }
    }
  } finally {
    flushing = false;
  }
  return getStudyQueueState();
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
  await flushStudyEvents().catch(() => undefined);
  const { error } = await db()
    .from("heuresis_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

/**
 * Records locally first, then flushes in the background. A temporary network
 * failure no longer loses a grade or blocks the review flow.
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
  void flushStudyEvents().catch(() => undefined);
}
