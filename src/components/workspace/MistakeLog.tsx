import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, FolderPlus, GraduationCap, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pin, Pencil, Plus, Trash2, X } from "lucide-react";
import { friendlyError, type KnowledgeEntry, type KnowledgeSubject, type KnowledgeTopic, type MistakeAccent } from "../../lib/knowledgeWorkspace";
import { EmptyState, InlineNameForm, Kbd, MOD_KEY, Portal, useConfirm } from "./ui";
import { useWorkspace } from "./WorkspaceContext";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import { RichText } from "./RichText";
import { mistakeDifference, type DifferencePart } from "../../lib/mistakeDiff";

const ACCENTS: Array<{ value: MistakeAccent | ""; label: string }> = [
  { value: "", label: "None" },
  { value: "red", label: "Red" },
  { value: "amber", label: "Amber" },
  { value: "green", label: "Green" },
  { value: "blue", label: "Blue" },
  { value: "violet", label: "Violet" },
];

function DiffLine({ parts }: { parts: DifferencePart[] }) {
  return <>{parts.map((part, index) => <span key={index}
    className={part.kind === "wrong" ? "ml-diff-wrong" : part.kind === "corrected" ? "ml-diff-right" : undefined}>{part.text}</span>)}</>;
}

/** A correction is always just two lines; classification and styling remain optional. */
export function MistakeLog() {
  const workspace = useWorkspace();
  const { snapshot, focusMistake, clearFocusMistake } = workspace;
  const [confirmElement, confirm] = useConfirm();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [session, setSession] = useState<string[] | null>(null);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [creatingSubject, setCreatingSubject] = useState(false);
  const [creatingTopic, setCreatingTopic] = useState<{ subjectId: string; parentId: string | null } | null>(null);
  const [renaming, setRenaming] = useState<{ kind: "subject" | "topic"; id: string } | null>(null);
  const [actionsId, setActionsId] = useState<string | null>(null);
  const [organiserOpen, setOrganiserOpen] = useState(() => {
    try { return localStorage.getItem("heuresis.mistakes.organiser.v1:" + workspace.userId) !== "closed"; }
    catch { return true; }
  });
  useEffect(() => {
    try { localStorage.setItem("heuresis.mistakes.organiser.v1:" + workspace.userId, organiserOpen ? "open" : "closed"); }
    catch { /* Sidebar preference is optional. */ }
  }, [organiserOpen, workspace.userId]);
  const [visibleCount, setVisibleCount] = useState(60);
  const [search, setSearch] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  const mistakes = useMemo(() => snapshot.entries
    .filter((entry) => entry.kind === "mistake")
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.created_at.localeCompare(a.created_at)),
    [snapshot.entries]);

  const topicTreeIds = useMemo(() => selectedTopicId ? new Set(workspace.subtreeIds(selectedTopicId)) : null,
    [selectedTopicId, workspace.subtreeIds]);

  const visibleMistakes = useMemo(() => mistakes.filter((entry) => {
    if (selectedSubjectId && workspace.topicById.get(entry.topic_id)?.subject_id !== selectedSubjectId) return false;
    if (topicTreeIds && !topicTreeIds.has(entry.topic_id)) return false;
    if (search.trim() && ![entry.attempt, entry.correction, entry.explanation, entry.title]
      .some((value) => value.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))) return false;
    return true;
  }), [mistakes, selectedSubjectId, topicTreeIds, workspace.topicById, search]);

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


  // The hierarchy belongs to Notebook AND Mistake Log. Never delete knowledge
  // as a side effect of removing its organisational label.
  const removeSubject = async (subject: KnowledgeSubject) => {
    if (snapshot.topics.some((topic) => topic.subject_id === subject.id)) {
      workspace.toast(`“${subject.name}” still has topics. Move or delete every empty topic first. Notes and mistakes will be preserved.`, { tone: "error" });
      return;
    }
    if (!await confirm({
      title: `Delete empty subject “${subject.name}”?`,
      body: "Only empty subjects can be deleted. This cannot be undone.",
      confirmLabel: "Delete empty subject", danger: true,
    })) return;
    try {
      await workspace.removeSubject(subject.id);
      if (selectedSubjectId === subject.id) select(null, null);
      setCreatingTopic(null);
      setRenaming(null);
      workspace.toast(`Deleted empty subject “${subject.name}”.`);
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  };

  const removeTopic = async (topic: KnowledgeTopic) => {
    if (workspace.subtreeIds(topic.id).length > 1) {
      workspace.toast(`“${topic.name}” has subtopics. Move or delete the empty subtopics first.`, { tone: "error" });
      return;
    }
    if (snapshot.entries.some((entry) => entry.topic_id === topic.id)) {
      workspace.toast(`“${topic.name}” still contains notes or mistakes. Move them before deleting this topic.`, { tone: "error" });
      return;
    }
    if (!await confirm({
      title: `Delete empty topic “${topic.name}”?`,
      body: "Only empty topics can be deleted. Your notes and mistakes will not be deleted.",
      confirmLabel: "Delete empty topic", danger: true,
    })) return;
    try {
      await workspace.removeTopic(topic.id);
      if (selectedTopicId === topic.id) select(topic.subject_id, null);
      setCreatingTopic(null);
      setRenaming(null);
      workspace.toast(`Deleted empty topic “${topic.name}”.`);
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  };

  return <div className="ml-page ml-simple-page">
    {confirmElement}
    <header className="ws-page-head">
      <div><h1>Mistake Log</h1>
        <p className="ws-muted ml-page-subtitle">Keep the mistake. Keep the correction.</p>
      </div>
      <div className="ws-page-actions">
        <button className="ws-button" type="button" disabled={!visibleMistakes.some((entry) => entry.correction.trim())}
          onClick={practiseShown}><GraduationCap size={16} /> Practise</button>
        {workspace.writable ? <button className="ws-button is-primary" type="button" onClick={() => {
          setAdding(true); setEditingId(null);
        }}><Plus size={16} /> Add mistake</button> : null}
      </div>
    </header>
    <div className={"ml-organised-layout" + (!organiserOpen ? " is-organiser-hidden" : "")}>
      {organiserOpen ? <aside className="ml-organiser" aria-label="Mistake subjects and topics">
        <div className="ml-nav-header">
          <span>Subjects</span>
          <div className="ml-nav-header-actions">
            {workspace.writable ? <button className="ws-icon-button" type="button"
              aria-label="New subject" title="New subject" onClick={() => {
                setCreatingSubject(true); setCreatingTopic(null); setRenaming(null); setActionsId(null);
              }}><Plus size={17} /></button> : null}
            <button className="ws-icon-button" type="button" title="Hide subjects" aria-label="Hide subjects"
              onClick={() => { setOrganiserOpen(false); setActionsId(null); }}><PanelLeftClose size={16} /></button>
          </div>
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
          onClick={() => select(null, null)}>All mistakes</button>
        {subjects.map((subject) => <div key={subject.id} className="ml-nav-group">
          {renaming?.kind === "subject" && renaming.id === subject.id
            ? <InlineNameForm label="Rename subject" initial={subject.name} submitLabel="Rename"
              onCancel={() => setRenaming(null)} onSubmit={async (name) => {
                await workspace.renameSubjectById(subject.id, name); setRenaming(null);
              }} />
            : <div className="ml-nav-row">
              <button type="button" className={"ml-nav-label" + (selectedSubjectId === subject.id && !selectedTopicId ? " is-active" : "")}
                onClick={() => select(subject.id, null)}>{subject.name}</button>
              {workspace.writable ? <OrganiserActions label={subject.name} open={actionsId === "subject:" + subject.id}
                onToggle={(open) => setActionsId(open ? "subject:" + subject.id : null)}
                items={[
                  { label: "Add topic", icon: <FolderPlus size={14} />, run: () => { setCreatingTopic({ subjectId: subject.id, parentId: null }); setCreatingSubject(false); setRenaming(null); } },
                  { label: "Rename", icon: <Pencil size={14} />, run: () => { setRenaming({ kind: "subject", id: subject.id }); setCreatingTopic(null); } },
                  { label: "Delete subject", icon: <Trash2 size={14} />, danger: true, run: () => void removeSubject(subject) },
                ]} /> : null}
            </div>}
          <TopicBranch subjectId={subject.id} parentId={null} depth={0}
            selectedTopicId={selectedTopicId} selectedSubjectId={selectedSubjectId}
            onSelect={select}
            onCreate={(parentId) => {
              setCreatingTopic({ subjectId: subject.id, parentId }); setCreatingSubject(false);
            }}
            onDelete={removeTopic} renaming={renaming} setRenaming={setRenaming}
            actionsId={actionsId} setActionsId={setActionsId} />
        </div>)}
        {!subjects.length ? <p className="ml-nav-hint">Add a subject to organise mistakes. You can also save without one.</p> : null}
      </aside> : null}
      <main className="ml-simple-list" ref={listRef}>
        <label className="ml-search-label">
          <span className="sr-only">Search mistakes</span>
          <input className="ml-search-field" type="search" value={search}
            onChange={(event) => { setSearch(event.target.value); setVisibleCount(60); }}
            placeholder="Search mistakes and corrections…" />
        </label>
        {!organiserOpen ? <button type="button" className="ml-organiser-restore" onClick={() => setOrganiserOpen(true)}>
          <PanelLeftOpen size={16} /> Subjects <span>{selectedTitle ? "· " + selectedTitle : ""}</span>
        </button> : null}
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
            showPath={!selectedTitle} onEdit={() => { setAdding(false); setEditingId(entry.id); }} />)}
        {visibleMistakes.length > visibleCount ? <button className="ml-simple-more" type="button"
          onClick={() => setVisibleCount((count) => count + 60)}>Show more</button> : null}
      </main>
    </div>
    {session ? <RecallSession ids={session} onClose={() => setSession(null)} /> : null}
  </div>;
}

