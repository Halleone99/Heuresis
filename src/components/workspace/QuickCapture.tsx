import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CornerDownLeft, GraduationCap, ListPlus, NotebookPen, Pin, Radio, TriangleAlert, X } from "lucide-react";
import { CATEGORY_LABELS, entryTitle, friendlyError, localDateKey, LIMITS, type NoteCategory } from "../../lib/knowledgeWorkspace";
import { captureDraftHasContent, readCaptureDraft, writeCaptureDraft, type CaptureDraft } from "../../lib/workspaceMemory";
import { getOfflineSyncState } from "../../lib/offlineFetch";
import { parseCaptureLine } from "../../lib/captureParse";
import { resolveCaptureContext } from "../../lib/captureContext";
import { InlineNameForm, Kbd, MOD_KEY, TopicPicker, formatDay } from "./ui";
import { DEFAULT_LANGUAGE_SUGGESTIONS, usePersonalOsObjectives } from "./usePersonalOs";
import { useWorkspace, type CaptureMode } from "./WorkspaceContext";
import { AICheck } from "./AICheck";
import { QuickFlashcard } from "./QuickFlashcard";
import { HandNotePad } from "./HandNotePad";
import { encodeHandNote } from "../../lib/handNote";

const EMPTY_DRAFT = (mode: CaptureMode): CaptureDraft => ({
  mode, text: "", category: "note", categoryTouched: false, attempt: "", correction: "", explanation: "", lessonTitle: "", updatedAt: "",
});

/** A note that reads as a question to oneself ("… why is 了 at the end?") is filed as a question. */
function looksLikeQuestion(text: string) {
  return /\?\s*$/.test(text.trim());
}

