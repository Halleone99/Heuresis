import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, CircleHelp, FilePlus2, FolderPlus, GraduationCap, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Pencil, Plus, ListChecks, Trash2 } from "lucide-react";
import {
  entryPreview, entryTitle, isDocument, isLesson, isOpenQuestion, localDateKey,
  type KnowledgeEntry, type KnowledgeTopic,
} from "../../lib/knowledgeWorkspace";
import type { NotebookLocation } from "../../lib/workspaceMemory";
import { isInboxTopic } from "../../lib/lessonCleanup";
import { DocumentPage } from "./DocumentPage";
import { openNoteWindow } from "../../lib/noteWindow";
import { friendlyError } from "../../lib/knowledgeWorkspace";
import { ReferenceLibrary } from "./ReferenceLibrary";
import { SubjectCard } from "./SubjectCard";
import { EmptyState, InlineNameForm, KindIcon, MOD_KEY, ShowMore, entryKindLabel, formatDay, relativeTime, useConfirm, usePopover, useProgressiveList } from "./ui";
import { DEFAULT_LANGUAGE_SUGGESTIONS, usePersonalOsObjectives } from "./usePersonalOs";
import { useWorkspace } from "./WorkspaceContext";

type ListFilter = "all" | "notes" | "questions";
export type NewDocRequest = { topicId: string; category?: KnowledgeEntry["category"]; title?: string; draftKey?: string } | null;

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function docSortKey(entry: KnowledgeEntry) {
  return isLesson(entry) && entry.lesson_date ? `${entry.lesson_date}T23:59:59` : entry.updated_at;
}

