import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  createEntry, createSubject, createTopic, deleteEntry, deleteSubject, deleteTopic, EMPTY_SNAPSHOT,
  entryTitle, friendlyError, isLesson, loadKnowledge, recordPractice, renameSubject, restoreEntry,
  updateEntry, updateTopic,
  type EntryInput, type EntryPatch, type KnowledgeEntry, type KnowledgeSnapshot, type KnowledgeSubject, type NoteCategory,
  type KnowledgeTopic, type PracticeOutcome, type SchemaLevel,
} from "../../lib/knowledgeWorkspace";
import { flushOfflineRequests, getOfflineSyncState, subscribeOfflineSync, subscribeReplayedRows } from "../../lib/offlineFetch";
import type { CleanupTarget } from "../../lib/lessonCleanup";
import { queueCaptureForReview } from "../../lib/captureReviewQueue";
import { signalWorkspaceChange, subscribeWorkspaceChanges } from "../../lib/workspaceSignal";
import { supabase } from "../../lib/supabase";
import {
  pushRecent, readCaptureDraft, readMemory, readPendingCaptures, writeCaptureDraft, writeMemory, writePendingCaptures,
  type CaptureDraftSurface, type WorkspaceMemory, type WorkspaceSection,
} from "../../lib/workspaceMemory";

export type CaptureMode = "note" | "mistake" | "lesson";
export type CaptureRequest = { mode: CaptureMode; topicId?: string | null; lessonId?: string | null; text?: string; category?: NoteCategory; mistakeModeId?: string | null };
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
  submitCapture: (input: EntryInput, label: string, surface?: CaptureDraftSurface) => Promise<KnowledgeEntry | null>;
  patchEntry: (id: string, patch: EntryPatch) => Promise<KnowledgeEntry>;
  removeEntry: (id: string, options?: { undo?: boolean }) => Promise<void>;
  practise: (id: string, outcome: PracticeOutcome, answer: string) => Promise<KnowledgeEntry>;
  // device-local context
  memory: WorkspaceMemory;
  updateMemory: (update: (current: WorkspaceMemory) => WorkspaceMemory) => void;
  // navigation across the five sections
  section: WorkspaceSection;
  goTo: (section: WorkspaceSection) => void;
  openDocument: (id: string, options?: { edit?: boolean; stayInSection?: boolean }) => void;
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
  cleanupTarget: CleanupTarget | null;
  openCleanup: (target: CleanupTarget) => void;
  closeCleanup: () => void;
  toasts: Toast[];
  toast: (message: string, options?: Omit<Toast, "id" | "message">) => void;
  dismissToast: (id: number) => void;
};

/**
 * The first server load combined with rows created on this device while it was
 * still downloading (for example a capture typed during start-up). Server rows
 * win for every id they contain; local-only rows are kept.
 */
