import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createEntry, createSubject, createTopic, deleteEntry, deleteSubject, deleteTopic, EMPTY_SNAPSHOT,
  entryTitle, friendlyError, isLesson, loadKnowledge, recordPractice, renameSubject, restoreEntry,
  updateEntry, updateTopic,
  type EntryInput, type EntryPatch, type KnowledgeEntry, type KnowledgeSnapshot, type KnowledgeSubject,
  type KnowledgeTopic, type PracticeOutcome, type SchemaLevel,
} from "../../lib/knowledgeWorkspace";
import { flushOfflineRequests, getOfflineSyncState, subscribeOfflineSync } from "../../lib/offlineFetch";
import { supabase } from "../../lib/supabase";
import {
  pushRecent, readCaptureDraft, readMemory, readPendingCaptures, writeCaptureDraft, writeMemory, writePendingCaptures,
  type WorkspaceMemory, type WorkspaceSection,
} from "../../lib/workspaceMemory";

export type CaptureMode = "note" | "mistake" | "lesson";
export type CaptureRequest = { mode: CaptureMode; topicId?: string | null; lessonId?: string | null; text?: string };
export type Toast = { id: number; message: string; tone?: "default" | "error"; action?: { label: string; run: () => void } };
export type TopicPath = { subject: KnowledgeSubject | null; chain: KnowledgeTopic[] };

type WorkspaceValue = {
  userId: string;
  snapshot: KnowledgeSnapshot;
  schema: SchemaLevel;
  writable: boolean;
  loading: boolean;
  error: string;
  reload: (silent?: boolean) => Promise<void>;
  subjectById: Map<string, KnowledgeSubject>;
  topicById: Map<string, KnowledgeTopic>;
  entryById: Map<string, KnowledgeEntry>;
  childrenOf: (parentId: string | null, subjectId: string) => KnowledgeTopic[];
  topicPath: (topicId: string | null | undefined) => TopicPath;
  pathLabel: (topicId: string | null | undefined, separator?: string) => string;
  subtreeIds: (topicId: string) => string[];
  // mutations — each updates the shared snapshot only after the write succeeds
  addSubject: (name: string) => Promise<KnowledgeSubject>;
  renameSubjectById: (id: string, name: string) => Promise<void>;
  removeSubject: (id: string) => Promise<void>;
  addTopic: (subjectId: string, name: string, parentId?: string | null) => Promise<KnowledgeTopic>;
  changeTopic: (id: string, patch: { name?: string; parent_id?: string | null }) => Promise<void>;
  removeTopic: (id: string) => Promise<void>;
  ensureInbox: (subjectId: string) => Promise<KnowledgeTopic>;
  addEntry: (input: EntryInput) => Promise<KnowledgeEntry>;
  /** Quick-capture save: survives slow networks and restarts, never stores twice. */
  submitCapture: (input: EntryInput, label: string) => Promise<KnowledgeEntry | null>;
  patchEntry: (id: string, patch: EntryPatch) => Promise<KnowledgeEntry>;
  removeEntry: (id: string, options?: { undo?: boolean }) => Promise<void>;
  practise: (id: string, outcome: PracticeOutcome, answer: string) => Promise<KnowledgeEntry>;
  // device-local context
  memory: WorkspaceMemory;
  updateMemory: (update: (current: WorkspaceMemory) => WorkspaceMemory) => void;
  // navigation across the five sections
  section: WorkspaceSection;
  goTo: (section: WorkspaceSection) => void;
  openDocument: (id: string, options?: { edit?: boolean }) => void;
  openTopic: (topicId: string) => void;
  openMistake: (id: string, options?: { practise?: boolean; ids?: string[] }) => void;
  pendingEditId: string | null;
  consumePendingEdit: (id: string) => boolean;
  focusMistake: { id: string; practise: boolean; ids?: string[] } | null;
  clearFocusMistake: () => void;
  // capture + feedback
  capture: CaptureRequest | null;
  openCapture: (request: CaptureRequest) => void;
  closeCapture: () => void;
  startLesson: (lessonId: string) => void;
  endLesson: () => void;
  currentLesson: KnowledgeEntry | null;
  toasts: Toast[];
  toast: (message: string, options?: Omit<Toast, "id" | "message">) => void;
  dismissToast: (id: number) => void;
};

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used inside WorkspaceProvider");
  return value;
}