type OrganiserAction = { label: string; icon: React.ReactNode; run: () => void; danger?: boolean };

/** The menu escapes the scrollable organiser so bottom rows never clip actions. */
function OrganiserActions({ label, items, open, onToggle }: {
  label: string; items: OrganiserAction[]; open: boolean; onToggle: (open: boolean) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) { setPosition(null); return; }
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 172;
    const height = items.length * 36 + 12;
    setPosition({
      top: Math.max(8, Math.min(rect.bottom + 3, window.innerHeight - height - 8)),
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
    });
    const closeOutside = (event: MouseEvent) => {
      if (!trigger.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) onToggle(false);
    };
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onToggle(false); trigger.current?.focus(); }
    };
    const onScroll = () => onToggle(false);
    document.addEventListener("mousedown", closeOutside);
    document.addEventListener("keydown", onEscape);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", closeOutside);
      document.removeEventListener("keydown", onEscape);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open, onToggle, items.length]);

  return <>
    <button ref={trigger} className="ws-icon-button ml-nav-more" type="button" aria-label={"Options for " + label}
      aria-haspopup="menu" aria-expanded={open} title={"Options for " + label}
      onClick={() => onToggle(!open)}><MoreHorizontal size={16} /></button>
    {open && position ? <Portal><div ref={menu} className="ml-nav-menu" role="menu"
      aria-label={"Options for " + label} style={{ top: position.top, left: position.left }}>
      {items.map((item) => <button key={item.label} type="button" role="menuitem"
        className={item.danger ? "is-danger" : ""}
        onClick={() => { onToggle(false); item.run(); }}>{item.icon}{item.label}</button>)}
    </div></Portal> : null}
  </>;
}