export function NotebookView({ referenceOnly = false, onExitReference }: { referenceOnly?: boolean; onExitReference?: () => void } = {}) {
  const workspace = useWorkspace();
  const { memory, updateMemory, snapshot, entryById, topicById, subjectById } = workspace;
  const location = memory.notebook;
  const [history, setHistory] = useState<NotebookLocation[]>([]);
  const [newDoc, setNewDoc] = useState<NewDocRequest>(null);
  const [referencesOpen, setReferencesOpen] = useState(referenceOnly);
  const [referenceReturnId, setReferenceReturnId] = useState<string | null>(null);
  const [creatingKind, setCreatingKind] = useState<"subject" | "topic" | null>(null);
  const [targetSubjectId, setTargetSubjectId] = useState("");
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

  const startNewNote = useCallback((topicId: string | null, title?: string, category?: KnowledgeEntry["category"]) => {
    const target = topicId ?? topic?.id ?? doc?.topic_id ?? null;
    if (!target) { workspace.toast("Choose or create a topic first.", { tone: "error" }); return; }
    setHistory((stack) => [...stack.slice(-30), { topicId: location.topicId, docId: location.docId, subjectId: location.subjectId ?? null }]);
    internalNavigation.current = true;
    updateMemory((current) => ({ ...current, notebook: { ...current.notebook, topicId: target, docId: null, subjectId: null } }));
    setNewDoc({ topicId: target, title, category, draftKey: crypto.randomUUID() });
  }, [doc?.topic_id, location.docId, location.subjectId, location.topicId, topic?.id, updateMemory, workspace]);

  const railCollapsed = memory.notebook.railCollapsed;
  const toggleRail = () => updateMemory((current) => ({ ...current, notebook: { ...current.notebook, railCollapsed: !current.notebook.railCollapsed } }));

  // A different page opens at its top; a new note keeps its place when its first save gives it an id.
  const pageKey = newDoc ? `new-${newDoc.draftKey ?? newDoc.topicId}` : doc ? stableKeys.current.get(doc.id) ?? doc.id : topic?.id ?? subject?.id ?? "home";
  const shownPage = useRef(pageKey);
  useLayoutEffect(() => {
    if (shownPage.current === pageKey) return;
    shownPage.current = pageKey;
    window.scrollTo(0, 0);
  }, [pageKey]);

  const newAction = workspace.writable && !referenceOnly ? <RowMenu label="New Notebook item" buttonLabel="New" items={[
    { label: "New subject", icon: <Plus size={14}/>, run: () => setCreatingKind("subject") },
    { label: "New topic", icon: <FolderPlus size={14}/>, run: () => {
      setTargetSubjectId(topic?.subject_id ?? subject?.id ?? (snapshot.subjects.length === 1 ? snapshot.subjects[0].id : ""));
      setCreatingKind("topic");
    } },
    { label: "New note", icon: <FilePlus2 size={14}/>, run: () => {
      const currentSubjectId = topic?.subject_id ?? subject?.id ?? null;
      const target = doc?.topic_id ?? topic?.id ?? (currentSubjectId
        ? snapshot.topics.find((row) => row.subject_id === currentSubjectId && isInboxTopic(row))?.id ?? null : null);
      if (target) { startNewNote(target); return; }
      if (!currentSubjectId) {
        // From Notebook home, use the same Unsorted → Inbox destination as
        // Quick Capture, but open the *document editor*, not the capture panel.
        void (async () => {
          const unsorted = snapshot.subjects.find((row) => row.name.trim().toLocaleLowerCase() === "unsorted")
            ?? await workspace.addSubject("Unsorted");
          const inbox = await workspace.ensureInbox(unsorted.id);
          startNewNote(inbox.id);
        })().catch((error) => workspace.toast(friendlyError(error), { tone: "error" }));
        return;
      }
      void workspace.ensureInbox(currentSubjectId).then((inbox) => startNewNote(inbox.id))
        .catch((error) => workspace.toast(friendlyError(error), { tone: "error" }));
    } },
    { label: "New writing window", icon: <FilePlus2 size={14}/>, run: () => {
      const currentSubjectId = topic?.subject_id ?? subject?.id ?? null;
      const target = doc?.topic_id ?? topic?.id ?? (currentSubjectId
        ? snapshot.topics.find((row) => row.subject_id === currentSubjectId && isInboxTopic(row))?.id ?? null : null);
      if (!target) { workspace.toast("Open a topic or its Inbox before creating a window.", { tone: "error" }); return; }
      void openNoteWindow({ topicId: target }).catch((error) => workspace.toast(friendlyError(error), { tone: "error" }));
    } },
  ]} /> : null;

  let main;
  if (workspace.loading && !snapshot.subjects.length) main = <div className="ws-loading" role="status"><span className="ws-spinner" />Opening your notebook…</div>;
  else if (referencesOpen) main = <ReferenceLibrary initialWorkId={referenceReturnId} onClose={() => { if (referenceOnly) onExitReference?.(); else setReferencesOpen(false); }}
    onCreate={(topicId) => { setReferencesOpen(false); setReferenceReturnId(null); startNewNote(topicId, "", "reference"); }}
    onEdit={(entry) => { setReferencesOpen(false); setReferenceReturnId(entry.id); workspace.openDocument(entry.id, { edit: true, stayInSection: referenceOnly }); }} />;
  else if (newDoc) main = <DocumentPage key={`new-${newDoc.draftKey ?? newDoc.topicId}`} entry={null} newDoc={newDoc} onBack={goBack} onClose={() => closeDocument(newDoc!.topicId)} navigate={navigate}
    onCreated={(created) => { stableKeys.current.set(created.id, `new-${newDoc.draftKey ?? newDoc.topicId}`); setNewDoc(null); if (created.category === "reference") setReferenceReturnId(created.id); navigate({ topicId: created.topic_id, docId: created.id }, { push: false }); }}
    onNewNote={startNewNote} />;
  else if (doc && isDocument(doc)) main = <DocumentPage key={stableKeys.current.get(doc.id) ?? doc.id} entry={doc} newDoc={null} onBack={goBack} onClose={() => { closeDocument(doc.topic_id); if (referenceReturnId === doc.id) setReferencesOpen(true); }} navigate={navigate} onCreated={() => undefined} onNewNote={startNewNote}
    onDetach={() => void openNoteWindow({ noteId: doc.id }).catch((error) => workspace.toast(friendlyError(error), { tone: "error" }))} />;
  else if (topic) main = <ScopePage key={topic.id} scope={{ topic }} navigate={navigate} newAction={newAction} />;
  else if (subject) main = <ScopePage key={subject.id} scope={{ subjectId: subject.id }} navigate={navigate} newAction={newAction} />;
  else main = <NotebookHome navigate={navigate} newAction={newAction} />;

  return <div className={`nb-layout ${railCollapsed ? "is-rail-collapsed" : ""} ${railOpenMobile ? "is-rail-open" : ""} ${referenceOnly ? "is-reference-standalone" : ""}`}>
    {!referenceOnly ? <NotebookRail location={location} navigate={navigate} onNewNote={startNewNote} onCollapse={toggleRail} /> : null}
    {!referenceOnly ? <button type="button" className="nb-rail-scrim" aria-label="Close topics" onClick={() => setRailOpenMobile(false)} /> : null}
    <section className="nb-main">
      {!referenceOnly ? <div className="nb-main-tools">
        <button type="button" className="ws-icon-button nb-rail-toggle" onClick={() => { if (window.matchMedia("(max-width: 900px)").matches) setRailOpenMobile((value) => !value); else toggleRail(); }}
          aria-label={railCollapsed ? "Show topics" : "Hide topics"} title={railCollapsed ? "Show topics" : "Hide topics"}>
          {railCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        {doc || newDoc ? newAction : null}
      </div> : null}
      {creatingKind ? <div className="nb-create-shell">
        {creatingKind === "subject" ? <InlineNameForm label="New subject" placeholder="Philosophy, History, German…" onCancel={() => setCreatingKind(null)}
          onSubmit={async (name) => {
            const created = await workspace.addSubject(name);
            await workspace.ensureInbox(created.id);
            setCreatingKind(null);
            navigate({ topicId: null, docId: null, subjectId: created.id });
          }} /> : <>
          <label className="nb-create-label" htmlFor="nb-new-topic-subject">Subject</label>
          <select id="nb-new-topic-subject" value={targetSubjectId} onChange={(event) => setTargetSubjectId(event.target.value)}>
            <option value="">Choose subject…</option>
            {snapshot.subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
          {targetSubjectId ? <InlineNameForm label="New topic" placeholder="Grammar, Philosophy of mind…" onCancel={() => setCreatingKind(null)}
            onSubmit={async (name) => {
              const parent = topic?.subject_id === targetSubjectId ? topic.id : null;
              const created = await workspace.addTopic(targetSubjectId, name, parent);
              setCreatingKind(null);
              navigate({ topicId: created.id, docId: null });
            }} /> : <button className="ws-button" type="button" onClick={() => setCreatingKind(null)}>Cancel</button>}
        </>}
      </div> : null}
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
      if (!isDocument(entry) || entry.category === "reference") continue;
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
        <InlineNameForm label="Sub-topic name" placeholder="Time expressions, Sub-topic…" onCancel={() => setCreating(null)}
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

      </div>
      {creating && !creating.subjectId ? <InlineNameForm label="Subject name" placeholder="Philosophy, German, History…" suggestions={suggestions}
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
            ? <InlineNameForm label="Subject name" initial={subject.name} submitLabel="Rename" onCancel={() => setRenaming(null)}
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
              <InlineNameForm label="Topic name" placeholder="Grammar, B1.2, Ideas…" onCancel={() => setCreating(null)}
                onSubmit={async (name) => { const created = await workspace.addTopic(subject.id, name, null); setCreating(null); navigate({ topicId: created.id, docId: null }); }} />
            </div> : workspace.writable ? <button type="button" className="nb-tree-add" onClick={() => setCreating({ subjectId: subject.id, parentId: null })}><Plus size={12} /> Topic</button> : null}
          </div> : null}
        </div>;
      })}
      {!subjects.length && !creating ? <p className="ws-muted nb-rail-empty">Subjects contain topics and notes.</p> : null}
    </div>
  </aside>;
}

