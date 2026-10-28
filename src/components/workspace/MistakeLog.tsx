import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, GraduationCap, Pencil, Plus, Trash2, X } from "lucide-react";
import { comparableCorrection, friendlyError, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { EmptyState, Kbd, MOD_KEY, Portal, TopicPicker } from "./ui";
import { useWorkspace } from "./WorkspaceContext";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { RichText } from "./RichText";
import { mistakeDifference, type DifferencePart } from "../../lib/mistakeDiff";

function DiffLine({ parts }: { parts: DifferencePart[] }) {
  return <>{parts.map((part, index) => <span key={index}
    className={part.kind === "wrong" ? "ml-diff-wrong" : part.kind === "corrected" ? "ml-diff-right"
      : part.kind === "gap" ? "ml-diff-gap" : undefined}>{part.text}</span>)}</>;
}

function ruleParts(title: string) {
  const match = title.trim().match(/^(.+?)\s+[–—-]\s+(.+)$/u);
  return { rule: (match?.[1] ?? title).trim(), detail: match?.[2]?.trim() ?? "" };
}

function isNotFiled(entry: KnowledgeEntry, topicById: ReturnType<typeof useWorkspace>["topicById"],
  subjectById: ReturnType<typeof useWorkspace>["subjectById"]) {
  const topic = topicById.get(entry.topic_id);
  return !topic || topic.name.trim().toLowerCase() === "inbox"
    || subjectById.get(topic.subject_id)?.name.trim().toLowerCase() === "unsorted";
}

/** Three familiar Notebook levels, without a second subject/topic hierarchy. */
export function MistakeLog() {
  const workspace = useWorkspace();
  const { snapshot, focusMistake, clearFocusMistake } = workspace;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [session, setSession] = useState<string[] | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(() => workspace.memory.mistakes.subjectId);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(() => workspace.memory.mistakes.topicId);
  const [notFiledOnly, setNotFiledOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(60);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const mistakes = useMemo(() => snapshot.entries
    .filter((entry) => entry.kind === "mistake")
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at)), [snapshot.entries]);
  const isUnfiled = useCallback((entry: KnowledgeEntry) =>
    isNotFiled(entry, workspace.topicById, workspace.subjectById), [workspace.topicById, workspace.subjectById]);

  const select = useCallback((subjectId: string | null, topicId: string | null, unfiled = false) => {
    setSelectedSubjectId(subjectId);
    setSelectedTopicId(topicId);
    setNotFiledOnly(unfiled);
    setVisibleCount(60);
    setSearch("");
    setAdding(false);
    setEditingId(null);
    workspace.updateMemory((current) => ({ ...current, mistakes: { subjectId, topicId } }));
  }, [workspace.updateMemory]);

  // Preserve external links from Review and Notebook, opening the actual entry.
  useEffect(() => {
    if (!focusMistake) return;
    const entry = mistakes.find((item) => item.id === focusMistake.id);
    clearFocusMistake();
    if (!entry) return;
    if (focusMistake.practise) {
      setSession(focusMistake.ids?.length ? focusMistake.ids : [entry.id]);
      return;
    }
    const topic = workspace.topicById.get(entry.topic_id);
    select(topic?.subject_id ?? null, entry.topic_id);
    setHighlightId(entry.id);
  }, [focusMistake, clearFocusMistake, mistakes, select, workspace.topicById]);

  useEffect(() => {
    if (!highlightId) return;
    const scroll = window.setTimeout(() => {
      listRef.current?.querySelector<HTMLElement>('[data-mistake="' + highlightId + '"]')
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 60);
    const clear = window.setTimeout(() => setHighlightId(null), 2600);
    return () => { window.clearTimeout(scroll); window.clearTimeout(clear); };
  }, [highlightId]);

  const selectedSubject = selectedSubjectId ? workspace.subjectById.get(selectedSubjectId) : null;
  const selectedTopic = selectedTopicId ? workspace.topicById.get(selectedTopicId) : null;
  const topicIds = useMemo(() => selectedTopicId ? new Set(workspace.subtreeIds(selectedTopicId)) : null,
    [selectedTopicId, workspace.subtreeIds]);

  const visibleMistakes = useMemo(() => mistakes.filter((entry) => {
    const topic = workspace.topicById.get(entry.topic_id);
    if (selectedSubjectId && topic?.subject_id !== selectedSubjectId) return false;
    if (topicIds && !topicIds.has(entry.topic_id)) return false;
    if (notFiledOnly && !isUnfiled(entry)) return false;
    const query = search.trim().toLocaleLowerCase();
    return !query || [entry.attempt, entry.correction, entry.explanation, entry.title]
      .some((value) => value.toLocaleLowerCase().includes(query));
  }), [mistakes, selectedSubjectId, topicIds, notFiledOnly, isUnfiled, workspace.topicById, search]);

  const countInTopic = useCallback((topicId: string) => {
    const ids = new Set(workspace.subtreeIds(topicId));
    return mistakes.filter((entry) => ids.has(entry.topic_id)).length;
  }, [workspace.subtreeIds, mistakes]);

  const childTopics = selectedSubjectId && !notFiledOnly ? workspace.childrenOf(selectedTopicId, selectedSubjectId)
    .filter((topic) => topic.name.trim().toLowerCase() !== "inbox" && countInTopic(topic.id) > 0) : [];
  const subjectCards = !selectedSubjectId && !notFiledOnly ? snapshot.subjects
    .filter((subject) => subject.name.trim().toLowerCase() !== "unsorted"
      && mistakes.some((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === subject.id))
    .sort((a, b) => {
      const last = (id: string) => mistakes.filter((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === id)
        .reduce((date, entry) => entry.created_at > date ? entry.created_at : date, "");
      return last(b.id).localeCompare(last(a.id));
    }) : [];
  const unfiledCount = mistakes.filter(isUnfiled).length;
  const currentUnfiledCount = selectedSubjectId ? mistakes.filter((entry) =>
    workspace.topicById.get(entry.topic_id)?.subject_id === selectedSubjectId && isUnfiled(entry)).length : unfiledCount;

  function practiseShown() {
    const eligible = visibleMistakes.filter((entry) => entry.correction.trim());
    if (!eligible.length) return;
    const latest = new Map<string, { outcome: string; created_at: string }>();
    for (const event of snapshot.practice) {
      const previous = latest.get(event.record_id);
      if (!previous || previous.created_at < event.created_at) latest.set(event.record_id, event);
    }
    const priority = (entry: KnowledgeEntry) => {
      const last = latest.get(entry.id);
      return last?.outcome === "incorrect" ? 0 : !last ? 1 : 2;
    };
    eligible.sort((a, b) => priority(a) - priority(b)
      || (a.last_recalled_at ?? "").localeCompare(b.last_recalled_at ?? ""));
    setSession(eligible.map((entry) => entry.id));
  }

  const groupByRule = Boolean(selectedTopicId && !search.trim() && !notFiledOnly);
  const repeatedRules = new Map<string, KnowledgeEntry[]>();
  if (groupByRule) {
    for (const entry of visibleMistakes) {
      const name = ruleParts(entry.title).rule;
      if (!name) continue;
      repeatedRules.set(name, [...(repeatedRules.get(name) ?? []), entry]);
    }
  }
  const groups = [...repeatedRules.entries()].filter(([, entries]) => entries.length > 1);
  const groupedIds = new Set(groups.flatMap(([, entries]) => entries.map((entry) => entry.id)));
  const listEntries = !selectedSubjectId && !notFiledOnly && !search.trim()
    ? mistakes.slice(0, 5) : visibleMistakes.slice(0, visibleCount);

  function renderItem(entry: KnowledgeEntry, inRule = false) {
    return editingId === entry.id
      ? <MistakeEditor key={entry.id} entry={entry} onDone={() => setEditingId(null)} />
      : <MistakeItem key={entry.id} entry={entry} highlighted={entry.id === highlightId}
          hideRuleTitle={inRule} showPath={!selectedTopicId || !selectedSubjectId}
          onEdit={() => { setAdding(false); setEditingId(entry.id); }} />;
  }

  const title = notFiledOnly ? "Not filed" : selectedTopic?.name ?? selectedSubject?.name ?? "Mistake Log";
  const allPage = !selectedSubjectId && !notFiledOnly;

  return <div className="ml-page ml-simple-page ml-hierarchy" ref={listRef}>
    <nav className="nb-crumbs ml-crumbs" aria-label="Mistake Log location">
      <button type="button" onClick={() => select(null, null)}>Mistake Log</button>
      {selectedSubject ? <><ChevronRight size={12}/><button type="button"
        onClick={() => select(selectedSubject.id, null)}>{selectedSubject.name}</button></> : null}
      {selectedTopic && !notFiledOnly ? workspace.topicPath(selectedTopic.id).chain.map((part) =>
        <span className="nb-crumb" key={part.id}><ChevronRight size={12}/>
          <button type="button" onClick={() => select(part.subject_id, part.id)}>{part.name}</button>
        </span>) : null}
      {notFiledOnly ? <span className="nb-crumb"><ChevronRight size={12}/> Not filed</span> : null}
    </nav>
    <header className="ws-page-head">
      <div><h1>{title}</h1>
        <p className="ws-muted ml-page-subtitle">{allPage ? "Understand mistakes. Keep the correction."
          : visibleMistakes.length + (visibleMistakes.length === 1 ? " mistake" : " mistakes")}</p></div>
      <div className="ws-page-actions">
        <button className="ws-button" type="button" disabled={!visibleMistakes.some((entry) => entry.correction.trim())}
          onClick={practiseShown}><GraduationCap size={16}/> Practise {allPage ? "all" : title}</button>
        {workspace.writable ? <button className="ws-button is-primary" type="button"
          onClick={() => { setAdding(true); setEditingId(null); }}><Plus size={16}/> Add mistake</button> : null}
      </div>
    </header>

    {allPage && unfiledCount > 0 ? <button className="ml-not-filed" type="button"
      onClick={() => select(null, null, true)}>{unfiledCount} {unfiledCount === 1 ? "mistake" : "mistakes"} not filed yet <ChevronRight size={15}/></button> : null}
    {selectedSubjectId && !selectedTopicId && !notFiledOnly && currentUnfiledCount > 0
      ? <button className="ml-not-filed" type="button" onClick={() => select(selectedSubjectId, null, true)}>
        Not filed · {currentUnfiledCount}<ChevronRight size={15}/></button> : null}

    {allPage && !search.trim() ? <div className="ml-hierarchy-grid">
      {subjectCards.map((subject) => {
        const entries = mistakes.filter((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === subject.id);
        const topics = workspace.childrenOf(null, subject.id).filter((topic) => countInTopic(topic.id));
        return <button type="button" key={subject.id} className="ml-hierarchy-card"
          onClick={() => select(subject.id, null)}>
          <span className="ml-hierarchy-card-heading">{subject.name}<ChevronRight size={17}/></span>
          <strong>{entries.length} {entries.length === 1 ? "mistake" : "mistakes"}</strong>
          <small>{topics.map((topic) => topic.name + " " + countInTopic(topic.id)).slice(0, 3).join(" · ") || "Not filed"}</small>
        </button>;
      })}
    </div> : null}

    {childTopics.length && !search.trim() ? <div className="ml-hierarchy-grid">
      {childTopics.map((topic) => <button type="button" key={topic.id} className="ml-hierarchy-card"
        onClick={() => select(topic.subject_id, topic.id)}>
        <span className="ml-hierarchy-card-heading">{topic.name}<ChevronRight size={17}/></span>
        <strong>{countInTopic(topic.id)} {countInTopic(topic.id) === 1 ? "mistake" : "mistakes"}</strong>
      </button>)}
    </div> : null}

    <section className="ml-hierarchy-content">
      {workspace.writable && selectedTopicId && !notFiledOnly ? <MistakeQuickAdd key={selectedTopicId}
        initialTopicId={selectedTopicId}/> : null}
      {adding ? <MistakeEditor key={"new:" + (selectedTopicId ?? selectedSubjectId ?? "all")}
        preferredSubjectId={selectedSubjectId} preferredTopicId={selectedTopicId}
        onDone={() => setAdding(false)}/> : null}
      <label className="ml-search-label">
        <span className="sr-only">Search mistakes</span>
        <input className="ml-search-field" type="search" value={search}
          onChange={(event) => { setSearch(event.target.value); setVisibleCount(60); }}
          placeholder={allPage ? "Search all mistakes…" : "Search in " + title + "…"} />
      </label>
      {allPage && !search.trim() && mistakes.length > 0 ? <h2 className="ml-section-label">Recently added</h2>
        : !allPage || search.trim() ? <h2 className="ml-section-label">{search.trim() ? "Search results" : "All mistakes"}</h2> : null}
      {!mistakes.length && !adding ? <EmptyState title="No mistakes recorded yet" icon={<Pencil size={22}/>}>
        Add a mistake and its correction. File it under any Notebook subject and topic.
      </EmptyState> : null}
      {mistakes.length > 0 && !visibleMistakes.length && (search.trim() || !allPage)
        ? <p className="ws-muted">No mistakes match this view. {search.trim() && !allPage
          ? <button type="button" className="nb-link-button" onClick={() => select(null, null)}>Search everywhere</button> : null}</p> : null}
      {groupByRule && groups.length && !search.trim() ? groups.map(([rule, entries]) =>
        <section className="ml-rule-group" key={rule}>
          <div className="ml-rule-head"><h3>{rule} <small>· {entries.length}</small></h3>
            <button type="button" className="nb-link-button"
              onClick={() => setSession(entries.filter((entry) => entry.correction.trim()).map((entry) => entry.id))}
              disabled={!entries.some((entry) => entry.correction.trim())}>Practise</button></div>
          <div className="ml-simple-list">{entries.map((entry) => renderItem(entry, true))}</div>
        </section>) : null}
      <div className="ml-simple-list">{listEntries.filter((entry) => !groupedIds.has(entry.id)).map((entry) => renderItem(entry))}</div>
      {!allPage && visibleMistakes.length > visibleCount ? <button className="ml-simple-more" type="button"
        onClick={() => setVisibleCount((count) => count + 60)}>Show more</button> : null}
    </section>
    {session ? <RecallSession ids={session} onClose={() => setSession(null)}/> : null}
  </div>;
}

function MistakeQuickAdd({ initialTopicId }: { initialTopicId: string }) {
  const workspace = useWorkspace();
  const [attempt, setAttempt] = useState("");
  const [correction, setCorrection] = useState("");
  const [rule, setRule] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function save() {
    if (!attempt.trim() || busy) return;
    setBusy(true); setError("");
    try {
      await workspace.addEntry({ kind: "mistake", topicId: initialTopicId, attempt: attempt.trim(),
        correction: correction.trim(), title: rule.trim() });
      setAttempt(""); setCorrection("");
      input.current?.focus();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }
  return <form className="ml-quick-add" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label><span>Mistake</span><input ref={input} value={attempt} maxLength={5000}
      placeholder="What was wrong?" onChange={(event) => setAttempt(event.target.value)}/></label>
    <label><span>Correction</span><input value={correction} maxLength={5000}
      placeholder="What's right?" onChange={(event) => setCorrection(event.target.value)}/></label>
    <label className="ml-quick-rule"><span>Rule (optional)</span><input value={rule} maxLength={200}
      placeholder="e.g. Adjektivendung" onChange={(event) => setRule(event.target.value)}/></label>
    <button className="ws-button is-primary" disabled={busy || !attempt.trim()} type="submit">
      <Plus size={15}/> Add
    </button>
    {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
  </form>;
}

function MistakeItem({ entry, highlighted, showPath, onEdit }: {
  entry: KnowledgeEntry; highlighted: boolean; showPath: boolean; onEdit: () => void;
}) {
  const workspace = useWorkspace();
  async function remove() {
    try { await workspace.removeEntry(entry.id); }
    catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }
  const diff = mistakeDifference(entry.attempt, entry.correction);
  async function togglePin() {
    try { await workspace.patchEntry(entry.id, { pinned: !entry.pinned }); }
    catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }
  return <article className={"ml-simple-item" + (highlighted ? " is-highlighted" : "")}
    data-accent={entry.accent_color ?? "none"} data-mistake={entry.id}>
    <div className="ml-simple-body">
      {entry.title ? <h2 className="ml-entry-title">{entry.title}</h2> : null}
      <div className="ml-simple-pair">
        <span className="ml-simple-symbol" title="Mistake" aria-label="Mistake">×</span>
        <p className="ml-simple-wrong">{entry.attempt ? <DiffLine parts={diff.before} /> : "Not recorded"}</p>
      </div>
      <div className="ml-simple-pair">
        <span className="ml-simple-symbol is-right" title="Correction" aria-label="Correction">✓</span>
        <p className={"ml-simple-right" + (!entry.correction ? " is-missing" : "")}>
          {entry.correction ? <DiffLine parts={diff.after} /> : "Add the correct version"}
        </p>
      </div>
      {entry.explanation ? <div className="ml-entry-context-wrap"><RichText text={entry.explanation} className="ml-entry-context is-compact" /></div> : null}
      {showPath ? <small className="ml-entry-path">{workspace.pathLabel(entry.topic_id)}</small> : null}
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
  const explanationRef = useRef<RichEditorHandle>(null);
  const [accent, setAccent] = useState<MistakeAccent | "">(entry?.accent_color ?? "");
  const [notesOpen, setNotesOpen] = useState(Boolean(entry?.explanation));
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
    if (!attempt.trim()) {
      setError("Write the mistake first. You can add the correction later.");
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
          explanation: (explanationRef.current?.getMarkdown() ?? explanation).trim(), accent_color: accent || null, topic_id: resolvedTopic,
        });
      } else {
        await workspace.addEntry({
          kind: "mistake", topicId: resolvedTopic, title: title.trim(),
          attempt: attempt.trim(), correction: correction.trim(), explanation: (explanationRef.current?.getMarkdown() ?? explanation).trim(),
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
      if (event.key === "Escape") {
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
    <details className="ml-edit-notes" open={notesOpen} onToggle={(event) => setNotesOpen(event.currentTarget.open)}>
      <summary>Explanation &amp; examples <small>— optional · bold, colour, highlights &amp; lists</small></summary>
      <div className="ml-explanation-editor">
        <RichEditor ref={explanationRef} resetKey={entry?.id ?? "new-mistake"} value={explanation}
          ariaLabel="Formatted explanation" placeholder="Why was this wrong? Add a rule, memorable example or short explanation."
          onChange={setExplanation} onSave={() => void save()} onDone={() => void save()} compactToolbar />
      </div>
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

  const exact = Boolean(current && answer.trim() && comparableCorrection(answer) === comparableCorrection(current.correction));

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
        <p className="ws-muted">Practice history is saved. You can return to these mistakes whenever you choose.</p>
        <div className="ws-dialog-actions"><button type="button" className="ws-button is-primary" autoFocus onClick={onClose}>Done</button></div>
      </div> : current ? <>
        <div className="recall-prompt">
          <span className="ml-label">{workspace.pathLabel(current.topic_id)}</span>
          {current.attempt ? <p className="recall-attempt"><span className="ml-label">You said</span>{current.attempt}</p> : <p className="ws-muted">Recall the correct form{current.title ? ` for “${current.title}”` : ""}.</p>}
          {current.explanation ? (hint || revealed ? <div className="recall-hint"><span className="ml-label">Why</span><RichText text={current.explanation} className="is-compact" /></div>
            : <button type="button" className="nb-link-button" onClick={() => setHint(true)}>Show the explanation as a hint</button>) : null}
        </div>
        <label className="ws-field"><span>Write the corrected version from memory</span>
          <textarea ref={inputRef} rows={2} value={answer} readOnly={revealed} onChange={(event) => setAnswer(event.target.value)} placeholder="Type it before revealing…" /></label>
        {revealed ? <div className={`recall-result ${answer.trim() ? (exact ? "is-exact" : "is-different") : ""}`}>
          <span className="ml-label">Correct form</span>
          {answer.trim() && !exact ? <p className="recall-user-answer"><DiffLine parts={mistakeDifference(answer, current.correction).before} /></p> : null}
           <p className="recall-answer"><DiffLine parts={mistakeDifference(answer, current.correction).after} /></p>
          <small>{!answer.trim() ? "Read the answer before continuing."
            : exact ? "Exact match." : "Differences are underlined above."}</small>
        </div> : null}
        <div className="ws-dialog-actions">
          {!revealed ? <>
            <button type="button" className="ws-button" onClick={() => void grade(false, true)} disabled={busy}>Missed</button>
            <button type="button" className="ws-button is-primary" onClick={() => setRevealed(true)}>Reveal <Kbd>{MOD_KEY} ↵</Kbd></button>
          </> : missed ? <button type="button" className="ws-button is-primary" onClick={next}>Next</button> : <>
            <button type="button" className="ws-button" onClick={() => void grade(false)} disabled={busy}>Missed</button>
            <button type="button" className="ws-button is-primary" onClick={() => void grade(true)} disabled={busy}><Check size={15} /> Recalled</button>
          </>}
        </div>
      </> : <p className="ws-muted">These mistakes have no correction to recall yet.</p>}
    </div>
  </div></Portal>;
}
