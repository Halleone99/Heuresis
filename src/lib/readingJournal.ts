/**
 * Lightweight annotations stored in the existing Reading book notes field.
 * The marker is intentionally separate from the human-readable notes and
 * Personal OS's shelf, progress, and reading-time markers.
 */
export type JournalKind = "interesting" | "question" | "reflection";

export type JournalEntry = {
  id: string;
  kind: JournalKind;
  text: string;
  reference: string;
  explanation: string;
  createdAt: string;
  updatedAt: string;
};

export type JournalDraft = Pick<JournalEntry, "kind" | "text" | "reference" | "explanation">;

const MARKER = /<!--reading-journal:([\s\S]*?)-->/i;
const ALLOWED = new Set<JournalKind>(["interesting", "question", "reflection"]);

export function readJournalNotes(notes: string): JournalEntry[] {
  const match = notes.match(MARKER);
  if (!match) return [];
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(match[1]));
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((value): value is JournalEntry => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return false;
      const row = value as Record<string, unknown>;
      return typeof row.id === "string" && row.id.length > 0
        && ALLOWED.has(row.kind as JournalKind)
        && typeof row.text === "string" && row.text.trim().length > 0
        && typeof row.createdAt === "string";
    }).map((entry) => ({
      id: entry.id, kind: entry.kind, text: entry.text,
      reference: typeof entry.reference === "string" ? entry.reference : "",
      explanation: typeof entry.explanation === "string" ? entry.explanation : "",
      createdAt: entry.createdAt,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : entry.createdAt,
    }));
  } catch {
    return [];
  }
}

function withJournal(notes: string, entries: JournalEntry[]): string {
  // Preserve all unrelated metadata and plain text, even when the journal is empty.
  if (!entries.length) return notes.replace(MARKER, "").trim();
  const marker = "<!--reading-journal:" + encodeURIComponent(JSON.stringify(entries)) + "-->";
  return MARKER.test(notes) ? notes.replace(MARKER, marker)
    : [marker, notes].filter(Boolean).join("\n");
}

export function saveEntryToNotes(notes: string, draft: JournalDraft, id?: string, newId?: string): string {
  if (!ALLOWED.has(draft.kind)) throw new Error("Choose a valid entry type.");
  const text = draft.text.trim();
  if (!text) throw new Error("Write something before saving.");
  if (text.length > 10000) throw new Error("An entry cannot exceed 10,000 characters.");
  const entries = readJournalNotes(notes);
  const now = new Date().toISOString();
  const existing = id ? entries.find((entry) => entry.id === id) : undefined;
  if (id && !existing) throw new Error("That reading entry has changed or was deleted. Reopen the book.");
  if (!id && entries.length >= 500) throw new Error("This book already has 500 reading entries.");
  const next: JournalEntry = {
    id: existing?.id ?? newId ?? crypto.randomUUID(),
    kind: draft.kind, text,
    reference: draft.reference.trim().slice(0, 250),
    explanation: draft.kind === "question" ? draft.explanation.trim().slice(0, 10000) : "",
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  return withJournal(notes, existing
    ? entries.map((entry) => entry.id === existing.id ? next : entry)
    : [next, ...entries]);
}

export function removeEntryFromNotes(notes: string, id: string): string {
  const entries = readJournalNotes(notes);
  if (!entries.some((entry) => entry.id === id)) throw new Error("This reading entry was already deleted.");
  return withJournal(notes, entries.filter((entry) => entry.id !== id));
}
