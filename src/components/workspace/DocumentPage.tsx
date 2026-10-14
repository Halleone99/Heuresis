import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, Check, ChevronRight, CircleHelp, Copy, FolderInput, GraduationCap, Layers, ListPlus,
  MoreHorizontal, Pencil, Pin, PinOff, Radio, RotateCcw, Trash2, X,
} from "lucide-react";
import {
  CATEGORY_LABELS, entryTitle, friendlyError, isLegacyLesson, isLesson, isOpenQuestion, localDateKey, mistakeStage,
  type KnowledgeEntry, type NoteCategory,
} from "../../lib/knowledgeWorkspace";
import { canonicalMarkdown, wikiLinks } from "../../lib/noteFormat";
import { readDocumentDraft, writeDocumentDraft, type NotebookLocation } from "../../lib/workspaceMemory";
import { getOfflineSyncState } from "../../lib/offlineFetch";
import { FlashcardDialog } from "./FlashcardDialog";
import type { NewDocRequest } from "./NotebookView";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { RichText, type LinkResolver } from "./RichText";
import { KindIcon, Kbd, MOD_KEY, TopicPicker, entryKindLabel, formatDay, formatLongDay, formatTime, relativeTime, useConfirm, usePopover } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

type Draft = { title: string; body: string; category: NoteCategory; lessonDate: string; topicId: string };
type SaveState = { kind: "idle" | "dirty" | "saving" | "saved" | "error" | "invalid"; message?: string; at?: string };

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