function TopicBranch({ subjectId, parentId, depth, selectedSubjectId, selectedTopicId, onSelect,
  onCreate, onDelete, renaming, setRenaming, actionsId, setActionsId }: {
  subjectId: string; parentId: string | null; depth: number;
  selectedSubjectId: string | null; selectedTopicId: string | null;
  onSelect: (subjectId: string | null, topicId: string | null) => void;
  onCreate: (parentId: string) => void;
  onDelete: (topic: KnowledgeTopic) => void;
  renaming: { kind: "subject" | "topic"; id: string } | null;
  setRenaming: (value: { kind: "subject" | "topic"; id: string } | null) => void;
  actionsId: string | null;
  setActionsId: (value: string | null) => void;
}) {
  const workspace = useWorkspace();
  return <>{workspace.childrenOf(parentId, subjectId).map((topic: KnowledgeTopic) => {
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
            <ChevronRight size={12} /> {topic.name}
          </button>
          {workspace.writable ? <OrganiserActions label={topic.name} open={actionsId === "topic:" + topic.id}
            onToggle={(open) => setActionsId(open ? "topic:" + topic.id : null)}
            items={[
              { label: "Add subtopic", icon: <Plus size={14} />, run: () => onCreate(topic.id) },
              { label: "Rename", icon: <Pencil size={14} />, run: () => setRenaming({ kind: "topic", id: topic.id }) },
              { label: "Delete topic", icon: <Trash2 size={14} />, danger: true, run: () => onDelete(topic) },
            ]} /> : null}
        </div>}
      <TopicBranch subjectId={subjectId} parentId={topic.id} depth={depth + 1}
        selectedSubjectId={selectedSubjectId} selectedTopicId={selectedTopicId}
        onSelect={onSelect} onCreate={onCreate} onDelete={onDelete} renaming={renaming} setRenaming={setRenaming}
        actionsId={actionsId} setActionsId={setActionsId} />
    </div>;
  })}</>;
}

function MistakeItem({ entry, highlighted, showPath, onEdit }: {
  entry: KnowledgeEntry; highlighted: boolean; showPath: boolean; onEdit: () => void;
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
  const diff = mistakeDifference(entry.attempt, entry.correction);
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
