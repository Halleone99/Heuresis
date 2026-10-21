import type { KnowledgeEntry } from "./knowledgeWorkspace";

export type QuickQueueKind = "raw" | "note" | "flashcard" | "mistake";
const PREFIX = "heuresis:q:v1:";
export function quickQueueDescription(kind: QuickQueueKind): string { return PREFIX + kind; }
export function quickQueueKind(entry: KnowledgeEntry): QuickQueueKind | null {
  const value = entry.description?.startsWith(PREFIX) ? entry.description.slice(PREFIX.length) : "";
  return value === "raw" || value === "note" || value === "flashcard" || value === "mistake" ? value : null;
}
export function quickQueueBody(kind: QuickQueueKind, data: { text: string; front: string; back: string; wrong: string; correct: string }): string {
  if (kind === "flashcard") return "Front: " + data.front.trim() + "\nBack: " + data.back.trim();
  if (kind === "mistake") return "Mistake: " + data.wrong.trim() + "\nCorrection: " + data.correct.trim();
  return data.text.trim();
}
export function quickQueuePair(kind: QuickQueueKind, body: string): [string, string] {
  const labelA = kind === "flashcard" ? "Front: " : "Mistake: ";
  const labelB = kind === "flashcard" ? "\nBack: " : "\nCorrection: ";
  const match = body.startsWith(labelA) ? body.slice(labelA.length) : body;
  const split = match.indexOf(labelB);
  return split < 0 ? [match, ""] : [match.slice(0, split), match.slice(split + labelB.length)];
}
