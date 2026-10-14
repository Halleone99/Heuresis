import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleHelp, FilePlus2, FolderPlus, GraduationCap, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ListChecks, Trash2 } from "lucide-react";
import {
  entryPreview, entryTitle, isDocument, isLesson, isOpenQuestion, localDateKey,
  type KnowledgeEntry, type KnowledgeTopic,
} from "../../lib/knowledgeWorkspace";
import type { NotebookLocation } from "../../lib/workspaceMemory";
import { isInboxTopic } from "../../lib/lessonCleanup";
import { DocumentPage } from "./DocumentPage";
import { EmptyState, InlineNameForm, KindIcon, Kbd, MOD_KEY, entryKindLabel, formatDay, relativeTime, useConfirm, usePopover } from "./ui";
import { DEFAULT_LANGUAGE_SUGGESTIONS, usePersonalOsObjectives } from "./usePersonalOs";
import { useWorkspace } from "./WorkspaceContext";

type ListFilter = "all" | "lessons" | "notes" | "questions";
export type NewDocRequest = { topicId: string; category?: KnowledgeEntry["category"]; title?: string } | null;

function docSortKey(entry: KnowledgeEntry) {
  return isLesson(entry) && entry.lesson_date ? `${entry.lesson_date}T23:59:59` : entry.updated_at;
}

