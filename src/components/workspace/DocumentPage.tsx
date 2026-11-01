import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, Copy, FolderInput, GraduationCap, Layers, ListPlus,
  MoreHorizontal, Pencil, Pin, Radio, RotateCcw, ListChecks, Languages, ExternalLink, Printer, Trash2, X,
} from "lucide-react";
import {
  CATEGORY_LABELS, entryTitle, friendlyError, isLegacyLesson, isLesson, isOpenQuestion, loadKnowledge, localDateKey, mistakeStage,
  type KnowledgeEntry, type NoteCategory,
} from "../../lib/knowledgeWorkspace";
import { canonicalMarkdown, wikiLinks } from "../../lib/noteFormat";
import { isAndroidRuntime } from "../../lib/platform";
import { adoptOwnSaveRevision } from "../../lib/noteRevision";
import { readDocumentDraft, writeDocumentDraft, type NotebookLocation } from "../../lib/workspaceMemory";
import { getOfflineSyncState, subscribeOfflineSync } from "../../lib/offlineFetch";
import { FlashcardDialog } from "./FlashcardDialog";
import type { NewDocRequest } from "./NotebookView";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { RichText, type LinkResolver } from "./RichText";
import { NoteReadingViews, NoteViewSwitcher, type NotebookReadMode } from "./NoteReadingViews";
import { KindIcon, Kbd, MOD_KEY, TopicPicker, entryKindLabel, formatDay, formatLongDay, formatTime, relativeTime, useConfirm, usePopover } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

type Draft = { title: string; body: string; category: NoteCategory; lessonDate: string; topicId: string };
type SaveState = { kind: "idle" | "dirty" | "saving" | "local" | "saved" | "error" | "invalid"; message?: string; at?: string };
type ReaderPrefs = { size: 15 | 17 | 19 | 21; width: "narrow" | "normal" | "wide"; face: "sans" | "serif"; spacing: "compact" | "comfortable" };
const DEFAULT_READER_PREFS: ReaderPrefs = { size: 17, width: "normal", face: "sans", spacing: "comfortable" };

const LESSON_OUTLINE = "# Grammar\n\n# Explanation\n\n# Examples\n> [!example]\n> \n\n# New expressions\n- \n\n# To revisit\n- ";

function draftFromEntry(entry: KnowledgeEntry | null, newDoc: NewDocRequest): Draft {
  return {
    title: entry?.title ?? newDoc?.title ?? "",
    body: entry?.body ?? "",
    category: entry?.category ?? newDoc?.category ?? "note",
    lessonDate: entry?.lesson_date ?? localDateKey(new Date()),
    topicId: entry?.topic_id ?? newDoc?.topicId ?? "",
  };
}

