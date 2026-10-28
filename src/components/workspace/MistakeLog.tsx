import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, GraduationCap, Pencil, Plus, Trash2, X } from "lucide-react";
import { comparableCorrection, friendlyError, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { EmptyState, Kbd, MOD_KEY, Portal, TopicPicker, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";
import { SubjectCard } from "./SubjectCard";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { RichText } from "./RichText";
import { mistakeDifference, type DifferencePart } from "../../lib/mistakeDiff";
import { parseCaptureLine } from "../../lib/captureParse";

function DiffLine({ parts }: { parts: DifferencePart[] }) {
  return <>{parts.map((part, index) => <span key={index}
    className={part.kind === "wrong" ? "ml-diff-wrong" : part.kind === "corrected" ? "ml-diff-right"
      : part.kind === "gap" ? "ml-diff-gap" : undefined}>{part.text}</span>)}</>;
}

function ruleParts(title: string) {
  const match = title.trim().match(/^(.+?)\s+[–—-]\s+(.+)$/u);
  return { rule: (match?.[1] ?? title).trim(), detail: match?.[2]?.trim() ?? "" };
}

/** Exact pair, within a subject. Matching only the correction merges unrelated errors. */
function findRepeatedMistake(entries: KnowledgeEntry[], topics: ReturnType<typeof useWorkspace>["topicById"],
  topicId: string, attempt: string, correction: string) {
  const subject = topics.get(topicId)?.subject_id;
  if (!subject) return undefined;
  const wrong = comparableCorrection(attempt), right = comparableCorrection(correction);
  return entries.find((entry) => entry.kind === "mistake"
    && topics.get(entry.topic_id)?.subject_id === subject
    && comparableCorrection(entry.attempt) === wrong
    && comparableCorrection(entry.correction) === right);
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
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkPicker, setBulkPicker] = useState(false);
  const [bulkRule, setBulkRule] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmElement, confirm] = useConfirm();
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
    setSelectedIds([]);
    setSelecting(false);
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
    for (const entry of visibleMistakes.slice(0, visibleCount)) {
      const name = ruleParts(entry.title).rule;
      if (!name) continue;
      repeatedRules.set(name, [...(repeatedRules.get(name) ?? []), entry]);
    }
  }
  const groups = [...repeatedRules.entries()].filter(([, entries]) => entries.length > 1);
  const groupedIds = new Set(groups.flatMap(([, entries]) => entries.map((entry) => entry.id)));
  const listEntries = !selectedSubjectId && !notFiledOnly && !search.trim()
    ? mistakes.slice(0, 5) : visibleMistakes.slice(0, visibleCount);

  async function moveSelected(topicId: string) {
    setBulkPicker(false);
    if (!selectedIds.length || bulkBusy) return;
    setBulkBusy(true);
    let moved = 0;
    try {
      for (const id of selectedIds) {
        await workspace.patchEntry(id, { topic_id: topicId });
        moved++;
      }
      workspace.toast("Moved " + moved + " mistakes to " + workspace.pathLabel(topicId) + ".");
      setSelectedIds([]); setSelecting(false);
    } catch (reason) {
      workspace.toast("Moved " + moved + " before an error: " + friendlyError(reason), { tone: "error" });
      setSelectedIds((ids) => ids.slice(moved));
    } finally { setBulkBusy(false); }
  }
  async function applyRule() {
    if (!selectedIds.length || !bulkRule.trim() || bulkBusy) return;
    setBulkBusy(true);
    let updated = 0;
    try {
      for (const id of selectedIds) {
        const entry = workspace.entryById.get(id);
        if (!entry) continue;
        const detail = ruleParts(entry.title).detail;
        await workspace.patchEntry(id, { title: bulkRule.trim() + (detail ? " – " + detail : "") });
        updated++;
      }
      workspace.toast("Updated the rule on " + updated + " mistakes.");
      setBulkRule(""); setSelectedIds([]); setSelecting(false);
    } catch (reason) {
      workspace.toast("Updated " + updated + " before an error: " + friendlyError(reason), { tone: "error" });
      setSelectedIds((ids) => ids.slice(updated));
    } finally { setBulkBusy(false); }
  }
  async function deleteSelected() {
    if (!selectedIds.length || bulkBusy) return;
    if (!await confirm({ title: "Delete " + selectedIds.length + " mistakes?",
      body: "The records and their recall history can be restored from Trash.", confirmLabel: "Move to Trash", danger: true })) return;
    setBulkBusy(true);
    let deleted = 0;
    try {
      for (const id of selectedIds) { await workspace.removeEntry(id, { undo: false }); deleted++; }
      workspace.toast("Moved " + deleted + " mistakes to Trash.");
      setSelectedIds([]); setSelecting(false);
    } catch (reason) {
      workspace.toast("Moved " + deleted + " before an error: " + friendlyError(reason), { tone: "error" });
      setSelectedIds((ids) => ids.slice(deleted));
    } finally { setBulkBusy(false); }
  }

  function renderItem(entry: KnowledgeEntry, inRule = false) {
    return editingId === entry.id
      ? <MistakeEditor key={entry.id} entry={entry} onDone={() => setEditingId(null)} />
      : <MistakeItem key={entry.id} entry={entry} highlighted={entry.id === highlightId}
          hideRuleTitle={inRule} showPath={!selectedTopicId || !selectedSubjectId}
          selecting={selecting} selected={selectedIds.includes(entry.id)}
          onSelect={() => setSelectedIds((ids) => ids.includes(entry.id) ? ids.filter((id) => id !== entry.id) : [...ids, entry.id])}
          onEdit={() => { setAdding(false); setEditingId(entry.id); }} />;
  }

  const title = notFiledOnly ? "Not filed" : selectedTopic?.name ?? selectedSubject?.name ?? "Mistake Log";
  const allPage = !selectedSubjectId && !notFiledOnly;

  return <div className="ml-page ml-simple-page ml-hierarchy" ref={listRef}>
    {confirmElement}
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
        return <SubjectCard key={subject.id} subject={subject} topics={topics.length}
          notes={entries.length} editable={false}
          detail={entries.length + (entries.length === 1 ? " mistake" : " mistakes") + " · "
            + (topics.map((topic) => topic.name + " " + countInTopic(topic.id)).slice(0, 3).join(" · ") || "Not filed")}
          onOpen={() => select(subject.id, null)}/>;
      })}
    </div> : null}

    {childTopics.length && !search.trim() ? <div className="ml-hierarchy-grid">
      {childTopics.map((topic) => <button type="button" key={topic.id} className="ml-hierarchy-card"
        onClick={() => select(topic.subject_id, topic.id)}>
        <span className="ml-hierarchy-card-heading">{topic.name}<ChevronRight size={17}/></span>
        <strong>{countInTopic(topic.id)} {countInTopic(topic.id) === 1 ? "mistake" : "mistakes"}</strong>
      </button>)}
    </div> : null}

    {workspace.writable && !allPage ? <div className="ml-bulk-toolbar">
      <button className="ws-button" type="button" aria-pressed={selecting}
        onClick={() => { setSelecting((open) => !open); setSelectedIds([]); }}>
        {selecting ? "Done selecting" : "Select mistakes"}
      </button>
      {selecting ? <>
        <button className="ws-button" type="button" disabled={bulkBusy}
          onClick={() => setSelectedIds(visibleMistakes.map((entry) => entry.id))}>Select all visible</button>
        <span className="ws-muted">{selectedIds.length} selected</span>
        <button className="ws-button" type="button" disabled={!selectedIds.length || bulkBusy}
          onClick={() => setBulkPicker(true)}>Move to…</button>
        <input type="text" maxLength={200} className="ml-bulk-rule-input" value={bulkRule}
          placeholder="Set rule…" aria-label="Set rule on selected mistakes"
          onChange={(event) => setBulkRule(event.target.value)}/>
        <button className="ws-button" type="button" disabled={!selectedIds.length || !bulkRule.trim() || bulkBusy}
          onClick={() => void applyRule()}>Apply rule</button>
        <button className="ws-button ml-bulk-delete" type="button" disabled={!selectedIds.length || bulkBusy}
          onClick={() => void deleteSelected()}>Move to Trash</button>
      </> : null}
    </div> : null}
    {bulkPicker ? <Portal><div className="ws-dialog-backdrop" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setBulkPicker(false); }}>
      <TopicPicker value={selectedTopicId} onClose={() => setBulkPicker(false)}
        onChange={(topicId) => void moveSelected(topicId)}/>
    </div></Portal> : null}
    <section className="ml-hierarchy-content">
      {workspace.writable && selectedTopicId && !notFiledOnly ? <MistakeQuickAdd key={selectedTopicId}
        initialTopicId={selectedTopicId}/> : null}
      {workspace.writable && selectedTopicId && !notFiledOnly ? <MistakeBulkAdd key={"bulk:" + selectedTopicId} topicId={selectedTopicId}/> : null}
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
  const [duplicate, setDuplicate] = useState<KnowledgeEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  const clear = () => { setAttempt(""); setCorrection(""); setDuplicate(null); input.current?.focus(); };
  async function save(forceSeparate = false) {
    if (!attempt.trim() || busy) return;
    if (!forceSeparate) {
      const existing = findRepeatedMistake(workspace.snapshot.entries, workspace.topicById,
        initialTopicId, attempt, correction);
      if (existing) { setDuplicate(existing); return; }
    }
    setBusy(true); setError(""); setDuplicate(null);
    try {
      await workspace.addEntry({ kind: "mistake", topicId: initialTopicId, attempt: attempt.trim(),
        correction: correction.trim(), title: rule.trim() });
      clear();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }
  async function madeAgain() {
    if (!duplicate || busy) return;
    setBusy(true); setError("");
    try {
      await workspace.recordRepeated(duplicate.id);
      workspace.toast("Recorded as made again, without creating a duplicate.");
      clear();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }
  return <form className="ml-quick-add" onSubmit={(event) => { event.preventDefault(); void save(); }}>
    <label><span>Mistake</span><input ref={input} value={attempt} maxLength={5000}
      placeholder="What was wrong?" onChange={(event) => { setAttempt(event.target.value); setDuplicate(null); }}/></label>
    <label><span>Correction</span><input value={correction} maxLength={5000}
      placeholder="What's right?" onChange={(event) => { setCorrection(event.target.value); setDuplicate(null); }}/></label>
    <label className="ml-quick-rule"><span>Rule (optional)</span><input value={rule} maxLength={200}
      placeholder="e.g. Adjektivendung" onChange={(event) => setRule(event.target.value)}/></label>
    <button className="ws-button is-primary" disabled={busy || !attempt.trim()} type="submit">
      <Plus size={15}/> Add
    </button>
    {duplicate ? <div className="ml-duplicate-check" role="status">
      <span>This exact mistake already exists in this subject.</span>
      <button className="ws-button" type="button" disabled={busy} onClick={() => void madeAgain()}>Made again</button>
      <button className="ws-button" type="button" disabled={busy} onClick={() => void save(true)}>Keep separately</button>
    </div> : null}
    {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
  </form>;
}

function MistakeBulkAdd({ topicId }: { topicId: string }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const rawLines = text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const lines = rawLines.map((raw) => ({ raw, result: parseCaptureLine(raw) }));
  const valid = lines.filter((item) => item.result.kind === "mistake" && item.result.attempt.trim()
    && item.result.attempt.length <= 5000 && item.result.correction.length <= 5000);
  const rejected = lines.length - valid.length;

  async function addAll() {
    if (busy || !valid.length || rejected || valid.length > 50) return;
    setBusy(true); setError("");
    let saved = 0, skipped = 0;
    const known = new Set(workspace.snapshot.entries.filter((entry) => entry.kind === "mistake"
      && workspace.topicById.get(entry.topic_id)?.subject_id === workspace.topicById.get(topicId)?.subject_id)
      .map((entry) => comparableCorrection(entry.attempt) + "\u0000" + comparableCorrection(entry.correction)));
    try {
      for (const item of valid) {
        const parsed = item.result;
        if (parsed.kind !== "mistake") continue;
        const key = comparableCorrection(parsed.attempt) + "\u0000" + comparableCorrection(parsed.correction);
        if (known.has(key)) { skipped++; continue; }
        await workspace.addEntry({ kind: "mistake", topicId, attempt: parsed.attempt,
          correction: parsed.correction, explanation: parsed.explanation });
        known.add(key); saved++;
      }
      setText(""); setOpen(false);
      workspace.toast("Added " + saved + " mistakes" + (skipped ? "; skipped " + skipped + " exact duplicates." : "."));
    } catch (reason) {
      // Keep the input on failure so the user can recover it; successful rows
      // will be skipped on the next attempt by exact-pair matching.
      setError("Saved " + saved + " before an error. Input retained. " + friendlyError(reason));
    } finally { setBusy(false); }
  }
  return <div className="ml-bulk-add">
    <button type="button" className="nb-link-button" onClick={() => setOpen((current) => !current)}>
      {open ? "Close bulk paste" : "Paste a list of mistakes"}
    </button>
    {open ? <div className="ml-bulk-panel">
      <label className="ws-field"><span>One correction per line: wrong → right // why</span>
        <textarea rows={5} value={text} placeholder={"Wrong sentence → Correct sentence // Explanation\nAnother error → Another correction"}
          onChange={(event) => { setText(event.target.value); setError(""); }} disabled={busy}/>
      </label>
      {rawLines.length ? <small>{valid.length} ready{rejected ? " · " + rejected + " invalid lines" : ""}
        {valid.length > 50 ? " · maximum 50 per batch" : ""} · German, Chinese and other subjects use the same format</small> : null}
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      <button type="button" className="ws-button is-primary" disabled={busy || !valid.length || Boolean(rejected) || valid.length > 50}
        onClick={() => void addAll()}>{busy ? "Adding…" : "Add " + valid.length + " mistakes"}</button>
    </div> : null}
  </div>;
}

function isIdeaStyle(entry: KnowledgeEntry): boolean {
  if (!entry.correction.trim()) return false;
  const original = entry.attempt.trim();
  const corrected = entry.correction.trim();
  // Short Hanzi sentences need character-level comparison, not a whitespace heuristic.
  if (/[\u3400-\u9fff]/u.test(original + corrected) && Math.max(original.length, corrected.length) < 120) return false;
  const a = original.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const b = corrected.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  if (a.length > 30 || b.length > 30) return true;
  const remaining = [...b];
  let common = 0;
  for (const token of a) {
    const index = remaining.indexOf(token);
    if (index >= 0) { common += 1; remaining.splice(index, 1); }
  }
  return Math.max(a.length, b.length) > 4 && common / Math.max(a.length, b.length) < 0.5;
}

function MistakeItem({ entry, highlighted, showPath, hideRuleTitle, onEdit, selecting, selected, onSelect }: {
  entry: KnowledgeEntry; highlighted: boolean; showPath: boolean; hideRuleTitle: boolean; onEdit: () => void;
  selecting: boolean; selected: boolean; onSelect: () => void;
}) {
  const workspace = useWorkspace();
  const ideaStyle = isIdeaStyle(entry);
  const diff = ideaStyle ? null : mistakeDifference(entry.attempt, entry.correction);
  const last = [...workspace.snapshot.practice].filter((event) => event.record_id === entry.id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  const rule = ruleParts(entry.title);
  return <article className={"ml-simple-item" + (highlighted ? " is-highlighted" : "")
    + (ideaStyle ? " is-idea-style" : "")} data-mistake={entry.id}>
    {selecting ? <input className="ml-select-checkbox" type="checkbox" checked={selected} onChange={onSelect}
      aria-label={"Select mistake " + (entry.title || entry.attempt.slice(0, 40))}/> : null}
    <div className="ml-simple-body">
      {entry.title && !hideRuleTitle ? <h2 className="ml-entry-title">{rule.rule}
        {rule.detail ? <small> · {rule.detail}</small> : null}</h2> : null}
      {hideRuleTitle && rule.detail ? <small className="ml-entry-detail">{rule.detail}</small> : null}
      <div className="ml-simple-pair">
        <span className="ml-simple-symbol" title="Mistake" aria-label="Mistake">×</span>
        <p className="ml-simple-wrong">{entry.attempt
          ? diff ? <DiffLine parts={diff.before}/> : entry.attempt : "Not recorded"}</p>
      </div>
      <div className="ml-simple-pair">
        <span className="ml-simple-symbol is-right" title="Correction" aria-label="Correction">✓</span>
        <p className={"ml-simple-right" + (!entry.correction ? " is-missing" : "")}>
          {entry.correction ? diff ? <DiffLine parts={diff.after}/> : entry.correction : "Add the correct version"}
        </p>
      </div>
      {entry.explanation ? <div className="ml-entry-context-wrap">
        <RichText text={entry.explanation} className="ml-entry-context is-compact"/></div> : null}
      <small className="ml-entry-evidence">
        {last ? (last.outcome === "incorrect" ? "Missed last time" : "Recalled last time") : "Not practised yet"}
        {showPath ? " · " + workspace.pathLabel(entry.topic_id) : ""}
        {entry.pinned ? " · Pinned" : ""}
      </small>
    </div>
    {workspace.writable ? <div className="ml-simple-actions">
      <button type="button" className="ws-icon-button" aria-label="Edit mistake" title="Edit" onClick={onEdit}>
        <Pencil size={15}/>
      </button>
    </div> : null}
  </article>;
}

function MistakeEditor({ entry, preferredSubjectId, preferredTopicId, onDone }: {
  entry?: KnowledgeEntry; preferredSubjectId?: string | null; preferredTopicId?: string | null; onDone: () => void;
}) {
  const workspace = useWorkspace();
  const [confirmElement, confirm] = useConfirm();
  const originalRule = ruleParts(entry?.title ?? "");
  const [topicId, setTopicId] = useState(entry?.topic_id ?? preferredTopicId ?? "");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [attempt, setAttempt] = useState(entry?.attempt ?? "");
  const [correction, setCorrection] = useState(entry?.correction ?? "");
  const [rule, setRule] = useState(originalRule.rule);
  const [explanation, setExplanation] = useState(entry?.explanation ?? "");
  const [pinned, setPinned] = useState(Boolean(entry?.pinned));
  const explanationRef = useRef<RichEditorHandle>(null);
  const [notesOpen, setNotesOpen] = useState(Boolean(entry?.explanation));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (busy) return;
    if (!attempt.trim()) { setError("Write the mistake first. The correction can be added later."); return; }
    if (!topicId || !workspace.topicById.has(topicId)) {
      setError("Choose a topic. You can create one in the destination picker.");
      return;
    }
    setBusy(true); setError("");
    const title = rule.trim() + (rule.trim() && originalRule.detail ? " – " + originalRule.detail : "");
    try {
      if (entry) {
        await workspace.patchEntry(entry.id, {
          attempt: attempt.trim(), correction: correction.trim(), title,
          explanation: (explanationRef.current?.getMarkdown() ?? explanation).trim(),
          topic_id: topicId, pinned,
        });
      } else {
        await workspace.addEntry({
          kind: "mistake", topicId, title, attempt: attempt.trim(),
          correction: correction.trim(), explanation: (explanationRef.current?.getMarkdown() ?? explanation).trim(),
        });
      }
      onDone();
    } catch (reason) { setError(friendlyError(reason)); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!entry || busy) return;
    if (!await confirm({ title: "Delete this mistake?", body: "You can undo this deletion immediately afterwards.", confirmLabel: "Delete mistake", danger: true })) return;
    setBusy(true);
    try { await workspace.removeEntry(entry.id); onDone(); }
    catch (reason) { setError(friendlyError(reason)); setBusy(false); }
  }

  return <>{confirmElement}<form className="ml-simple-edit" onSubmit={(event) => { event.preventDefault(); void save(); }}
    onKeyDown={(event) => {
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
      if (event.key === "Escape" && !pickerOpen) { event.preventDefault(); onDone(); }
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void save(); }
    }}>
    <div className="ml-edit-head"><strong>{entry ? "Edit mistake" : "New mistake"}</strong>
      <button type="button" className="ws-icon-button" aria-label="Cancel editing" disabled={busy}
        onClick={onDone}><X size={16}/></button>
    </div>
    <label className="ws-field">
      <span>Mistake</span>
      <textarea autoFocus rows={2} maxLength={5000} value={attempt}
        placeholder="What did you get wrong?" onChange={(event) => setAttempt(event.target.value)}/>
    </label>
    <label className="ws-field">
      <span>Correction</span>
      <textarea rows={2} maxLength={5000} value={correction}
        placeholder="What is the correct version?" onChange={(event) => setCorrection(event.target.value)}/>
    </label>
    {attempt.trim().length > 0 && attempt.length < 240 && !correction.trim()
      ? <button type="button" className="nb-link-button ml-copy-mistake"
        onClick={() => setCorrection(attempt)}>Copy mistake to correction</button> : null}
    <div className="ml-edit-options">
      <label className="ws-field">
        <span>Rule <small>(optional)</small></span>
        <input type="text" maxLength={200} value={rule} placeholder="Adjektivendung, Compound interest…"
          onChange={(event) => setRule(event.target.value)}/>
      </label>
      <div className="ws-field">
        <span>Location</span>
        <button type="button" className="ws-button ml-destination" onClick={() => setPickerOpen(true)}>
          {topicId ? workspace.pathLabel(topicId) : preferredSubjectId
            ? "Choose topic in " + (workspace.subjectById.get(preferredSubjectId)?.name ?? "subject")
            : "Choose subject and topic"}
          <ChevronRight size={15}/>
        </button>
      </div>
    </div>
    {entry ? <label className="ml-pin-option"><input type="checkbox" checked={pinned}
      onChange={(event) => setPinned(event.target.checked)}/> Pin this mistake</label> : null}
    {pickerOpen ? <Portal><div className="ws-dialog-backdrop" role="presentation"
      onMouseDown={(event) => { if (event.target === event.currentTarget) setPickerOpen(false); }}>
      <TopicPicker value={topicId || null} onClose={() => setPickerOpen(false)}
        onChange={(id) => { setTopicId(id); setPickerOpen(false); setError(""); }}/>
    </div></Portal> : null}
    <details className="ml-edit-notes" open={notesOpen} onToggle={(event) => setNotesOpen(event.currentTarget.open)}>
      <summary>Explanation &amp; examples <small>— optional</small></summary>
      <div className="ml-explanation-editor">
        <RichEditor ref={explanationRef} resetKey={entry?.id ?? "new-mistake"} value={explanation}
          ariaLabel="Formatted explanation" placeholder="Why was this wrong? Add a rule or short explanation."
          onChange={setExplanation} onSave={() => void save()} onDone={() => void save()} compactToolbar/>
      </div>
    </details>
    {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
    <div className="ml-simple-edit-actions">
      {entry ? <button className="ws-button ml-delete-in-editor" type="button" disabled={busy}
        onClick={() => void remove()}><Trash2 size={14}/> Delete</button> : null}
      <button className="ws-button" type="button" disabled={busy} onClick={onDone}>Cancel</button>
      <button className="ws-button is-primary" type="submit" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </button>
    </div>
  </form></>;
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

  const ideaRecall = Boolean(current && isIdeaStyle(current));
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
          {current.attempt ? <p className="recall-attempt"><span className="ml-label">Mistake</span>{current.attempt}</p> : <p className="ws-muted">Recall the correct form{current.title ? ` for “${current.title}”` : ""}.</p>}
          {current.explanation ? (hint || revealed ? <div className="recall-hint"><span className="ml-label">Why</span><RichText text={current.explanation} className="is-compact" /></div>
            : <button type="button" className="nb-link-button" onClick={() => setHint(true)}>Show the explanation as a hint</button>) : null}
        </div>
        <label className="ws-field"><span>{ideaRecall ? "In your own words (optional)" : "Write the corrected version from memory"}</span>
          <textarea ref={inputRef} rows={ideaRecall ? 3 : 2} value={answer} readOnly={revealed} onChange={(event) => setAnswer(event.target.value)} placeholder={ideaRecall ? "Explain the correct idea…" : "Type it before revealing…"} /></label>
        {revealed ? <div className={"recall-result " + (ideaRecall ? "" : answer.trim() ? (exact ? "is-exact" : "is-different") : "")}>
          <span className="ml-label">Correct form</span>
          {!ideaRecall && answer.trim() && !exact ? <p className="recall-user-answer"><DiffLine parts={mistakeDifference(answer, current.correction).before}/></p> : null}
          <p className="recall-answer">{ideaRecall ? current.correction : <DiffLine parts={mistakeDifference(answer, current.correction).after}/>}</p>
          <small>{ideaRecall ? "Compare your reasoning, then grade yourself."
            : !answer.trim() ? "Read the answer before continuing."
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