export function DocumentPage({ entry, newDoc, onBack, onClose, navigate, onCreated, onNewNote }: {
  entry: KnowledgeEntry | null; newDoc: NewDocRequest; onBack: () => void; onClose: () => void;
  navigate: (location: NotebookLocation) => void; onCreated: (entry: KnowledgeEntry) => void;
  onNewNote: (topicId: string | null, title?: string) => void;
}) {
  const workspace = useWorkspace();
  const { userId, snapshot } = workspace;
  const [editing, setEditing] = useState(() => Boolean(newDoc) || Boolean(entry && workspace.pendingEditId === entry.id));
  const [draft, setDraft] = useState<Draft>(() => draftFromEntry(entry, newDoc));
  const [save, setSave] = useState<SaveState>({ kind: "idle" });
  const [restore, setRestore] = useState<{ title: string; body: string; savedAt: string } | null>(null);
  const [moving, setMoving] = useState(false);
  const [flashcard, setFlashcard] = useState(false);
  const [confirmElement, confirm] = useConfirm();
  const editorRef = useRef<RichEditorHandle>(null);
  const entryIdRef = useRef<string | null>(entry?.id ?? null);
  // New notes also need a durable draft key before they acquire a server ID.
  const draftIdRef = useRef(entry?.id ?? `unsaved:${newDoc?.topicId ?? "inbox"}`);
  const draftRef = useRef(draft);
  const savedRef = useRef<Draft>(draftFromEntry(entry, newDoc));
  const savingRef = useRef(false);
  const againRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef<Promise<unknown> | null>(null);
  const persistRef = useRef<() => Promise<unknown>>(async () => undefined);
  const editorKey = useRef(`${entry?.id ?? "new"}-${Date.now()}`);

  const liveEntry = entryIdRef.current ? workspace.entryById.get(entryIdRef.current) ?? entry : entry;
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
    if (differs) setRestore({ title: stored.title, body: stored.body, savedAt: stored.savedAt });
    else writeDocumentDraft(userId, key, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the reading view in sync with saves made elsewhere (e.g. "Copy into lesson").
  useEffect(() => {
    if (editing || !liveEntry) return;
    const next = draftFromEntry(liveEntry, null);
    draftRef.current = next;
    savedRef.current = next;
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
    let release: () => void = () => undefined;
    inflightRef.current = new Promise<void>((resolve) => { release = resolve; });
    const current = draftRef.current;
    if (!isDirty(current)) { setSave((state) => state.kind === "error" || state.kind === "invalid" ? state : { kind: state.at ? "saved" : "idle", at: state.at }); return "saved"; }
    const kind = liveEntry?.kind ?? "note";
    if (kind === "note" && !current.body.trim()) {
      setSave({ kind: "invalid", message: entryIdRef.current ? "A note needs some text. Write something, or delete the note." : "Start writing — the note is saved as soon as it has text." });
      return "invalid";
    }
    savingRef.current = true;
    setSave({ kind: "saving" });
    try {
      if (!entryIdRef.current) {
        const created = await workspace.addEntry({ kind: "note", topicId: current.topicId, title: current.title, body: current.body, category: current.category });
        const priorDraftKey = draftIdRef.current;
        entryIdRef.current = created.id;
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
        await workspace.patchEntry(entryIdRef.current, patch);
      }
      savedRef.current = current;
      const stillDirty = isDirty(draftRef.current);
      if (!stillDirty && entryIdRef.current) writeDocumentDraft(userId, entryIdRef.current, null);
      const offline = !getOfflineSyncState().online;
      setSave({ kind: stillDirty ? "dirty" : "saved", at: new Date().toISOString(), message: offline ? "Saved on this device — will sync when online" : undefined });
      return "saved";
    } catch (error) {
      setSave({ kind: "error", message: friendlyError(error) });
      return "error";
    } finally {
      savingRef.current = false;
      release();
      if (againRef.current) { againRef.current = false; void persist(); }
    }
  }, [isDirty, liveEntry?.kind, onCreated, userId, workspace]);
  persistRef.current = persist;

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
      baseUpdatedAt: liveEntry?.updated_at ?? "",
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
    try {
      await workspace.patchEntry(liveEntry.id, { topic_id: topicId });
      draftRef.current = { ...draftRef.current, topicId };
      savedRef.current = { ...savedRef.current, topicId };
      setDraft(draftRef.current);
      workspace.toast(`Moved to ${workspace.pathLabel(topicId)}.`);
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

  // Escape in reading mode closes the note; editing Escape saves before closing.
  useEffect(() => {
    if (editing) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector(".ws-dialog-backdrop, .qc-panel, .ws-palette")) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [editing, onClose]);

  const statusText = save.kind === "saving" ? "Saving…"
    : save.kind === "dirty" ? "Unsaved changes"
      : save.kind === "saved" ? (save.message ?? `Saved ${save.at ? formatTime(save.at) : ""}`)
        : save.kind === "error" ? save.message ?? "Could not save"
          : save.kind === "invalid" ? save.message ?? "" : entryIdRef.current ? "All changes saved" : "Not saved yet";

  return <article className={`nb-doc ${editing ? "is-editing" : ""} ${lesson ? "is-lesson" : ""}`} aria-label={title || "New note"}>
    {confirmElement}
    {flashcard && liveEntry ? <FlashcardDialog entry={liveEntry} onClose={() => setFlashcard(false)} /> : null}
    <div className="nb-doc-bar">
      <nav className="nb-crumbs" aria-label="Location">
        <button type="button" className="nb-back" onClick={() => { if (editing) void finishEditing().then((result) => { if (result === "done") onBack(); }); else onBack(); }} aria-label="Back"><ArrowLeft size={15} /></button>
        <button type="button" onClick={() => navigate({ topicId: null, docId: null, subjectId: path.subject?.id ?? null })}>{path.subject?.name ?? "Notebook"}</button>
        {path.chain.map((item) => <span key={item.id} className="nb-crumb"><ChevronRight size={12} /><button type="button" onClick={() => navigate({ topicId: item.id, docId: null })}>{item.name}</button></span>)}
      </nav>
      <div className="nb-doc-actions">
        {editing ? <>
          <span className={`nb-save-state is-${save.kind}`} role="status" aria-live="polite">
            {save.kind === "saving" ? <span className="ws-spinner is-small" /> : save.kind === "saved" || save.kind === "idle" ? <Check size={13} /> : null}
            {statusText}
            {save.kind === "error" ? <button type="button" onClick={() => void persist()}><RotateCcw size={12} /> Retry</button> : null}
          </span>
          <button type="button" className="ws-button is-primary" onClick={() => void finishEditing()} title={`Done (${MOD_KEY}+Enter)`}><Check size={15} /> Done</button>
        </> : <>
          {liveEntry && workspace.writable ? <button type="button" className={`ws-icon-button ${liveEntry.pinned ? "is-on" : ""}`} onClick={() => void togglePin()}
            aria-pressed={liveEntry.pinned} title={liveEntry.pinned ? "Unpin from Overview" : "Pin to Overview"}>{liveEntry.pinned ? <PinOff size={16} /> : <Pin size={16} />}</button> : null}
          {workspace.writable ? <button type="button" className="ws-button" onClick={() => startEditing()} title="Edit (E)"><Pencil size={14} /> Edit</button> : null}
          {liveEntry ? <DocMenu
            onMove={workspace.writable ? () => setMoving(true) : undefined}
            onCopy={() => { void navigator.clipboard?.writeText([liveEntry.title, liveEntry.body].filter(Boolean).join("\n\n")).then(() => workspace.toast("Copied to the clipboard.")); }}
            onFlashcard={() => setFlashcard(true)}
            onDelete={workspace.writable ? () => void remove() : undefined} /> : null}
        </>}
        <button type="button" className="ws-icon-button" aria-label="Close note" title="Close note (Esc)" onClick={() => void closeNote()}><X size={16} /></button>
      </div>
    </div>

    {moving ? <div className="ws-popover-host"><TopicPicker value={draft.topicId} onChange={(id) => void moveTo(id)} onClose={() => setMoving(false)} /></div> : null}

    {restore ? <div className="nb-restore" role="alert">
      <span>Unsaved changes from {relativeTime(restore.savedAt)} were found on this device.</span>
      <button type="button" className="ws-button is-small is-primary" onClick={() => {
        const next = { ...draftRef.current, title: restore.title, body: restore.body };
        draftRef.current = next; setDraft(next); setRestore(null); startEditing(); scheduleSave();
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
      {editing ? <input className="nb-title-input" value={draft.title} maxLength={200} aria-label="Title"
        placeholder={lesson ? "Lesson title — e.g. HSK 2 · Chapter 4" : "Title (optional)"}
        onChange={(event) => updateDraft({ title: event.target.value })}
        onKeyDown={(event) => {
          if (!event.nativeEvent.isComposing && (event.key === "Enter" || event.key === "ArrowDown")) { event.preventDefault(); editorRef.current?.focus("start"); }
          if (event.key === "Escape") { event.preventDefault(); void closeNote(); }
          if ((event.ctrlKey || event.metaKey) && event.code === "KeyS") { event.preventDefault(); void persist(); }
        }} />
        : <h1 className="nb-doc-title">{title || <span className="ws-muted">Untitled</span>}</h1>}
      {editing && lesson ? <label className="nb-date-field">Lesson date
        <input type="date" value={draft.lessonDate} onChange={(event) => updateDraft({ lessonDate: event.target.value })} /></label> : null}
      {lessonId && !editing ? <div className="nb-lesson-strip">
        <span>{capturedNotes.length + capturedQuestions.length} captured · {capturedMistakes.length} {capturedMistakes.length === 1 ? "mistake" : "mistakes"}</span>
        {workspace.writable ? (capturing
          ? <button type="button" className="nb-live-pill" onClick={() => workspace.endLesson()} title="Quick captures are being attached to this lesson. Click to stop."><Radio size={13} /> Capturing into this lesson · End</button>
          : <button type="button" className="ws-button is-small" onClick={() => { workspace.startLesson(lessonId); workspace.toast("Quick captures will now be attached to this lesson."); }}><Radio size={13} /> Capture into this lesson</button>) : null}
      </div> : null}
      {liveEntry && isLegacyLesson(liveEntry) ? <p className="ws-muted nb-legacy-note">Created with the first Notebook version. It reads and edits normally; new captures cannot be attached to it.</p> : null}
    </header>

    {editing ? <div className="nb-doc-editor">
      {lesson && !draft.body.trim() ? <button type="button" className="ws-button is-small nb-outline-button"
        onClick={() => editorRef.current?.setMarkdown(LESSON_OUTLINE)}><ListPlus size={14} /> Add lesson outline</button> : null}
      <RichEditor ref={editorRef} resetKey={editorKey.current} value={draft.body} autoFocus
        placeholder={lesson ? "Write during or after the lesson — or add the outline above. Quick captures appear below." : "Start writing. Use # for a heading, - for a list, > for a quotation, or the Example and Rule blocks."}
        onChange={(body) => updateDraft({ body })}
        onEscape={() => void closeNote()} onDone={() => void finishEditing()} onSave={() => void persist()} />
      <p className="nb-editor-hints"><Kbd>{MOD_KEY} B</Kbd> bold · <Kbd>{MOD_KEY} I</Kbd> italic · <Kbd>{MOD_KEY} ⇧ H</Kbd> highlight · <code>[[Title]]</code> links another note · <Kbd>{MOD_KEY} ↵</Kbd> done</p>
    </div> : <div className="nb-doc-body">
      {draft.body.trim() ? <RichText text={draft.body} resolve={resolveLink} className="nb-reading" />
        : <p className="ws-muted nb-doc-empty">{lesson ? "No lesson notes written yet." : "This note is empty."}</p>}
      {workspace.writable ? <button type="button" className="nb-continue" onClick={() => startEditing("end")}><Pencil size={13} /> {draft.body.trim() ? "Add to this" : "Start writing"}</button> : null}
    </div>}

    {lessonId ? <section className="nb-lesson-extras" aria-label="Captured during this lesson">
      {capturedQuestions.length ? <div className="nb-extra-block">
        <h2 className="ws-section-title"><CircleHelp size={15} /> To revisit</h2>
        {capturedQuestions.map((capture) => <CaptureRow key={capture.id} capture={capture} onOpen={() => navigate({ topicId: capture.topic_id, docId: capture.id })}
          actions={workspace.writable ? (editing ? [{ label: "Answered", run: () => void markAnswered(capture) }] : [{ label: "Answered", run: () => void markAnswered(capture) }, { label: "Copy into lesson", run: () => void mergeCapture(capture) }]) : []} />)}
      </div> : null}
      {capturedNotes.length ? <div className="nb-extra-block">
        <h2 className="ws-section-title"><Layers size={15} /> Captured during the lesson</h2>
        {capturedNotes.map((capture) => <CaptureRow key={capture.id} capture={capture} onOpen={() => navigate({ topicId: capture.topic_id, docId: capture.id })}
          actions={workspace.writable && !editing ? [{ label: "Copy into lesson", run: () => void mergeCapture(capture) }] : []} />)}
      </div> : null}
      {capturedMistakes.length ? <div className="nb-extra-block">
        <h2 className="ws-section-title"><GraduationCap size={15} /> Mistakes from this lesson</h2>
        {capturedMistakes.map((mistake) => <button type="button" key={mistake.id} className="nb-mistake-row" onClick={() => workspace.openMistake(mistake.id)}>
          <span className="nb-mistake-attempt">{mistake.attempt || "—"}</span>
          <ArrowRight size={14} />
          <span className="nb-mistake-correct">{mistake.correction || <em>needs a correction</em>}</span>
          <small>{mistakeStage(mistake) === "to_correct" ? "To correct" : mistakeStage(mistake) === "understood" ? "Understood" : "In review"}</small>
        </button>)}
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
        {newer ? <button type="button" onClick={() => navigate({ topicId: newer.topic_id, docId: newer.id })}><ArrowLeft size={14} /><span><small>Newer</small>{entryTitle(newer)}</span></button> : <span />}
        {older ? <button type="button" className="is-next" onClick={() => navigate({ topicId: older.topic_id, docId: older.id })}><span><small>Older</small>{entryTitle(older)}</span><ArrowRight size={14} /></button> : <span />}
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

function CaptureRow({ capture, onOpen, actions }: { capture: KnowledgeEntry; onOpen: () => void; actions: Array<{ label: string; run: () => void }> }) {
  return <div className="nb-capture-row">
    <span className="nb-capture-time">{formatTime(capture.created_at)}</span>
    <div className="nb-capture-body">
      {capture.title.trim() ? <strong>{capture.title}</strong> : null}
      <RichText text={capture.body} className="is-compact" />
    </div>
    <div className="nb-capture-actions">
      {actions.map((action) => <button type="button" key={action.label} className="ws-button is-small is-quiet" onClick={action.run}>{action.label}</button>)}
      <button type="button" className="ws-button is-small is-quiet" onClick={onOpen}>Open</button>
    </div>
  </div>;
}

function DocMenu({ onMove, onCopy, onFlashcard, onDelete }: { onMove?: () => void; onCopy: () => void; onFlashcard: () => void; onDelete?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = usePopover(open, close);
  const item = (label: string, icon: React.ReactNode, run?: () => void, danger = false) => run
    ? <button type="button" role="menuitem" className={danger ? "is-danger" : ""} onClick={() => { setOpen(false); run(); }}>{icon}{label}</button> : null;
  return <div className="ws-menu" ref={ref}>
    <button type="button" className="ws-icon-button" aria-label="More actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal size={17} /></button>
    {open ? <div className="ws-menu-list is-right" role="menu">
      {item("Move to…", <FolderInput size={14} />, onMove)}
      {item("Make a flashcard…", <Layers size={14} />, onFlashcard)}
      {item("Copy text", <Copy size={14} />, onCopy)}
      {item("Delete", <Trash2 size={14} />, onDelete, true)}
    </div> : null}
  </div>;
}

