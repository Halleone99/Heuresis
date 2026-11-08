import { supabase } from "./supabase";
import type { StudyGrade } from "./study";

export type ReviewCorrectionGrade = Extract<StudyGrade, "again" | "hard">;
export type ReviewCorrection = {
  id: string;
  card_id: string;
  template_id: string | null;
  grade: ReviewCorrectionGrade;
  attempt: string;
  reference_answer: string;
  explanation: string;
  created_at: string;
};

type QueuedCorrection = ReviewCorrection & {
  user_id: string;
  pack_id: string;
  session_id: string;
};

const QUEUE_KEY = "heuresis.review.corrections.pending.v1";
let flushing = false;

function readQueue(): QueuedCorrection[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("Invalid correction queue");
    return value.filter((row): row is QueuedCorrection =>
      row !== null && typeof row === "object" && typeof row.id === "string"
      && typeof row.user_id === "string" && typeof row.card_id === "string"
      && typeof row.pack_id === "string" && typeof row.session_id === "string"
      && (row.template_id === null || typeof row.template_id === "string")
      && (row.grade === "again" || row.grade === "hard")
      && typeof row.attempt === "string" && typeof row.reference_answer === "string"
      && typeof row.explanation === "string" && typeof row.created_at === "string");
  } catch (error) {
    throw new Error("Saved correction notes could not be read. Do not clear this device's storage.", { cause: error });
  }
}

function writeQueue(queue: QueuedCorrection[]) {
  try {
    if (typeof window !== "undefined") localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch (error) {
    throw new Error("Correction could not be saved on this device. Preserve your local data.", { cause: error });
  }
}

/** Replay only notes belonging to the currently signed-in account. Never discard a failed note. */
export async function flushReviewCorrections(): Promise<void> {
  if (!supabase || flushing || (typeof navigator !== "undefined" && !navigator.onLine)) return;
  flushing = true;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) return;
    for (const row of readQueue()) {
      if (row.user_id !== data.session.user.id) continue;
      const { error: insertError } = await supabase.from("heuresis_review_corrections").insert(row);
      if (insertError) {
        if (insertError.code !== "23505") break;
        const { data: existing, error: lookupError } = await supabase
          .from("heuresis_review_corrections").select("id").eq("id", row.id).maybeSingle();
        if (lookupError || !existing) break;
      }
      // Read afresh: the learner may have written another note during the request.
      writeQueue(readQueue().filter((item) => item.id !== row.id));
    }
  } finally {
    flushing = false;
  }
}

export async function saveReviewCorrection(input: {
  id: string;
  cardId: string;
  packId: string;
  sessionId: string;
  templateId: string | null;
  grade: ReviewCorrectionGrade;
  attempt: string;
  referenceAnswer: string;
  explanation: string;
}): Promise<"synced" | "queued"> {
  if (!supabase) throw new Error("Supabase is not configured.");
  const explanation = input.explanation.trim();
  const referenceAnswer = input.referenceAnswer.trim();
  if (!explanation) throw new Error("Explain the confusion before saving.");
  if (!referenceAnswer) throw new Error("This card has no reference answer to compare.");
  if (explanation.length > 3000 || input.attempt.length > 3000 || referenceAnswer.length > 3000) {
    throw new Error("Maximum 3,000 characters per field.");
  }
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Sign in to save a correction.");
  const row: QueuedCorrection = {
    id: input.id,
    user_id: data.session.user.id,
    card_id: input.cardId,
    pack_id: input.packId,
    session_id: input.sessionId,
    template_id: input.templateId,
    grade: input.grade,
    attempt: input.attempt.trim(),
    reference_answer: referenceAnswer,
    explanation,
    created_at: new Date().toISOString(),
  };
  const pending = readQueue();
  if (!pending.some((item) => item.id === row.id)) writeQueue([...pending, row]);
  await flushReviewCorrections().catch(() => undefined);
  return readQueue().some((item) => item.id === row.id) ? "queued" : "synced";
}

/** Includes the device's unsynchronised notes, for same-session offline retries. */
export async function loadReviewCorrections(cardId: string, templateId: string | null): Promise<ReviewCorrection[]> {
  if (!supabase) return [];
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) return [];
  const pending = readQueue().filter((row) => row.user_id === userId && row.card_id === cardId
    && row.template_id === templateId);
  let remote: ReviewCorrection[] = [];
  if (typeof navigator === "undefined" || navigator.onLine) {
    let query = supabase.from("heuresis_review_corrections")
      .select("id,card_id,template_id,grade,attempt,reference_answer,explanation,created_at")
      .eq("card_id", cardId);
    query = templateId ? query.eq("template_id", templateId) : query.is("template_id", null);
    const { data, error } = await query.order("created_at", { ascending: false }).limit(200);
    if (error && !pending.length) throw error;
    if (!error) remote = (data ?? []) as ReviewCorrection[];
  }
  const byId = new Map<string, ReviewCorrection>();
  for (const row of [...remote, ...pending]) byId.set(row.id, row);
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// A queued correction must reach Supabase even if the user never opens Review again.
if (typeof window !== "undefined") {
  const sync = () => { void flushReviewCorrections().catch(() => undefined); };
  window.addEventListener("online", sync);
  window.addEventListener("focus", sync);
  void Promise.resolve().then(sync);
}