export function NotebookView() {
  const workspace = useWorkspace();
  const { memory, updateMemory, snapshot, entryById, topicById, subjectById } = workspace;
  const location = memory.notebook;
  const [history, setHistory] = useState<NotebookLocation[]>([]);
  const [newDoc, setNewDoc] = useState<NewDocRequest>(null);
  const [railOpenMobile, setRailOpenMobile] = useState(false);
  const missingNotified = useRef<string | null>(null);
  // A new note keeps the same page instance once it has been saved for the first time,
  // so the editor (caret, undo history) is not reset under the user's fingers.
  const stableKeys = useRef(new Map<string, string>());

  const internalNavigation = useRef(false);
  const previousLocation = useRef<NotebookLocation>({ topicId: location.topicId, docId: location.docId, subjectId: location.subjectId ?? null });
  const navigate = useCallback((next: NotebookLocation, options: { push?: boolean } = { push: true }) => {
    internalNavigation.current = true;
    if (options.push !== false) setHistory((stack) => [...stack.slice(-30), { topicId: location.topicId, docId: location.docId, subjectId: location.subjectId ?? null }]);
    setNewDoc(null);
    setRailOpenMobile(false);
    updateMemory((current) => ({
      ...current,
      notebook: { ...current.notebook, topicId: next.topicId, docId: next.docId, subjectId: next.subjectId ?? null },
      recentDocs: next.docId ? [next.docId, ...current.recentDocs.filter((id) => id !== next.docId)].slice(0, 12) : current.recentDocs,
    }));
  }, [location.docId, location.subjectId, location.topicId, updateMemory]);

  // Openings from elsewhere (search, Overview, Mistake Log links) also become Back steps.
  useEffect(() => {
    const previous = previousLocation.current;
    const current = { topicId: location.topicId, docId: location.docId, subjectId: location.subjectId ?? null };
    const changed = previous.topicId !== current.topicId || previous.docId !== current.docId || (previous.subjectId ?? null) !== current.subjectId;
    if (changed && !internalNavigation.current) setHistory((stack) => [...stack.slice(-30), previous]);
    internalNavigation.current = false;
    previousLocation.current = current;
  }, [location.docId, location.subjectId, location.topicId]);

  const doc = location.docId ? entryById.get(location.docId) ?? null : null;
  const topic = location.topicId ? topicById.get(location.topicId) ?? null : null;
  const subject = location.subjectId ? subjectById.get(location.subjectId) ?? null : null;

  // A remembered document may have been deleted (here or on another device).
  useEffect(() => {
    if (workspace.loading || !location.docId || doc) return;
    if (missingNotified.current === location.docId) return;
    missingNotified.current = location.docId;
    workspace.toast("That note is no longer available. It may have been deleted on another device.");
    internalNavigation.current = true;
    setHistory((stack) => stack.filter((item) => item.docId !== location.docId));
    updateMemory((current) => ({ ...current, notebook: { ...current.notebook, docId: null }, recentDocs: current.recentDocs.filter((id) => id !== location.docId) }));
  }, [doc, location.docId, updateMemory, workspace]);
  useEffect(() => {
    if (workspace.loading || !location.topicId || topic) return;
    updateMemory((current) => ({ ...current, notebook: { ...current.notebook, topicId: null } }));
  }, [location.topicId, topic, updateMemory, workspace.loading]);

  // Reveal a topic on navigation, not after a deliberate collapse.
  const visibleTopicId = doc?.topic_id ?? topic?.id;
  useEffect(() => {
    const topicId = visibleTopicId;
    if (!topicId) return;
    const path = workspace.topicPath(topicId);
    const ids = [path.subject?.id, ...path.chain.slice(0, -1).map((item) => item.id)].filter(Boolean) as string[];
    if (ids.every((id) => memory.notebook.expanded.includes(id))) return;
    updateMemory((current) => ({ ...current, notebook: { ...current.notebook, expanded: Array.from(new Set([...current.notebook.expanded, ...ids])) } }));
  }, [visibleTopicId, updateMemory, workspace.topicPath]);

  const closeDocument = useCallback((topicId: string) => {
    navigate({ topicId, docId: null }, { push: false });
  }, [navigate]);

  const goBack = useCallback(() => {
    const previous = history[history.length - 1];
    if (previous) {
      setHistory((stack) => stack.slice(0, -1));
      navigate(previous, { push: false });
      return;
    }
    if (doc) navigate({ topicId: doc.topic_id, docId: null }, { push: false });
    else if (topic?.parent_id) navigate({ topicId: topic.parent_id, docId: null }, { push: false });
    else if (topic) navigate({ topicId: null, docId: null, subjectId: topic.subject_id }, { push: false });
    else navigate({ topicId: null, docId: null }, { push: false });
  }, [doc, history, navigate, topic]);

  // Mouse "back" button and Alt+← go back inside the Notebook.
  useEffect(() => {
    const onMouse = (event: MouseEvent) => { if (event.button === 3) { event.preventDefault(); goBack(); } };
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey && event.key === "ArrowLeft" && !(event.target instanceof HTMLElement && event.target.isContentEditable)) { event.preventDefault(); goBack(); }
    };
    window.addEventListener("mouseup", onMouse);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mouseup", onMouse); window.removeEventListener("keydown", onKey); };
  }, [goBack]);

  const startNewNote = useCallback((topicId: string | null, title?: string) => {
    const target = topicId ?? topic?.id ?? doc?.topic_id ?? null;
    if (!target) { workspace.toast("Choose or create a topic first.", { tone: "error" }); return; }
    setHistory((stack) => [...stack.slice(-30), { topicId: location.topicId, docId: location.docId, subjectId: location.subjectId ?? null }]);
    internalNavigation.current = true;
    updateMemory((current) => ({ ...current, notebook: { ...current.notebook, topicId: target, docId: null, subjectId: null } }));
    setNewDoc({ topicId: target, title });
  }, [doc?.topic_id, location.docId, location.subjectId, location.topicId, topic?.id, updateMemory, workspace]);

  const railCollapsed = memory.notebook.railCollapsed;
  const toggleRail = () => updateMemory((current) => ({ ...current, notebook: { ...current.notebook, railCollapsed: !current.notebook.railCollapsed } }));

  // A different page opens at its top; a new note keeps its place when its first save gives it an id.
  const pageKey = newDoc ? `new-${newDoc.topicId}` : doc ? stableKeys.current.get(doc.id) ?? doc.id : topic?.id ?? subject?.id ?? "home";
  const shownPage = useRef(pageKey);
  useLayoutEffect(() => {
    if (shownPage.current === pageKey) return;
    shownPage.current = pageKey;
    window.scrollTo(0, 0);
  }, [pageKey]);

  let main;
  if (workspace.loading && !snapshot.subjects.length) main = <div className="ws-loading" role="status"><span className="ws-spinner" />Opening your notebook…</div>;
  else if (newDoc) main = <DocumentPage key={`new-${newDoc.topicId}`} entry={null} newDoc={newDoc} onBack={goBack} onClose={() => closeDocument(newDoc!.topicId)} navigate={navigate}
    onCreated={(created) => { stableKeys.current.set(created.id, `new-${newDoc.topicId}`); setNewDoc(null); navigate({ topicId: created.topic_id, docId: created.id }, { push: false }); }}
    onNewNote={startNewNote} />;
  else if (doc && isDocument(doc)) main = <DocumentPage key={stableKeys.current.get(doc.id) ?? doc.id} entry={doc} newDoc={null} onBack={goBack} onClose={() => closeDocument(doc.topic_id)} navigate={navigate} onCreated={() => undefined} onNewNote={startNewNote} />;
  else if (topic) main = <ScopePage key={topic.id} scope={{ topic }} navigate={navigate} onNewNote={startNewNote} onBack={goBack} />;
  else if (subject) main = <ScopePage key={subject.id} scope={{ subjectId: subject.id }} navigate={navigate} onNewNote={startNewNote} onBack={goBack} />;
  else main = <NotebookHome navigate={navigate} onNewNote={startNewNote} />;

  return <div className={`nb-layout ${railCollapsed ? "is-rail-collapsed" : ""} ${railOpenMobile ? "is-rail-open" : ""}`}>
    <NotebookRail location={location} navigate={navigate} onNewNote={startNewNote} onCollapse={toggleRail} />
    <button type="button" className="nb-rail-scrim" aria-label="Close topics" onClick={() => setRailOpenMobile(false)} />
    <section className="nb-main">
      <div className="nb-main-tools">
        <button type="button" className="ws-icon-button nb-rail-toggle" onClick={() => { if (window.matchMedia("(max-width: 900px)").matches) setRailOpenMobile((value) => !value); else toggleRail(); }}
          aria-label={railCollapsed ? "Show topics" : "Hide topics"} title={railCollapsed ? "Show topics" : "Hide topics"}>
          {railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>
      {main}
    </section>
  </div>;
}

