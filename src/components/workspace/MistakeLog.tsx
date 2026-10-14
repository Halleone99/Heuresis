import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, GraduationCap, History, Layers, MessageSquareText, Pencil, Plus, RotateCcw, Search, Trash2, TriangleAlert, X } from "lucide-react";
import {
  addDays, entryTitle, friendlyError, isRecallDue, mistakeStage, normaliseSearch, RETAINED_STREAK,
  type KnowledgeEntry, type MistakeStage, type NoteCategory,
} from "../../lib/knowledgeWorkspace";
import { FlashcardDialog } from "./FlashcardDialog";
import { RowMenu } from "./NotebookView";
import { EmptyState, Kbd, MOD_KEY, Portal, TopicPicker, dueLabel, formatDay, relativeTime, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

type StageFilter = "all" | MistakeStage | "due";
const STAGE_LABEL: Record<MistakeStage, string> = { to_correct: "To correct", practising: "Practising", understood: "Understood" };


type MistakeMode = "grammar" | "vocabulary" | "phrase" | "other";
type MistakeView = "home" | "history" | MistakeMode;

const MODE_CARDS = [
  { id: "grammar", title: "Grammar", detail: "Cases, tenses, sentence structure and rules.", icon: GraduationCap },
  { id: "vocabulary", title: "Vocabulary", detail: "Words, meanings, forms and usage.", icon: BookOpen },
  { id: "phrase", title: "Expressions", detail: "Natural phrasing, idioms and blocks of meaning.", icon: MessageSquareText },
  { id: "other", title: "Other mistakes", detail: "Unclassified mistakes and anything else to revisit.", icon: TriangleAlert },
] as const;

function mistakeMode(entry: KnowledgeEntry): MistakeMode {
  if (entry.category === "grammar" || entry.category === "vocabulary" || entry.category === "phrase") return entry.category;
  return "other";
}

function categoryFor(view: MistakeView): NoteCategory {
  return view === "grammar" || view === "vocabulary" || view === "phrase" ? view : "note";
}

export function MistakeLog() {
  const workspace = useWorkspace();
  const { snapshot, memory, updateMemory, focusMistake, clearFocusMistake } = workspace;
  const [query, setQuery] = useState("");
  const [view, setView] = useState<MistakeView>("home");
  const [language, setLanguage] = useState("All");
  const [session, setSession] = useState<string[] | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stage = memory.mistakes.stage as StageFilter;

  const subjects = useMemo(() => [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name)), [snapshot.subjects]);
  const languageNames = useMemo(() => {
    const names = ["All", "German", "Russian", "Chinese"];
    for (const subject of subjects) if (!names.some((name) => name.toLowerCase() === subject.name.toLowerCase())) names.push(subject.name);
    return names;
  }, [subjects]);
  const activeSubject = subjects.find((subject) => subject.name.toLowerCase() === language.toLowerCase()) ?? null;
  const mistakes = useMemo(() => snapshot.entries.filter((entry) => entry.kind === "mistake"), [snapshot.entries]);
  const inSubject = useMemo(() => language === "All" ? mistakes
    : mistakes.filter((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === activeSubject?.id),
    [activeSubject?.id, language, mistakes, workspace.topicById]);
  const inMode = useMemo(() => view === "home" || view === "history" ? inSubject
    : inSubject.filter((entry) => mistakeMode(entry) === view), [inSubject, view]);
  const counts = useMemo(() => ({
    all: inMode.length,
    to_correct: inMode.filter((entry) => mistakeStage(entry) === "to_correct").length,
    practising: inMode.filter((entry) => mistakeStage(entry) === "practising").length,
    understood: inMode.filter((entry) => mistakeStage(entry) === "understood").length,
    due: inMode.filter((entry) => isRecallDue(entry)).length,
  }), [inMode]);
  const q = normaliseSearch(query);
  const shown = inMode
    .filter((entry) => stage === "all" || (stage === "due" ? isRecallDue(entry) : mistakeStage(entry) === stage))
    .filter((entry) => !q || q.split(" ").every((word) => normaliseSearch([entry.attempt, entry.correction, entry.explanation, entry.title, workspace.pathLabel(entry.topic_id)].join(" ")).includes(word)))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const due = inMode.filter((entry) => isRecallDue(entry))
    .sort((a, b) => (a.recall_due_at ?? "").localeCompare(b.recall_due_at ?? ""));
  const allDue = inSubject.filter((entry) => isRecallDue(entry))
    .sort((a, b) => (a.recall_due_at ?? "").localeCompare(b.recall_due_at ?? ""));

  useEffect(() => {
    if (!focusMistake) return;
    const target = snapshot.entries.find((entry) => entry.id === focusMistake.id);
    clearFocusMistake();
    if (!target) return;
    if (focusMistake.practise) { setSession(focusMistake.ids?.length ? focusMistake.ids : [target.id]); return; }
    setView("history");
    setLanguage("All");
    updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, stage: "all", subjectId: null } }));
    setHighlightId(target.id);
    window.setTimeout(() => listRef.current?.querySelector(`[data-mistake="${target.id}"]`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 60);
    window.setTimeout(() => setHighlightId(null), 2600);
  }, [clearFocusMistake, focusMistake, snapshot.entries, updateMemory]);

  const setStage = (next: StageFilter) => updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, stage: next } }));
  function selectLanguage(next: string) {
    setLanguage(next);
    const subject = subjects.find((item) => item.name.toLowerCase() === next.toLowerCase());
    updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, subjectId: subject?.id ?? null, stage: "all" } }));
    setEditingId(null);
    setQuery("");
  }
  function openMode(next: MistakeView) {
    setView(next);
    setStage("all");
    setQuery("");
    setEditingId(null);
  }
  async function recordMistake() {
    // A language choice must never silently file a mistake under another language.
    try {
      let topicId: string | null = null;
      if (language !== "All") {
        const subject = activeSubject ?? await workspace.addSubject(language);
        topicId = snapshot.topics.find((topic) => topic.subject_id === subject.id)?.id
          ?? (await workspace.ensureInbox(subject.id)).id;
      }
      workspace.openCapture({ mode: "mistake", topicId, category: categoryFor(view) });
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }
  const title = view === "history" ? "History" : MODE_CARDS.find((item) => item.id === view)?.title ?? "Choose a mode";

  return <div className="ml-page">
    <header className="ws-page-head">
      <div>
        <span className="ws-eyebrow">Mistake → Correction → Practice → Progress</span>
        <h1>Mistake Log</h1>
        <p className="ws-page-sub">
          <span>{inSubject.length} mistakes</span><span>{allDue.length} due for recall</span>
          <span>{inSubject.filter((entry) => mistakeStage(entry) === "understood").length} understood</span>
        </p>
      </div>
      <div className="ws-page-actions">
        <button type="button" className="ws-button" disabled={!(view === "home" ? allDue.length : due.length)}
          onClick={() => setSession((view === "home" ? allDue : due).map((entry) => entry.id))}>
          <GraduationCap size={15} /> Practise due ({view === "home" ? allDue.length : due.length})</button>
        {workspace.writable ? <button type="button" className="ws-button is-primary" onClick={recordMistake} title={`${MOD_KEY}+Shift+M`}>
          <Plus size={15} /> Record mistake</button> : null}
      </div>
    </header>

    <nav className="ml-languages" aria-label="Mistake Log languages">
      <span className="ml-languages-label">Language</span>
      <div className="ml-languages-tabs">
        {languageNames.map((name) => <button key={name} type="button" className={language === name ? "is-active" : ""}
          aria-current={language === name ? "page" : undefined} onClick={() => selectLanguage(name)}>{name}</button>)}
      </div>
    </nav>

    {view === "home" ? <main className="ml-launch" aria-labelledby="ml-modes-title">
      <div className="ml-launch-intro">
        <div><h2 id="ml-modes-title">What would you like to work on?</h2>
          <p>Select a subject area to practise and review your actual mistakes.</p></div>
        <span>{language === "All" ? "All languages" : language}</span>
      </div>
      <div className="ml-mode-grid">
        {MODE_CARDS.map(({ id, title: modeTitle, detail, icon: Icon }) => {
          const entries = inSubject.filter((entry) => mistakeMode(entry) === id);
          const dueCount = entries.filter((entry) => isRecallDue(entry)).length;
          return <button type="button" key={id} className="ml-mode-card" onClick={() => openMode(id)}>
            <span className="ml-mode-icon"><Icon size={21} /></span>
            <span className="ml-mode-body"><strong>{modeTitle}</strong><span>{detail}</span></span>
            <span className="ml-mode-foot"><span>{entries.length} logged</span><span>{dueCount ? `${dueCount} due` : "View mistakes"}</span><ArrowRight size={17} /></span>
          </button>;
        })}
        <button type="button" className="ml-history-launch" onClick={() => openMode("history")}>
          <History size={20} /><span><strong>Complete history</strong><small>All mistakes, original answers and every recall attempt</small></span>
          <span className="ml-history-total">{inSubject.length} records</span><ArrowRight size={17} />
        </button>
      </div>
      {language !== "All" && !activeSubject ? <p className="ml-language-empty">No {language} subject exists in Notebook yet. Create one there, then record mistakes here.</p> : null}
      {inSubject.length > 0 && inSubject.some((entry) => mistakeMode(entry) === "other") ?
        <p className="ml-legacy-note">Older mistakes without a category appear in Other mistakes. You can assign them a type when editing.</p> : null}
    </main> : <>
      <nav className="ml-breadcrumb" aria-label="Mistake Log location">
        <button type="button" onClick={() => openMode("home")}><ArrowLeft size={15} /> Modes</button>
        <span aria-hidden="true">/</span><strong>{title}</strong>
        <span className="ml-breadcrumb-total">{inMode.length} {inMode.length === 1 ? "mistake" : "mistakes"}</span>
      </nav>
      <section className="ml-filters" aria-label={`${title} filters`}>
        <div className="ml-filter-row">
          <div className="ws-segmented" role="tablist" aria-label="Stage">
            {(["all", "to_correct", "practising", "due", "understood"] as StageFilter[]).map((key) => <button type="button" role="tab" key={key}
              aria-selected={stage === key} className={stage === key ? "is-active" : ""} onClick={() => setStage(key)}>
              {key === "all" ? "All" : key === "due" ? "Due" : STAGE_LABEL[key]}<small>{counts[key]}</small></button>)}
          </div>
          <label className="ws-search-field"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="Search mistakes…" aria-label="Search mistakes" />
            {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button> : null}</label>
        </div>
      </section>
      <div className="ml-list" ref={listRef}>
        {shown.map((entry) => editingId === entry.id
          ? <MistakeEditor key={entry.id} entry={entry} onDone={() => setEditingId(null)} />
          : <MistakeCard key={entry.id} entry={entry} highlighted={highlightId === entry.id}
            onEdit={() => setEditingId(entry.id)} onPractise={() => setSession([entry.id])} />)}
        {!shown.length ? <EmptyState icon={<TriangleAlert size={22} />}
          title={stage === "due" ? "Nothing due in this mode" : query ? "No matching mistakes" : "No mistakes here yet"}
          action={workspace.writable && stage !== "due" && !query ? <button type="button" className="ws-button is-primary" onClick={recordMistake}><Plus size={15} /> Record a mistake</button> : null}>
          {stage === "due" ? "Completed recalls will return when the next interval is due."
            : language !== "All" && !activeSubject ? `Create a ${language} subject in Notebook to start recording mistakes.`
            : !inMode.length ? "Mistakes saved in this category will appear here. Older uncategorised records remain under Other mistakes."
            : "Try another filter or search."}
        </EmptyState> : null}
      </div>
    </>}
    {session ? <RecallSession ids={session} onClose={() => setSession(null)} /> : null}
  </div>;
}

