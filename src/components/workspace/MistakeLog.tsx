import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronDown, GraduationCap, Layers, Pencil, Plus, RotateCcw, Search, Trash2, TriangleAlert, X } from "lucide-react";
import {
  addDays, entryTitle, friendlyError, isRecallDue, mistakeStage, normaliseSearch, RETAINED_STREAK,
  type KnowledgeEntry, type MistakeStage,
} from "../../lib/knowledgeWorkspace";
import { FlashcardDialog } from "./FlashcardDialog";
import { RowMenu } from "./NotebookView";
import { EmptyState, Kbd, MOD_KEY, Portal, TopicPicker, dueLabel, formatDay, relativeTime, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

type StageFilter = "all" | MistakeStage | "due";
const STAGE_LABEL: Record<MistakeStage, string> = { to_correct: "To correct", practising: "In review", understood: "Understood" };

export function MistakeLog() {
  const workspace = useWorkspace();
  const { snapshot, memory, updateMemory, focusMistake, clearFocusMistake } = workspace;
  const [query, setQuery] = useState("");
  const [session, setSession] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const subjectId = memory.mistakes.subjectId && workspace.subjectById.has(memory.mistakes.subjectId) ? memory.mistakes.subjectId : null;
  const stage = memory.mistakes.stage as StageFilter;

  const mistakes = useMemo(() => snapshot.entries.filter((entry) => entry.kind === "mistake"), [snapshot.entries]);
  const inSubject = useMemo(() => subjectId ? mistakes.filter((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === subjectId) : mistakes, [mistakes, subjectId, workspace.topicById]);
  const counts = useMemo(() => ({
    all: inSubject.length,
    to_correct: inSubject.filter((entry) => mistakeStage(entry) === "to_correct").length,
    practising: inSubject.filter((entry) => mistakeStage(entry) === "practising").length,
    understood: inSubject.filter((entry) => mistakeStage(entry) === "understood").length,
    due: inSubject.filter((entry) => isRecallDue(entry)).length,
  }), [inSubject]);
  const q = normaliseSearch(query);
  const shown = inSubject
    .filter((entry) => stage === "all" || (stage === "due" ? isRecallDue(entry) : mistakeStage(entry) === stage))
    .filter((entry) => !q || q.split(" ").every((word) => normaliseSearch([entry.attempt, entry.correction, entry.explanation, entry.title, workspace.pathLabel(entry.topic_id)].join(" ")).includes(word)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const due = inSubject.filter((entry) => isRecallDue(entry))
    .sort((a, b) => (a.recall_due_at ?? "").localeCompare(b.recall_due_at ?? ""));

  useEffect(() => {
    if (!focusMistake) return;
    const target = snapshot.entries.find((entry) => entry.id === focusMistake.id);
    clearFocusMistake();
    if (!target) return;
    if (focusMistake.practise) { setSession(focusMistake.ids?.length ? focusMistake.ids : [target.id]); return; }
    updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, stage: "all", subjectId: null } }));
    setHighlightId(target.id);
    window.setTimeout(() => listRef.current?.querySelector(`[data-mistake="${target.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    window.setTimeout(() => setHighlightId(null), 2600);
  }, [clearFocusMistake, focusMistake, snapshot.entries, updateMemory]);

  const setStage = (next: StageFilter) => updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, stage: next } }));
  const setSubject = (next: string | null) => updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, subjectId: next } }));
  const subjects = [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name));

  return <div className="ml-page">
    <header className="ws-page-head">
      <div>
        <h1>Mistake Log</h1>
        <p className="ws-page-sub">
          <span>{counts.to_correct} to correct</span><span>{counts.practising} practising</span>
          <span className={counts.due ? "is-accent" : ""}>{counts.due} due for recall</span><span>{counts.understood} understood</span>
        </p>
      </div>
      <div className="ws-page-actions">
        <button type="button" className="ws-button is-primary" disabled={!due.length} onClick={() => setSession(due.map((entry) => entry.id))}>
          <GraduationCap size={15} /> Practise due{due.length ? ` (${due.length})` : ""}</button>
        {workspace.writable ? <button type="button" className="ws-button" onClick={() => workspace.openCapture({ mode: "mistake" })} title={`${MOD_KEY}+Shift+M`}><Plus size={15} /> Record mistake</button> : null}
      </div>
    </header>

    <div className="ml-filters">
      {subjects.length > 1 ? <div className="ws-chips" role="group" aria-label="Subject">
        <button type="button" className={!subjectId ? "is-active" : ""} onClick={() => setSubject(null)}>All subjects</button>
        {subjects.map((subject) => <button type="button" key={subject.id} className={subjectId === subject.id ? "is-active" : ""} onClick={() => setSubject(subject.id)}>{subject.name}</button>)}
      </div> : null}
      <div className="ml-filter-row">
        <div className="ws-segmented" role="tablist" aria-label="Stage">
          {(["all", "to_correct", "practising", "due", "understood"] as StageFilter[]).map((key) => <button type="button" role="tab" key={key}
            aria-selected={stage === key} className={stage === key ? "is-active" : ""} onClick={() => setStage(key)}>
            {key === "all" ? "All" : key === "due" ? "Due" : STAGE_LABEL[key]}<small>{counts[key]}</small></button>)}
        </div>
        <label className="ws-search-field"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search mistakes…" aria-label="Search mistakes" />
          {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button> : null}</label>
      </div>
    </div>

    <div className="ml-list" ref={listRef}>
      {shown.map((entry) => editingId === entry.id
        ? <MistakeEditor key={entry.id} entry={entry} onDone={() => setEditingId(null)} />
        : <MistakeCard key={entry.id} entry={entry} highlighted={highlightId === entry.id}
          onEdit={() => setEditingId(entry.id)} onPractise={() => setSession([entry.id])} />)}
      {!shown.length ? <EmptyState icon={<TriangleAlert size={22} />}
        title={mistakes.length ? (stage === "due" ? "Nothing is due for recall" : "No mistakes match") : "No mistakes recorded yet"}
        action={!mistakes.length && workspace.writable ? <button type="button" className="ws-button is-primary" onClick={() => workspace.openCapture({ mode: "mistake" })}><Plus size={15} /> Record a mistake</button> : null}>
        {mistakes.length ? (stage === "due" ? "Mistakes come back for recall after 1, 3, 7, 21 and 60 days of correct answers." : "Try another filter or search.")
          : <>During a lesson press <Kbd>{MOD_KEY} ⇧ M</Kbd>: write what you said, and add the correction now or later.</>}
      </EmptyState> : null}
    </div>
    {session ? <RecallSession ids={session} onClose={() => setSession(null)} /> : null}
  </div>;
}

function MistakeCard({ entry, highlighted, onEdit, onPractise }: { entry: KnowledgeEntry; highlighted: boolean; onEdit: () => void; onPractise: () => void }) {
  const workspace = useWorkspace();
  const [confirmElement, confirm] = useConfirm();
  const [flashcard, setFlashcard] = useState(false);
  const stage = mistakeStage(entry);
  const lesson = entry.lesson_id ? workspace.entryById.get(entry.lesson_id) : null;
  const attempts = workspace.snapshot.practice.filter((event) => event.record_id === entry.id);
  const lastAttempt = attempts[0];

  async function setUnderstood(understood: boolean) {
    try {
      await workspace.patchEntry(entry.id, understood
        ? { status: "understood", recall_due_at: entry.recall_due_at ?? addDays(new Date(), 3).toISOString() }
        : { status: "needs_practice" });
      if (understood && !entry.recall_due_at) workspace.toast("Marked as understood. It will come back for a recall check in 3 days.");
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }
  async function remove() {
    if (!await confirm({ title: "Delete this mistake?", body: "You can undo this deletion for a few seconds. Its practice history is preserved.", confirmLabel: "Delete", danger: true })) return;
    try { await workspace.removeEntry(entry.id); } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  return <article className={`ml-card is-${stage} ${highlighted ? "is-highlighted" : ""}`} data-mistake={entry.id}>
    {confirmElement}
    {flashcard ? <FlashcardDialog entry={entry} onClose={() => setFlashcard(false)} /> : null}
    <div className="ml-card-top">
      <span className="ml-card-context">
        <button type="button" className="nb-link-button" onClick={() => workspace.openTopic(entry.topic_id)}>{workspace.pathLabel(entry.topic_id)}</button>
        {lesson ? <> · <button type="button" className="nb-link-button" onClick={() => workspace.openDocument(lesson.id)}>{entryTitle(lesson)}</button></> : null}
        <span> · {formatDay(entry.created_at)}</span>
      </span>
      <span className={`ml-stage is-${stage}`}>{STAGE_LABEL[stage]}</span>
      {workspace.writable ? <RowMenu label="mistake" items={[
        { label: "Edit", icon: <Pencil size={14} />, run: onEdit },
        ...(entry.correction ? [{ label: "Make a flashcard…", icon: <Layers size={14} />, run: () => setFlashcard(true) }] : []),
        { label: "Delete", icon: <Trash2 size={14} />, danger: true, run: () => void remove() },
      ]} /> : null}
    </div>
    {entry.title.trim() ? <h3 className="ml-card-title">{entry.title}</h3> : null}
    <div className="ml-pair">
      <div className="ml-attempt"><span className="ml-label">My attempt</span><p lang="und">{entry.attempt || <em className="ws-muted">not written down</em>}</p></div>
      <div className="ml-arrow" aria-hidden="true"><ArrowRight size={16} /></div>
      <div className="ml-correct"><span className="ml-label">Correct form</span>
        {entry.correction ? <p>{entry.correction}</p> : workspace.writable ? <button type="button" className="ml-add-correction" onClick={onEdit}><Plus size={13} /> Add the correction</button> : <p className="ws-muted">—</p>}
      </div>
    </div>
    {entry.explanation ? <div className="ml-why"><span className="ml-label">Why</span><p>{entry.explanation}</p></div> : null}
    <div className="ml-card-foot">
      <span className="ml-evidence">
        {attempts.length
          ? <>{attempts.filter((event) => event.outcome === "correct").length}/{attempts.length} recalls correct · last {relativeTime(lastAttempt.created_at)}
            {entry.recall_streak >= RETAINED_STREAK ? <b> · recalled on {entry.recall_streak} separate days</b> : null}
            {entry.recall_due_at && entry.correction ? <> · {dueLabel(entry.recall_due_at)}</> : null}</>
          : entry.correction ? (entry.recall_due_at ? <>Not recalled yet · {dueLabel(entry.recall_due_at)}</> : "Not recalled yet") : "Add the correct form to practise it"}
      </span>
      <span className="ml-card-actions">
        {entry.correction ? <button type="button" className="ws-button is-small" onClick={onPractise}><RotateCcw size={13} /> Test recall</button> : null}
        {workspace.writable && entry.correction ? (entry.status === "understood"
          ? <button type="button" className="ws-button is-small is-quiet" onClick={() => void setUnderstood(false)}>Practise again</button>
          : <button type="button" className="ws-button is-small is-quiet" onClick={() => void setUnderstood(true)} title="Self-assessed — recall checks continue"><Check size={13} /> I understand it</button>) : null}
      </span>
    </div>
  </article>;
}

function MistakeEditor({ entry, onDone }: { entry: KnowledgeEntry; onDone: () => void }) {
  const workspace = useWorkspace();
  const [values, setValues] = useState({ title: entry.title, attempt: entry.attempt, correction: entry.correction, explanation: entry.explanation, topicId: entry.topic_id });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstEmpty = !entry.correction ? "correction" : "attempt";

  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await workspace.patchEntry(entry.id, { title: values.title.trim(), attempt: values.attempt.trim(), correction: values.correction.trim(), explanation: values.explanation.trim(), topic_id: values.topicId });
      onDone();
    } catch (saveError) { setError(friendlyError(saveError)); }
    finally { setBusy(false); }
  }

  return <form className="ml-card is-editing" data-mistake={entry.id} onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => {
      if (event.key === "Escape" && !picking) { event.preventDefault(); onDone(); }
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); }
    }}>
    <div className="ml-edit-grid">
      <label className="ws-field"><span>My attempt</span><textarea rows={2} autoFocus={firstEmpty === "attempt"} value={values.attempt} onChange={(event) => setValues({ ...values, attempt: event.target.value })} /></label>
      <label className="ws-field"><span>Correct form</span><textarea rows={2} autoFocus={firstEmpty === "correction"} value={values.correction} onChange={(event) => setValues({ ...values, correction: event.target.value })} /></label>
    </div>
    <label className="ws-field"><span>Why it was wrong</span><textarea rows={2} value={values.explanation} placeholder="The rule, or what you misunderstood" onChange={(event) => setValues({ ...values, explanation: event.target.value })} /></label>
    <div className="ml-edit-grid">
      <label className="ws-field"><span>Short label <small>optional</small></span><input value={values.title} maxLength={200} placeholder="e.g. 了 inside a 的时候 clause" onChange={(event) => setValues({ ...values, title: event.target.value })} /></label>
      <div className="ws-field"><span>Topic</span>
        <button type="button" className="qc-topic" onClick={() => setPicking((value) => !value)}>{workspace.pathLabel(values.topicId)} <ChevronDown size={13} /></button>
        {picking ? <div className="ws-popover-host"><TopicPicker value={values.topicId} onChange={(id) => { setValues({ ...values, topicId: id }); setPicking(false); }} onClose={() => setPicking(false)} /></div> : null}
      </div>
    </div>
    {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
    <div className="ws-dialog-actions">
      <span className="qc-hint"><Kbd>{MOD_KEY} ↵</Kbd> save</span>
      <button type="button" className="ws-button" onClick={onDone}>Cancel</button>
      <button type="submit" className="ws-button is-primary" disabled={busy}>{busy ? "Saving…" : "Save"}</button>
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
        if (event.nativeEvent.isComposing) return;
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