type MenuItem = { label: string; icon?: React.ReactNode; run: () => void; danger?: boolean };
export function RowMenu({ label, items, icon, buttonLabel }: { label: string; items: MenuItem[]; icon?: React.ReactNode; buttonLabel?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = usePopover(open, close);
  return <div className="ws-menu" ref={ref}>
    <button type="button" className={`ws-icon-button ws-menu-trigger ${buttonLabel ? "nb-new-button" : ""}`} aria-label={buttonLabel ?? `Actions for ${label}`} aria-haspopup="menu" aria-expanded={open}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>{buttonLabel ? <><Plus size={15} /> {buttonLabel}</> : icon ?? <MoreHorizontal size={15} />}</button>
    {open ? <div className="ws-menu-list" role="menu">
      {items.map((item) => <button type="button" role="menuitem" key={item.label} className={item.danger ? "is-danger" : ""}
        onClick={(event) => { event.stopPropagation(); setOpen(false); item.run(); }}>{item.icon}{item.label}</button>)}
    </div> : null}
  </div>;
}

// ---------------------------------------------------------------------------
// Topic or subject page: what lives here, newest first
// ---------------------------------------------------------------------------
function ScopePage({ scope, navigate, newAction }: {
  scope: { topic: KnowledgeTopic } | { subjectId: string };
  navigate: (location: NotebookLocation) => void;
  newAction: React.ReactNode;
}) {
  const workspace = useWorkspace();
  const { snapshot, memory, updateMemory } = workspace;
  const topic = "topic" in scope ? scope.topic : null;
  const subjectId = topic ? topic.subject_id : (scope as { subjectId: string }).subjectId;
  const subject = workspace.subjectById.get(subjectId) ?? null;
  const path = topic ? workspace.topicPath(topic.id) : { subject, chain: [] };
  const children = workspace.childrenOf(topic?.id ?? null, subjectId);
  const filter: ListFilter = memory.notebook.filter === "lessons" ? "all" : memory.notebook.filter;
  // Never flatten all the subject's notes into the subject landing page.
  // Notes belong on their immediate topic page, not on an ancestor page.
  const docs = topic ? snapshot.entries.filter((entry) =>
    entry.topic_id === topic.id && isDocument(entry) && entry.category !== "reference") : [];
  const counts = {
    all: docs.length,
    notes: docs.filter((entry) => !isOpenQuestion(entry)).length,
    questions: docs.filter(isOpenQuestion).length,
  };
  const shown = docs.filter((entry) => filter === "all" || (filter === "questions" ? isOpenQuestion(entry) : !isOpenQuestion(entry)))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || docSortKey(b).localeCompare(docSortKey(a)));
  const page = useProgressiveList(shown, `${topic?.id ?? subjectId}|${filter}`);
  const setFilter = (next: ListFilter) => updateMemory((current) =>
    ({ ...current, notebook: { ...current.notebook, filter: next } }));
  const title = topic?.name ?? subject?.name ?? "Notebook";

  return <div className="nb-scope">
    <nav className="nb-crumbs" aria-label="Location">
      <button type="button" onClick={() => navigate({ topicId: null, docId: null })}>Notebook</button>
      {path.subject ? <><ChevronRight size={12} /><button type="button"
        onClick={() => navigate({ topicId: null, docId: null, subjectId: path.subject!.id })}>{path.subject.name}</button></> : null}
      {path.chain.slice(0, -1).map((item) => <span key={item.id} className="nb-crumb"><ChevronRight size={12} />
        <button type="button" onClick={() => navigate({ topicId: item.id, docId: null })}>{item.name}</button>
      </span>)}
    </nav>
    <header className="nb-scope-head">
      <h1>{title}</h1>
      <div className="nb-scope-actions">
        {workspace.writable && topic && isInboxTopic(topic) ? <button type="button" className="ws-button"
          onClick={() => workspace.openCleanup({ kind: "inbox", id: topic.id })}><ListChecks size={15}/> Organise Inbox</button> : null}
        {newAction}
      </div>
    </header>

    {children.length ? <div className="nb-topic-grid" aria-label={topic ? "Subtopics" : "Topics"}>
      {children.map((child) => {
        const subtree = new Set(workspace.subtreeIds(child.id));
        const noteCount = snapshot.entries.filter((entry) => subtree.has(entry.topic_id) && isDocument(entry) && entry.category !== "reference").length;
        const childCount = workspace.childrenOf(child.id, subjectId).length;
        return <button type="button" key={child.id} className="nb-topic-card"
          onClick={() => navigate({ topicId: child.id, docId: null })}>
          <span className="nb-topic-card-title">{child.name}<ChevronRight size={16} aria-hidden="true"/></span>
          <span className="nb-topic-card-count">{countLabel(noteCount, "note")}{childCount ? ` · ${countLabel(childCount, "subtopic")}` : ""}</span>
        </button>;
      })}
    </div> : null}

    {!topic ? (
      !children.length ? <EmptyState icon={<FolderPlus size={22}/>} title="No topics yet">
        Use New → New topic to organise your notes. Quick captures can go into an Inbox.
      </EmptyState> : null
    ) : docs.length ? <>
      <div className="ws-segmented" role="tablist" aria-label="Show notes">
        {(["all", "notes", "questions"] as ListFilter[]).map((key) => <button type="button" role="tab" key={key}
          aria-selected={filter === key} className={`${filter === key ? "is-active" : ""} ${counts[key] === 0 ? "is-zero" : ""}`}
          onClick={() => setFilter(key)}>
          {key === "all" ? "All" : key === "notes" ? "Notes" : "Questions"}<small>{counts[key]}</small>
        </button>)}
      </div>
      {shown.length ? <><ul className="nb-doc-list">
        {page.visible.map((entry) => {
          const captures = isLesson(entry) ? snapshot.entries.filter((row) => row.lesson_id === entry.id).length : 0;
          const kindLabel = isLesson(entry) ? "Note" : entryKindLabel(entry);
          const showKind = topic.name.trim().toLocaleLowerCase() !== kindLabel.toLocaleLowerCase();
          const metadata = [showKind ? kindLabel : null, captures ? `${captures} captured` : null].filter(Boolean).join(" · ");
          return <li key={entry.id}>
            <button type="button" className={`nb-doc-row ${isLesson(entry) ? "is-lesson" : ""}`}
              onClick={() => navigate({ topicId: entry.topic_id, docId: entry.id })}>
              <span className="nb-doc-icon"><KindIcon entry={entry} size={16}/></span>
              <span className="nb-doc-text"><strong>{entryTitle(entry)}{entry.pinned ? <span className="nb-pin-dot" title="Pinned">•</span> : null}</strong>
                {entryPreview(entry, 200) ? <span className="nb-doc-preview">{entryPreview(entry, 200)}</span> : null}
              </span>
              <span className="nb-doc-meta"><span>{isLesson(entry) && entry.lesson_date ? formatDay(entry.lesson_date) : relativeTime(entry.updated_at)}</span>
                {metadata ? <small>{metadata}</small> : null}</span>
            </button>
          </li>;
        })}
      </ul><ShowMore remaining={page.remaining} onMore={page.showMore} label="notes"/></> :
      <p className="ws-muted nb-topic-empty-filter">No notes match this filter.</p>}
    </> : !children.length ? <EmptyState icon={<FilePlus2 size={22}/>} title="No notes here yet">
      Use New → New note to capture something here.
    </EmptyState> : null}
  </div>;
}

