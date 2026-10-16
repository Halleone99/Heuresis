import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, FolderPlus, GraduationCap, Pin, Pencil, Plus, Trash2, X } from "lucide-react";
import { friendlyError, type KnowledgeEntry, type KnowledgeTopic, type MistakeAccent } from "../../lib/knowledgeWorkspace";
import { EmptyState, InlineNameForm, Kbd, MOD_KEY, Portal, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

const ACCENTS: Array<{ value: MistakeAccent | ""; label: string }> = [
  { value: "", label: "None" },
  { value: "red", label: "Red" },
  { value: "amber", label: "Amber" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
];

/** A correction is always just two lines; classification and styling remain optional. */
export function MistakeLog() {
  const workspace = useWorkspace();
  const { snapshot, focusMistake, clearFocusMistake } = workspace;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [session, setSession] = useState<string[] | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState<{ subjectId: string; parentId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: "subject" | "topic"; id: string } | null>(null);
  const [visibleCount, setVisibleCount] = useState(60);
  const listRef = useRef<HTMLDivElement>(null);

  const mistakes = useMemo(() => snapshot.entries
    .filter((entry) => entry.kind === "mistake")
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at)),
    [snapshot.entries]);

  const subjectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const mistake of mistakes) {
      const subjectId = workspace.topicById.get(mistake.topic_id)?.subject_id;
      if (subjectId) counts.set(subjectId, (counts.get(subjectId) ?? 0) + 1);
    }
    return counts;
  }, [mistakes, workspace.topicById]);

  const topicTreeIds = useMemo(() => selectedTopicId ? new Set(workspace.subtreeIds(selectedTopicId)) : null,
    [selectedTopicId, workspace.subtreeIds]);

  const visibleMistakes = useMemo(() => mistakes.filter((entry) => {
    if (selectedSubjectId && workspace.topicById.get(entry.topic_id)?.subject_id !== selectedSubjectId) return false;
    if (topicTreeIds && !topicTreeIds.has(entry.topic_id)) return false;
    return true;
  }), [mistakes, selectedSubjectId, topicTreeIds, workspace.topicById]);

  const select = (subjectId: string | null, topicId: string | null) => {
    setSelectedSubjectId(subjectId);
    setSelectedTopicId(topicId);
    setVisibleCount(60);
    setAdding(false);
    setEditingId(null);
  };

  // External links from Overview/Review still open and highlight any original mistake.
  useEffect(() => {
    if (!focusMistake) return;
    const target = mistakes.find((entry) => entry.id === focusMistake.id);
    clearFocusMistake();
    if (!target) return;
    if (focusMistake.practise) {
      setSession(focusMistake.ids?.length ? focusMistake.ids : [target.id]);
      return;
    }
    setSelectedSubjectId(null); setSelectedTopicId(null);
    const position = mistakes.findIndex((entry) => entry.id === target.id);
    setVisibleCount((count) => Math.max(count, position + 1));
    setAdding(false); setEditingId(null); setHighlightId(target.id);
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

  const subjects = useMemo(() => [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot.subjects]);
  const selectedTitle = selectedTopicId ? workspace.topicById.get(selectedTopicId)?.name
    : selectedSubjectId ? workspace.subjectById.get(selectedSubjectId)?.name : null;

  return <div className="ml-page ml-simple-page">
    <header className="ws-page-head">
      <div><h1>Mistake Log</h1>
        <p className="ws-muted ml-page-subtitle">Keep the mistake. Keep the correction.</p>
      </div>
      {workspace.writable ? <div className="ws-page-actions">
        <button className="ws-button is-primary" type="button" onClick={() => {
          setAdding(true); setEditingId(null);
        }}><Plus size={16} /> Add mistake</button>
      </div> : null}
    </header>
    <div className="ml-organised-layout">
      <aside className="ml-organiser" aria-label="Mistake subjects and topics">
        <div className="ml-nav-header">
          <span>Subjects</span>
          {workspace.writable ? <button className="ws-icon-button" type="button"
            aria-label="New subject" title="New subject" onClick={() => {
              setCreatingSubject(true); setCreatingTopic(null); setRenaming(null);
            }}><Plus size={17} /></button> : null}
        </div>
        {creatingSubject ? <div className="ml-inline-create">
          <InlineNameForm label="New subject" placeholder="German, Work, History…"
            onCancel={() => setCreatingSubject(false)}
            onSubmit={async (name) => {
              const existing = workspace.snapshot.subjects.find((row) => row.name.toLowerCase() === name.trim().toLowerCase());
              const subject = existing ?? await workspace.addSubject(name);
              await workspace.ensureInbox(subject.id);
              setCreatingSubject(false);
              select(subject.id, null);
            }} />
        </div> : null}
        {creatingTopic ? <div className="ml-inline-create">
          <InlineNameForm label={creatingTopic.parentId ? "New subtopic" : "New topic"}
            placeholder="Grammar, Etiquette, Vocabulary…"
            onCancel={() => setCreatingTopic(null)}
            onSubmit={async (name) => {
              const topic = await workspace.addTopic(creatingTopic.subjectId, name, creatingTopic.parentId);
              select(creatingTopic.subjectId, topic.id);
              setCreatingTopic(null);
            }} />
        </div> : null}
        <button type="button" className={"ml-nav-all" + (!selectedSubjectId ? " is-active" : "")}
          onClick={() => select(null, null)}>All mistakes <span>{mistakes.length}</span></button>
        {subjects.map((subject) => <div key={subject.id} className="ml-nav-group">
          {renaming?.kind === "subject" && renaming.id === subject.id
            ? <InlineNameForm label="Rename subject" initial={subject.name} submitLabel="Rename"
              onCancel={() => setRenaming(null)} onSubmit={async (name) => {
                await workspace.renameSubjectById(subject.id, name); setRenaming(null);
              }} />
            : <div className="ml-nav-row">
              <button type="button" className={"ml-nav-label" + (selectedSubjectId === subject.id && !selectedTopicId ? " is-active" : "")}
                onClick={() => select(subject.id, null)}>{subject.name}<span>{subjectCounts.get(subject.id) ?? 0}</span></button>
              {workspace.writable ? <>
                <button className="ws-icon-button ml-nav-tool" type="button" title="Add topic"
                  aria-label={"Add topic to " + subject.name} onClick={() => {
                    setCreatingTopic({ subjectId: subject.id, parentId: null }); setCreatingSubject(false);
                  }}><FolderPlus size={15} /></button>
                <button className="ws-icon-button ml-nav-tool" type="button" title="Rename subject"
                  aria-label={"Rename " + subject.name} onClick={() => setRenaming({ kind: "subject", id: subject.id })}><Pencil size={13} /></button>
              </> : null}
            </div>}
          <TopicBranch subjectId={subject.id} parentId={null} depth={0}
            selectedTopicId={selectedTopicId} selectedSubjectId={selectedSubjectId}
            mistakes={mistakes} onSelect={select}
            onCreate={(parentId) => {
              setCreatingTopic({ subjectId: subject.id, parentId }); setCreatingSubject(false);
            }}
            renaming={renaming} setRenaming={setRenaming} />
        </div>)}
        {!subjects.length ? <p className="ml-nav-hint">Add a subject to organise mistakes. You can also save without one.</p> : null}
      </aside>
      <main className="ml-simple-list" ref={listRef}>
        {selectedTitle ? <div className="ml-current-filter">
          <span>{workspace.pathLabel(selectedTopicId ?? undefined) || selectedTitle}</span>
          <button type="button" onClick={() => select(null, null)}>Show all <X size={13} /></button>
        </div> : null}
        {adding ? <MistakeEditor key={"new:" + (selectedTopicId ?? selectedSubjectId ?? "all")}
          preferredSubjectId={selectedSubjectId} preferredTopicId={selectedTopicId}
          onDone={() => setAdding(false)} /> : null}
        {!visibleMistakes.length && !adding ? <EmptyState title={mistakes.length ? "No mistakes here yet" : "No mistakes recorded yet"} icon={<Pencil size={22} />}>
          Add a mistake and the correct version. Subjects, titles and colours are optional.
        </EmptyState> : null}
        {visibleMistakes.slice(0, visibleCount).map((entry) => editingId === entry.id
          ? <MistakeEditor key={entry.id} entry={entry} onDone={() => setEditingId(null)} />
          : <MistakeItem key={entry.id} entry={entry} highlighted={entry.id === highlightId}
            onEdit={() => { setAdding(false); setEditingId(entry.id); }} />)}
        {visibleMistakes.length > visibleCount ? <button className="ml-simple-more" type="button"
          onClick={() => setVisibleCount((count) => count + 60)}>Show more</button> : null}
      </main>
    </div>
    {session ? <RecallSession ids={session} onClose={() => setSession(null)} /> : null}
  </div>;
}

function TopicBranch({ subjectId, parentId, depth, selectedSubjectId, selectedTopicId, mistakes, onSelect,
  onCreate, renaming, setRenaming }: {
  subjectId: string; parentId: string | null; depth: number;
  selectedSubjectId: string | null; selectedTopicId: string | null; mistakes: KnowledgeEntry[];
  onSelect: (subjectId: string | null, topicId: string | null) => void;
  onCreate: (parentId: string) => void;
  renaming: { kind: "subject" | "topic"; id: string } | null;
  setRenaming: (value: { kind: "subject" | "topic"; id: string } | null) => void;
}) {
  const workspace = useWorkspace();
  return <>{workspace.childrenOf(parentId, subjectId).map((topic: KnowledgeTopic) => {
    const subtree = new Set(workspace.subtreeIds(topic.id));
    const count = mistakes.filter((entry) => subtree.has(entry.topic_id)).length;
    return <div className="ml-nav-topic-group" key={topic.id}>
      {renaming?.kind === "topic" && renaming.id === topic.id
        ? <InlineNameForm label="Rename topic" initial={topic.name} submitLabel="Rename"
          onCancel={() => setRenaming(null)} onSubmit={async (name) => {
            await workspace.changeTopic(topic.id, { name }); setRenaming(null);
          }} />
        : <div className="ml-nav-row" style={{ paddingLeft: 12 + depth * 12 }}>
          <button type="button" className={"ml-nav-label ml-nav-topic" +
            (selectedSubjectId === subjectId && selectedTopicId === topic.id ? " is-active" : "")}
            onClick={() => onSelect(subjectId, topic.id)}>
            <ChevronRight size={12} /> {topic.name}<span>{count}</span>
          </button>
          {workspace.writable ? <>
            <button className="ws-icon-button ml-nav-tool" type="button" title="Add subtopic"
              aria-label={"Add subtopic to " + topic.name} onClick={() => onCreate(topic.id)}><Plus size={13}/></button>
            <button className="ws-icon-button ml-nav-tool" type="button" title="Rename topic"
              aria-label={"Rename topic " + topic.name} onClick={() => setRenaming({ kind: "topic", id: topic.id })}><Pencil size={12}/></button>
          </> : null}
        </div>}
      <TopicBranch subjectId={subjectId} parentId={topic.id} depth={depth + 1}
        selectedSubjectId={selectedSubjectId} selectedTopicId={selectedTopicId} mistakes={mistakes}
        onSelect={onSelect} onCreate={onCreate} renaming={renaming} setRenaming={setRenaming} />
    </div>;
  })}</>;
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
  async function togglePin() {
    try { await workspace.patchEntry(entry.id, { pinned: !entry.pinned }); }
    catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }
  return <article className={"ml-simple-item" + (highlighted ? " is-highlighted" : "")}
    data-accent={entry.accent_color ?? "none"} data-mistake={entry.id}>
    {confirmElement}
    <div className="ml-simple-body">
      {entry.title ? <h2 className="ml-entry-title">{entry.title}</h2> : null}
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
      {entry.explanation ? <p className="ml-entry-context">{entry.explanation}</p> : null}
      <small className="ml-entry-path">{workspace.pathLabel(entry.topic_id)}</small>
    </div>
    {workspace.writable ? <div className="ml-simple-actions">
      <button type="button" className={"ws-icon-button" + (entry.pinned ? " is-active" : "")}
        aria-label={entry.pinned ? "Unpin mistake" : "Pin mistake"} title={entry.pinned ? "Unpin" : "Pin"}
        aria-pressed={entry.pinned} onClick={() => void togglePin()}><Pin size={15}/></button>
      <button type="button" className="ws-icon-button" aria-label="Edit mistake" title="Edit" onClick={onEdit}>
        <Pencil size={15}/>
      </button>
      <button type="button" className="ws-icon-button" aria-label="Delete mistake" title="Delete"
        onClick={() => void remove()}><Trash2 size={15}/></button>
    </div> : null}
  </article>;
}

function MistakeEditor({ entry, preferredSubjectId, preferredTopicId, onDone }: {
  entry?: KnowledgeEntry; preferredSubjectId?: string | null; preferredTopicId?: string | null; onDone: () => void;
}) {
  const workspace = useWorkspace();
  const initialSubjectId = entry ? workspace.topicById.get(entry.topic_id)?.subject_id ?? "" : preferredSubjectId ?? "";
  const [subjectId, setSubjectId] = useState(initialSubjectId);
  const [topicId, setTopicId] = useState(entry?.topic_id ?? preferredTopicId ?? "");
  const [attempt, setAttempt] = useState(entry?.attempt ?? "");
  const [correction, setCorrection] = useState(entry?.correction ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [explanation, setExplanation] = useState(entry?.explanation ?? "");
  const [accent, setAccent] = useState<MistakeAccent | "">(entry?.accent_color ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const options = useMemo(() => {
    const visit = (subject: string, parentId: string | null, depth: number, rows: Array<{ id: string; name: string }>) => {
      for (const topic of workspace.childrenOf(parentId, subject)) {
        rows.push({ id: topic.id, name: "\u00a0\u00a0".repeat(depth) + topic.name });
        visit(subject, topic.id, depth + 1, rows);
      }
    };
    const rows: Array<{ id: string; name: string }> = [];
    if (subjectId) visit(subjectId, null, 0, rows);
    return rows;
  }, [subjectId, workspace.childrenOf]);

  async function save() {
    if (busy) return;
    if (!attempt.trim() || !correction.trim()) {
      setError("Write the mistake and the correct version.");
      return;
    }
    setBusy(true); setError("");
    try {
      const subject = subjectId
        ? workspace.subjectById.get(subjectId)
        : workspace.snapshot.subjects.find((item) => item.name.trim().toLowerCase() === "unsorted")
          ?? await workspace.addSubject("Unsorted");
      if (!subject) throw new Error("Choose a valid subject.");
      const resolvedTopic = topicId && workspace.topicById.get(topicId)?.subject_id === subject.id
        ? topicId : (await workspace.ensureInbox(subject.id)).id;
      if (entry) {
        await workspace.patchEntry(entry.id, {
          attempt: attempt.trim(), correction: correction.trim(), title: title.trim(),
          explanation: explanation.trim(), accent_color: accent || null, topic_id: resolvedTopic,
        });
      } else {
        await workspace.addEntry({
          kind: "mistake", topicId: resolvedTopic, title: title.trim(),
          attempt: attempt.trim(), correction: correction.trim(), explanation: explanation.trim(),
          accentColor: accent || null,
        });
      }
      onDone();
    } catch (reason) {
      // Keep everything visible on error; the user can retry without retyping.
      setError(friendlyError(reason));
    } finally { setBusy(false); }
  }

  return <form className="ml-simple-edit" onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape" && event.target instanceof HTMLTextAreaElement) {
        event.preventDefault(); onDone();
      }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault(); void save();
      }
    }}>
    <div className="ml-edit-head"><strong>{entry ? "Edit mistake" : "New mistake"}</strong>
      <button type="button" className="ws-icon-button" aria-label="Cancel editing" disabled={busy} onClick={onDone}><X size={16}/></button>
    </div>
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
    <div className="ml-edit-options">
      <label className="ws-field">
        <span>Title <small>(optional)</small></span>
        <input type="text" maxLength={200} value={title} placeholder="Give this a name…" onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label className="ws-field">
        <span>Subject</span>
        <select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setTopicId(""); }}>
          <option value="">Unsorted</option>
          {workspace.snapshot.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
      </label>
      <label className="ws-field">
        <span>Topic</span>
        <select value={topicId} onChange={(event) => setTopicId(event.target.value)} disabled={!subjectId}>
          <option value="">Inbox (default)</option>
          {options.map((topic) => <option key={topic.id} value={topic.id}>{topic.name}</option>)}
        </select>
      </label>
    </div>
    <fieldset className="ml-accent-options"><legend>Colour <small>(optional)</small></legend>
      <div className="ml-accent-choices">
        {ACCENTS.map((colour) => <button key={colour.value || "none"} type="button"
          className={"ml-accent-choice" + (accent === colour.value ? " is-selected" : "")}
          data-accent={colour.value || "none"} aria-pressed={accent === colour.value}
          aria-label={"Colour: " + colour.label} title={colour.label}
          onClick={() => setAccent(colour.value)}>
          <span className="ml-accent-dot" />{colour.label}
        </button>)}
      </div>
    </fieldset>
    <details className="ml-edit-notes" defaultOpen={Boolean(explanation)}>
      <summary>Additional note <small>(optional)</small></summary>
      <label className="ws-field">
        <span>Context or explanation</span>
        <textarea rows={3} maxLength={10000} value={explanation}
          placeholder="A reminder, context, or why the correction matters…"
          onChange={(event) => setExplanation(event.target.value)} />
      </label>
    </details>
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