export function QuickCapture({ floating = false, onRequestClose }: { floating?: boolean; onRequestClose?: () => void } = {}) {
  const workspace = useWorkspace();
  const { capture: request, memory, updateMemory, currentLesson, userId } = workspace;
  const draftSurface = floating ? "floating" : "inline";
  const [draft, setDraft] = useState<CaptureDraft>(() => {
    const saved = readCaptureDraft(userId, draftSurface);
    return saved ? { ...saved, mode: saved.mode === "lesson" ? "note" : saved.mode } : EMPTY_DRAFT("note");
  });
  const [topicId, setTopicId] = useState<string | null>(null);
  const [captureStyle, setCaptureStyle] = useState<"raw" | "notepad" | "mistake" | "flashcard" | "handnote">("raw");
  const [forceNoCategory, setForceNoCategory] = useState(false);
  const [picking, setPicking] = useState(false);
  const [openLesson, setOpenLesson] = useState(true);
  const [lessonDate, setLessonDate] = useState(localDateKey(new Date()));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState("");
  const [creatingSubject, setCreatingSubject] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLTextAreaElement | HTMLInputElement | null>(null);
  const draftTimer = useRef<number | null>(null);
  const { objectives } = usePersonalOsObjectives(userId);

  const mode = draft.mode as CaptureMode;
  const attachToLesson = Boolean(!floating && currentLesson && memory.capture.attachToLesson && mode !== "lesson");
  const keepOpen = floating || memory.capture.keepOpen;
  // Ideas in the floating window are captured deliberately, then organised later.
  // Enter makes a new line; Ctrl+Enter saves the entire idea.
  const stream = mode === "note" && !floating && Boolean(memory.capture.stream);

  // Remember where the user was typing so closing the panel puts them straight back there.
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnRange = useRef<Range | null>(null);
  const wasOpen = useRef(false);
  // Layout effect, declared before the focusing one, so it sees the previous focus.
  useLayoutEffect(() => {
    if (request && !wasOpen.current) {
      const active = document.activeElement;
      returnFocus.current = active instanceof HTMLElement && !active.closest(".qc-panel") ? active : null;
      const selection = window.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
      returnRange.current = range && returnFocus.current?.contains(range.startContainer) ? range.cloneRange() : null;
    }
    if (!request && wasOpen.current) {
      const target = returnFocus.current;
      if (target && document.contains(target)) {
        target.focus({ preventScroll: true });
        // Put the caret back exactly where it was (contentEditable focus would jump to the start).
        const range = returnRange.current;
        if (range && target.contains(range.startContainer)) {
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
      returnFocus.current = null;
      returnRange.current = null;
    }
    wasOpen.current = Boolean(request);
  }, [request]);

  // Respond to every open request (shortcut, button) — including switching mode
  // while open. Handled during render (not in an effect) so the very first frame
  // already shows the right fields and destination: keys typed immediately after
  // the shortcut land in the right place.
  const [handledRequest, setHandledRequest] = useState<typeof request>(null);
  if (request && request !== handledRequest) {
    setHandledRequest(request);
    setCaptureStyle(request.mode === "mistake" ? "mistake" : readCaptureDraft(userId, draftSurface)?.handStrokes?.length ? "handnote" : "raw");
    setError(""); setFlash(""); setPicking(false);
    setDraft((current) => {
      const stored = captureDraftHasContent(current) ? current : readCaptureDraft(userId, draftSurface) ?? current;
      const safeMode = request.mode === "lesson" ? "note" : request.mode;
      const base = captureDraftHasContent(stored) ? stored : EMPTY_DRAFT(safeMode);
      const next = { ...base, mode: safeMode };
      if (request.text) next.text = request.text;
      if (request.category) { next.category = request.category; next.categoryTouched = true; }
      next.mistakeModeId = request.mode === "mistake" ? (request.mistakeModeId ?? null) : null;
      return next;
    });
    const lessonTopic = currentLesson && memory.capture.attachToLesson && request.mode !== "lesson" ? currentLesson.topic_id : null;
    const resolved = resolveCaptureContext({
      subjects: workspace.snapshot.subjects, topics: workspace.snapshot.topics,
      requestedTopicId: request.topicId, lessonTopicId: lessonTopic,
      savedSubjectId: memory.capture.subjectId, savedTopicId: memory.capture.topicId,
      notebookSubjectId: memory.notebook.subjectId, notebookTopicId: memory.notebook.topicId,
      documentTopicId: memory.notebook.docId ? workspace.entryById.get(memory.notebook.docId)?.topic_id : null,
    });
    setTopicId(resolved.topicId);
  }

  // Focus the first field after React has committed the fields for the current mode.
  const [focusNonce, setFocusNonce] = useState(0);
  // Layout effect: focus lands before the next keystroke is processed, so nothing
  // typed straight after the shortcut is lost.
  useLayoutEffect(() => {
    if (!request || captureStyle === "handnote") return;
    const field = firstFieldRef.current;
    if (field && document.activeElement !== field) {
      field.focus();
      const length = field.value.length;
      try { field.setSelectionRange(length, length); } catch { /* date inputs */ }
    }
  }, [request, mode, captureStyle, focusNonce, saving]);

  // Persist the draft so closing the panel (or the app) never loses a half-typed thought.
  useEffect(() => {
    if (!request) return;
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      writeCaptureDraft(userId, captureDraftHasContent(draft) || draft.lessonTitle.trim() ? { ...draft, updatedAt: new Date().toISOString() } : null, draftSurface);
    }, 250);
    return () => { if (draftTimer.current) window.clearTimeout(draftTimer.current); };
  }, [draft, request, userId]);

  const close = useCallback((options: { discard?: boolean } = {}) => {
    if (options.discard) { writeCaptureDraft(userId, null, draftSurface); setDraft(EMPTY_DRAFT(mode)); }
    else if (captureDraftHasContent(draft)) {
      writeCaptureDraft(userId, { ...draft, updatedAt: new Date().toISOString() }, draftSurface);
      workspace.toast("Draft kept — it will be here when you reopen Quick capture.");
    }
    setPicking(false);
    if (floating && onRequestClose) onRequestClose();
    else workspace.closeCapture();
  }, [draft, mode, userId, workspace, floating, onRequestClose]);

  const patch = (value: Partial<CaptureDraft>) => setDraft((current) => ({ ...current, ...value }));
  function formatSelection(prefix: string, suffix: string) {
    const field = firstFieldRef.current;
    if (!(field instanceof HTMLTextAreaElement)) return;
    const start = field.selectionStart, end = field.selectionEnd;
    const replacement = prefix + draft.text.slice(start, end) + suffix;
    patch({ text: draft.text.slice(0, start) + replacement + draft.text.slice(end) });
    window.requestAnimationFrame(() => { field.focus(); field.setSelectionRange(start + prefix.length, end + prefix.length); });
  }
  function switchCaptureStyle(style: "raw" | "notepad" | "mistake" | "flashcard" | "handnote") {
    setCaptureStyle(style);
    if (style !== "flashcard") setMode(style === "mistake" ? "mistake" : "note");
    setError("");
  }
  function noCategory() {
    if (attachToLesson) { setError("Detach the active lesson before choosing No category."); return; }
    setForceNoCategory(true);
    setTopicId(null);
    updateMemory((current) => ({ ...current, capture: { ...current.capture, subjectId: null, topicId: null } }));
  }
  const setMode = (next: CaptureMode) => { patch({ mode: next, pendingId: undefined }); setError(""); };
  const category: NoteCategory = draft.categoryTouched ? (draft.category ?? "note") : looksLikeQuestion(draft.text) ? "question" : (draft.category ?? "note");

  const destinationLabel = topicId ? workspace.pathLabel(topicId) : "";
  const subjects = workspace.snapshot.subjects;
  const lessonSubjectId = currentLesson ? workspace.topicById.get(currentLesson.topic_id)?.subject_id ?? null : null;
  const selectedSubjectId = forceNoCategory ? null : ((attachToLesson ? lessonSubjectId : null)
    ?? (topicId ? workspace.topicById.get(topicId)?.subject_id ?? null : null)
    ?? (memory.capture.subjectId && workspace.subjectById.has(memory.capture.subjectId) ? memory.capture.subjectId : null)
    ?? resolveCaptureContext({
      subjects, topics: workspace.snapshot.topics,
      savedSubjectId: memory.capture.subjectId, savedTopicId: memory.capture.topicId,
      notebookSubjectId: memory.notebook.subjectId, notebookTopicId: memory.notebook.topicId,
      documentTopicId: memory.notebook.docId ? workspace.entryById.get(memory.notebook.docId)?.topic_id : null,
    }).subjectId);
  const languageName = subjects.find((subject) => subject.id === selectedSubjectId)?.name ?? null;
  function selectLanguage(subjectId: string) {
    if (saving) return;
    setForceNoCategory(false);
    if (attachToLesson && lessonSubjectId && subjectId !== lessonSubjectId) {
      setError("This capture is attached to an active lesson. Detach it before switching language.");
      return;
    }
    const inbox = workspace.snapshot.topics.find((row) => row.subject_id === subjectId &&
      !row.parent_id && row.name.trim().toLocaleLowerCase() === "inbox");
    const nextTopic = inbox?.id ?? null;
    setTopicId(nextTopic);
    setError("");
    updateMemory((current) => ({ ...current,
      capture: { ...current.capture, subjectId, topicId: nextTopic },
    }));
  }
  const suggestions = useMemo(() => (objectives?.languages.map((language) => language.name) ?? DEFAULT_LANGUAGE_SUGGESTIONS)
    .filter((name) => !subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())).slice(0, 4), [objectives, subjects]);

  async function submit() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
    if (!workspace.writable) { setError("Apply the Notebook database update before capturing (see the notice in Notebook)."); return; }
    // Categorisation is optional: quick capture can always save to Unsorted › Inbox.
    const unsorted = subjects.find((subject) => subject.name.toLowerCase() === "unsorted");
    const destinationSubjectId = selectedSubjectId ?? unsorted?.id ?? (await workspace.addSubject("Unsorted")).id;
    let destination = topicId && workspace.topicById.get(topicId)?.subject_id === destinationSubjectId
      ? topicId : null;
    if (!destination || floating || (stream && !attachToLesson)) {
      destination = (await workspace.ensureInbox(destinationSubjectId)).id;
    }
    const lessonId = attachToLesson ? currentLesson?.id ?? null : null;
    if (lessonId && currentLesson) destination = currentLesson.topic_id;
    if (!destination) { setError("No destination could be created. Your draft is kept."); return; }
    setTopicId(destination);
    updateMemory((current) => ({ ...current, capture: { ...current.capture, subjectId: destinationSubjectId, topicId: destination } }));
    try {
      if (mode === "note") {
        if (captureStyle === "handnote" && !draft.handStrokes?.length) { setError("Draw something first."); return; }
        if (captureStyle !== "handnote" && !draft.text.trim()) { setError("Write something first."); return; }
        const handBody = captureStyle === "handnote" ? `${draft.text.trim() || "Handwritten note"}\n\n${encodeHandNote(draft.handStrokes ?? [])}` : null;
        if ((handBody ?? draft.text).length > LIMITS.body) { setError("This note is too large. Undo a few strokes before saving."); return; }
        const parsed = stream && captureStyle === "raw" ? parseCaptureLine(draft.text) : null;
        const sent = { ...draft };
        const id = sent.pendingId ?? crypto.randomUUID();
        writeCaptureDraft(userId, { ...sent, pendingId: id, updatedAt: new Date().toISOString() }, draftSurface);
        setDraft((current) => ({ ...current, pendingId: id }));
        const input = parsed?.kind === "mistake"
          ? { id, kind: "mistake" as const, topicId: destination, attempt: parsed.attempt, correction: parsed.correction,
              explanation: parsed.explanation, category: parsed.category, lessonId }
          : { id, kind: "note" as const, topicId: destination, body: handBody ?? (parsed?.kind === "note" ? parsed.body : sent.text),
              category: parsed?.kind === "note" ? parsed.category : category, lessonId };
        const label = (input.kind === "mistake" ? input.attempt || input.correction : input.body).trim().slice(0, 40);
        const created = await workspace.submitCapture(input, label, draftSurface);
        if (!created) { setError("The capture is kept for retry. It has not been discarded."); return; }
        reset(destination);
        confirmSaved(created.id, created.topic_id, input.kind === "mistake" ? "the Mistake Log" : lessonId ? "the lesson" : workspace.pathLabel(created.topic_id));
      } else if (mode === "mistake") {
        if (!draft.attempt.trim() || !draft.correction.trim()) { setError("Write the mistake and the correct version."); return; }
        const label = (draft.attempt || draft.correction).trim().slice(0, 40);
        const sent = { ...draft };
        const id = sent.pendingId ?? crypto.randomUUID();
        writeCaptureDraft(userId, { ...sent, pendingId: id, updatedAt: new Date().toISOString() }, draftSurface);
        setDraft((current) => ({ ...current, pendingId: id }));
        const created = await workspace.submitCapture({ id, kind: "mistake", topicId: destination, attempt: sent.attempt, correction: sent.correction, explanation: sent.explanation, mistakeModeId: sent.mistakeModeId ?? null, category: sent.category === "grammar" || sent.category === "vocabulary" || sent.category === "phrase" ? sent.category : "note", lessonId }, label, draftSurface);
        if (!created) { setError("The mistake is safely retained for retry. Keep this draft until its save is confirmed."); return; }
        reset(destination);
        confirmSaved(created.id, created.topic_id, "the Mistake Log");
      } else {
        const title = draft.lessonTitle.trim() || `Lesson — ${formatDay(lessonDate)}`;
        const created = await workspace.addEntry({ kind: "lesson", topicId: destination, title, body: "", lessonDate });
        writeCaptureDraft(userId, null, draftSurface);
        setDraft(EMPTY_DRAFT("note"));
        updateMemory((current) => ({ ...current, capture: { ...current.capture, topicId: destination, subjectId: selectedSubjectId } }));
        workspace.startLesson(created.id);
        workspace.closeCapture();
        workspace.toast(`Lesson started. Quick captures now attach to “${entryTitle(created)}”.`);
        if (openLesson) workspace.openDocument(created.id, { edit: true });
      }
    } catch (submitError) {
      setError(friendlyError(submitError));
    }
    } finally { setSaving(false); }
  }

  function reset(savedTopicId: string) {
    const savedSubjectId = workspace.topicById.get(savedTopicId)?.subject_id ?? selectedSubjectId;
    updateMemory((current) => ({ ...current, capture: { ...current.capture,
      topicId: savedTopicId, subjectId: savedSubjectId,
    } }));
    // Clear only what was just saved; text typed in another mode stays as a draft.
    setDraft((current) => {
      const next = current.mode === "note"
        ? { ...current, text: "", handStrokes: captureStyle === "handnote" ? [] : current.handStrokes, category: "note" as const, categoryTouched: false, pendingId: undefined }
        : { ...current, attempt: "", correction: "", explanation: "", pendingId: undefined };
      writeCaptureDraft(userId, captureDraftHasContent(next) ? next : null, draftSurface);
      return next;
    });
    if (keepOpen || stream) {
      setFlash("Saved. Ready for the next line.");
      setFocusNonce((value) => value + 1);
    } else {
      workspace.closeCapture();
    }
  }

  function confirmSaved(id: string, savedTopicId: string, where: string) {
    // "Online" only means a network exists. If the write was queued (server
    // unreachable, captive portal), say so instead of claiming it is stored.
    const sync = getOfflineSyncState();
    const local = !sync.online || sync.pending > 0;
    const message = local ? `Saved on this device — will sync to ${where}.` : `Saved to ${where}.`;
    if ((keepOpen || stream) && workspace.capture) setFlash(message);
    workspace.toast(message, {
      action: {
        label: "Undo",
        run: () => { void workspace.removeEntry(id, { undo: false }).then(() => workspace.toast("Capture removed.")).catch((removeError) => workspace.toast(friendlyError(removeError), { tone: "error" })); },
      },
    });
    void savedTopicId;
  }

  if (!request) return null;

  const hasContent = captureDraftHasContent(draft);
  const noSubjects = !subjects.length;

  return <div className="qc-panel" ref={panelRef} role="dialog" aria-label="Quick capture"
    onKeyDown={(event) => {
      // A capture is its own keyboard layer, even above a Study modal.
      event.stopPropagation();
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "Escape" && !picking && !creatingSubject) { event.preventDefault(); close(); }
      if (mod && event.key === "Enter" && captureStyle !== "flashcard") { event.preventDefault(); void submit(); }
    }}>
    {!floating ? <div className="qc-head">
      <strong className="qc-head-title">Quick Capture</strong>
      <span className="qc-head-spacer" />
      {mode === "note" && !floating ? <button type="button" className={`qc-stream-toggle ${stream ? "is-active" : ""}`} aria-pressed={stream}
        title={stream ? "Switch to structured note capture" : "Rapid continuous capture: Enter saves"}
        onClick={() => updateMemory((current) => ({ ...current, capture: { ...current.capture, stream: !current.capture.stream } }))}>
        <ListPlus size={14} /> Stream</button> : null}
      {mode !== "lesson" && !floating ? <button type="button" className={`ws-icon-button ${keepOpen ? "is-on" : ""}`} aria-pressed={keepOpen}
        aria-label="Keep open after saving"
        title={keepOpen ? "Keeps open after saving (for several notes in a row) — click to close after each save" : "Keep open after saving"}
        onClick={() => updateMemory((current) => ({ ...current, capture: { ...current.capture, keepOpen: !current.capture.keepOpen } }))}>
        {/* One pin icon; filled means on. A crossed-out pin read as an "unpin" action. */}
        <Pin size={15} fill={keepOpen ? "currentColor" : "none"} /></button> : null}
      <button type="button" className="ws-icon-button" aria-label="Close quick capture" title="Close (Esc) — the draft is kept" onClick={() => close()}><X size={16} /></button>
    </div> : null}
    {mode !== "lesson" ? <div className="qc-kind-row">
      <span>Capture as</span>
      <select aria-label="Capture type" value={captureStyle} disabled={saving}
        onChange={(event) => switchCaptureStyle(event.target.value as typeof captureStyle)}>
        <option value="raw">Raw</option>
        <option value="flashcard">Flashcard</option>
        <option value="mistake">Mistake Log</option>
        <option value="notepad">Notepad</option>
        <option value="handnote">Handwritten note</option>
      </select>
    </div> : null}
    {floating ? <div className="qc-floating-destination">
      <label htmlFor="quick-capture-subject">Save idea to</label>
      <select id="quick-capture-subject" aria-label="Save capture to subject Inbox" disabled={saving || !workspace.writable}
        value={selectedSubjectId ?? ""}
        onChange={(event) => { if (event.target.value) selectLanguage(event.target.value); else noCategory(); }}>
        <option value="">No category</option>
        {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name} › Inbox</option>)}
      </select>

    </div> : null}

    {noSubjects && workspace.loading ? <p className="qc-help qc-loading" role="status"><span className="ws-spinner is-small" aria-hidden="true" /> Loading your subjects… keep typing, the draft is kept.</p> : null}
    {!floating && noSubjects && workspace.writable && !workspace.loading ? <div className="qc-first-run">
      <strong>Capture first, organise later</strong>
      <p>You can save straight away in Unsorted › Inbox, or choose a subject below.</p>
      {creatingSubject ? <InlineNameForm label="Subject name" placeholder="Philosophy, German…" onCancel={() => setCreatingSubject(false)}
        onSubmit={async (name) => { const subject = await workspace.addSubject(name); const inbox = await workspace.ensureInbox(subject.id); setTopicId(inbox.id); updateMemory((current) => ({ ...current, capture: { ...current.capture, subjectId: subject.id, topicId: inbox.id } })); setCreatingSubject(false); }} />
        : <div className="qc-chips">
          {suggestions.map((name) => <button type="button" key={name} className="ws-button is-small" onClick={async () => {
            try { const subject = await workspace.addSubject(name); const inbox = await workspace.ensureInbox(subject.id); setTopicId(inbox.id); updateMemory((current) => ({ ...current, capture: { ...current.capture, subjectId: subject.id, topicId: inbox.id } })); }
            catch (createError) { setError(friendlyError(createError)); }
          }}>{name}</button>)}
          <button type="button" className="ws-button is-small is-quiet" onClick={() => setCreatingSubject(true)}>Other…</button>
        </div>}
    </div> : null}

    <div className="qc-body">
      {captureStyle === "flashcard" && mode !== "lesson" ? <QuickFlashcard
        userId={userId} subjectName={languageName ?? "No category"}
        onSaved={() => workspace.toast("Flashcard saved to Study.")} /> : mode === "note" && captureStyle === "handnote" ? <>
        <HandNotePad strokes={draft.handStrokes ?? []} onChange={(handStrokes) => patch({ handStrokes })} disabled={saving} />
        <input className="qc-main-input" style={{ minHeight: 0, height: 42 }} aria-label="Handwriting caption (optional)"
          placeholder="Title or short description (optional)" value={draft.text} disabled={saving}
          onChange={(event) => patch({ text: event.target.value })} />
        <p className="qc-help">Your handwriting is saved as a vector drawing in a normal Notebook note.</p>
      </> : mode === "note" ? <>
        <textarea ref={(node) => { if (node) firstFieldRef.current = node; }} className="qc-main-input" rows={captureStyle === "notepad" ? 6 : stream ? 2 : 3} value={draft.text}
          aria-label={floating ? "Capture an idea" : stream ? "Stream capture" : "Quick note"}
          placeholder={captureStyle === "notepad" ? "Write freely. Enter adds a new line; Ctrl+Enter saves." : floating ? "A thought, a question, an observation…\nWrite freely, then save this idea." : stream ? "One thought per line. Enter to save; Shift+Enter for a line break." : "A phrase, a question, an explanation… capture it now, organise it later."}
          disabled={saving} onChange={(event) => patch({ text: event.target.value })}
          onKeyDown={(event) => {
            // Notepad behaves like a text editor: Enter inserts a newline.
            // Ctrl/Cmd+Enter or Ctrl/Cmd+S explicitly saves the note.
            if (captureStyle === "notepad" && (event.ctrlKey || event.metaKey) &&
                (event.key === "Enter" || event.code === "KeyS") &&
                !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              void submit();
              return;
            }
            if (stream && captureStyle !== "notepad" && event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
              event.preventDefault();
              void submit();
            }
          }} />
        <div className="qc-editor-tools" role="toolbar" aria-label="Text formatting and checking">
          <button type="button" aria-label="Bold selection" title="Bold selection" onClick={() => formatSelection("**", "**")}><strong>B</strong></button>
          <button type="button" aria-label="Italic selection" title="Italic selection" onClick={() => formatSelection("*", "*")}><em>I</em></button>
          <AICheck text={draft.text} language={languageName ?? "Unknown"} onApply={(next) => patch({ text: next })} compact />
        </div>
        {floating ? null : stream && captureStyle !== "notepad" ? <div className="qc-stream-meta">
          <span>{draft.text.trim() ? parseCaptureLine(draft.text).preview : "Note"} → {attachToLesson && currentLesson ? entryTitle(currentLesson) : languageName ? `${languageName} › Inbox` : "Choose subject"}</span>
          <span><Kbd>Enter</Kbd> save · <Kbd>⇧ Enter</Kbd> newline</span>
          <small>Use a → b for mistakes, // for why, #g grammar, #v vocabulary, #e expressions; ? for questions.</small>
        </div> : <div className="qc-categories" role="radiogroup" aria-label="Kind of note">
          {(Object.keys(CATEGORY_LABELS) as NoteCategory[]).map((key) => <button key={key} type="button" role="radio" aria-checked={category === key}
            className={category === key ? "is-active" : ""} onClick={() => patch({ category: key, categoryTouched: true })}>{CATEGORY_LABELS[key]}</button>)}
        </div>}
      </> : mode === "mistake" ? <>
        <label className="qc-field"><span>Mistake</span>
          <textarea ref={(node) => { if (node) firstFieldRef.current = node; }} rows={2} value={draft.attempt}
            placeholder="What did you get wrong?" onChange={(event) => patch({ attempt: event.target.value })} /></label>
        <label className="qc-field"><span>Correction</span>
          <textarea rows={2} value={draft.correction} placeholder="What is the correct version?"
            onChange={(event) => patch({ correction: event.target.value })} /></label>
        <AICheck text={draft.correction} language={languageName ?? "Unknown"} context="mistake"
          onApply={(next) => patch({ correction: next })} compact />
      </> : <>
        <label className="qc-field"><span>Lesson</span>
          <input ref={(node) => { if (node) firstFieldRef.current = node; }} value={draft.lessonTitle} maxLength={200}
            placeholder={`e.g. HSK 2 · Chapter 4   (default: Lesson — ${formatDay(lessonDate)})`}
            onChange={(event) => patch({ lessonTitle: event.target.value })}
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); void submit(); } }} /></label>
        <div className="qc-lesson-row">
          <label className="qc-field is-inline"><span>Date</span><input type="date" value={lessonDate} onChange={(event) => setLessonDate(event.target.value)} /></label>
          <label className="qc-check"><input type="checkbox" checked={openLesson} onChange={(event) => setOpenLesson(event.target.checked)} /> Open the lesson page</label>
        </div>
        <p className="qc-help">Starts an empty lesson document. Notes and mistakes you capture next are attached to it until you end the lesson.</p>
      </>}
    </div>

    {!floating && captureStyle !== "flashcard" ? <div className="qc-destination">
      {subjects.length > 1 ? <div className="qc-language-choices" role="group" aria-label="Capture subject">
        <span className="qc-language-caption">Subject</span>
        {subjects.map((subject) => <button type="button" key={subject.id}
          className={selectedSubjectId === subject.id ? "is-active" : ""}
          aria-pressed={selectedSubjectId === subject.id} disabled={saving}
          title={attachToLesson && lessonSubjectId !== subject.id ? "Detach from the active lesson to change subject" : `Save captures in ${subject.name}`}
          onClick={() => selectLanguage(subject.id)}>{subject.name}</button>)}
      </div> : null}
      <div className="qc-destination-row">
        <span className="qc-label">Save in</span>
        <button type="button" className="qc-topic" aria-haspopup="listbox" aria-expanded={picking} onClick={() => setPicking((value) => !value)} disabled={noSubjects}>
          {stream && !attachToLesson ? (languageName ? `${languageName} › Inbox` : "Choose subject") : destinationLabel || (languageName ? `${languageName} › Inbox` : "Choose subject")} <ChevronDown size={13} />
        </button>
        {currentLesson && mode !== "lesson" ? <button type="button" className={`qc-lesson-chip ${attachToLesson ? "is-on" : ""}`} aria-pressed={attachToLesson}
          title={attachToLesson ? "Attached to the current lesson — click to file it on its own" : "Attach to the current lesson"}
          onClick={() => {
            const next = !memory.capture.attachToLesson;
            updateMemory((current) => ({ ...current, capture: { ...current.capture, attachToLesson: next } }));
            if (next && currentLesson) setTopicId(currentLesson.topic_id);
          }}>
          <Radio size={12} /> {attachToLesson ? entryTitle(currentLesson) : "Not in lesson"}
        </button> : null}
      </div>
      {picking ? <div className="qc-picker"><TopicPicker value={topicId} onChange={(id) => { setTopicId(id); const subjectId = workspace.topicById.get(id)?.subject_id ?? null; updateMemory((current) => ({ ...current, capture: { ...current.capture, topicId: id, subjectId } })); setPicking(false); firstFieldRef.current?.focus(); }} onClose={() => setPicking(false)} /></div> : null}
    </div> : null}

    {error ? <p className="ws-field-error qc-error" role="alert">{error}</p> : null}
    {flash ? <p className="qc-flash" role="status">{flash}</p> : null}

    {captureStyle !== "flashcard" || mode === "lesson" ? <div className="qc-foot">
      <span className="qc-hint">{floating ? <>{captureStyle === "handnote" ? "Draw your note" : "Enter for a new line"} · <Kbd>{MOD_KEY} ↵</Kbd> to save</> : stream ? <><Kbd>Enter</Kbd> save · </> : <><Kbd>{MOD_KEY} ↵</Kbd> save · </>}{!floating ? <><Kbd>Esc</Kbd> close{hasContent ? " (draft kept)" : ""}</> : null}</span>
      {hasContent && !floating ? <button type="button" className="ws-button is-quiet is-small" onClick={() => close({ discard: true })}>Discard</button> : null}
      <button type="button" className="ws-button is-primary" disabled={saving || (floating && !(mode === "mistake" ? draft.attempt.trim() && draft.correction.trim() : captureStyle === "handnote" ? Boolean(draft.handStrokes?.length) : draft.text.trim()))} onClick={() => void submit()}>
        {saving ? <><span className="ws-spinner is-small" aria-hidden="true" /> Saving…</>
          : mode === "lesson" ? <><GraduationCap size={15} /> Start lesson</> : <><CornerDownLeft size={15} /> {floating ? "Save idea" : "Save"}</>}
      </button>
    </div> : null}
  </div>;
}