export function mergeFirstLoad(remote: KnowledgeSnapshot, local: KnowledgeSnapshot): KnowledgeSnapshot {
  const keep = <T extends { id: string }>(server: T[], mine: T[]) => {
    const ids = new Set(server.map((row) => row.id));
    return [...mine.filter((row) => !ids.has(row.id)), ...server];
  };
  return {
    ...remote,
    subjects: keep(remote.subjects, local.subjects),
    topics: keep(remote.topics, local.topics),
    entries: keep(remote.entries, local.entries),
    practice: keep(remote.practice, local.practice),
  };
}

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
  // Ignore a remote refresh that began before a local write completed.
  const localWriteRevision = useRef(0);
  const setSnapshot = useCallback((next: KnowledgeSnapshot | ((current: KnowledgeSnapshot) => KnowledgeSnapshot)) => {
    if (typeof next === "function") localWriteRevision.current += 1;
    snapshotRef.current = typeof next === "function" ? next(snapshotRef.current) : next;
    setSnapshotState(snapshotRef.current);
  }, []);
  // Publish only local mutations, never full reloads: no cross-view loops.
  const setSnapshotLocal = useCallback((update: (current: KnowledgeSnapshot) => KnowledgeSnapshot) => {
    setSnapshot(update);
    signalWorkspaceChange(userId);
  }, [setSnapshot, userId]);
  const [schema, setSchema] = useState<SchemaLevel>("v2");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [memory, setMemory] = useState<WorkspaceMemory>(() => readMemory(userId));
  // Both the main app and native floating Capture webviews use one account-scoped
  // lesson/topic context. A cross-window change must not remain stale here.
  useEffect(() => {
    const key = `heuresis.workspace.memory.v2:${userId}`;
    const onStorage = (event: StorageEvent) => {
      if (event.key === key) setMemory(readMemory(userId));
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [userId]);
  const [capture, setCapture] = useState<CaptureRequest | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [focusMistake, setFocusMistake] = useState<{ id: string; practise: boolean; ids?: string[] } | null>(null);
  const toastId = useRef(0);
  const lastLoad = useRef(0);
  const loadingRef = useRef(false);
  // True once a complete snapshot has been shown. From then on a refresh never
  // blanks the visible Notebook: it replaces it only with a newer copy.
  const hasLoaded = useRef(false);
  const followUp = useRef<number | null>(null);
  useEffect(() => () => { if (followUp.current !== null) window.clearTimeout(followUp.current); }, []);

  useEffect(() => { writeMemory(userId, memory); }, [memory, userId]);

  const toast = useCallback((message: string, options: Omit<Toast, "id" | "message"> = {}) => {
    toastId.current += 1;
    const id = toastId.current;
    setToasts((current) => [...current.slice(-2), { id, message, ...options }]);
    window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), options.action ? 7000 : 3800);
  }, []);
  const dismissToast = useCallback((id: number) => setToasts((current) => current.filter((item) => item.id !== id)), []);

  const reload = useCallback(async (silent = false): Promise<void> => {
    if (loadingRef.current) return;
    const sync = getOfflineSyncState();
    // While offline writes are still queued, the server copy is older than the
    // local one; a background refresh would make fresh captures vanish briefly.
    // Writes the server has refused are not coming; they wait in Offline recovery
    // and must not stop the Notebook from ever refreshing again.
    if (silent && sync.online && sync.pending - sync.held > 0) return;
    loadingRef.current = true;
    // A spinner replaces the page only while there is nothing to show yet.
    const showSpinner = !silent && !hasLoaded.current;
    if (showSpinner) setLoading(true);
    try {
      if (sync.online && sync.pending > 0 && supabase) {
        const { data } = await supabase.auth.getSession();
        await flushOfflineRequests(data.session?.access_token).catch(() => undefined);
      }
      const revisionBeforeLoad = localWriteRevision.current;
      const result = await loadKnowledge(userId);
      if (localWriteRevision.current !== revisionBeforeLoad) {
        // A capture or edit saved during this download is newer than its result.
        if (hasLoaded.current) {
          // Keep the local work on screen and fetch again shortly, instead of
          // waiting for a focus change that may never come.
          if (followUp.current !== null) window.clearTimeout(followUp.current);
          followUp.current = window.setTimeout(() => { followUp.current = null; void reload(true); }, 1500);
          return;
        }
        // The very first load must never be thrown away: that left the whole
        // Notebook looking empty apart from the capture made during start-up.
        // Before the first load, local rows can only be ones created here.
        setSnapshot((local) => mergeFirstLoad(result.snapshot, local));
      } else {
        setSnapshot(result.snapshot);
      }
      hasLoaded.current = true;
      setSchema(result.schema);
      setError("");
      lastLoad.current = Date.now();
    } catch (loadError) {
      if (!silent && hasLoaded.current) toast(`Could not refresh the Notebook: ${friendlyError(loadError)} The copy on screen is unchanged.`, { tone: "error" });
      else if (!silent) setError(friendlyError(loadError));
    } finally {
      loadingRef.current = false;
      if (showSpinner) setLoading(false);
    }
  }, [setSnapshot, toast, userId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const refresh = () => { if (Date.now() - lastLoad.current > 60_000) void reload(true); };
    window.addEventListener("focus", refresh);
    // After Heuresis has replayed queued offline writes, pick up the server's view.
    // Debounce writes from the other Heuresis window. Wait for an in-flight
    // refresh rather than dropping its change event.
    let refreshTimer: number | null = null;
    const scheduleCrossWindowReload = () => {
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        refreshTimer = null;
        if (loadingRef.current) { scheduleCrossWindowReload(); return; }
        void reload(true);
      }, 250);
    };
    const stopCrossWindow = subscribeWorkspaceChanges(userId, scheduleCrossWindowReload);
    let wasSyncing = getOfflineSyncState().syncing;
    const unsubscribe = subscribeOfflineSync((state) => {
      if (wasSyncing && !state.syncing && !state.error) void reload(true);
      wasSyncing = state.syncing;
    });
    return () => {
      window.removeEventListener("focus", refresh);
      unsubscribe();
      stopCrossWindow();
      if (refreshTimer !== null) window.clearTimeout(refreshTimer);
    };
  }, [reload, userId]);

  // When queued offline edits reach the server, adopt the revision it assigned,
  // so the next edit of the same note is not rejected as a conflict.
  useEffect(() => subscribeReplayedRows(({ table, row }) => {
    if (table !== "knowledge_records" || typeof row.id !== "string" || typeof row.updated_at !== "string") return;
    const id = row.id;
    const revision = row.updated_at;
    if (!snapshotRef.current.entries.some((entry) => entry.id === id && entry.updated_at !== revision)) return;
    setSnapshot((current) => ({
      ...current,
      entries: current.entries.map((entry) => entry.id === id ? { ...entry, updated_at: revision } : entry),
    }));
  }), [setSnapshot]);

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


  const updateMemory = useCallback((update: (current: WorkspaceMemory) => WorkspaceMemory) => setMemory((current) => update(current)), []);

  const addSubject = useCallback(async (name: string) => {
    const created = await createSubject(userId, name);
    setSnapshotLocal((current) => ({ ...current, subjects: [...current.subjects, created] }));
    return created;
  }, [setSnapshotLocal, userId]);
  const renameSubjectById = useCallback(async (id: string, name: string) => {
    const clean = await renameSubject(userId, id, name);
    setSnapshotLocal((current) => ({ ...current, subjects: current.subjects.map((row) => row.id === id ? { ...row, name: clean } : row) }));
  }, [setSnapshotLocal, userId]);
  const removeSubject = useCallback(async (id: string) => {
    await deleteSubject(userId, id);
    setSnapshotLocal((current) => {
      const topicIds = new Set(current.topics.filter((topic) => topic.subject_id === id).map((topic) => topic.id));
      const deletedEntryIds = new Set(current.entries.filter((row) => topicIds.has(row.topic_id)).map((row) => row.id));
      return {
        ...current,
        subjects: current.subjects.filter((row) => row.id !== id),
        topics: current.topics.filter((row) => !topicIds.has(row.id)),
        entries: current.entries.filter((row) => !deletedEntryIds.has(row.id)),
        practice: current.practice.filter((row) => !deletedEntryIds.has(row.record_id)),
      };
    });
  }, [setSnapshotLocal, userId]);
  const addTopic = useCallback(async (subjectId: string, name: string, parentId: string | null = null) => {
    const created = await createTopic(userId, subjectId, name, parentId);
    setSnapshotLocal((current) => ({ ...current, topics: [...current.topics, created] }));
    return created;
  }, [setSnapshotLocal, userId]);
  const changeTopic = useCallback(async (id: string, patch: { name?: string; parent_id?: string | null }) => {
    const clean = await updateTopic(userId, id, patch);
    setSnapshotLocal((current) => ({ ...current, topics: current.topics.map((row) => row.id === id ? { ...row, ...clean } : row) }));
  }, [setSnapshotLocal, userId]);
  const removeTopic = useCallback(async (id: string) => {
    await deleteTopic(userId, id);
    setSnapshotLocal((current) => {
      const deletedEntryIds = new Set(current.entries.filter((row) => row.topic_id === id).map((row) => row.id));
      return {
        ...current,
        topics: current.topics.filter((row) => row.id !== id),
        entries: current.entries.filter((row) => !deletedEntryIds.has(row.id)),
        practice: current.practice.filter((row) => !deletedEntryIds.has(row.record_id)),
      };
    });
  }, [setSnapshotLocal, userId]);
  const ensureInbox = useCallback(async (subjectId: string) => {
    const existing = snapshotRef.current.topics.find((topic) => topic.subject_id === subjectId && !topic.parent_id && topic.name.toLowerCase() === "inbox");
    if (existing) return existing;
    return addTopic(subjectId, "Inbox", null);
  }, [addTopic]);

  const addEntry = useCallback(async (input: EntryInput) => {
    const created = await createEntry(userId, input);
    setSnapshotLocal((current) => ({ ...current, entries: [created, ...current.entries.filter((row) => row.id !== created.id)] }));
    return created;
  }, [setSnapshotLocal, userId]);

  const dropPending = useCallback((id: string) => {
    writePendingCaptures(userId, readPendingCaptures(userId).filter((item) => item.input.id !== id));
  }, [userId]);

  const submitCapture = useCallback(async (input: EntryInput, label: string, surface: CaptureDraftSurface = "inline") => {
    const id = input.id ?? crypto.randomUUID();
    const full = { ...input, id };
    writePendingCaptures(userId, [...readPendingCaptures(userId).filter((item) => item.input.id !== id), { input: full, label, submittedAt: new Date().toISOString() }]);
    const slow = window.setTimeout(() => toast("Still saving — your capture is kept on this device until it is stored."), 1800);
    try {
      const created = await addEntry(full);
      queueCaptureForReview(userId, id);
      dropPending(id);
      return created;
    } catch (saveError) {
      const code = (saveError as { code?: string })?.code;
      if (code) {
        // The server rejected it (e.g. its topic was deleted elsewhere): retrying cannot help,
        // so hand the text back to the capture panel instead of losing it.
        dropPending(id);
        if (!readCaptureDraft(userId, surface)) writeCaptureDraft(userId, {
          mode: input.kind, text: input.body ?? "", category: input.category ?? "note", categoryTouched: true,
          attempt: input.attempt ?? "", correction: input.correction ?? "", explanation: input.explanation ?? "",
          lessonTitle: input.kind === "lesson" ? input.title ?? "" : "", updatedAt: new Date().toISOString(),
        }, surface);
        toast(`Could not save “${label}”: ${friendlyError(saveError)} Your draft remains in the original Capture window.`, { tone: "error" });
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
        if (snapshotRef.current.entries.some((row) => row.id === item.input.id)) {
          queueCaptureForReview(userId, item.input.id!);
          dropPending(item.input.id);
          continue;
        }
        try {
          await addEntry(item.input);
          queueCaptureForReview(userId, item.input.id!);
          dropPending(item.input.id);
          restored += 1;
        }
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
    setSnapshotLocal((value) => ({ ...value, entries: value.entries.map((row) => row.id === id ? { ...row, ...changed, updated_at: next.updated_at } : row) }));
    return snapshotRef.current.entries.find((row) => row.id === id) ?? next;
  }, [setSnapshotLocal, userId]);
  const removeEntry = useCallback(async (id: string, options: { undo?: boolean } = {}) => {
    const existing = snapshotRef.current.entries.find((row) => row.id === id);
    await deleteEntry(userId, id);
    setSnapshotLocal((current) => ({
      ...current,
      // The database uses a reversible archive; do not discard attached
      // captures or recall history from memory while Undo is still possible.
      entries: current.entries.filter((row) => row.id !== id),
      practice: current.practice,
    }));
    if (existing && options.undo !== false) {
      toast(`Deleted “${entryTitle(existing).slice(0, 48)}”.`, {
        action: {
          label: "Undo",
          run: () => {
            void restoreEntry(existing).then(() => {
              setSnapshotLocal((current) => ({ ...current, entries: [existing, ...current.entries.filter((row) => row.id !== existing.id)] }));
              toast("Restored.");
            }).catch((restoreError) => toast(friendlyError(restoreError), { tone: "error" }));
          },
        },
      });
    }
  }, [setSnapshotLocal, toast, userId]);
  const practise = useCallback(async (id: string, outcome: PracticeOutcome, answer: string) => {
    const current = snapshotRef.current.entries.find((row) => row.id === id);
    if (!current) throw new Error("This mistake no longer exists.");
    const result = await recordPractice(userId, current, outcome, answer);
    setSnapshotLocal((value) => ({
      ...value,
      entries: value.entries.map((row) => row.id === id ? result.entry : row),
      practice: [result.event, ...value.practice],
    }));
    return result.entry;
  }, [setSnapshotLocal, userId]);

  // Section navigation means "open Notebook home", never "resume the last note".
  // Direct note/topic links below still set their target before changing section.
  const goTo = useCallback((next: WorkspaceSection) => {
    if (next === "notebook") {
      setMemory((current) => {
        if (!current.notebook.docId && !current.notebook.topicId && !current.notebook.subjectId) return current;
        return { ...current, notebook: { ...current.notebook, docId: null, topicId: null, subjectId: null } };
      });
    }
    onSection(next);
  }, [onSection]);
  const openDocument = useCallback((id: string, options: { edit?: boolean; stayInSection?: boolean } = {}) => {
    const entry = snapshotRef.current.entries.find((row) => row.id === id);
    setMemory((current) => ({
      ...current,
      notebook: { ...current.notebook, docId: id, topicId: entry?.topic_id ?? current.notebook.topicId, subjectId: null },
      recentDocs: pushRecent(current.recentDocs, id),
    }));
    if (options.edit) setPendingEditId(id);
    if (!options.stayInSection) onSection("notebook");
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
  const [cleanupTarget, setCleanupTarget] = useState<CleanupTarget | null>(null);
  const openCleanup = useCallback((target: CleanupTarget) => setCleanupTarget({ ...target }), []);
  const closeCleanup = useCallback(() => setCleanupTarget(null), []);
  const endLesson = useCallback(() => {
    const lessonId = memory.currentLesson?.id;
    setMemory((current) => ({ ...current, currentLesson: null }));
    if (lessonId && snapshotRef.current.entries.some((row) => row.lesson_id === lessonId)) {
      setCleanupTarget({ kind: "lesson", id: lessonId });
    }
  }, [memory.currentLesson?.id]);
  // Recheck expiry whenever the capture panel or another workspace state renders.
  // A desktop app left open overnight must not attach notes to yesterday's lesson.
  const started = memory.currentLesson?.startedAt;
  const lessonActive = Boolean(started && Date.now() - new Date(started).getTime() < 10 * 60 * 60 * 1000);
  const lessonEntry = lessonActive && memory.currentLesson ? entryById.get(memory.currentLesson.id) : undefined;
  const currentLesson = lessonEntry && isLesson(lessonEntry) ? lessonEntry : null;

  const value: WorkspaceValue = {
    userId, snapshot, schema, writable: schema === "v2", loading, error, reload,
    subjectById, topicById, entryById, childrenOf, topicPath, pathLabel, subtreeIds,
    addSubject, renameSubjectById, removeSubject, addTopic, changeTopic, removeTopic, ensureInbox,
    addEntry, submitCapture, patchEntry, removeEntry, practise,
    memory, updateMemory,
    section, goTo, openDocument, openTopic, openMistake, pendingEditId, consumePendingEdit, focusMistake, clearFocusMistake,
    capture, openCapture, closeCapture, startLesson, endLesson, currentLesson,
    cleanupTarget, openCleanup, closeCleanup,
    toasts, toast, dismissToast,
  };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}
