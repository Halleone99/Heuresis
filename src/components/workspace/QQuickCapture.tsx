import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Feather, Maximize2, Minimize2, X } from "lucide-react";
import { HandNotePad } from "./HandNotePad";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { encodeHandNote } from "../../lib/handNote";
import type { HandStroke } from "../../lib/handNote";
import { friendlyError, LIMITS } from "../../lib/knowledgeWorkspace";
import { getOfflineSyncState } from "../../lib/offlineFetch";
import { quickQueueBody, quickQueueDescription, type QuickQueueKind } from "../../lib/quickQueue";
import { useWorkspace } from "./WorkspaceContext";
import "./q-queue.css";

type Draft = {
  type: QuickQueueKind; handwriting: boolean;
  text: string; front: string; back: string; wrong: string; correct: string;
  strokes: HandStroke[]; id?: string;
};
const blank = (): Draft => ({
  type: "note", handwriting: false, text: "", front: "", back: "", wrong: "", correct: "", strokes: [],
});
const kinds: { value: QuickQueueKind; label: string }[] = [
  { value: "note", label: "Note" },
  { value: "flashcard", label: "Flashcard" }, { value: "mistake", label: "Mistake" },
];
function draftKey(userId: string, floating: boolean) {
  return `heuresis.q.captureDraft.v1:${userId}:${floating ? "floating" : "main"}`;
}
function readDraft(key: string): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null") as Partial<Draft> | null;
    if (saved && (saved.type === "raw" || kinds.some(({ value }) => value === saved.type))) return { ...blank(), ...saved, type: saved.type === "raw" ? "note" : saved.type! };
  } catch { /* ignore damaged local draft */ }
  return blank();
}
export function QQuickCapture({ floating = false, onRequestClose, expanded = false, onExpandedChange }: {
  floating?: boolean; onRequestClose?: () => void; expanded?: boolean; onExpandedChange?: (expanded: boolean) => void;
} = {}) {
  const workspace = useWorkspace();
  const request = workspace.capture;
  const key = draftKey(workspace.userId, floating);
  const [draft, setDraft] = useState<Draft>(() => readDraft(key));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [formatted, setFormatted] = useState(false);
  const [panelExpanded, setPanelExpanded] = useState(false);
  const [editorVersion, setEditorVersion] = useState(0);
  const richEditor = useRef<RichEditorHandle>(null);
  const isExpanded = floating ? expanded : panelExpanded;
  const setExpanded = (value: boolean) => floating ? onExpandedChange?.(value) : setPanelExpanded(value);
  const [lastRequest, setLastRequest] = useState<typeof request>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; fromX: number; fromY: number; left: number; top: number } | null>(null);
  const positionKey = `heuresis.q.capturePosition.v1:${workspace.userId}`;
  const [position, setPosition] = useState<{ x: number; y: number } | null>(() => {
    if (floating) return null;
    try {
      const saved = JSON.parse(localStorage.getItem(positionKey) || "null") as { x?: number; y?: number } | null;
      return saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)
        ? { x: Number(saved.x), y: Number(saved.y) } : null;
    } catch { return null; }
  });

  // Drag the panel by its title bar, never by the editor, buttons, or handwriting canvas.
  // Keep the full editor above the bottom navigation and inside the available viewport.
  function boundPosition(left: number, top: number) {
    const panel = panelRef.current;
    const rect = panel?.getBoundingClientRect();
    const width = rect?.width ?? 470;
    const height = rect?.height ?? 440;
    const edge = 8;
    const bottomReserved = window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches ? 74 : 8;
    const upperReserved = window.matchMedia("(pointer: coarse) and (max-width: 900px)").matches ? 90 : 8;
    return {
      x: Math.max(edge, Math.min(left, window.innerWidth - width - edge)),
      y: Math.max(upperReserved, Math.min(top, window.innerHeight - height - bottomReserved)),
    };
  }
  function beginDrag(event: ReactPointerEvent<HTMLElement>) {
    if (floating || (event.pointerType === "mouse" && event.button !== 0) ||
        (event.target as HTMLElement).closest("button")) return;
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { pointerId: event.pointerId, fromX: event.clientX, fromY: event.clientY, left: rect.left, top: rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function moveDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    setPosition(boundPosition(current.left + event.clientX - current.fromX, current.top + event.clientY - current.fromY));
  }
  function endDrag(event: ReactPointerEvent<HTMLElement>) {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const next = boundPosition(current.left + event.clientX - current.fromX, current.top + event.clientY - current.fromY);
    drag.current = null;
    setPosition(next);
    try { localStorage.setItem(positionKey, JSON.stringify(next)); } catch { /* optional position memory */ }
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  useEffect(() => {
    if (floating) return;
    const fit = () => setPosition((current) => current ? boundPosition(current.x, current.y) : null);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [floating]);
  useEffect(() => {
    if (!floating && request && position) {
      const safe = boundPosition(position.x, position.y);
      if (safe.x !== position.x || safe.y !== position.y) setPosition(safe);
    }
  }, [request, floating]);

  if (request && request !== lastRequest) {
    setLastRequest(request);
    // A shortcut names a provisional Q label; it never creates a final record.
    if (request.mode === "mistake") setDraft((current) => ({ ...current, type: "mistake" }));
    else if (request.mode === "note") setDraft((current) => ({ ...current, type: "note" }));
  }
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* optional draft cache */ }
  }, [draft, key]);
  if (!request) return null;

  // Keep the same record ID while editing an unsent draft: retry must not create a second capture.
  const patch = (values: Partial<Draft>) => { setDraft((current) => ({ ...current, ...values })); setError(""); };
  const latestFormattedText = () => draft.type === "note" && formatted && !draft.handwriting
    ? richEditor.current?.getMarkdown() ?? draft.text : draft.text;
  const preserveFormattedText = () => {
    const text = latestFormattedText();
    if (text !== draft.text) setDraft((current) => ({ ...current, text }));
    return text;
  };
  const close = () => {
    preserveFormattedText();
    if (floating && onRequestClose) onRequestClose(); else workspace.closeCapture();
  };
  const valid = draft.handwriting ? draft.strokes.length > 0 :
    draft.type === "flashcard" ? !!draft.front.trim() && !!draft.back.trim() :
    draft.type === "mistake" ? !!draft.wrong.trim() && !!draft.correct.trim() : !!draft.text.trim();

  async function save() {
    const currentText = latestFormattedText();
    const body = draft.handwriting
      ? [draft.text.trim(), encodeHandNote(draft.strokes)].filter(Boolean).join("\n\n")
      : quickQueueBody(draft.type, { ...draft, text: currentText });
    if (saving || (draft.type === "note" && !draft.handwriting ? !currentText.trim() : !valid)) return;
    setSaving(true); setError("");
    try {
      if (!workspace.writable) throw new Error("Notebook storage is not ready. Your draft is preserved.");
      if (body.length > LIMITS.body) throw new Error("This capture is too long. Shorten it before saving.");
      // No final categorisation at capture time. A normal backed-up note record
      // holds the queue content, with a durable Q marker in its description.
      const unsorted = workspace.snapshot.subjects.find((subject) => subject.name.toLowerCase() === "unsorted")
        ?? await workspace.addSubject("Unsorted");
      const inbox = await workspace.ensureInbox(unsorted.id);
      const id = draft.id ?? crypto.randomUUID();
      if (!draft.id) setDraft((current) => ({ ...current, id }));
      const result = await workspace.submitCapture({
        id, kind: "note", topicId: inbox.id, description: quickQueueDescription(draft.type),
        body, category: "note",
      }, body.slice(0, 45) || "Handwritten capture", floating ? "floating" : "inline");
      if (!result) { setError("The capture is kept for retry. It has not been discarded."); return; }
      const next = blank();
      setDraft(next);
      setEditorVersion((value) => value + 1);
      try { localStorage.removeItem(key); } catch { /* optional */ }
      if (getOfflineSyncState().pending) workspace.toast("Saved on this device; waiting to sync.");
      if (!floating) workspace.closeCapture();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setSaving(false); }
  }
  const simple = draft.type === "raw" || draft.type === "note";
  return <div ref={panelRef} className={`qc-panel q-capture-panel ${floating ? "is-floating" : ""} ${isExpanded ? "is-expanded" : ""}`}
    style={!floating && !isExpanded && position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}
    role="dialog" aria-label="Quick Capture"
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); if (isExpanded) setExpanded(false); else close(); }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); }
    }}>
    {!floating ? <header className="q-capture-head" onPointerDown={beginDrag}
      onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
      aria-label="Drag Quick Capture window"><span><Feather size={18}/> Quick Capture</span>
      <div className="q-capture-head-actions">
        <button type="button" aria-label={isExpanded ? "Restore floating capture" : "Expand capture to full screen"}
          title={isExpanded ? "Restore window" : "Full screen"} onClick={() => setExpanded(!isExpanded)}>
          {isExpanded ? <Minimize2 size={18}/> : <Maximize2 size={18}/>}</button>
        <button type="button" aria-label="Close Quick Capture" onClick={close}><X size={18}/></button>
      </div></header> : null}
    <div className="q-capture-types" role="group" aria-label="Capture type">
      {kinds.map((kind) => <button type="button" key={kind.value} aria-pressed={draft.type === kind.value}
        className={draft.type === kind.value ? "active" : ""}
        onClick={() => { preserveFormattedText(); patch({ type: kind.value, handwriting: kind.value === "note" ? draft.handwriting : false }); }}>{kind.label}</button>)}
    </div>
    <div className="q-capture-mode" role="group" aria-label="Input mode">
      <span>{draft.handwriting ? "Handwriting" : formatted && draft.type === "note" ? "Note editor" : "Quick capture"}</span>
      <div>
        {draft.type === "note" && !draft.handwriting ? <button className={formatted ? "active" : ""} type="button"
          aria-pressed={formatted} title={formatted ? "Return to fast plain-text capture" : "Open formatting tools"}
          onClick={() => { preserveFormattedText(); setFormatted((value) => !value); }}>{formatted ? "Quick" : "Format"}</button> : null}
        <button className={!draft.handwriting ? "active" : ""} type="button" onClick={() => patch({ handwriting: false })}>Text</button>
        <button className={draft.handwriting ? "active" : ""} type="button" onClick={() => { preserveFormattedText(); patch({ handwriting: true, type: "note" }); }}>Pen</button>
      </div>
    </div>
    <div className="q-capture-editor">
      {draft.handwriting ? <>
        <HandNotePad strokes={draft.strokes} onChange={(strokes) => patch({ strokes })} disabled={saving}/>
        <input value={draft.text} onChange={(event) => patch({ text: event.target.value })}
          aria-label="Optional caption" placeholder="Caption (optional)"/>
      </> : simple && formatted ? <RichEditor ref={richEditor} value={draft.text}
        resetKey={`${key}:${editorVersion}`} ariaLabel="Formatted capture note"
        placeholder="Write your lesson or notes…" autoFocus
        onChange={(text) => patch({ text })} onDone={() => void save()} onSave={() => void save()}/> :
        simple ? <textarea autoFocus aria-label="Quick note" value={draft.text}
        placeholder="Capture a thought…"
        onChange={(event) => patch({ text: event.target.value })}/> :
        draft.type === "flashcard" ? <>
          <label>Front<textarea value={draft.front} placeholder="Question or phrase…" onChange={(event) => patch({ front: event.target.value })}/></label>
          <label>Back<textarea value={draft.back} placeholder="Answer or translation…" onChange={(event) => patch({ back: event.target.value })}/></label>
        </> : <>
          <label>Mistake<textarea value={draft.wrong} placeholder="What was wrong?" onChange={(event) => patch({ wrong: event.target.value })}/></label>
          <label>Correction<textarea value={draft.correct} placeholder="Correct version…" onChange={(event) => patch({ correct: event.target.value })}/></label>
        </>}
    </div>
    {error ? <p className="q-capture-error" role="alert">{error}</p> : null}
    <footer className="q-capture-footer">
      <span>File it later from Captures.</span>
      <button type="button" className="q-primary" disabled={saving || !valid} onClick={() => void save()}>
        {saving ? "Saving…" : "Save"}
      </button>
    </footer>
  </div>;
}