export function DocumentPage({ entry, newDoc, onBack, onClose, navigate, onCreated, onNewNote, newAction, onDetach, startInEditMode = false, detached = false }: {
  entry: KnowledgeEntry | null; newDoc: NewDocRequest; onBack: () => void; onClose: () => void;
  navigate: (location: NotebookLocation) => void; onCreated: (entry: KnowledgeEntry) => void;
  onNewNote: (topicId: string | null, title?: string) => void;
  newAction?: React.ReactNode;
  onDetach?: () => void; startInEditMode?: boolean; detached?: boolean;
}) {
  const workspace = useWorkspace();
  const { userId, snapshot } = workspace;
  const [editing, setEditing] = useState(() => Boolean(newDoc) || startInEditMode || Boolean(entry && workspace.pendingEditId === entry.id));
  const [draft, setDraft] = useState<Draft>(() => draftFromEntry(entry, newDoc));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [restore, setRestore] = useState<{ title: string; body: string; savedAt: string; baseUpdatedAt: string } | null>(null);
  // Conflicts are exceptional: do not interrupt normal typing with a modal.
  const [conflict, setConflict] = useState(false);
  const [moving, setMoving] = useState(false);
  const [flashcardTarget, setFlashcardTarget] = useState<KnowledgeEntry | null>(null);
  const [addingChapter, setAddingChapter] = useState(false);
  const [chapterTitle, setChapterTitle] = useState("");
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    if (!printing) return;
    const complete = () => { document.body.classList.remove("nb-printing"); setPrinting(false); };
    window.addEventListener("afterprint", complete);
    return () => window.removeEventListener("afterprint", complete);
  }, [printing]);
  const [rubyPinyin, setRubyPinyin] = useState(() => {
    try { return localStorage.getItem(`heuresis.notebook.ruby.v1:${userId}`) === "true"; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(`heuresis.notebook.ruby.v1:${userId}`, String(rubyPinyin)); }
    catch { /* Optional reading preference. */ }
  }, [rubyPinyin, userId]);
  const [readerPrefs, setReaderPrefs] = useState<ReaderPrefs>(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(`heuresis.notebook.reader.v1:${userId}`) ?? "{}") as Partial<ReaderPrefs>;
      return { size: [15, 17, 19, 21].includes(Number(stored.size)) ? stored.size! : 17,
        width: stored.width === "narrow" || stored.width === "wide" ? stored.width : "normal",
        face: stored.face === "serif" ? "serif" : "sans",
        spacing: stored.spacing === "compact" ? "compact" : "comfortable" };
    } catch { return DEFAULT_READER_PREFS; }
  });
  useEffect(() => {
    try { localStorage.setItem(`heuresis.notebook.reader.v1:${userId}`, JSON.stringify(readerPrefs)); }
    catch { /* Preferences are local and optional. */ }
  }, [readerPrefs, userId]);
  const [readMode, setReadMode] = useState<NotebookReadMode>(() => {
    try {
      const saved = localStorage.getItem("heuresis.notebook.readmode.v1:" + userId);
      return saved === "canvas" || saved === "study" ? saved : "document";
    } catch { return "document"; }
  });
  const [canvasColumns, setCanvasColumns] = useState<2 | 3>(() => {
    try { return localStorage.getItem("heuresis.notebook.columns.v1:" + userId) === "3" ? 3 : 2; }
    catch { return 2; }
  });
  useEffect(() => {
    try { localStorage.setItem("heuresis.notebook.readmode.v1:" + userId, readMode); }
    catch { /* Preferences are optional. */ }
  }, [readMode, userId]);
  useEffect(() => {
    try { localStorage.setItem("heuresis.notebook.columns.v1:" + userId, String(canvasColumns)); }
    catch { /* Preferences are optional. */ }
  }, [canvasColumns, userId]);
  const [confirmElement, confirm] = useConfirm();
  const editorRef = useRef<RichEditorHandle>(null);
  const entryIdRef = useRef<string | null>(entry?.id ?? null);
  // New notes also need a durable draft key before they acquire a server ID.
  const draftIdRef = useRef(entry?.id ?? `unsaved:${newDoc?.draftKey ?? newDoc?.topicId ?? "inbox"}`);
  const draftRef = useRef(draft);
  const savedRef = useRef<Draft>(draftFromEntry(entry, newDoc));
  const baseRevisionRef = useRef(entry?.updated_at ?? "");
  const conflictRef = useRef(false);
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef<Promise<unknown> | null>(null);
  const persistRef = useRef<() => Promise<unknown>>(async () => undefined);
  const editorKey = useRef(`${entry?.id ?? "new"}-${Date.now()}`);

  const liveEntry = entryIdRef.current ? workspace.entryById.get(entryIdRef.current) ?? entry : entry;
  // Delayed autosaves must compare against the newest snapshot, not the timer closure.
  const entryByIdRef = useRef(workspace.entryById);
  entryByIdRef.current = workspace.entryById;
  const lesson = liveEntry ? isLesson(liveEntry) : false;
  const kindLabel = liveEntry ? entryKindLabel(liveEntry) : CATEGORY_LABELS[draft.category];

  useEffect(() => { if (entry) workspace.consumePendingEdit(entry.id); }, [entry, workspace]);

  // Recover unfinished drafts for both existing and brand-new documents.
  useEffect(() => {
    const key = draftIdRef.current;
    const stored = readDocumentDraft(userId, key);
    if (!stored) return;
    const initial = draftFromEntry(entry, newDoc);
    const differs = stored.title !== initial.title || canonicalMarkdown(stored.body) !== canonicalMarkdown(initial.body);
    if (differs) setRestore({ title: stored.title, body: stored.body, savedAt: stored.savedAt, baseUpdatedAt: stored.baseUpdatedAt });
    else writeDocumentDraft(userId, key, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the reading view in sync with saves made elsewhere (e.g. "Copy into lesson").
  useEffect(() => {
    if (editing || !liveEntry) return;
    const next = draftFromEntry(liveEntry, null);
    draftRef.current = next;
    savedRef.current = next;
    baseRevisionRef.current = liveEntry.updated_at;
    setDraft(next);
  }, [editing, liveEntry]);

  const isDirty = useCallback((value: Draft) => {
    const saved = savedRef.current;
    return value.title.trim() !== saved.title.trim() || value.body !== saved.body || value.category !== saved.category
      || value.lessonDate !== saved.lessonDate || value.topicId !== saved.topicId;
  }, []);

  const persist = useCallback(async (): Promise<"saved" | "invalid" | "error" | "busy"> => {
    if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
    if (savingRef.current) { againRef.current = true; return "busy"; }
    if (conflictRef.current) return "error";
    // The editor sends debounced updates for ordinary typing. A deliberate
    // Save (Ctrl+S, Done, or navigation) must read the live DOM immediately;
    // otherwise a last keystroke can miss the save window.
    const liveBody = editorRef.current?.getMarkdown();
    if (liveBody !== undefined && liveBody !== draftRef.current.body) {
      draftRef.current = { ...draftRef.current, body: liveBody };
      setDraft(draftRef.current);
      writeDocumentDraft(userId, draftIdRef.current, {
        title: draftRef.current.title, body: liveBody, savedAt: new Date().toISOString(),
        baseUpdatedAt: baseRevisionRef.current,
      });
    }
    const current = draftRef.current;
    if (!isDirty(current)) { setSave((state) => state.kind === "error" || state.kind === "invalid" ? state : { kind: state.at ? "saved" : "idle", at: state.at }); return "saved"; }
    const currentEntry = entryIdRef.current ? entryByIdRef.current.get(entryIdRef.current) : null;
    // A late acknowledgement of our last save (including offline replay) is not an external edit.
    baseRevisionRef.current = adoptOwnSaveRevision(currentEntry, baseRevisionRef.current, savedRef.current);
    if (entryIdRef.current && (!currentEntry || (baseRevisionRef.current && currentEntry.updated_at !== baseRevisionRef.current))) {
      conflictRef.current = true;
      setConflict(true);
      setSave({ kind: "error", message: "Another version exists; your changes are preserved on this device." });
      return "error";
    }
    const kind = liveEntry?.kind ?? "note";
    if (kind === "note" && !current.body.trim()) {
      setSave({ kind: "invalid", message: entryIdRef.current ? "A note needs some text. Write something, or delete the note." : "Start writing — the note is saved as soon as it has text." });
      return "invalid";
    }
    // Only create a pending save promise once there is real work to await.
    let release: () => void = () => undefined;
    inflightRef.current = new Promise<void>((resolve) => { release = resolve; });
    savingRef.current = true;
    setSave({ kind: "saving" });
    try {
      if (!entryIdRef.current) {
        const created = await workspace.addEntry({ kind: "note", topicId: current.topicId, title: current.title, body: current.body, category: current.category });
        const priorDraftKey = draftIdRef.current;
        entryIdRef.current = created.id;
        baseRevisionRef.current = created.updated_at;
        draftIdRef.current = created.id;
        writeDocumentDraft(userId, created.id, {
          title: draftRef.current.title, body: draftRef.current.body,
          savedAt: new Date().toISOString(), baseUpdatedAt: created.updated_at,
        });
        writeDocumentDraft(userId, priorDraftKey, null);
        onCreated(created);
      } else {
        const patch: Record<string, unknown> = { title: current.title.trim(), body: current.body, topic_id: current.topicId };
        if (kind === "note") patch.category = current.category;
        if (kind === "lesson") patch.lesson_date = current.lessonDate || null;
        const updated = await workspace.patchEntry(entryIdRef.current, patch);
        baseRevisionRef.current = updated.updated_at;
      }
      savedRef.current = current;
      const stillDirty = isDirty(draftRef.current);
      const sync = getOfflineSyncState();
      const needsSync = !sync.online || sync.pending > 0;
      // An offline save exists only in the upload queue. Keep the device draft as
      // a second copy until that queue has reached the server.
      if (!stillDirty && !needsSync && entryIdRef.current) writeDocumentDraft(userId, entryIdRef.current, null);
      setSave({ kind: stillDirty ? "dirty" : needsSync ? "local" : "saved",
        at: new Date().toISOString(),
        message: needsSync ? "On device · waiting to sync" : undefined });
      return "saved";
    } catch (error) {
      const message = friendlyError(error);
      if (/changed on another device|was deleted|changed elsewhere/i.test(message)) {
        conflictRef.current = true;
        setConflict(true);
        setSave({ kind: "error", message: "Another version exists; your changes are preserved on this device." });
      } else setSave({ kind: "error", message });
      return "error";
    } finally {
      savingRef.current = false;
      release();
      if (againRef.current) { againRef.current = false; void persist(); }
    }
  }, [isDirty, liveEntry?.kind, onCreated, userId, workspace]);
  persistRef.current = persist;

  // Offline writes are durable locally, but must never be presented as
  // confirmed on the server. Update that label only when the pending queue
  // has actually drained successfully.
  useEffect(() => subscribeOfflineSync((state) => {
    if (state.online && !state.pending && !state.syncing && !state.error) {
      setSave((current) => {
        if (current.kind !== "local") return current;
        if (entryIdRef.current && !isDirty(draftRef.current)) writeDocumentDraft(userId, entryIdRef.current, null);
        return { kind: "saved", at: new Date().toISOString(), message: "Synced" };
      });
    }
  }), [isDirty, userId]);

  const scheduleSave = useCallback(() => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => { timerRef.current = null; void persist(); }, 900);
  }, [persist]);

  const updateDraft = useCallback((patch: Partial<Draft>) => {
    const next = { ...draftRef.current, ...patch };
    draftRef.current = next;
    setDraft(next);
    if (!isDirty(next)) return;
    setSave((state) => state.kind === "saving" ? state : { kind: "dirty", at: state.at });
    writeDocumentDraft(userId, draftIdRef.current, {
      title: next.title, body: next.body, savedAt: new Date().toISOString(),
      baseUpdatedAt: baseRevisionRef.current,
    });
    scheduleSave();
  }, [isDirty, liveEntry?.updated_at, scheduleSave, userId]);

  // Flush unsaved work when leaving the page or closing the window. The local
  // draft copy (written on every change) covers anything a closing window cuts off.
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty(draftRef.current)) return;
      void persistRef.current();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty]);
  useEffect(() => () => {
    try { const body = editorRef.current?.getMarkdown(); if (body !== undefined) draftRef.current = { ...draftRef.current, body }; } catch { /* editor already gone */ }
    if (isDirty(draftRef.current)) void persistRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Saves and leaves edit mode. "left" means the page was already navigated away from. */
  async function finishEditing(): Promise<"done" | "left" | "stay"> {
    const body = editorRef.current?.getMarkdown();
    if (body !== undefined) { draftRef.current = { ...draftRef.current, body }; setDraft(draftRef.current); }
    while (savingRef.current && inflightRef.current) await inflightRef.current;
    // A new note that never received any text is simply discarded.
    if (!entryIdRef.current && !draftRef.current.body.trim()) {
      if (!draftRef.current.title.trim()) { onBack(); return "left"; }
      setSave({ kind: "invalid", message: "Add some text to save this note, or remove the title to discard it." });
      return "stay";
    }
    const result = await persist();
    if (result === "saved") { setEditing(false); return "done"; }
    return "stay";
  }

  // A genuine edit conflict never retries against a newly fetched version.
  // The only paths are an explicit copy or discarding the local draft.
  async function saveConflictedCopy() {
    try {
      const body = editorRef.current?.getMarkdown() ?? draftRef.current.body;
      const current = { ...draftRef.current, body };
      const created = await workspace.addEntry({
        kind: "note", topicId: current.topicId,
        title: (current.title.trim() || "Untitled") + " (copy)",
        body: current.body, category: current.category,
      });
      savedRef.current = current; draftRef.current = current;
      writeDocumentDraft(userId, draftIdRef.current, null);
      conflictRef.current = false;
      setConflict(false);
      navigate({ topicId: created.topic_id, docId: created.id });
    } catch (error) { setSave({ kind: "error", message: friendlyError(error) }); }
  }
  async function useLatestVersion() {
    try {
      // Read the authoritative snapshot. The context map from this render is
      // stale until React has committed the refresh, so it must not decide
      // which version gets discarded.
      const latestSnapshot = await loadKnowledge(userId);
      const latest = latestSnapshot.snapshot.entries.find((row) => row.id === entryIdRef.current);
      if (!latest) throw new Error("The latest note is unavailable. Keep your local copy.");
      await workspace.reload();
      const next = draftFromEntry(latest, null);
      draftRef.current = next;
      savedRef.current = next;
      baseRevisionRef.current = latest.updated_at;
      editorRef.current?.setMarkdown(next.body);
      writeDocumentDraft(userId, draftIdRef.current, null);
      conflictRef.current = false;
      setConflict(false);
      setEditing(false);
      setDraft(next);
      setSave({ kind: "saved", at: latest.updated_at });
    } catch (error) { setSave({ kind: "error", message: friendlyError(error) }); }
  }

  function startEditing(where: "start" | "end" = "end") {
    editorKey.current = `${entryIdRef.current ?? "new"}-${Date.now()}`;
    setEditing(true);
    window.setTimeout(() => editorRef.current?.focus(where), 30);
  }

  const resolveLink: LinkResolver = useCallback((target: string) => {
    const wanted = target.toLocaleLowerCase();
    const subjectId = workspace.topicById.get(draft.topicId)?.subject_id;
    const matches = snapshot.entries.filter((row) => row.kind !== "mistake" && entryTitle(row).toLocaleLowerCase() === wanted);
    const match = matches.find((row) => workspace.topicById.get(row.topic_id)?.subject_id === subjectId) ?? matches[0];
    return {
      exists: Boolean(match),
      open: () => match ? navigate({ topicId: match.topic_id, docId: match.id }) : onNewNote(draft.topicId, target),
    };
  }, [draft.topicId, navigate, onNewNote, snapshot.entries, workspace.topicById]);

  const title = draft.title.trim() || (liveEntry ? entryTitle(liveEntry) : "");
  const backlinks = useMemo(() => {
    if (!liveEntry || !title) return [];
    const key = title.toLocaleLowerCase();
    return snapshot.entries.filter((row) => row.id !== liveEntry.id && row.kind !== "mistake" && wikiLinks(row.body).has(key));
  }, [liveEntry, snapshot.entries, title]);
  const siblings = useMemo(() => {
    if (!liveEntry) return [];
    return snapshot.entries.filter((row) => row.topic_id === liveEntry.topic_id && row.kind !== "mistake")
      .sort((a, b) => (isLesson(b) && b.lesson_date ? b.lesson_date : b.updated_at).localeCompare(isLesson(a) && a.lesson_date ? a.lesson_date : a.updated_at));
  }, [liveEntry, snapshot.entries]);
  const position = liveEntry ? siblings.findIndex((row) => row.id === liveEntry.id) : -1;
  const newer = position > 0 ? siblings[position - 1] : null;
  const older = position >= 0 && position < siblings.length - 1 ? siblings[position + 1] : null;
  const lessonId = liveEntry?.kind === "lesson" ? liveEntry.id : null;
  const captures = lessonId ? snapshot.entries.filter((row) => row.lesson_id === lessonId).sort((a, b) => a.created_at.localeCompare(b.created_at)) : [];
  const capturedNotes = captures.filter((row) => row.kind === "note" && !isOpenQuestion(row));
  const capturedQuestions = captures.filter(isOpenQuestion);
  const capturedMistakes = captures.filter((row) => row.kind === "mistake");
  const capturing = Boolean(lessonId && workspace.currentLesson?.id === lessonId);
  const path = workspace.topicPath(draft.topicId);
  const readerStyle = {
    "--nb-reader-size": `${readerPrefs.size}px`,
    "--nb-reader-width": readerPrefs.width === "narrow" ? "600px" : readerPrefs.width === "wide" ? "850px" : "720px",
    "--nb-reader-font": readerPrefs.face === "serif" ? "var(--ws-serif)" : "var(--ws-sans)",
    "--nb-reader-line-height": readerPrefs.spacing === "compact" ? "1.55" : "1.75",
  } as CSSProperties;
  const wordCount = (draft.body.match(/[\p{L}\p{N}]+(?:[\u2019\u0027-][\p{L}\p{N}]+)*/gu) ?? []).length;
  const printNote = useCallback(() => {
    if (isAndroidRuntime()) return;
    document.body.classList.add("nb-printing");
    setPrinting(true);
    // Wait for the complete, unfolded print copy to mount outside the app shell.
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => window.print()));
  }, []);

  async function remove() {
    if (!liveEntry) { onBack(); return; }
    const extra = captures.length ? ` The ${captures.length} ${captures.length === 1 ? "item" : "items"} captured during it will be kept.` : "";
    if (!await confirm({ title: `Delete “${entryTitle(liveEntry).slice(0, 60)}”?`, body: `You can undo this for a few seconds.${extra}`, confirmLabel: "Delete", danger: true })) return;
    try {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      savedRef.current = draftRef.current;
      writeDocumentDraft(userId, liveEntry.id, null);
      if (capturing) workspace.endLesson();
      await workspace.removeEntry(liveEntry.id);
      navigate({ topicId: liveEntry.topic_id, docId: null });
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  async function togglePin() {
    if (!liveEntry) return;
    try { await workspace.patchEntry(liveEntry.id, { pinned: !liveEntry.pinned }); }
    catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  async function moveTo(topicId: string) {
    setMoving(false);
    if (!liveEntry) { updateDraft({ topicId }); return; }
    const previousTopicId = liveEntry.topic_id;
    if (topicId === previousTopicId) return;
    const entryId = liveEntry.id;
    const applyTopic = async (destination: string) => {
      await workspace.patchEntry(entryId, { topic_id: destination });
      draftRef.current = { ...draftRef.current, topicId: destination };
      savedRef.current = { ...savedRef.current, topicId: destination };
      setDraft(draftRef.current);
    };
    try {
      await applyTopic(topicId);
      workspace.toast(`Moved to ${workspace.pathLabel(topicId)}.`, {
        action: { label: "Undo", run: () => {
          void applyTopic(previousTopicId)
            .then(() => workspace.toast("Move undone."))
            .catch((error) => workspace.toast(friendlyError(error), { tone: "error" }));
        } },
      });
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  async function mergeCapture(capture: KnowledgeEntry) {
    if (!liveEntry || !lessonId) return;
    if (editing) { workspace.toast("Finish editing before copying into the lesson."); return; }
    const addition = [capture.title.trim() ? `**${capture.title.trim()}**` : "", capture.body.trim()].filter(Boolean).join("\n");
    const nextBody = `${liveEntry.body.replace(/\s+$/, "")}${liveEntry.body.trim() ? "\n\n" : ""}${addition}`;
    try {
      if (liveEntry.body.includes(addition)) {
        workspace.toast("Already included in the lesson; original capture preserved.");
        return;
      }
      await workspace.patchEntry(lessonId, { body: nextBody });
      // Never delete the original in a second network operation. The copy is
      // reversible and retains the capture's own context and mistake history.
      workspace.toast("Copied into the lesson. Original capture preserved.");
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  async function markAnswered(capture: KnowledgeEntry) {
    try { await workspace.patchEntry(capture.id, { category: "note" }); workspace.toast("Marked as answered."); }
    catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  async function closeNote() {
    if (editing) {
      const result = await finishEditing();
      if (result !== "done") return;
    }
    onClose();
  }

  // Escape in reading mode closes the note; editing Escape finishes editing without navigating away.
  useEffect(() => {
    if (editing) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || event.keyCode === 229 || event.defaultPrevented || document.querySelector(".ws-dialog-backdrop, .qc-panel, .ws-palette")) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [editing, onClose]);

  const statusText = save.kind === "saving" ? "Saving…"
    : save.kind === "dirty" ? "Unsaved changes"
      : save.kind === "local" ? save.message ?? "On device · waiting to sync"
      : save.kind === "saved" ? (save.message ?? `Saved ${save.at ? formatTime(save.at) : ""}`)
        : save.kind === "error" ? save.message ?? "Could not save"
          : save.kind === "invalid" ? save.message ?? "" : entryIdRef.current ? "All changes saved" : "Not saved yet";

  return <article className={`nb-doc ${editing ? "is-editing" : ""} ${lesson ? "is-lesson" : ""} ${!editing ? "is-" + readMode : ""}`} style={readerStyle} aria-label={title || "New note"}>
    {printing && createPortal(<div className="nb-print-root" aria-label="Printable note">
      <header className="nb-print-header">
        <small>{[path.subject?.name, ...path.chain.map((item) => item.name)].filter(Boolean).join(" · ")}</small>
        <h1>{title || "Untitled"}</h1>
        {liveEntry ? <small>{formatDay(liveEntry.updated_at)}</small> : null}
      </header>
      <RichText text={draft.body} rubyPinyin={rubyPinyin} collapsible={false} className="nb-print-prose" />
    </div>, document.body)}
    {confirmElement}
    {flashcardTarget ? <FlashcardDialog entry={flashcardTarget} onClose={() => setFlashcardTarget(null)} /> : null}
    <div className="nb-doc-bar">
      <nav className="nb-crumbs" aria-label="Location">
        {detached ? <>
          <span>{path.subject?.name ?? "Notebook"}</span>
          {path.chain.map((item) => <span key={item.id} className="nb-crumb"><ChevronRight size={12} /><span>{item.name}</span></span>)}
        </> : <>
          <button type="button" onClick={() => navigate({ topicId: null, docId: null, subjectId: path.subject?.id ?? null })}>{path.subject?.name ?? "Notebook"}</button>
          {path.chain.map((item) => <span key={item.id} className="nb-crumb"><ChevronRight size={12} /><button type="button" onClick={() => navigate({ topicId: item.id, docId: null })}>{item.name}</button></span>)}
        </>}
      </nav>
      <div className="nb-doc-actions">
        {!editing ? <NoteViewSwitcher mode={readMode} onChange={setReadMode} /> : null}
        {!editing && readMode === "document" ? <details className="nb-reader-settings">
          <summary title="Reading appearance" aria-label="Reading appearance">Aa</summary>
          <div className="nb-reader-panel">
            <strong>Reading appearance</strong>
            <label>Text size<select value={readerPrefs.size} onChange={(event) => setReaderPrefs((prev) => ({ ...prev, size: Number(event.target.value) as ReaderPrefs["size"] }))}>
              {([15, 17, 19, 21] as const).map((v) => <option key={v} value={v}>{v} px</option>)}
            </select></label>
            <label>Line width<select value={readerPrefs.width} onChange={(event) => setReaderPrefs((prev) => ({ ...prev, width: event.target.value as ReaderPrefs["width"] }))}>
              <option value="narrow">Narrow</option><option value="normal">Normal</option><option value="wide">Wide</option>
            </select></label>
            <label>Typeface<select value={readerPrefs.face} onChange={(event) => setReaderPrefs((prev) => ({ ...prev, face: event.target.value as ReaderPrefs["face"] }))}>
              <option value="sans">Sans</option><option value="serif">Serif</option>
            </select></label>
            <label>Spacing<select value={readerPrefs.spacing} onChange={(event) => setReaderPrefs((prev) => ({ ...prev, spacing: event.target.value as ReaderPrefs["spacing"] }))}>
              <option value="comfortable">Comfortable</option><option value="compact">Compact</option>
            </select></label>
          </div>
        </details> : null}
        {editing ? <>
          <span className={`nb-save-state is-${save.kind}`} role="status" aria-live="polite">
            {save.kind === "saving" ? <span className="ws-spinner is-small" /> : save.kind === "local" || save.kind === "saved" || save.kind === "idle" ? <Check size={13} /> : null}
            {statusText}
            {save.kind === "error" && !conflict ? <button type="button" onClick={() => void persist()}><RotateCcw size={12} /> Retry</button> : null}
          </span>
          <button type="button" className="ws-button is-primary" onClick={() => void finishEditing()} title={`Done (${MOD_KEY}+Enter)`}><Check size={15} /> Done</button>
        </> : <>
          <div className="nb-doc-primary-actions">
            {workspace.writable ? <button type="button" className="ws-button" onClick={() => startEditing()} title="Edit (E)"><Pencil size={14} /> Edit</button> : null}
            {newAction}
          </div>
          {liveEntry ? <DocMenu
            onDetach={onDetach}
            onPin={workspace.writable ? () => void togglePin() : undefined}
            pinned={Boolean(liveEntry.pinned)}
            onMove={workspace.writable ? () => setMoving(true) : undefined}
            onCopy={() => { void navigator.clipboard?.writeText([liveEntry.title, liveEntry.body].filter(Boolean).join("\n\n")).then(() => workspace.toast("Copied to the clipboard.")); }}
            onPrint={!isAndroidRuntime() ? printNote : undefined}
            onFlashcard={() => { if (liveEntry) setFlashcardTarget(liveEntry); }}
            onNewNote={detached && workspace.writable ? () => onNewNote(draft.topicId) : undefined}
            onDelete={workspace.writable ? () => void remove() : undefined} /> : null}
        </>}
        <button type="button" className="ws-icon-button nb-doc-close" aria-label="Close note" title="Close note (Esc)" onClick={() => void closeNote()}><X size={16} /></button>
      </div>
    </div>

    {moving ? <div className="ws-popover-host"><TopicPicker value={draft.topicId} onChange={(id) => void moveTo(id)} onClose={() => setMoving(false)} /></div> : null}

    {conflict ? <div className="nb-restore" role="alert">
      <span>This note changed elsewhere. Your unsaved version is preserved on this device. Choose which to keep.</span>
      <button type="button" className="ws-button is-small is-primary" onClick={() => void saveConflictedCopy()}>Save mine as copy</button>
      <button type="button" className="ws-button is-small" onClick={() => void useLatestVersion()}>Use latest version</button>
    </div> : null}
    {restore ? <div className="nb-restore" role="alert">
      <span>Unsaved changes from {relativeTime(restore.savedAt)} were found on this device.</span>
      <button type="button" className="ws-button is-small is-primary" onClick={() => {
        const next = { ...draftRef.current, title: restore.title, body: restore.body };
        draftRef.current = next; setDraft(next); setRestore(null); startEditing();
        if (entryIdRef.current && restore.baseUpdatedAt !== baseRevisionRef.current) {
          conflictRef.current = true; setConflict(true);
          setSave({ kind: "error", message: "The note changed since this draft was saved." });
        } else scheduleSave();
      }}>Restore</button>
      <button type="button" className="ws-button is-small is-quiet" onClick={() => { writeDocumentDraft(userId, draftIdRef.current, null); setRestore(null); }}>Discard</button>
    </div> : null}

    <header className="nb-doc-head">
      <div className="nb-doc-eyebrow">
        {liveEntry ? <KindIcon entry={liveEntry} size={14} /> : null}
        {lesson ? <span>Lesson · {formatLongDay(editing ? draft.lessonDate : liveEntry?.lesson_date ?? liveEntry?.created_at)}</span>
          : editing && workspace.writable ? <select className="nb-kind-select" aria-label="Kind of note" value={draft.category}
            onChange={(event) => updateDraft({ category: event.target.value as NoteCategory })}>
            {(Object.keys(CATEGORY_LABELS) as NoteCategory[]).map((key) => <option key={key} value={key}>{CATEGORY_LABELS[key]}</option>)}
          </select> : <span>{kindLabel}</span>}
        {liveEntry && !editing ? <span className="nb-doc-updated">· updated {relativeTime(liveEntry.updated_at)}</span> : null}
        {liveEntry?.lesson_id ? <button type="button" className="nb-link-button" onClick={() => navigate({ topicId: workspace.entryById.get(liveEntry.lesson_id!)?.topic_id ?? null, docId: liveEntry.lesson_id })}>
          · from {entryTitle(workspace.entryById.get(liveEntry.lesson_id) ?? liveEntry)}</button> : null}
      </div>
      {editing ? <textarea className="nb-title-input" rows={1} value={draft.title} maxLength={200} aria-label="Title"
        placeholder={lesson ? "Lesson title — e.g. HSK 2 · Chapter 4" : "Title (optional)"}
        onChange={(event) => updateDraft({ title: event.target.value })}
        onInput={(event) => { const field = event.currentTarget; field.style.height = "auto"; field.style.height = `${field.scrollHeight}px`; }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
          if (event.key === "Enter" || event.key === "ArrowDown") { event.preventDefault(); editorRef.current?.focus("start"); }
          if (event.key === "Escape") { event.preventDefault(); void finishEditing(); }
          if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") { event.preventDefault(); void persist(); }
        }} />
        : <h1 className="nb-doc-title">{title || <span className="ws-muted">Untitled</span>}</h1>}
      {editing && lesson ? <label className="nb-date-field">Lesson date
        <input type="date" value={draft.lessonDate} onChange={(event) => updateDraft({ lessonDate: event.target.value })} /></label> : null}
      {lessonId && !editing ? <div className="nb-lesson-strip">
        <span>{capturedNotes.length + capturedQuestions.length} captured · {capturedMistakes.length} {capturedMistakes.length === 1 ? "mistake" : "mistakes"}</span>
        {workspace.writable && captures.length ? <button type="button" className="ws-button is-small"
          onClick={() => workspace.openCleanup({ kind: "lesson", id: lessonId })}><ListChecks size={14}/> Organise captures</button> : null}
        {workspace.writable ? (capturing
          ? <button type="button" className="nb-live-pill" onClick={() => workspace.endLesson()} title="Quick captures are being attached to this lesson. Click to stop."><Radio size={13} /> Capturing into this lesson · End</button>
          : <button type="button" className="ws-button is-small" onClick={() => { workspace.startLesson(lessonId); workspace.toast("Quick captures will now be attached to this lesson."); }}><Radio size={13} /> Capture into this lesson</button>) : null}
      </div> : null}
      {liveEntry && isLegacyLesson(liveEntry) ? <p className="ws-muted nb-legacy-note">Created with the first Notebook version. It reads and edits normally; new captures cannot be attached to it.</p> : null}
    </header>

    {editing ? <div className="nb-doc-editor">
      {lesson && !draft.body.trim() ? <button type="button" className="ws-button is-small nb-outline-button"
        onClick={() => editorRef.current?.setMarkdown(LESSON_OUTLINE)}><ListPlus size={14} /> Add lesson outline</button> : null}
      {draft.category === "reference" ? <div className="nb-reference-chapter-action">
        {addingChapter ? <form onSubmit={(event) => {
          event.preventDefault();
          const title = chapterTitle.trim().replace(/[\r\n]+/g, " ");
          if (!title) return;
          const current = editorRef.current?.getMarkdown() ?? draftRef.current.body;
          editorRef.current?.setMarkdown(`${current.trimEnd()}${current.trim() ? "\n\n" : ""}## ${title}\n\n`);
          editorRef.current?.focus("end");
          setChapterTitle("");
          setAddingChapter(false);
        }}>
          <input autoFocus aria-label="New chapter title" maxLength={120} placeholder="Chapter title" value={chapterTitle} onChange={(event) => setChapterTitle(event.target.value)} />
          <button type="submit" className="ws-button is-small is-primary" disabled={!chapterTitle.trim()}>Add</button>
          <button type="button" className="ws-button is-small" onClick={() => { setAddingChapter(false); setChapterTitle(""); }}>Cancel</button>
        </form> : <button type="button" className="ws-button is-small" onClick={() => setAddingChapter(true)}><ListPlus size={14} /> Add chapter</button>}
      </div> : null}
      <RichEditor ref={editorRef} resetKey={editorKey.current} value={draft.body} autoFocus
        placeholder={lesson ? "Write during or after the lesson — or add the outline above. Quick captures appear below." : draft.category === "reference" ? "Start with ## Chapter title, then write your chapter. Add more ## headings to build the contents." : "Start writing. Use # for a heading, - for a list, > for a quotation, or the Example and Rule blocks."}
        onChange={(body) => updateDraft({ body })}
        onEscape={() => void finishEditing()} onDone={() => void finishEditing()} onSave={() => void persist()} />
      <p className="nb-editor-hints"><Kbd>{MOD_KEY} B</Kbd> bold · <Kbd>{MOD_KEY} I</Kbd> italic · <Kbd>{MOD_KEY} ⇧ H</Kbd> highlight · <span>Colours</span> for text or highlighting · click heading arrows to fold · <code>[[Title]]</code> links another note · <Kbd>{MOD_KEY} ↵</Kbd> done</p>
    </div> : <div className="nb-doc-body">
      {!editing && /\p{Script=Han}/u.test(draft.body) && draft.body.toLowerCase().includes("[!example]") ? <div className="nb-reading-controls">
        <button type="button" className={rubyPinyin ? "is-active" : ""} aria-pressed={rubyPinyin}
          onClick={() => setRubyPinyin((value) => !value)} title="Show or hide pinyin above Chinese example sentences">
          <Languages size={14}/> Pinyin above Hanzi
        </button>
      </div> : null}
      {draft.body.trim() ? <NoteReadingViews text={draft.body} mode={readMode} resolve={resolveLink} rubyPinyin={rubyPinyin} columns={canvasColumns} onColumnsChange={setCanvasColumns}
        foldStorageKey={liveEntry?.id ? `heuresis.notebook.collapsed.v1:${userId}:${liveEntry.id}` : undefined} />
        : <p className="ws-muted nb-doc-empty">{lesson ? "No lesson notes written yet." : "This note is empty."}</p>}
      {workspace.writable && !detached ? <button type="button" className="nb-continue" onClick={() => startEditing("end")}><Pencil size={13} /> {draft.body.trim() ? "Add to this" : "Start writing"}</button> : null}
    </div>}
    <p className="nb-note-metrics">{wordCount.toLocaleString()} words · {draft.body.length.toLocaleString()} characters{draft.body.length >= 40000 ? " · approaching 50,000-character limit" : ""}</p>

    {lessonId ? <section className="nb-lesson-extras" aria-label="Captured during this lesson">
      {capturedQuestions.length ? <div className="nb-extra-block">
        <h2 className="ws-section-title"><CircleHelp size={15} /> To revisit</h2>
        {capturedQuestions.map((capture) => <CaptureRow key={capture.id} capture={capture} onOpen={() => navigate({ topicId: capture.topic_id, docId: capture.id })} onFlashcard={() => setFlashcardTarget(capture)}
          actions={workspace.writable ? (editing ? [{ label: "Answered", run: () => void markAnswered(capture) }] : [{ label: "Answered", run: () => void markAnswered(capture) }, { label: "Copy into lesson", run: () => void mergeCapture(capture) }]) : []} />)}
      </div> : null}
      {capturedNotes.length ? <div className="nb-extra-block">
        <h2 className="ws-section-title"><Layers size={15} /> Captured during the lesson</h2>
        {capturedNotes.map((capture) => <CaptureRow key={capture.id} capture={capture} onOpen={() => navigate({ topicId: capture.topic_id, docId: capture.id })} onFlashcard={() => setFlashcardTarget(capture)}
          actions={workspace.writable && !editing ? [{ label: "Copy into lesson", run: () => void mergeCapture(capture) }] : []} />)}
      </div> : null}
      {capturedMistakes.length ? <div className="nb-extra-block">
        <h2 className="ws-section-title"><GraduationCap size={15} /> Mistakes from this lesson</h2>
        {capturedMistakes.map((mistake) => <div key={mistake.id} className="nb-mistake-with-card">
          <button type="button" className="nb-mistake-row" onClick={() => workspace.openMistake(mistake.id)}>
            <span className="nb-mistake-attempt">{mistake.attempt || "—"}</span>
            <ArrowRight size={14} />
            <span className="nb-mistake-correct">{mistake.correction || <em>needs a correction</em>}</span>
            <small>{mistakeStage(mistake) === "to_correct" ? "To correct" : mistakeStage(mistake) === "understood" ? "Understood" : "In review"}</small>
          </button>
          {mistake.correction ? <button type="button" className="ws-button is-small is-quiet"
            title="Make flashcard from this corrected mistake" aria-label="Make flashcard from this corrected mistake"
            onClick={() => setFlashcardTarget(mistake)}><Layers size={14}/> Flashcard</button> : null}
        </div>)}
      </div> : null}
      {!captures.length && !editing ? <p className="ws-muted nb-extras-empty">
        {capturing ? <>Press <Kbd>{MOD_KEY} ⇧ N</Kbd> for a note or <Kbd>{MOD_KEY} ⇧ M</Kbd> for a mistake — they will appear here.</>
          : "Notes and mistakes captured while this lesson is active appear here."}
      </p> : null}
    </section> : null}

    {!editing && liveEntry ? <footer className="nb-doc-foot">
      {backlinks.length ? <div className="nb-backlinks"><span className="ws-eyebrow">Linked from</span>
        {backlinks.map((row) => <button type="button" key={row.id} onClick={() => navigate({ topicId: row.topic_id, docId: row.id })}><KindIcon entry={row} size={13} />{entryTitle(row)}</button>)}
      </div> : null}
      <div className="nb-pager">
        {newer ? <button type="button" onClick={() => navigate({ topicId: newer.topic_id, docId: newer.id })}><ArrowLeft size={14} /><span><small>Previous note</small>{entryTitle(newer)}</span></button> : <span />}
        {older ? <button type="button" className="is-next" onClick={() => navigate({ topicId: older.topic_id, docId: older.id })}><span><small>Next note</small>{entryTitle(older)}</span><ArrowRight size={14} /></button> : <span />}
      </div>
      <p className="nb-doc-dates">Created {formatDay(liveEntry.created_at)} {formatTime(liveEntry.created_at)} · Last edited {formatDay(liveEntry.updated_at)} {formatTime(liveEntry.updated_at)}</p>
    </footer> : null}
    <KeyboardEdit enabled={!editing && workspace.writable} onEdit={() => startEditing()} />
  </article>;
}

function KeyboardEdit({ enabled, onEdit }: { enabled: boolean; onEdit: () => void }) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (document.querySelector(".ws-dialog-backdrop, .qc-panel, .ws-palette")) return;
      if (!event.ctrlKey && !event.metaKey && !event.altKey && event.key.toLowerCase() === "e") { event.preventDefault(); onEdit(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, onEdit]);
  return null;
}

function CaptureRow({ capture, onOpen, onFlashcard, actions }: { capture: KnowledgeEntry; onOpen: () => void; onFlashcard: () => void; actions: Array<{ label: string; run: () => void }> }) {
  return <div className="nb-capture-row">
    <span className="nb-capture-time">{formatTime(capture.created_at)}</span>
    <div className="nb-capture-body">
      {capture.title.trim() ? <strong>{capture.title}</strong> : null}
      <RichText text={capture.body} className="is-compact" />
    </div>
    <div className="nb-capture-actions">
      {actions.map((action) => <button type="button" key={action.label} className="ws-button is-small is-quiet" onClick={action.run}>{action.label}</button>)}
      <button type="button" className="ws-button is-small" onClick={onFlashcard}><Layers size={13}/> Flashcard</button>
      <button type="button" className="ws-button is-small is-quiet" onClick={onOpen}>Open</button>
    </div>
  </div>;
}

function DocMenu({ onDetach, onPin, pinned = false, onMove, onCopy, onPrint, onFlashcard, onNewNote, onDelete }: { onDetach?: () => void; onPin?: () => void; pinned?: boolean; onMove?: () => void; onCopy: () => void; onPrint?: () => void; onFlashcard: () => void; onNewNote?: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = usePopover(open, close);
  const item = (label: string, icon: React.ReactNode, run?: () => void, danger = false) => run
    ? <button type="button" role="menuitem" className={danger ? "is-danger" : ""} onClick={() => { setOpen(false); run(); }}>{icon}{label}</button> : null;
  return <div className="ws-menu" ref={ref}>
    <button type="button" className={`ws-icon-button ${pinned ? "is-on" : ""}`} aria-label="More actions" title={pinned ? "More actions · pinned to Overview" : "More actions"} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /></button>
    {open ? <div className="ws-menu-list is-right" role="menu">
      {item("New note", <ListPlus size={14} />, onNewNote)}
       {item("Open in new window", <ExternalLink size={14} />, onDetach)}
      {item(pinned ? "Unpin from Overview" : "Pin to Overview", <Pin size={14} fill={pinned ? "currentColor" : "none"} />, onPin)}
      {item("Move to…", <FolderInput size={14} />, onMove)}
      {item("Make a flashcard…", <Layers size={14} />, onFlashcard)}
      {item("Copy text", <Copy size={14} />, onCopy)}
       {item("Print or save as PDF…", <Printer size={14} />, onPrint)}
      {item("Delete", <Trash2 size={14} />, onDelete, true)}
    </div> : null}
  </div>;
}