type ProviderProps = {
  userId: string;
  section: WorkspaceSection;
  onSection: (section: WorkspaceSection) => void;
  children: ReactNode;
};

export function WorkspaceProvider({ userId, section, onSection, children }: ProviderProps) {
  const [snapshot, setSnapshotState] = useState<KnowledgeSnapshot>(EMPTY_SNAPSHOT);
  // Mutations read and write through this ref so rapid successive saves never
  // apply a patch on top of a stale copy of the snapshot.
  const snapshotRef = useRef<KnowledgeSnapshot>(EMPTY_SNAPSHOT);
  const setSnapshot = useCallback((next: KnowledgeSnapshot | ((current: KnowledgeSnapshot) => KnowledgeSnapshot)) => {
    snapshotRef.current = typeof next === "function" ? next(snapshotRef.current) : next;
    setSnapshotState(snapshotRef.current);
  }, []);
  const [schema, setSchema] = useState<SchemaLevel>("v2");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memory, setMemory] = useState<WorkspaceMemory>(() => readMemory(userId));
  const [capture, setCapture] = useState<CaptureRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [focusMistake, setFocusMistake] = useState<{ id: string; practise: boolean; ids?: string[] } | null>(null);
  const toastId = useRef(0);
  const lastLoad = useRef(0);
  const loadingRef = useRef(false);

  useEffect(() => { writeMemory(userId, memory); }, [memory, userId]);

  const reload = useCallback(async (silent = false) => {
    if (loadingRef.current) return;
    const sync = getOfflineSyncState();
    // While offline writes are still queued, the server copy is older than the
    // local one; a background refresh would make fresh captures vanish briefly.
    if (silent && sync.online && sync.pending > 0) return;
    loadingRef.current = true;
    if (!silent) setLoading(true);
    try {
      if (sync.online && sync.pending > 0 && supabase) {
        const { data } = await supabase.auth.getSession();
        await flushOfflineRequests(data.session?.access_token).catch(() => undefined);
      }
      const result = await loadKnowledge(userId);
      setSnapshot(result.snapshot);
      setSchema(result.schema);
      setError("");
      lastLoad.current = Date.now();
    } catch (loadError) {
      if (!silent) setError(friendlyError(loadError));
    } finally {
      loadingRef.current = false;
      if (!silent) setLoading(false);
    }
  }, [setSnapshot, userId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const refresh = () => { if (Date.now() - lastLoad.current > 60_000) void reload(true); };
    window.addEventListener("focus", refresh);
    // After Heuresis has replayed queued offline writes, pick up the server's view.
    let wasSyncing = getOfflineSyncState().syncing;
    const unsubscribe = subscribeOfflineSync((state) => {
      if (wasSyncing && !state.syncing && !state.error) void reload(true);
      wasSyncing = state.syncing;
    });
    return () => { window.removeEventListener("focus", refresh); unsubscribe(); };
  }, [reload]);

  const subjectById = useMemo(() => new Map(snapshot.subjects.map((row) => [row.id, row])), [snapshot.subjects]);
  const topicById = useMemo(() => new Map(snapshot.topics.map((row) => [row.id, row])), [snapshot.topics]);
  const entryById = useMemo(() => new Map(snapshot.entries.map((row) => [row.id, row])), [snapshot.entries]);

  const childrenOf = useCallback((parentId: string | null, subjectId: string) => snapshot.topics
    .filter((topic) => topic.subject_id === subjectId && (topic.parent_id ?? null) === parentId)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })), [snapshot.topics]);

  const topicPath = useCallback((topicId: string | null | undefined): TopicPath => {
    const chain: KnowledgeTopic[] = [];
    let cursor = topicId ? topicById.get(topicId) : undefined;
    const seen = new Set<string>();
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chain.unshift(cursor);
      cursor = cursor.parent_id ? topicById.get(cursor.parent_id) : undefined;
    }
    const subject = chain[0] ? subjectById.get(chain[0].subject_id) ?? null : null;
    return { subject, chain };
  }, [subjectById, topicById]);

  const pathLabel = useCallback((topicId: string | null | undefined, separator = " › ") => {
    const { subject, chain } = topicPath(topicId);
    return [subject?.name, ...chain.map((topic) => topic.name)].filter(Boolean).join(separator);
  }, [topicPath]);

  const subtreeIds = useCallback((topicId: string) => {
    const result = [topicId];
    for (let index = 0; index < result.length; index += 1) {
      for (const topic of snapshot.topics) if (topic.parent_id === result[index]) result.push(topic.id);
    }
    return result;
  }, [snapshot.topics]);

  const toast = useCallback((message: string, options: Omit<Toast, "id" | "message"> = {}) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current.slice(-2), { id, message, ...options }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), options.action ? 7000 : 3800);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  const updateMemory = useCallback((update: (current: WorkspaceMemory) => WorkspaceMemory) => setMemory((current) => update(current)), []);

  const addSubject = useCallback(async (name: string) => {
    const created = await createSubject(userId, name);
    setSnapshot((current) => ({ ...current, subjects: [...current.subjects, created] }));
    return created;
  }, [setSnapshot, userId]);
  const renameSubjectById = useCallback(async (id: string, name: string) => {
    const clean = await renameSubject(userId, id, name);
    setSnapshot((current) => ({ ...current, subjects: current.subjects.map((row) => row.id === id ? { ...row, name: clean } : row) }));
  }, [setSnapshot, userId]);
  const removeSubject = useCallback(async (id: string) => {
    await deleteSubject(userId, id);
    setSnapshot((current) => {
      const topicIds = new Set(current.topics.filter((topic) => topic.subject_id === id).map((topic) => topic.id));
      return {
        ...current,
        subjects: current.subjects.filter((row) => row.id !== id),
        topics: current.topics.filter((row) => !topicIds.has(row.id)),
        entries: current.entries.filter((row) => !topicIds.has(row.topic_id)),
      };
    });
  }, [setSnapshot, userId]);
  const addTopic = useCallback(async (subjectId: string, name: string, parentId: string | null = null) => {
    const created = await createTopic(userId, subjectId, name, parentId);
    setSnapshot((current) => ({ ...current, topics: [...current.topics, created] }));
    return created;
  }, [setSnapshot, userId]);
  const changeTopic = useCallback(async (id: string, patch: { name?: string; parent_id?: string | null }) => {
    const clean = await updateTopic(userId, id, patch);
    setSnapshot((current) => ({ ...current, topics: current.topics.map((row) => row.id === id ? { ...row, ...clean } : row) }));
  }, [setSnapshot, userId]);
  const removeTopic = useCallback(async (id: string) => {
    await deleteTopic(userId, id);
    setSnapshot((current) => ({ ...current, topics: current.topics.filter((row) => row.id !== id) }));
  }, [setSnapshot, userId]);
  const ensureInbox = useCallback(async (subjectId: string) => {
    const existing = snapshotRef.current.topics.find((topic) => topic.subject_id === subjectId && !topic.parent_id && topic.name.toLowerCase() === "inbox");
    if (existing) return existing;
    return addTopic(subjectId, "Inbox", null);
  }, [addTopic]);

  const addEntry = useCallback(async (input: EntryInput) => {
    const created = await createEntry(userId, input);
    setSnapshot((current) => ({ ...current, entries: [created, ...current.entries.filter((row) => row.id !== created.id)] }));
    return created;
  }, [setSnapshot, userId]);

  const dropPending = useCallback((id: string) => {
    writePendingCaptures(userId, readPendingCaptures(userId).filter((item) => item.input.id !== id));
  }, [userId]);

  const submitCapture = useCallback(async (input: EntryInput, label: string) => {
    const id = input.id ?? crypto.randomUUID();
    const full = { ...input, id };
    writePendingCaptures(userId, [...readPendingCaptures(userId).filter((item) => item.input.id !== id), { input: full, label, submittedAt: new Date().toISOString() }]);
    const slow = window.setTimeout(() => toast("Still saving — your capture is kept on this device until it is stored."), 1800);
    try {
      const created = await addEntry(full);
      dropPending(id);
      return created;
    } catch (saveError) {
      const code = (saveError as { code?: string })?.code;
      if (code) {
        // The server rejected it (e.g. its topic was deleted elsewhere): retrying cannot help,
        // so hand the text back to the capture panel instead of losing it.
        dropPending(id);
        if (!readCaptureDraft(userId)) writeCaptureDraft(userId, {
          mode: input.kind, text: input.body ?? "", category: input.category ?? "note", categoryTouched: true,
          attempt: input.attempt ?? "", correction: input.correction ?? "", explanation: input.explanation ?? "",
          lessonTitle: input.kind === "lesson" ? input.title ?? "" : "", updatedAt: new Date().toISOString(),
        });
        toast(`Could not save “${label}”: ${friendlyError(saveError)} Your text is back in Quick capture.`, { tone: "error" });
      } else {
        toast(`Could not reach the server — “${label}” is kept on this device and will be retried.`, { tone: "error" });
      }
      return null;
    } finally {
      window.clearTimeout(slow);
    }
  }, [addEntry, dropPending, toast, userId]);

  // Retry captures that were submitted but never confirmed (app closed, network hung).
  const retriedPending = useRef(false);
  useEffect(() => {
    if (loading || error || retriedPending.current || schema !== "v2") return;
    retriedPending.current = true;
    const pending = readPendingCaptures(userId);
    if (!pending.length) return;
    void (async () => {
      let restored = 0;
      for (const item of pending) {
        if (snapshotRef.current.entries.some((row) => row.id === item.input.id)) { dropPending(item.input.id); continue; }
        try { await addEntry(item.input); dropPending(item.input.id); restored += 1; }
        catch { /* stays pending for the next launch */ }
      }
      if (restored) toast(`${restored} earlier ${restored === 1 ? "capture was" : "captures were"} saved.`);
    })();
  }, [addEntry, dropPending, error, loading, schema, toast, userId]);
  const patchEntry = useCallback(async (id: string, patch: EntryPatch) => {
    const current = snapshotRef.current.entries.find((row) => row.id === id);
    if (!current) throw new Error("This entry no longer exists. It may have been deleted on another device.");
    const next = await updateEntry(userId, current, patch);
    const changed = Object.fromEntries(Object.keys(patch).map((key) => [key, next[key as keyof KnowledgeEntry]]));
    setSnapshot((value) => ({ ...value, entries: value.entries.map((row) => row.id === id ? { ...row, ...changed, updated_at: next.updated_at } : row) }));
    return snapshotRef.current.entries.find((row) => row.id === id) ?? next;
  }, [setSnapshot, userId]);
  const removeEntry = useCallback(async (id: string, options: { undo?: boolean } = {}) => {
    const existing = snapshotRef.current.entries.find((row) => row.id === id);
    await deleteEntry(userId, id);
    setSnapshot((current) => ({
      ...current,
      entries: current.entries.filter((row) => row.id !== id).map((row) => row.lesson_id === id ? { ...row, lesson_id: null } : row),
      practice: current.practice.filter((row) => row.record_id !== id),
    }));
    if (existing && options.undo !== false) {
      toast(`Deleted “${entryTitle(existing).slice(0, 48)}”.`, {
        action: {
          label: "Undo",
          run: () => {
            void restoreEntry(existing).then(() => {
              setSnapshot((current) => ({ ...current, entries: [existing, ...current.entries.filter((row) => row.id !== existing.id)] }));
              toast("Restored.");
            }).catch((restoreError) => toast(friendlyError(restoreError), { tone: "error" }));
          },
        },
      });
    }
  }, [setSnapshot, toast, userId]);
  const practise = useCallback(async (id: string, outcome: PracticeOutcome, answer: string) => {
    const current = snapshotRef.current.entries.find((row) => row.id === id);
    if (!current) throw new Error("This mistake no longer exists.");
    const result = await recordPractice(userId, current, outcome, answer);
    setSnapshot((value) => ({
      ...value,
      entries: value.entries.map((row) => row.id === id ? result.entry : row),
      practice: [result.event, ...value.practice],
    }));
    return result.entry;
  }, [setSnapshot, userId]);

  const goTo = useCallback((next: WorkspaceSection) => onSection(next), [onSection]);
  const openDocument = useCallback((id: string, options: { edit?: boolean } = {}) => {
    const entry = snapshotRef.current.entries.find((row) => row.id === id);
    setMemory((current) => ({
      ...current,
      notebook: { ...current.notebook, docId: id, topicId: entry?.topic_id ?? current.notebook.topicId, subjectId: null },
      recentDocs: pushRecent(current.recentDocs, id),
    }));
    if (options.edit) setPendingEditId(id);
    onSection("notebook");
  }, [onSection]);
  const consumePendingEdit = useCallback((id: string) => {
    if (pendingEditId !== id) return false;
    setPendingEditId(null);
    return true;
  }, [pendingEditId]);
  const openTopic = useCallback((topicId: string) => {
    setMemory((current) => ({ ...current, notebook: { ...current.notebook, topicId, docId: null, subjectId: null } }));
    onSection("notebook");
  }, [onSection]);
  const openMistake = useCallback((id: string, options: { practise?: boolean; ids?: string[] } = {}) => {
    setFocusMistake({ id, practise: Boolean(options.practise), ids: options.ids });
    onSection("mistakes");
  }, [onSection]);
  const clearFocusMistake = useCallback(() => setFocusMistake(null), []);

  const openCapture = useCallback((request: CaptureRequest) => setCapture({ ...request }), []);
  const closeCapture = useCallback(() => setCapture(null), []);
  const startLesson = useCallback((lessonId: string) => {
    setMemory((current) => ({ ...current, currentLesson: { id: lessonId, startedAt: new Date().toISOString() }, capture: { ...current.capture, attachToLesson: true } }));
  }, []);
  const endLesson = useCallback(() => setMemory((current) => ({ ...current, currentLesson: null })), []);
  const currentLesson = useMemo(() => {
    const id = memory.currentLesson?.id;
    const entry = id ? entryById.get(id) : undefined;
    return entry && isLesson(entry) && entry.kind === "lesson" ? entry : null;
  }, [entryById, memory.currentLesson?.id]);

  const value: WorkspaceValue = {
    userId, snapshot, schema, writable: schema === "v2", loading, error, reload,
    subjectById, topicById, entryById, childrenOf, topicPath, pathLabel, subtreeIds,
    addSubject, renameSubjectById, removeSubject, addTopic, changeTopic, removeTopic, ensureInbox,
    addEntry, submitCapture, patchEntry, removeEntry, practise,
    memory, updateMemory,
    section, goTo, openDocument, openTopic, openMistake, pendingEditId, consumePendingEdit, focusMistake, clearFocusMistake,
    capture, openCapture, closeCapture, startLesson, endLesson, currentLesson,
    toasts, toast, dismissToast,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
