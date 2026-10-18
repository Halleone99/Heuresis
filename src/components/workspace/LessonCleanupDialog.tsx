import { useEffect, useMemo, useRef, useState } from "react";
import {
  Check, FolderInput, Layers,
  ListPlus, Trash2, TriangleAlert, X,
} from "lucide-react";
import {
  CATEGORY_LABELS, entryPreview, entryTitle, friendlyError,
  type KnowledgeEntry, type NoteCategory,
} from "../../lib/knowledgeWorkspace";
import { cleanupCandidates, mergedCaptureText, type CleanupTarget } from "../../lib/lessonCleanup";
import { FlashcardDialog } from "./FlashcardDialog";
import { Kbd, Portal, TopicPicker, formatTime, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

const TYPES: NoteCategory[] = ["note", "question", "grammar", "vocabulary", "phrase"];
const SHORTCUTS = ["1", "2", "3", "4", "5"] as const;

export function LessonCleanupDialog({ target, onClose }: { target: CleanupTarget; onClose: () => void }) {
  const workspace = useWorkspace();
  const [selected, setSelected] = useState<string[]>([]);
  const [focusIndex, setFocusIndex] = useState(0);
  const [moving, setMoving] = useState(false);
  const [merging, setMerging] = useState(false);
  const [converting, setConverting] = useState(false);
  const [mistakeAttempt, setMistakeAttempt] = useState("");
  const [mistakeCorrection, setMistakeCorrection] = useState("");
  const [mistakeExplanation, setMistakeExplanation] = useState("");
  const [mistakeTopic, setMistakeTopic] = useState("");
  const [mergeTitle, setMergeTitle] = useState("");
  const [mergeBody, setMergeBody] = useState("");
  const [mergeTopic, setMergeTopic] = useState("");
  const [flashcard, setFlashcard] = useState<KnowledgeEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirmElement, confirm] = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);

  const items = useMemo(() => cleanupCandidates(target, workspace.snapshot.entries, workspace.snapshot.topics),
    [target, workspace.snapshot.entries, workspace.snapshot.topics]);
  const originTopicId = target.kind === "lesson"
    ? workspace.entryById.get(target.id)?.topic_id ?? ""
    : target.id;
  const topic = workspace.topicById.get(originTopicId);
  const heading = target.kind === "lesson"
    ? entryTitle(workspace.entryById.get(target.id) ?? { title: "Lesson", kind: "lesson" } as KnowledgeEntry)
    : workspace.pathLabel(originTopicId);
  const focused = items[Math.min(focusIndex, Math.max(0, items.length - 1))] ?? null;
  const selectedItems = items.filter((item) => selected.includes(item.id));
  const actionable = selectedItems.length ? selectedItems : focused ? [focused] : [];

  useEffect(() => {
    const ids = new Set(items.map((item) => item.id));
    setSelected((current) => current.filter((id) => ids.has(id)));
    setFocusIndex((current) => Math.max(0, Math.min(current, Math.max(items.length - 1, 0))));
  }, [items]);
  useEffect(() => { setMergeTopic(originTopicId); }, [originTopicId]);
  function focusRow(index: number) {
    const next = Math.max(0, Math.min(items.length - 1, index));
    setFocusIndex(next);
    listRef.current?.querySelectorAll<HTMLButtonElement>(".lc-row-focus")[next]?.focus();
  }
  function toggle(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((one) => one !== id) : [...current, id]);
  }

  async function perform(operation: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
  }
  async function changeType(value: NoteCategory, rows: KnowledgeEntry[] = actionable) {
    if (!workspace.writable || !rows.length || busy) return;
    await perform(async () => {
      let changed = 0;
      for (const row of rows) {
        try {
          if (row.category !== value) { await workspace.patchEntry(row.id, { category: value }); changed++; }
        } catch (err) {
          throw new Error(`${changed} changed before the error. ${friendlyError(err)}`);
        }
      }
      setNotice(`${changed} ${changed === 1 ? "entry" : "entries"} categorised as ${CATEGORY_LABELS[value]}. Move them to a topic when you are ready.`);
    });
  }
  async function moveTo(destination: string) {
    if (!destination || !workspace.writable || busy || !actionable.length) return;
    if (destination === originTopicId) {
      setError("Choose another topic to file these entries. They are already in this one.");
      return;
    }
    const targetTopic = workspace.topicById.get(destination);
    if (!targetTopic || !topic || targetTopic.subject_id !== topic.subject_id) {
      setError("Choose a topic in the same language. Moving between languages needs a separate review.");
      return;
    }
    await perform(async () => {
      let moved = 0;
      for (const row of actionable) {
        try { await workspace.patchEntry(row.id, { topic_id: destination }); moved++; }
        catch (err) { throw new Error(`${moved} moved; remaining entries were kept. ${friendlyError(err)}`); }
      }
      setMoving(false); setSelected([]);
      setNotice(`${moved} ${moved === 1 ? "entry" : "entries"} filed in ${workspace.pathLabel(destination)}. Original lesson references were preserved.`);
    });
  }
  function prepareMistake() {
    if (actionable.length !== 1 || actionable[0].kind !== "note") {
      setError("Select one idea to turn into a mistake.");
      return;
    }
    setError("");
    setMerging(false);
    setMoving(false);
    setMistakeAttempt(actionable[0].body.trim().slice(0, 5000));
    setMistakeCorrection("");
    setMistakeExplanation("");
    setMistakeTopic(originTopicId);
    setConverting(true);
  }
  async function createMistake() {
    if (!workspace.writable || busy || !mistakeAttempt.trim() || !mistakeCorrection.trim() || !mistakeTopic) return;
    const destination = workspace.topicById.get(mistakeTopic);
    if (!topic || !destination || destination.subject_id !== topic.subject_id) {
      setError("Choose a destination within the same subject.");
      return;
    }
    await perform(async () => {
      await workspace.addEntry({
        kind: "mistake",
        topicId: mistakeTopic,
        attempt: mistakeAttempt.trim(),
        correction: mistakeCorrection.trim(),
        explanation: mistakeExplanation.trim(),
      });
      setConverting(false);
      setNotice("Mistake Log entry created. Your original capture is still here until you explicitly archive it.");
    });
  }

  function prepareMerge() {
    if (actionable.length < 2 || actionable.some((row) => row.kind !== "note")) {
      setError("Select at least two notes or questions to combine. Mistakes keep their own recall history.");
      return;
    }
    setError("");
    setMergeTitle(target.kind === "lesson" ? `Organised notes · ${heading}` : "Organised notes");
    setMergeBody(mergedCaptureText(actionable));
    setMergeTopic(originTopicId);
    setMerging(true);
  }
  async function createMergedNote() {
    if (!mergeBody.trim() || !mergeTopic || busy) return;
    if (!workspace.writable || !workspace.topicById.has(mergeTopic)) return;
    const destination = workspace.topicById.get(mergeTopic);
    const source = workspace.topicById.get(originTopicId);
    if (!destination || !source || destination.subject_id !== source.subject_id) {
      setError("Choose a destination in this language before combining notes.");
      return;
    }
    if (target.kind === "inbox" && mergeTopic === originTopicId) {
      setError("Choose another topic for the combined note, or it will stay in the Inbox.");
      return;
    }
    await perform(async () => {
      const created = await workspace.addEntry({
        kind: "note", topicId: mergeTopic, title: mergeTitle.trim(), body: mergeBody,
      });
      setMerging(false); setSelected([]);
      setNotice(`Created “${entryTitle(created)}”. Originals remain untouched; you can archive them individually after checking the result.`);
    });
  }
  async function removeSelected() {
    if (!workspace.writable || !actionable.length || busy) return;
    const ok = await confirm({
      title: `Archive ${actionable.length} ${actionable.length === 1 ? "capture" : "captures"}?`,
      body: "Their contents will remain in Trash, and lesson recall history will not be deleted.",
      confirmLabel: "Move to Trash", danger: true,
    });
    if (!ok) return;
    await perform(async () => {
      let removed = 0;
      for (const row of actionable) {
        try { await workspace.removeEntry(row.id, { undo: false }); removed++; }
        catch (err) { throw new Error(`${removed} archived before the error. ${friendlyError(err)}`); }
      }
      setSelected([]);
      setNotice(`${removed} moved to Trash. Use the account menu to restore them.`);
    });
  }

  function onKeys(event: React.KeyboardEvent<HTMLElement>) {
    if (event.defaultPrevented || busy || moving || merging || flashcard || document.querySelector('[role="alertdialog"]')) return;
    const node = event.target;
    if (node instanceof HTMLElement && (node.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName))) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); focusRow(focusIndex + (event.key === "ArrowDown" ? 1 : -1));
    } else if (event.key === " " && focused) { event.preventDefault(); toggle(focused.id); }
    else if (event.key.toLowerCase() === "t") { event.preventDefault(); setMoving(true); }
    else if (event.key.toLowerCase() === "f" && focused) { event.preventDefault(); setFlashcard(focused); }
    else if (event.key.toLowerCase() === "m") { event.preventDefault(); prepareMerge(); }
    else if ((event.key === "Delete" || event.key === "Backspace") && actionable.length) { event.preventDefault(); void removeSelected(); }
    else if ((SHORTCUTS as readonly string[]).includes(event.key)) {
      event.preventDefault(); void changeType(TYPES[Number(event.key) - 1]);
    }
  }

  return <Portal><div className="ws-dialog-backdrop" role="presentation">
    <section className="ws-dialog lc-dialog" role="dialog" aria-modal="true"
      aria-labelledby="lc-title" onKeyDown={onKeys}>
      {confirmElement}
      {flashcard ? <FlashcardDialog entry={flashcard} onClose={() => setFlashcard(null)}/> : null}
      <header className="ws-dialog-head">
        <div className="lc-heading"><span className="ws-eyebrow">{target.kind === "lesson" ? "After the lesson" : "Language Inbox"}</span>
          <h2 id="lc-title"><ListPlus size={20}/> Organise captures</h2>
          <p>{heading}</p>
        </div>
        <button type="button" className="ws-icon-button" onClick={onClose} aria-label="Close clean-up" disabled={busy} autoFocus><X size={17}/></button>
      </header>
      <div className="lc-toolbar">
        <span>{items.length} to organise · {selected.length} selected</span>
        <button type="button" className="ws-button is-small is-quiet" disabled={!items.length}
          onClick={() => setSelected(selected.length === items.length ? [] : items.map((row) => row.id))}>
          {selected.length === items.length ? "Deselect all" : "Select all"}</button>
      </div>
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      {notice ? <p className="lc-notice" role="status">{notice}</p> : null}
      <div className="lc-list" ref={listRef}>
        {!items.length ? <div className="lc-empty"><Check size={22}/><strong>Everything organised</strong>
          <p>{target.kind === "lesson" ? "No captures remain in this lesson's original topic." : "Your Inbox has no unfiled captures."}</p></div> : null}
        {items.map((item, index) => <div key={item.id} className={`lc-row ${focusIndex === index ? "is-focused" : ""} ${selected.includes(item.id) ? "is-selected" : ""}`}>
          <input type="checkbox" aria-label={`Select ${entryTitle(item)}`} checked={selected.includes(item.id)}
            onChange={() => toggle(item.id)} disabled={busy}/>
          <button type="button" className="lc-row-focus" onClick={() => setFocusIndex(index)}
            aria-current={focusIndex === index ? "true" : undefined}>
            <span className="lc-row-head"><time>{formatTime(item.created_at)}</time>
              <span>{item.kind === "mistake" ? "Mistake" : CATEGORY_LABELS[item.category ?? "note"]}</span></span>
            <strong>{item.kind === "mistake" ? item.attempt || item.correction : entryTitle(item)}</strong>
            <small>{entryPreview(item, 220)}</small>
          </button>
          <button type="button" className="lc-row-card" title="Make a flashcard" aria-label={`Make a flashcard from ${entryTitle(item)}`}
            onClick={() => { setFocusIndex(index); setFlashcard(item); }}><Layers size={16}/></button>
        </div>)}
      </div>
      {items.length ? <div className="lc-actions">
        <div className="lc-category-controls">
          <span>Type {actionable.length > 1 ? `(${actionable.length} selected)` : "(focused)"}</span>
          <div>{TYPES.map((type, index) => <button key={type} type="button" className="ws-button is-small"
            disabled={!workspace.writable || !actionable.length || busy} onClick={() => void changeType(type)}
            title={`Shortcut ${index + 1}`}><span>{index + 1}</span> {CATEGORY_LABELS[type]}</button>)}</div>
        </div>
        <div className="lc-action-row">
          <button type="button" className="ws-button is-primary" disabled={!workspace.writable || busy || !actionable.length}
            onClick={() => { setError(""); setMoving(true); }}><FolderInput size={15}/> Move to topic <Kbd>T</Kbd></button>
          <button type="button" className="ws-button" disabled={!workspace.writable || busy || !actionable.length}
            onClick={() => setFlashcard(focused)}><Layers size={15}/> Flashcard <Kbd>F</Kbd></button>
          <button type="button" className="ws-button" disabled={!workspace.writable || busy || actionable.length !== 1 || actionable[0]?.kind !== "note"}
            onClick={prepareMistake}><TriangleAlert size={15}/> Make mistake</button>
          <button type="button" className="ws-button" disabled={!workspace.writable || busy || actionable.length < 2 || actionable.some((row) => row.kind !== "note")}
            onClick={prepareMerge}><ListPlus size={15}/> Merge notes <Kbd>M</Kbd></button>
          <button type="button" className="ws-button is-quiet" disabled={!workspace.writable || busy || !actionable.length}
            onClick={() => void removeSelected()}><Trash2 size={15}/> Trash</button>
        </div>
        <p className="lc-help">↑ ↓ focus · Space select · 1–5 type · T move · F flashcard · M merge · Del trash</p>
      </div> : null}
      {moving ? <div className="lc-picker-panel"><div className="lc-picker-head">
        <strong>File {actionable.length} {actionable.length === 1 ? "capture" : "captures"}</strong>
        <button type="button" className="ws-icon-button" aria-label="Cancel move" onClick={() => setMoving(false)}><X size={15}/></button>
      </div>
      <p>Choose another topic in this language. The original lesson link is preserved.</p>
      <TopicPicker value={originTopicId} onChange={(id) => void moveTo(id)} onClose={() => setMoving(false)} allowCreate={false}/>
      </div> : null}
      {converting ? <div className="lc-merge-panel">
        <div className="lc-picker-head"><strong>Turn an idea into a mistake</strong>
          <button type="button" className="ws-icon-button" aria-label="Cancel conversion" onClick={() => setConverting(false)}><X size={15}/></button></div>
        <p>Define the incorrect attempt and its correction. The original capture is preserved; nothing is deleted automatically.</p>
        <label className="ws-field"><span>What was wrong?</span>
          <textarea value={mistakeAttempt} maxLength={5000} onChange={(event) => setMistakeAttempt(event.target.value)} rows={2}/></label>
        <label className="ws-field"><span>Correct version</span>
          <textarea value={mistakeCorrection} maxLength={5000} onChange={(event) => setMistakeCorrection(event.target.value)} rows={2}/></label>
        <label className="ws-field"><span>Explanation (optional)</span>
          <textarea value={mistakeExplanation} maxLength={10000} onChange={(event) => setMistakeExplanation(event.target.value)} rows={2}/></label>
        <span className="lc-destination">Save in: {workspace.pathLabel(mistakeTopic)}</span>
        <TopicPicker value={mistakeTopic} onChange={setMistakeTopic} onClose={() => undefined} allowCreate={false}/>
        <button type="button" className="ws-button is-primary" disabled={!mistakeAttempt.trim() || !mistakeCorrection.trim() || busy || !workspace.writable}
          onClick={() => void createMistake()}><TriangleAlert size={14}/> Create mistake</button>
      </div> : null}
      {merging ? <div className="lc-merge-panel">
        <div className="lc-picker-head"><strong>New combined note</strong>
          <button type="button" className="ws-icon-button" aria-label="Cancel merge" onClick={() => setMerging(false)}><X size={15}/></button></div>
        <p>Review the text before creating a new note. Original lines stay intact until you explicitly archive them.</p>
        <label className="ws-field"><span>Title</span><input value={mergeTitle} onChange={(event) => setMergeTitle(event.target.value)} maxLength={200}/></label>
        <label className="ws-field"><span>Content</span><textarea value={mergeBody} onChange={(event) => setMergeBody(event.target.value)} rows={6}/></label>
        <span className="lc-destination">Destination: {workspace.pathLabel(mergeTopic)}</span>
        <TopicPicker value={mergeTopic} onChange={setMergeTopic} onClose={() => undefined} allowCreate={false}/>
        <button type="button" className="ws-button is-primary" disabled={!mergeBody.trim() || !workspace.writable || busy}
          onClick={() => void createMergedNote()}><ListPlus size={15}/> Create combined note</button>
      </div> : null}
      <footer className="lc-footer"><span>Changes save directly to Notebook. You can organise the remaining entries later.</span>
        <button type="button" className="ws-button" onClick={onClose} disabled={busy}>Done</button></footer>
    </section>
  </div></Portal>;
}