// ---------------------------------------------------------------------------
// Rail: subjects → topics (nested), with inline creation and a small menu
// ---------------------------------------------------------------------------
function NotebookRail({ location, navigate, onNewNote, onCollapse }: {
  location: NotebookLocation; navigate: (location: NotebookLocation) => void;
  onNewNote: (topicId: string | null) => void; onCollapse: () => void;
}) {
  const workspace = useWorkspace();
  const { snapshot, memory, updateMemory } = workspace;
  const { objectives } = usePersonalOsObjectives(workspace.userId);
  const [creating, setCreating] = useState<null | { subjectId: string | null; parentId: string | null }>(null);
  const [renaming, setRenaming] = useState<null | { kind: "subject" | "topic"; id: string }>(null);
  const [confirmElement, confirm] = useConfirm();
  const expanded = new Set(memory.notebook.expanded);
  const activeTopicId = location.docId ? workspace.entryById.get(location.docId)?.topic_id ?? location.topicId : location.topicId;

  const counts = useMemo(() => {
    const map = new Map<string, { docs: number; questions: number }>();
    for (const entry of snapshot.entries) {
      if (!isDocument(entry)) continue;
      const row = map.get(entry.topic_id) ?? { docs: 0, questions: 0 };
      row.docs += 1;
      if (isOpenQuestion(entry)) row.questions += 1;
      map.set(entry.topic_id, row);
    }
    return map;
  }, [snapshot.entries]);

  const toggle = (id: string) => updateMemory((current) => {
    const set = new Set(current.notebook.expanded);
    if (set.has(id)) set.delete(id); else set.add(id);
    return { ...current, notebook: { ...current.notebook, expanded: Array.from(set) } };
  });
  const expand = (id: string) => updateMemory((current) => ({ ...current, notebook: { ...current.notebook, expanded: Array.from(new Set([...current.notebook.expanded, id])) } }));

  async function removeTopic(topic: KnowledgeTopic) {
    const subtree = workspace.subtreeIds(topic.id);
    const entries = snapshot.entries.filter((entry) => subtree.includes(entry.topic_id)).length;
    if (entries) {
      workspace.toast(`“${topic.name}” still contains ${entries} ${entries === 1 ? "entry" : "entries"}. Move or delete them first.`, { tone: "error" });
      return;
    }
    if (subtree.length > 1) {
      workspace.toast(`“${topic.name}” still has sub-topics. Delete those first.`, { tone: "error" });
      return;
    }
    if (!await confirm({ title: `Delete “${topic.name}”?`, body: "This topic is empty. Deleting it cannot be undone.", confirmLabel: "Delete topic", danger: true })) return;
    try {
      await workspace.removeTopic(topic.id);
      if (location.topicId === topic.id) navigate({ topicId: topic.parent_id, docId: null, subjectId: topic.parent_id ? null : topic.subject_id });
    } catch (error) { workspace.toast(error instanceof Error ? error.message : String(error), { tone: "error" }); }
  }
  async function removeSubject(subjectId: string) {
    const subject = workspace.subjectById.get(subjectId);
    if (!subject) return;
    const topicIds = new Set(snapshot.topics.filter((topic) => topic.subject_id === subjectId).map((topic) => topic.id));
    const entries = snapshot.entries.filter((entry) => topicIds.has(entry.topic_id)).length;
    if (entries) {
      workspace.toast(`${subject.name} still contains ${entries} ${entries === 1 ? "entry" : "entries"}. Move or delete them first.`, { tone: "error" });
      return;
    }
    if (!await confirm({ title: `Delete ${subject.name}?`, body: topicIds.size ? `Its ${topicIds.size} empty ${topicIds.size === 1 ? "topic" : "topics"} will be removed too.` : "This subject is empty.", confirmLabel: "Delete subject", danger: true })) return;
    try {
      await workspace.removeSubject(subjectId);
      navigate({ topicId: null, docId: null, subjectId: null });
    } catch (error) { workspace.toast(error instanceof Error ? error.message : String(error), { tone: "error" }); }
  }

  const renderTopics = (subjectId: string, parentId: string | null, depth: number) => workspace.childrenOf(parentId, subjectId).map((topic) => {
    const children = workspace.childrenOf(topic.id, subjectId);
    const isOpen = expanded.has(topic.id);
    const count = counts.get(topic.id);
    return <div key={topic.id} className="nb-tree-node" role="treeitem" aria-expanded={children.length ? isOpen : undefined} aria-selected={activeTopicId === topic.id}>
      {renaming?.kind === "topic" && renaming.id === topic.id
        ? <div style={{ paddingLeft: 10 + depth * 14 }}><InlineNameForm label="Topic name" initial={topic.name} submitLabel="Rename"
          onCancel={() => setRenaming(null)} onSubmit={async (name) => { await workspace.changeTopic(topic.id, { name }); setRenaming(null); }} /></div>
        : <div className={`nb-tree-row ${activeTopicId === topic.id ? "is-active" : ""}`} style={{ paddingLeft: 6 + depth * 14 }}>
          <button type="button" className="nb-tree-twisty" aria-label={isOpen ? `Collapse ${topic.name}` : `Expand ${topic.name}`}
            disabled={!children.length} onClick={() => toggle(topic.id)}>
            {children.length ? (isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />) : <span className="nb-tree-dot" />}
          </button>
          <button type="button" className="nb-tree-label" onClick={() => navigate({ topicId: topic.id, docId: null })}>
            <span>{topic.name}</span>
            {count?.questions ? <small className="nb-tree-question" title={`${count.questions} open ${count.questions === 1 ? "question" : "questions"}`}>?{count.questions}</small> : count?.docs ? <small>{count.docs}</small> : null}
          </button>
          {workspace.writable ? <RowMenu label={topic.name} items={[
            { label: "New note here", icon: <FilePlus2 size={14} />, run: () => onNewNote(topic.id) },
            ...(depth < 3 ? [{ label: "New sub-topic", icon: <FolderPlus size={14} />, run: () => { expand(topic.id); setCreating({ subjectId, parentId: topic.id }); } }] : []),
            { label: "Rename", icon: <Pencil size={14} />, run: () => setRenaming({ kind: "topic", id: topic.id }) },
            { label: "Delete", icon: <Trash2 size={14} />, danger: true, run: () => void removeTopic(topic) },
          ]} /> : null}
        </div>}
      {creating && creating.parentId === topic.id ? <div style={{ paddingLeft: 20 + depth * 14 }}>
        <InlineNameForm label="Sub-topic name" placeholder="Time expressions, Lesson 7…" onCancel={() => setCreating(null)}
          onSubmit={async (name) => { const created = await workspace.addTopic(subjectId, name, topic.id); setCreating(null); navigate({ topicId: created.id, docId: null }); }} />
      </div> : null}
      {isOpen ? <div role="group">{renderTopics(subjectId, topic.id, depth + 1)}</div> : null}
    </div>;
  });

  const subjects = [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name));
  const suggestions = (objectives?.languages.map((language) => language.name) ?? DEFAULT_LANGUAGE_SUGGESTIONS)
    .filter((name) => !subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())).slice(0, 4);

  return <aside className="nb-rail" aria-label="Notebook topics">
    {confirmElement}
    <div className="nb-rail-head">
      <button type="button" className="ws-icon-button nb-rail-collapse" aria-label="Hide topics" title="Hide topics" onClick={onCollapse}><PanelLeftClose size={15} /></button>
    </div>
    <div className="nb-rail-section nb-rail-tree" role="tree" aria-label="Subjects and topics">
      <div className="nb-rail-section-head">
        <span className="ws-eyebrow">Subjects</span>
        {workspace.writable ? <button type="button" className="ws-icon-button" aria-label="New language" title="New language" onClick={() => setCreating({ subjectId: null, parentId: null })}><Plus size={14} /></button> : null}
      </div>
      {creating && !creating.subjectId ? <InlineNameForm label="Language name" placeholder="Chinese, German, Russian…" suggestions={suggestions}
        onCancel={() => setCreating(null)}
        onSubmit={async (name) => {
          const created = await workspace.addSubject(name);
          const inbox = await workspace.ensureInbox(created.id);
          setCreating(null);
          expand(created.id);
          navigate({ topicId: inbox.id, docId: null });
        }} /> : null}
      {subjects.map((subject) => {
        const isOpen = expanded.has(subject.id);
        return <div key={subject.id} className="nb-tree-subject" role="treeitem" aria-expanded={isOpen}>
          {renaming?.kind === "subject" && renaming.id === subject.id
            ? <InlineNameForm label="Language name" initial={subject.name} submitLabel="Rename" onCancel={() => setRenaming(null)}
              onSubmit={async (name) => { await workspace.renameSubjectById(subject.id, name); setRenaming(null); }} />
            : <div className={`nb-tree-row is-subject ${location.subjectId === subject.id && !location.topicId && !location.docId ? "is-active" : ""}`}>
              <button type="button" className="nb-tree-twisty" aria-label={isOpen ? `Collapse ${subject.name}` : `Expand ${subject.name}`} onClick={() => toggle(subject.id)}>
                {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button>
              <button type="button" className="nb-tree-label" onClick={() => { expand(subject.id); navigate({ topicId: null, docId: null, subjectId: subject.id }); }}>
                <span>{subject.name}</span>
              </button>
              {workspace.writable ? <RowMenu label={subject.name} items={[
                { label: "New topic", icon: <FolderPlus size={14} />, run: () => { expand(subject.id); setCreating({ subjectId: subject.id, parentId: null }); } },
                { label: "Rename", icon: <Pencil size={14} />, run: () => setRenaming({ kind: "subject", id: subject.id }) },
                { label: "Delete", icon: <Trash2 size={14} />, danger: true, run: () => void removeSubject(subject.id) },
              ]} /> : null}
            </div>}
          {isOpen ? <div role="group">
            {renderTopics(subject.id, null, 1)}
            {creating && creating.subjectId === subject.id && !creating.parentId ? <div className="nb-tree-create">
              <InlineNameForm label="Topic name" placeholder="Grammar, B1.2, Lessons…" onCancel={() => setCreating(null)}
                onSubmit={async (name) => { const created = await workspace.addTopic(subject.id, name, null); setCreating(null); navigate({ topicId: created.id, docId: null }); }} />
            </div> : workspace.writable ? <button type="button" className="nb-tree-add" onClick={() => setCreating({ subjectId: subject.id, parentId: null })}><Plus size={12} /> Topic</button> : null}
          </div> : null}
        </div>;
      })}
      {!subjects.length && !creating ? <p className="ws-muted nb-rail-empty">Subjects hold your languages or fields — Chinese, German, Russian…</p> : null}
    </div>
  </aside>;
}