function MistakeCard({ entry, highlighted, onEdit, onPractise }: { entry: KnowledgeEntry; highlighted: boolean; onEdit: () => void; onPractise: () => void }) {
  const workspace = useWorkspace();
  const [confirmElement, confirm] = useConfirm();
  const [flashcard, setFlashcard] = useState(false);
  const stage = mistakeStage(entry);
  const lesson = entry.lesson_id ? workspace.entryById.get(entry.lesson_id) : null;
  const attempts = workspace.snapshot.practice.filter((event) => event.record_id === entry.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
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
      <span className="ml-kind">{MODE_CARDS.find((item) => item.id === mistakeMode(entry))?.title}</span>
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
          : entry.correction ? (entry.recall_due_at ? <>Not practised yet · {dueLabel(entry.recall_due_at)}</> : "Not practised yet") : "Add the correct form to practise it"}
      </span>
      <span className="ml-card-actions">
        {entry.correction ? <button type="button" className="ws-button is-small" onClick={onPractise}><RotateCcw size={13} /> Test recall</button> : null}
        {workspace.writable && entry.correction ? (entry.status === "understood"
          ? <button type="button" className="ws-button is-small is-quiet" onClick={() => void setUnderstood(false)}>Practise again</button>
          : <button type="button" className="ws-button is-small is-quiet" onClick={() => void setUnderstood(true)} title="Self-assessed — recall checks continue"><Check size={13} /> I understand it</button>) : null}
        {workspace.writable ? <button type="button" className="ws-icon-button" aria-label="Edit mistake" onClick={onEdit}><Pencil size={14} /></button> : null}
      </span>
    </div>
    {attempts.length ? <details className="ml-attempt-history">
      <summary><History size={13} /> Previous attempts ({attempts.length})</summary>
      <ol>
        {attempts.map((event) => <li key={event.id}>
          <span>{formatDay(event.created_at)}</span>
          <strong className={event.outcome === "correct" ? "is-correct" : "is-incorrect"}>{event.outcome === "correct" ? "Correct" : "Needs work"}</strong>
          <p>{event.answer || "No written answer recorded"}</p>
        </li>)}
      </ol>
    </details> : null}
  </article>;
}

function MistakeEditor({ entry, onDone }: { entry: KnowledgeEntry; onDone: () => void }) {
  const workspace = useWorkspace();
  const [values, setValues] = useState({ title: entry.title, attempt: entry.attempt, correction: entry.correction, explanation: entry.explanation, topicId: entry.topic_id, category: categoryFor(mistakeMode(entry)) });
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const firstEmpty = !entry.correction ? "correction" : "attempt";

  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      await workspace.patchEntry(entry.id, { title: values.title.trim(), attempt: values.attempt.trim(), correction: values.correction.trim(), explanation: values.explanation.trim(), topic_id: values.topicId, category: values.category });
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
    <div className="ml-edit-kind" role="group" aria-label="Mistake category">
      <span>Type of mistake</span>
      {MODE_CARDS.map((item) => <button type="button" key={item.id} className={mistakeMode({ ...entry, category: values.category }) === item.id ? "is-active" : ""}
        aria-pressed={mistakeMode({ ...entry, category: values.category }) === item.id}
        onClick={() => setValues((current) => ({ ...current, category: categoryFor(item.id) }))}>{item.title}</button>)}
    </div>
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
