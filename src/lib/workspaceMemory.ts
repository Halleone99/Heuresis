/**
 * Device-local working context for the learning workspace, scoped per account.
 * This is convenience state only (where you were, what you were drafting); the
 * database stays the single source of truth for notes, lessons and mistakes.
 */
import type { KnowledgeKind, NoteCategory } from "./knowledgeWorkspace";

export type WorkspaceSection = "overview" | "study" | "notebook" | "mistakes" | "progress" | "reading" | "quotations" | "reference" | "queue";
export type ThemePreference = "system" | "light" | "dark";

export type NotebookLocation = { topicId: string | null; docId: string | null; subjectId?: string | null };
export type CurrentLesson = { id: string; startedAt: string };
export type CaptureDraft = {
  mode: Exclude<KnowledgeKind, "lesson"> | "lesson";
  text: string; category: NoteCategory | null; categoryTouched: boolean; mistakeModeId?: string | null;
  /** Editable vector strokes from the Quick Capture handwriting pad. */
  handStrokes?: import("./handNote").HandStroke[];
  attempt: string; correction: string; explanation: string;
  lessonTitle: string; updatedAt: string;
  /** Stable identity of a capture awaiting confirmation; prevents duplicate retries. */
  pendingId?: string;
};
export type DocumentDraft = { title: string; body: string; savedAt: string; baseUpdatedAt: string };

export type WorkspaceMemory = {
  notebook: NotebookLocation & { railCollapsed: boolean; expanded: string[]; filter: "all" | "lessons" | "notes" | "questions" };
  recentDocs: string[];
  currentLesson: CurrentLesson | null;
  capture: { topicId: string | null; subjectId?: string | null; keepOpen: boolean; attachToLesson: boolean; stream?: boolean };
  mistakes: { subjectId: string | null; topicId: string | null };
  study: { view: string | null; packId: string | null };
  progress: { range: 8 | 12 | 26 };
};

const SECTION_KEY = "heuresis.workspace.section.v1";
const THEME_KEY = "heuresis.theme.v1";
const memoryKey = (userId: string) => `heuresis.workspace.memory.v2:${userId}`;
export type CaptureDraftSurface = "inline" | "floating";
const captureDraftKey = (userId: string, surface: CaptureDraftSurface = "inline") =>
  `heuresis.capture.draft.v2:${userId}${surface === "floating" ? ":floating" : ""}`;
const docDraftKey = (userId: string, id: string) => `heuresis.doc.draft.v2:${userId}:${id}`;
const LESSON_TTL_MS = 10 * 60 * 60 * 1000;

const DEFAULT_MEMORY: WorkspaceMemory = {
  notebook: { topicId: null, docId: null, subjectId: null, railCollapsed: false, expanded: [], filter: "all" },
  recentDocs: [],
  currentLesson: null,
  capture: { topicId: null, subjectId: null, keepOpen: false, attachToLesson: true, stream: false },
  mistakes: { subjectId: null, topicId: null },
  study: { view: null, packId: null },
  progress: { range: 12 },
};

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : null;
  } catch { return null; }
}
function write(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch { /* storage may be unavailable; the app still works */ }
}

export function readSection(): WorkspaceSection {
  try {
    const stored = localStorage.getItem(SECTION_KEY);
    if (stored === "quotations") return "reading"; // legacy Quotations destination is now inside Reading
    return stored === "study" || stored === "notebook" || stored === "mistakes" || stored === "overview" || stored === "reading" || stored === "quotations" || stored === "reference" || stored === "queue" ? stored : "overview";
  } catch { return "overview"; }
}
export function writeSection(section: WorkspaceSection) {
  try { localStorage.setItem(SECTION_KEY, section); } catch { /* optional */ }
}

export function readTheme(): ThemePreference {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch { return "system"; }
}
export function writeTheme(theme: ThemePreference) {
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* optional */ }
}

export function readMemory(userId: string): WorkspaceMemory {
  const stored = read<Partial<WorkspaceMemory>>(memoryKey(userId)) ?? {};
  // Migrate the v1 Notebook keys once so a relaunch reopens the same place.
  if (!stored.notebook) {
    try {
      const topicId = localStorage.getItem("heuresis.knowledge.currentTopic.v1");
      const docId = localStorage.getItem(`heuresis.knowledge.openNote.v1:${userId}`);
      if (topicId || docId) stored.notebook = { ...DEFAULT_MEMORY.notebook, topicId, docId };
    } catch { /* optional */ }
  }
  const memory: WorkspaceMemory = {
    notebook: { ...DEFAULT_MEMORY.notebook, ...(stored.notebook ?? {}) },
    recentDocs: Array.isArray(stored.recentDocs) ? stored.recentDocs.filter((id) => typeof id === "string").slice(0, 12) : [],
    currentLesson: stored.currentLesson ?? null,
    capture: { ...DEFAULT_MEMORY.capture, ...(stored.capture ?? {}) },
    mistakes: { subjectId: stored.mistakes?.subjectId ?? null, topicId: stored.mistakes?.topicId ?? null },
    study: { ...DEFAULT_MEMORY.study, ...(stored.study ?? {}) },
    progress: { range: stored.progress?.range === 8 || stored.progress?.range === 26 ? stored.progress.range : 12 },
  };
  if (memory.currentLesson && Date.now() - new Date(memory.currentLesson.startedAt).getTime() > LESSON_TTL_MS) memory.currentLesson = null;
  return memory;
}
export function writeMemory(userId: string, memory: WorkspaceMemory) {
  write(memoryKey(userId), memory);
}
export function pushRecent(list: string[], id: string) {
  return [id, ...list.filter((item) => item !== id)].slice(0, 12);
}

export function readCaptureDraft(userId: string, surface: CaptureDraftSurface = "inline"): CaptureDraft | null {
  return read<CaptureDraft>(captureDraftKey(userId, surface));
}
export function writeCaptureDraft(userId: string, draft: CaptureDraft | null, surface: CaptureDraftSurface = "inline") {
  write(captureDraftKey(userId, surface), draft);
}
export function captureDraftHasContent(draft: CaptureDraft | null) {
  if (!draft) return false;
  return Boolean(draft.text.trim() || draft.handStrokes?.length || draft.attempt.trim() || draft.correction.trim() || draft.explanation.trim());
}

export function readDocumentDraft(userId: string, id: string) {
  return read<DocumentDraft>(docDraftKey(userId, id));
}
export function writeDocumentDraft(userId: string, id: string, draft: DocumentDraft | null) {
  write(docDraftKey(userId, id), draft);
}

/**
 * Captures that were submitted but not yet confirmed by the database. They are
 * retried with the same id (so they can never be stored twice) until they land.
 */
export type PendingCapture = { input: import("./knowledgeWorkspace").EntryInput & { id: string }; label: string; submittedAt: string };
const pendingKey = (userId: string) => `heuresis.capture.pending.v1:${userId}`;
export function readPendingCaptures(userId: string): PendingCapture[] {
  const list = read<PendingCapture[]>(pendingKey(userId));
  return Array.isArray(list) ? list.filter((item) => item?.input?.id) : [];
}
export function writePendingCaptures(userId: string, list: PendingCapture[]) {
  write(pendingKey(userId), list.length ? list : null);
}