type MenuItem = { label: string; icon?: React.ReactNode; run: () => void; danger?: boolean };
export function RowMenu({ label, items, icon }: { label: string; items: MenuItem[]; icon?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = usePopover(open, close);
  return <div className="ws-menu" ref={ref}>
    <button type="button" className="ws-icon-button ws-menu-trigger" aria-label={`Actions for ${label}`} aria-haspopup="menu" aria-expanded={open}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>{icon ?? <MoreHorizontal size={15} />}</button>
    {open ? <div className="ws-menu-list" role="menu">
      {items.map((item) => <button type="button" role="menuitem" key={item.label} className={item.danger ? "is-danger" : ""}
        onClick={(event) => { event.stopPropagation(); setOpen(false); item.run(); }}>{item.icon}{item.label}</button>)}
    </div> : null}
  </div>;
}

// ---------------------------------------------------------------------------
// Topic or subject page: what lives here, newest first
// ---------------------------------------------------------------------------
function ScopePage({ scope, navigate, onNewNote, onBack }: {
  scope: { topic: KnowledgeTopic } | { subjectId: string };
  navigate: (location: NotebookLocation) => void; onNewNote: (topicId: string | null) => void; onBack: () => void;
}) {
  const workspace = useWorkspace();
  const { snapshot, memory, updateMemory } = workspace;
  const filter = memory.notebook.filter as ListFilter;
  const topic = "topic" in scope ? scope.topic : null;
  const subjectId = topic ? topic.subject_id : (scope as { subjectId: string }).subjectId;
  const subject = workspace.subjectById.get(subjectId) ?? null;
  const path = topic ? workspace.topicPath(topic.id) : { subject, chain: [] };
  const topicIds = useMemo(() => topic ? workspace.subtreeIds(topic.id)
    : snapshot.topics.filter((row) => row.subject_id === subjectId).map((row) => row.id), [snapshot.topics, subjectId, topic, workspace]);
  const children = workspace.childrenOf(topic?.id ?? null, subjectId);
  const [creatingChild, setCreatingChild] = useState(false);

  const entries = snapshot.entries.filter((entry) => topicIds.includes(entry.topic_id));
  const docs = entries.filter(isDocument);
  const mistakes = entries.filter((entry) => entry.kind === "mistake");
  const counts = {
    all: docs.length,
    lessons: docs.filter(isLesson).length,
    notes: docs.filter((entry) => !isLesson(entry) && !isOpenQuestion(entry)).length,
    questions: docs.filter(isOpenQuestion).length,
  };
  const shown = docs.filter((entry) => filter === "all" || (filter === "lessons" ? isLesson(entry) : filter === "questions" ? isOpenQuestion(entry) : !isLesson(entry) && !isOpenQuestion(entry)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || docSortKey(b).localeCompare(docSortKey(a)));

  const setFilter = (next: ListFilter) => updateMemory((current) => ({ ...current, notebook: { ...current.notebook, filter: next } }));
  const fallbackTopic = topic?.id ?? children[0]?.id ?? null;
  const title = topic?.name ?? subject?.name ?? "Notebook";

  return <div className="nb-scope">
    <nav className="nb-crumbs" aria-label="Location">
      <button type="button" className="nb-back" onClick={onBack} aria-label="Back">←</button>
      <button type="button" onClick={() => navigate({ topicId: null, docId: null })}>Notebook</button>
      {path.subject ? <><ChevronRight size={12} /><button type="button" onClick={() => navigate({ topicId: null, docId: null, subjectId: path.subject!.id })}>{path.subject.name}</button></> : null}
      {path.chain.slice(0, -1).map((item) => <span key={item.id} className="nb-crumb"><ChevronRight size={12} /><button type="button" onClick={() => navigate({ topicId: item.id, docId: null })}>{item.name}</button></span>)}
    </nav>
    <header className="nb-scope-head">
      <div>
        <h1>{title}</h1>
        {mistakes.length ? <p className="nb-scope-meta">
          <button type="button" className="nb-link-button" onClick={() => {
            updateMemory((current) => ({ ...current, mistakes: { ...current.mistakes, subjectId } }));
            workspace.goTo("mistakes");
          }}>{mistakes.length} {mistakes.length === 1 ? "mistake" : "mistakes"} →</button>
        </p> : null}
      </div>
      {workspace.writable ? <div className="nb-scope-actions">
        {(topic ? workspace.topicPath(topic.id).chain.length < 4 : true) ? <RowMenu label={title} items={[
          { label: topic ? "New sub-topic" : "New topic", icon: <FolderPlus size={14}/>, run: () => setCreatingChild(true) },
        ]}/> : null}
        {topic && isInboxTopic(topic) ? <button type="button" className="ws-button"
          onClick={() => workspace.openCleanup({ kind: "inbox", id: topic.id })}>
          <ListChecks size={15}/> Organise Inbox
        </button> : null}
        <button type="button" className="ws-button" disabled={!fallbackTopic}
          onClick={() => workspace.openCapture({ mode: "lesson", topicId: fallbackTopic })}><GraduationCap size={15} /> New lesson</button>
        <button type="button" className="ws-button is-primary" disabled={!fallbackTopic} onClick={() => onNewNote(fallbackTopic)}><FilePlus2 size={15} /> New note</button>
      </div> : null}
    </header>

    {(children.length || creatingChild) ? <div className="nb-subtopics">
      {children.map((child) => {
        const childDocs = snapshot.entries.filter((entry) => isDocument(entry) && workspace.subtreeIds(child.id).includes(entry.topic_id)).length;
        return <button type="button" key={child.id} className="nb-subtopic" onClick={() => navigate({ topicId: child.id, docId: null })}>
          <span>{child.name}</span><small>{childDocs}</small>
        </button>;
      })}
      {creatingChild && workspace.writable ? <div className="nb-subtopic-form">
        <InlineNameForm label={topic ? "Sub-topic name" : "Topic name"} placeholder={topic ? "Sub-topic" : "Topic"}
          onCancel={() => setCreatingChild(false)}
          onSubmit={async (name) => { const created = await workspace.addTopic(subjectId, name, topic?.id ?? null); setCreatingChild(false); navigate({ topicId: created.id, docId: null }); }}/>
      </div> : null}
    </div> : null}

    <div className="ws-segmented" role="tablist" aria-label="Show">
      {(["all", "lessons", "notes", "questions"] as ListFilter[]).map((key) => <button type="button" role="tab" key={key}
        aria-selected={filter === key} className={`${filter === key ? "is-active" : ""} ${counts[key] === 0 ? "is-zero" : ""}`} onClick={() => setFilter(key)}>
        {key === "all" ? "All" : key === "lessons" ? "Lessons" : key === "notes" ? "Notes" : "Questions"}<small>{counts[key]}</small>
      </button>)}
    </div>

    {shown.length ? <ul className="nb-doc-list">
      {shown.map((entry) => {
        const inSubtopic = topic && entry.topic_id !== topic.id ? workspace.topicById.get(entry.topic_id)?.name : !topic ? workspace.topicById.get(entry.topic_id)?.name : null;
        const captures = isLesson(entry) ? snapshot.entries.filter((row) => row.lesson_id === entry.id).length : 0;
        const preview = entryPreview(entry, 200);
        const kindLabel = entryKindLabel(entry);
        const ownTopicName = workspace.topicById.get(entry.topic_id)?.name.trim().toLocaleLowerCase();
        const showKind = !ownTopicName || ownTopicName !== kindLabel.toLocaleLowerCase();
        const metadata = [inSubtopic, showKind ? kindLabel : null, captures ? `${captures} captured` : null].filter(Boolean).join(" · ");
        return <li key={entry.id}>
          <button type="button" className={`nb-doc-row ${isLesson(entry) ? "is-lesson" : ""}`} onClick={() => navigate({ topicId: entry.topic_id, docId: entry.id })}>
            <span className="nb-doc-icon"><KindIcon entry={entry} size={16} /></span>
            <span className="nb-doc-text">
              <strong>{entryTitle(entry)}{entry.pinned ? <span className="nb-pin-dot" title="Pinned">•</span> : null}</strong>
              {preview ? <span className="nb-doc-preview">{preview}</span> : null}
            </span>
            <span className="nb-doc-meta">
              <span>{isLesson(entry) && entry.lesson_date ? formatDay(entry.lesson_date) : relativeTime(entry.updated_at)}</span>
              {metadata ? <small>{metadata}</small> : null}
            </span>
          </button>
        </li>;
      })}
    </ul> : <EmptyState icon={filter === "questions" ? <CircleHelp size={22} /> : <FilePlus2 size={22} />}
      title={filter === "questions" ? "No open questions here" : filter === "lessons" ? "No lessons here yet" : docs.length ? "Nothing matches this filter" : "Nothing written here yet"}
      action={workspace.writable && fallbackTopic ? <div className="ws-empty-actions">
        <button type="button" className="ws-button is-primary" onClick={() => onNewNote(fallbackTopic)}><FilePlus2 size={15} /> Write a note</button>
        <button type="button" className="ws-button" onClick={() => workspace.openCapture({ mode: "lesson", topicId: fallbackTopic })}><GraduationCap size={15} /> Start a lesson</button>
      </div> : null}>
      {filter === "questions" ? "Questions you capture (end a quick note with ?) collect here until you answer them." : `Quick notes land here instantly with ${MOD_KEY}+Shift+N from anywhere.`}
    </EmptyState>}
  </div>;
}

// ---------------------------------------------------------------------------
// Notebook home: what to reopen, and the first-run path
// ---------------------------------------------------------------------------
function NotebookHome({ navigate, onNewNote }: { navigate: (location: NotebookLocation) => void; onNewNote: (topicId: string | null) => void }) {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const { objectives } = usePersonalOsObjectives(workspace.userId);
  const [creating, setCreating] = useState(false);
  const subjects = [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name));
  const docs = snapshot.entries.filter(isDocument);
  const lessons = docs.filter(isLesson).sort((a, b) => docSortKey(b).localeCompare(docSortKey(a))).slice(0, 6);
  const recentNotes = docs.filter((entry) => !isLesson(entry)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  const suggestions = (objectives?.languages.map((language) => language.name) ?? DEFAULT_LANGUAGE_SUGGESTIONS)
    .filter((name) => !subjects.some((subject) => subject.name.toLowerCase() === name.toLowerCase())).slice(0, 4);

  if (!subjects.length) {
    return <div className="nb-welcome">
      <span className="ws-eyebrow">Notebook</span>
      <h1>Where what you learn is kept, and found again.</h1>
      <p>Start with a subject — usually a language. Heuresis adds an <em>Inbox</em> topic so quick notes always have somewhere to land; organise them into topics whenever you like.</p>
      {workspace.writable ? (creating
        ? <div className="nb-welcome-form"><InlineNameForm label="Language name" placeholder="Chinese, German, Russian…" suggestions={suggestions}
          onCancel={() => setCreating(false)}
          onSubmit={async (name) => {
            const created = await workspace.addSubject(name);
            const inbox = await workspace.ensureInbox(created.id);
            workspace.updateMemory((current) => ({ ...current, notebook: { ...current.notebook, expanded: Array.from(new Set([...current.notebook.expanded, created.id])) } }));
            setCreating(false);
            navigate({ topicId: inbox.id, docId: null });
          }} /></div>
        : <div className="ws-empty-actions">
          {suggestions.slice(0, 3).map((name) => <button type="button" key={name} className="ws-button" onClick={async () => {
            try {
              const created = await workspace.addSubject(name);
              const inbox = await workspace.ensureInbox(created.id);
              workspace.updateMemory((current) => ({ ...current, notebook: { ...current.notebook, expanded: Array.from(new Set([...current.notebook.expanded, created.id])) } }));
              navigate({ topicId: inbox.id, docId: null });
            } catch (error) { workspace.toast(error instanceof Error ? error.message : String(error), { tone: "error" }); }
          }}><Plus size={14} /> {name}</button>)}
          <button type="button" className="ws-button is-primary" onClick={() => setCreating(true)}><Plus size={14} /> Other subject…</button>
        </div>) : null}
    </div>;
  }

  return <div className="nb-scope nb-home">
    <header className="nb-scope-head">
      <div><span className="ws-eyebrow">{formatDay(localDateKey(new Date()))}</span><h1>Notebook</h1></div>
      {workspace.writable ? <div className="nb-scope-actions">
        <button type="button" className="ws-button" onClick={() => workspace.openCapture({ mode: "lesson" })}><GraduationCap size={15} /> New lesson</button>
        <button type="button" className="ws-button is-primary" onClick={() => onNewNote(workspace.memory.capture.topicId && workspace.topicById.has(workspace.memory.capture.topicId) ? workspace.memory.capture.topicId : snapshot.topics[0]?.id ?? null)}><FilePlus2 size={15} /> New note</button>
      </div> : null}
    </header>
    <div className="nb-home-subjects">
      {subjects.map((subject) => {
        const topicIds = new Set(snapshot.topics.filter((topic) => topic.subject_id === subject.id).map((topic) => topic.id));
        const subjectDocs = docs.filter((entry) => topicIds.has(entry.topic_id));
        const subjectLessons = subjectDocs.filter(isLesson).length;
        return <button type="button" key={subject.id} className="nb-home-subject" onClick={() => navigate({ topicId: null, docId: null, subjectId: subject.id })}>
          <strong>{subject.name}</strong>
          <span>{topicIds.size} {topicIds.size === 1 ? "topic" : "topics"} · {subjectDocs.length - subjectLessons} notes · {subjectLessons} lessons</span>
        </button>;
      })}
    </div>
    <div className="nb-home-columns">
      <section>
        <h2 className="ws-section-title">Recent lessons</h2>
        {lessons.length ? <ul className="nb-doc-list is-compact">{lessons.map((entry) => <li key={entry.id}>
          <button type="button" className="nb-doc-row is-lesson" onClick={() => navigate({ topicId: entry.topic_id, docId: entry.id })}>
            <span className="nb-doc-icon"><KindIcon entry={entry} size={15} /></span>
            <span className="nb-doc-text"><strong>{entryTitle(entry)}</strong><span className="nb-doc-preview">{workspace.pathLabel(entry.topic_id)}</span></span>
            <span className="nb-doc-meta"><span>{formatDay(entry.lesson_date ?? entry.created_at)}</span></span>
          </button></li>)}</ul>
          : <p className="ws-muted">Lessons you start with {MOD_KEY}+Shift+L appear here.</p>}
      </section>
      <section>
        <h2 className="ws-section-title">Recently edited notes</h2>
        {recentNotes.length ? <ul className="nb-doc-list is-compact">{recentNotes.map((entry) => <li key={entry.id}>
          <button type="button" className="nb-doc-row" onClick={() => navigate({ topicId: entry.topic_id, docId: entry.id })}>
            <span className="nb-doc-icon"><KindIcon entry={entry} size={15} /></span>
            <span className="nb-doc-text"><strong>{entryTitle(entry)}</strong><span className="nb-doc-preview">{workspace.pathLabel(entry.topic_id)}</span></span>
            <span className="nb-doc-meta"><span>{relativeTime(entry.updated_at)}</span></span>
          </button></li>)}</ul>
          : <p className="ws-muted">Nothing yet. Capture a quick note with {MOD_KEY}+Shift+N.</p>}
      </section>
    </div>
  </div>;
}
