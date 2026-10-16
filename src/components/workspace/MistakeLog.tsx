import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, GraduationCap, Pencil, Plus, Trash2, X } from "lucide-react";
import { friendlyError, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { EmptyState, Kbd, MOD_KEY, Portal, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

/**
 * Mistake Log is a general-purpose correction notebook, not a language or
 * flashcard dashboard. Old modes, subjects, practice events and explanations
 * are deliberately retained in storage, but never required for a simple entry.
 */
export function MistakeLog() {
  const workspace = useWorkspace();
  const { snapshot, focusMistake, clearFocusMistake } = workspace;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [session, setSession] = useState<string[] | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const listRef = useRef<HTMLDivElement>(null);

  const mistakes = useMemo(() => snapshot.entries
    .filter((entry) => entry.kind === "mistake")
    .sort((a, b) => b.created_at.localeCompare(a.created_at)), [snapshot.entries]);

  // Other parts of Heuresis can still open an old entry (or an existing recall
  // session) without reintroducing those controls to this minimal main page.
  useEffect(() => {
    if (!focusMistake) return;
    const target = mistakes.find((entry) => entry.id === focusMistake.id);
    clearFocusMistake();
    if (!target) return;
    if (focusMistake.practise) {
      setSession(focusMistake.ids?.length ? focusMistake.ids : [target.id]);
      return;
    }
    const position = mistakes.findIndex((entry) => entry.id === target.id);
    setVisibleCount((count) => Math.max(count, position + 1));
    setAdding(false);
    setEditingId(null);
    setHighlightId(target.id);
  }, [focusMistake, clearFocusMistake, mistakes]);

  useEffect(() => {
    if (!highlightId) return;
    const scroll = window.setTimeout(() => {
      const item = Array.from(listRef.current?.querySelectorAll<HTMLElement>("[data-mistake]") ?? [])
        .find((node) => node.dataset.mistake === highlightId);
      item?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 50);
    const clear = window.setTimeout(() => setHighlightId(null), 2600);
    return () => { window.clearTimeout(scroll); window.clearTimeout(clear); };
  }, [highlightId]);

  return <div className="ml-page ml-simple-page">
    <header className="ws-page-head">
      <div><h1>Mistake Log</h1></div>
      {workspace.writable ? <div className="ws-page-actions">
        <button className="ws-button is-primary" type="button" onClick={() => {
          setAdding(true); setEditingId(null);
        }}><Plus size={16} /> Add mistake</button>
      </div> : null}
    </header>
    <main className="ml-simple-list" ref={listRef}>
      {adding ? <MistakeEditor onDone={() => setAdding(false)} /> : null}
      {!mistakes.length && !adding ? <EmptyState title="No mistakes recorded yet" icon={<Pencil size={22} />}>
        Add a mistake and the correct version. You can use this for anything you are learning.
      </EmptyState> : null}
      {mistakes.slice(0, visibleCount).map((entry) => editingId === entry.id
        ? <MistakeEditor key={entry.id} entry={entry} onDone={() => setEditingId(null)} />
        : <MistakeItem key={entry.id} entry={entry} highlighted={entry.id === highlightId}
          onEdit={() => { setAdding(false); setEditingId(entry.id); }} />)}
      {mistakes.length > visibleCount ? <button className="ml-simple-more" type="button"
        onClick={() => setVisibleCount((count) => count + 60)}>Show more</button> : null}
    </main>
    {session ? <RecallSession ids={session} onClose={() => setSession(null)} /> : null}
  </div>;
}

function MistakeItem({ entry, highlighted, onEdit }: {
  entry: KnowledgeEntry; highlighted: boolean; onEdit: () => void;
}) {
  const workspace = useWorkspace();
  const [confirmElement, confirm] = useConfirm();
  async function remove() {
    if (!await confirm({
      title: "Delete this mistake?",
      body: "You can undo the deletion for a few seconds.",
      confirmLabel: "Delete", danger: true,
    })) return;
    try { await workspace.removeEntry(entry.id); }
    catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  return <article className={"ml-simple-item" + (highlighted ? " is-highlighted" : "")} data-mistake={entry.id}>
    {confirmElement}
    <div className="ml-simple-body">
      <div className="ml-simple-pair">
        <span className="ml-simple-label">Mistake</span>
        <p className="ml-simple-wrong">{entry.attempt || "Not recorded"}</p>
      </div>
      <div className="ml-simple-pair">
        <span className="ml-simple-label">Correction</span>
        <p className={"ml-simple-right" + (!entry.correction ? " is-missing" : "")}>
          {entry.correction || "Add the correct version"}
        </p>
      </div>
    </div>
    {workspace.writable ? <div className="ml-simple-actions">
      <button type="button" className="ws-icon-button" aria-label="Edit mistake" title="Edit" onClick={onEdit}>
        <Pencil size={15}/>
      </button>
      <button type="button" className="ws-icon-button" aria-label="Delete mistake" title="Delete"
        onClick={() => void remove()}><Trash2 size={15}/></button>
    </div> : null}
  </article>;
}

function MistakeEditor({ entry, onDone }: { entry?: KnowledgeEntry; onDone: () => void }) {
  const workspace = useWorkspace();
  const [attempt, setAttempt] = useState(entry?.attempt ?? "");
  const [correction, setCorrection] = useState(entry?.correction ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (busy) return;
    if (!attempt.trim() || !correction.trim()) {
      setError("Write the mistake and the correct version.");
      return;
    }
    setBusy(true); setError("");
    try {
      if (entry) {
        // Preserve the original subject, metadata and practice history.
        await workspace.patchEntry(entry.id, { attempt: attempt.trim(), correction: correction.trim() });
      } else {
        // No subject/category decision is needed to capture a correction.
        const subject = workspace.snapshot.subjects.find((item) => item.name.trim().toLowerCase() === "unsorted")
          ?? await workspace.addSubject("Unsorted");
        const inbox = await workspace.ensureInbox(subject.id);
        await workspace.addEntry({
          kind: "mistake", topicId: inbox.id,
          attempt: attempt.trim(), correction: correction.trim(),
        });
      }
      onDone();
    } catch (reason) {
      // Keep both fields intact on error, so the user can retry the save.
      setError(friendlyError(reason));
    } finally { setBusy(false); }
  }

  return <form className="ml-simple-edit" onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Escape") { event.preventDefault(); onDone(); }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault(); void save();
      }
    }}>
    <label className="ws-field">
      <span>Mistake</span>
      <textarea autoFocus rows={2} maxLength={5000} value={attempt}
        placeholder="What did you get wrong?" onChange={(event) => setAttempt(event.target.value)} />
    </label>
    <label className="ws-field">
      <span>Correction</span>
      <textarea rows={2} maxLength={5000} value={correction}
        placeholder="What is the correct version?" onChange={(event) => setCorrection(event.target.value)} />
    </label>
    {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
    <div className="ml-simple-edit-actions">
      <button className="ws-button" type="button" disabled={busy} onClick={onDone}>Cancel</button>
      <button className="ws-button is-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  </form>;
}

// ---------------------------------------------------------------------------
// Recall: produce the corrected form before seeing it, then grade yourself.
// ---------------------------------------------------------------------------
// Compare written answers without stripping the distinctions learners must master:
// German capitals/umlauts, Cyrillic й/и and Mandarin pinyin tones.
function answerKey(text: string) {
  return text.normalize("NFC")
    .replace(/[.,!?。！？；;:：、，"“”]/g, "")
    .replace(/\s+/g, " ").trim();
}

function RecallSession({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const workspace = useWorkspace();
  const [index, setIndex] = useState(0);
  const [answer, setAnswer] = useState("");
  const [revealed, setRevealed] = useState(false);
  const [missed, setMissed] = useState(false);
  const [hint, setHint] = useState(false);
  const [results, setResults] = useState<Array<{ id: string; correct: boolean }>>([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const queue = useMemo(() => ids.map((id) => workspace.entryById.get(id)).filter((entry): entry is KnowledgeEntry => Boolean(entry?.correction)), [ids, workspace.entryById]);
  const current = queue[index];
  const finished = index >= queue.length;

  useEffect(() => { if (!finished) window.requestAnimationFrame(() => inputRef.current?.focus()); }, [finished, index]);

  const next = useCallback(() => {
    setIndex((value) => value + 1);
    setAnswer(""); setRevealed(false); setHint(false); setMissed(false);
  }, []);

  const grade = useCallback(async (correct: boolean, showBeforeNext = false) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      if (workspace.writable) await workspace.practise(current.id, correct ? "correct" : "incorrect", answer);
      setResults((list) => [...list, { id: current.id, correct }]);
      if (showBeforeNext) { setMissed(true); setRevealed(true); }
      else next();
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
    finally { setBusy(false); }
  }, [answer, busy, current, next, workspace]);

  const exact = Boolean(current && answer.trim() && answerKey(answer) === answerKey(current.correction));

  return <Portal><div className="ws-dialog-backdrop" role="presentation">
    <div className="ws-dialog is-recall" role="dialog" aria-modal="true" aria-labelledby="recall-title"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (!finished && (event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); if (!revealed) setRevealed(true); }
      }}>
      <div className="ws-dialog-head">
        <h2 id="recall-title"><GraduationCap size={17} /> Recall {queue.length > 1 && !finished ? <small>{index + 1} of {queue.length}</small> : null}</h2>
        <button type="button" className="ws-icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
      </div>
      {finished ? <div className="recall-summary">
        <strong>{results.filter((result) => result.correct).length} of {results.length} recalled</strong>
        <p className="ws-muted">Correct answers bring a mistake back after a longer pause (1 → 3 → 7 → 21 → 60 days); a miss brings it back tomorrow. Answering correctly several times on the same day counts once — retention is shown only by recall on separate days.</p>
        <div className="ws-dialog-actions"><button type="button" className="ws-button is-primary" autoFocus onClick={onClose}>Done</button></div>
      </div> : current ? <>
        <div className="recall-prompt">
          <span className="ml-label">{workspace.pathLabel(current.topic_id)}</span>
          {current.attempt ? <p className="recall-attempt"><span className="ml-label">You said</span>{current.attempt}</p> : <p className="ws-muted">Recall the correct form{current.title ? ` for “${current.title}”` : ""}.</p>}
          {current.explanation ? (hint || revealed ? <p className="recall-hint"><span className="ml-label">Why</span>{current.explanation}</p>
            : <button type="button" className="nb-link-button" onClick={() => setHint(true)}>Show the explanation as a hint</button>) : null}
        </div>
        <label className="ws-field"><span>Write the corrected version from memory</span>
          <textarea ref={inputRef} rows={2} value={answer} readOnly={revealed} onChange={(event) => setAnswer(event.target.value)} placeholder="Type it before revealing…" /></label>
        {revealed ? <div className={`recall-result ${answer.trim() ? (exact ? "is-exact" : "is-different") : ""}`}>
          <span className="ml-label">Correct form</span>
          <p className="recall-answer">{current.correction}</p>
          <small>{!answer.trim() ? "Read the answer before continuing."
            : exact ? "Exact match." : "Different from your answer. Check spelling, capitals and tone marks."}</small>
        </div> : null}
        <div className="ws-dialog-actions">
          {!revealed ? <>
            <button type="button" className="ws-button" onClick={() => void grade(false, true)} disabled={busy}>I don't know</button>
            <button type="button" className="ws-button is-primary" onClick={() => setRevealed(true)}>Reveal <Kbd>{MOD_KEY} ↵</Kbd></button>
          </> : missed ? <button type="button" className="ws-button is-primary" onClick={next}>Next</button> : <>
            <button type="button" className="ws-button" onClick={() => void grade(false)} disabled={busy}>Not yet</button>
            <button type="button" className="ws-button is-primary" onClick={() => void grade(true)} disabled={busy}><Check size={15} /> I had it</button>
          </>}
        </div>
      </> : <p className="ws-muted">These mistakes have no correction to recall yet.</p>}
    </div>
  </div></Portal>;
}
