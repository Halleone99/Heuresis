import { useEffect, useState } from "react";
import { Feather, X } from "lucide-react";
import { HandNotePad } from "./HandNotePad";
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
  type: "raw", handwriting: false, text: "", front: "", back: "", wrong: "", correct: "", strokes: [],
});
const kinds: { value: QuickQueueKind; label: string }[] = [
  { value: "raw", label: "Raw" }, { value: "note", label: "Note" },
  { value: "flashcard", label: "Flashcard" }, { value: "mistake", label: "Mistake" },
];
function draftKey(userId: string, floating: boolean) {
  return `heuresis.q.captureDraft.v1:${userId}:${floating ? "floating" : "main"}`;
}
function readDraft(key: string): Draft {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null") as Partial<Draft> | null;
    if (saved && kinds.some(({ value }) => value === saved.type)) return { ...blank(), ...saved };
  } catch { /* ignore damaged local draft */ }
  return blank();
}
export function QQuickCapture({ floating = false, onRequestClose }: {
  floating?: boolean; onRequestClose?: () => void;
} = {}) {
  const workspace = useWorkspace();
  const request = workspace.capture;
  const key = draftKey(workspace.userId, floating);
  const [draft, setDraft] = useState<Draft>(() => readDraft(key));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [lastRequest, setLastRequest] = useState<typeof request>(null);
  if (request && request !== lastRequest) {
    setLastRequest(request);
    // A shortcut names a provisional Q label; it never creates a final record.
    if (request.mode === "mistake") setDraft((current) => ({ ...current, type: "mistake" }));
    else if (request.mode === "note") setDraft((current) => ({ ...current, type: current.type || "raw" }));
  }
  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* optional draft cache */ }
  }, [draft, key]);
  if (!request) return null;

  const patch = (values: Partial<Draft>) => { setDraft((current) => ({ ...current, ...values, id: undefined })); setError(""); };
  const close = () => { if (floating && onRequestClose) onRequestClose(); else workspace.closeCapture(); };
  const body = draft.handwriting
    ? [draft.text.trim(), encodeHandNote(draft.strokes)].filter(Boolean).join("\n\n")
    : quickQueueBody(draft.type, draft);
  const valid = draft.handwriting ? draft.strokes.length > 0 :
    draft.type === "flashcard" ? !!draft.front.trim() && !!draft.back.trim() :
    draft.type === "mistake" ? !!draft.wrong.trim() && !!draft.correct.trim() : !!draft.text.trim();

  async function save() {
    if (saving || !valid) return;
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
      try { localStorage.removeItem(key); } catch { /* optional */ }
      workspace.toast(getOfflineSyncState().pending ? "Saved on this device for Q; awaiting sync." : "Saved to Q.");
      if (!floating) workspace.closeCapture();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setSaving(false); }
  }
  const simple = draft.type === "raw" || draft.type === "note";
  return <div className={`qc-panel q-capture-panel ${floating ? "is-floating" : ""}`}
    role="dialog" aria-label="Quick Capture"
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); }
    }}>
    {!floating ? <header className="q-capture-head"><span><Feather size={18}/> Quick Capture</span>
      <button type="button" aria-label="Close Quick Capture" onClick={close}><X size={18}/></button></header> : null}
    <div className="q-capture-types" role="group" aria-label="Capture type">
      {kinds.map((kind) => <button type="button" key={kind.value} aria-pressed={draft.type === kind.value}
        className={draft.type === kind.value ? "active" : ""}
        onClick={() => patch({ type: kind.value })}>{kind.label}</button>)}
    </div>
    <div className="q-capture-mode" role="group" aria-label="Input mode">
      <span>Capture to Q</span>
      <div>
        <button className={!draft.handwriting ? "active" : ""} type="button" onClick={() => patch({ handwriting: false })}>Text</button>
        <button className={draft.handwriting ? "active" : ""} type="button" onClick={() => patch({ handwriting: true })}>Pen</button>
      </div>
    </div>
    <div className="q-capture-editor">
      {draft.handwriting ? <>
        <HandNotePad strokes={draft.strokes} onChange={(strokes) => patch({ strokes })} disabled={saving}/>
        <input value={draft.text} onChange={(event) => patch({ text: event.target.value })}
          aria-label="Optional caption" placeholder="Caption (optional)"/>
      </> : simple ? <textarea autoFocus aria-label="Quick note" value={draft.text}
        placeholder={draft.type === "raw" ? "Capture a thought…" : "Write your note…"}
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
      <span>Sort and convert later in Q.</span>
      <button type="button" className="q-primary" disabled={saving || !valid} onClick={() => void save()}>
        {saving ? "Saving…" : "Save to Q"}
      </button>
    </footer>
  </div>;
}
