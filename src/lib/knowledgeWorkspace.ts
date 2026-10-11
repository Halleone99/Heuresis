import { supabase } from "./supabase";

// Canonical Knowledge tables are shared with Personal OS. Keep a single
// source of truth; the Heuresis UI never copies these entries into cards.
export type KnowledgeKind = "note" | "mistake";
export type MistakeStatus = "needs_practice" | "understood";
export type KnowledgeSubject = { id: string; user_id: string; name: string; created_at: string };
export type KnowledgeTopic = { id: string; user_id: string; subject_id: string; name: string; created_at: string };
export type KnowledgeEntry = {
  id: string; user_id: string; topic_id: string; kind: KnowledgeKind;
  title: string; body: string; attempt: string; correction: string;
  explanation: string; status: MistakeStatus | null;
  created_at: string; updated_at: string;
};
export type KnowledgeSnapshot = {
  subjects: KnowledgeSubject[]; topics: KnowledgeTopic[]; entries: KnowledgeEntry[];
};
export type KnowledgeDraft = {
  topicId: string; kind: KnowledgeKind; title: string; body: string;
  attempt: string; correction: string; explanation: string;
};
const PAGE_SIZE = 500;
function db() {
  if (!supabase) throw new Error("Sign in to use the Knowledge workspace.");
  return supabase;
}
async function allRows(table: "knowledge_subjects" | "knowledge_topics" | "knowledge_entries", userId: string) {
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await db().from(table).select("*")
      .eq("user_id", userId).order("created_at", { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
  }
  return rows;
}
export async function loadKnowledge(userId: string): Promise<KnowledgeSnapshot> {
  if (!userId) throw new Error("A signed-in account is required.");
  const [subjects, topics, entries] = await Promise.all([
    allRows("knowledge_subjects", userId),
    allRows("knowledge_topics", userId),
    allRows("knowledge_entries", userId),
  ]);
  return {
    subjects: subjects as KnowledgeSubject[],
    topics: topics as KnowledgeTopic[],
    entries: entries as KnowledgeEntry[],
  };
}
function name(value: string) {
  const clean = value.trim();
  if (!clean || clean.length > 120) throw new Error("Name must be between 1 and 120 characters.");
  return clean;
}
export async function createKnowledgeSubject(userId: string, rawName: string) {
  const { data, error } = await db().from("knowledge_subjects")
    .insert({ id: crypto.randomUUID(), user_id: userId, name: name(rawName) })
    .select("*").single();
  if (error) throw error;
  return data as KnowledgeSubject;
}
export async function createKnowledgeTopic(userId: string, subjectId: string, rawName: string) {
  const { data, error } = await db().from("knowledge_topics")
    .insert({ id: crypto.randomUUID(), user_id: userId, subject_id: subjectId, name: name(rawName) })
    .select("*").single();
  if (error) throw error;
  return data as KnowledgeTopic;
}
export async function saveKnowledgeEntry(userId: string, draft: KnowledgeDraft, existingId?: string): Promise<void> {
  const title = draft.title.trim();
  if (title.length > 200) throw new Error("Title must be 200 characters or fewer.");
  if (!draft.topicId) throw new Error("Choose a topic first.");
  if (draft.kind === "note" && !draft.body.trim()) throw new Error("Write something to capture.");
  if (draft.kind === "mistake" && (!draft.attempt.trim() || !draft.correction.trim())) {
    throw new Error("A mistake needs both an attempt and its correction.");
  }
  const fields = {
    topic_id: draft.topicId, title,
    body: draft.kind === "note" ? draft.body.trim() : "",
    attempt: draft.kind === "mistake" ? draft.attempt.trim() : "",
    correction: draft.kind === "mistake" ? draft.correction.trim() : "",
    explanation: draft.kind === "mistake" ? draft.explanation.trim() : "",
  };
  if (existingId) {
    // 'kind' cannot change on edit: database deliberately protects identity.
    const { error } = await db().from("knowledge_entries")
      .update(fields).eq("id", existingId).eq("user_id", userId);
    if (error) throw error;
  } else {
    const { error } = await db().from("knowledge_entries").insert({
      id: crypto.randomUUID(), user_id: userId, kind: draft.kind,
      status: draft.kind === "mistake" ? "needs_practice" : null, ...fields,
    });
    if (error) throw error;
  }
}
export async function setKnowledgeMistakeStatus(userId: string, id: string, status: MistakeStatus) {
  const { error } = await db().from("knowledge_entries")
    .update({ status }).eq("id", id).eq("user_id", userId).eq("kind", "mistake");
  if (error) throw error;
}
export async function deleteKnowledgeEntry(userId: string, id: string) {
  const { error } = await db().from("knowledge_entries")
    .delete().eq("id", id).eq("user_id", userId);
  if (error) throw error;
}
export function knowledgeSearchText(entry: KnowledgeEntry, topic?: KnowledgeTopic, subject?: KnowledgeSubject) {
  return [entry.title, entry.body, entry.attempt, entry.correction,
    entry.explanation, topic?.name ?? "", subject?.name ?? ""].join(" ").normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
}