// ---------------------------------------------------------------------------
// Notebook home: what to reopen, and the first-run path
// ---------------------------------------------------------------------------
function NotebookHome({ navigate, newAction }: { navigate: (location: NotebookLocation) => void; newAction: React.ReactNode }) {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const subjects = [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name));
  const docs = snapshot.entries.filter((entry) => isDocument(entry) && entry.category !== "reference");
  return <div className="nb-scope nb-home">
    <header className="nb-scope-head">
      <div><span className="ws-eyebrow">{formatDay(localDateKey(new Date()))}</span><h1>Notebook</h1></div>
      <div className="nb-scope-actions">{newAction}</div>
    </header>
    {subjects.length ? <div className="nb-home-subjects">
      {subjects.map((subject) => {
        const topicIds = new Set(snapshot.topics.filter((topic) => topic.subject_id === subject.id).map((topic) => topic.id));
        const notes = docs.filter((entry) => topicIds.has(entry.topic_id)).length;
        return <SubjectCard key={subject.id} subject={subject} topics={topicIds.size} notes={notes}
          onOpen={() => navigate({ topicId: null, docId: null, subjectId: subject.id })} />;
      })}
    </div> : <EmptyState icon={<FolderPlus size={24}/>} title="Your notebook is ready">
      Choose New → New subject to begin, or capture a note directly and organise it later.
    </EmptyState>}
  </div>;
}
