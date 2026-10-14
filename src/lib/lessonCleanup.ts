import type { KnowledgeEntry, KnowledgeTopic } from "./knowledgeWorkspace";

/**
 * A capture is still waiting to be filed when it remains in the lesson's
 * original topic, or any capture sits directly in the language Inbox.
 * Changing category alone never quietly removes a capture from this queue.
 */
export type CleanupTarget = { kind: "lesson" | "inbox"; id: string };

export function isInboxTopic(topic: Pick<KnowledgeTopic, "name" | "parent_id"> | null | undefined) {
  return Boolean(topic && topic.parent_id === null && topic.name.trim().toLocaleLowerCase() === "inbox");
}

export function cleanupCandidates(
  target: CleanupTarget, entries: KnowledgeEntry[], topics: KnowledgeTopic[],
): KnowledgeEntry[] {
  const lesson = target.kind === "lesson" ? entries.find((entry) => entry.id === target.id && entry.kind === "lesson") : null;
  const inbox = target.kind === "inbox" ? topics.find((topic) => topic.id === target.id) : null;
  if (target.kind === "lesson" && !lesson) return [];
  if (target.kind === "inbox" && !isInboxTopic(inbox)) return [];
  return entries.filter((entry) => {
    if (entry.kind === "lesson") return false;
    return target.kind === "lesson"
      ? entry.lesson_id === lesson!.id && entry.topic_id === lesson!.topic_id
      : entry.topic_id === target.id;
  }).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
}

/** Deterministic, editable initial draft. Originals are never deleted on merge. */
export function mergedCaptureText(entries: KnowledgeEntry[]) {
  return entries.map((entry) => {
    const heading = entry.title.trim() ? `**${entry.title.trim()}**\n` : "";
    const text = entry.kind === "mistake"
      ? [entry.attempt, entry.correction].filter(Boolean).join(" → ")
      : entry.body.trim();
    return `${heading}${text}`.trim();
  }).filter(Boolean).join("\n\n");
}
