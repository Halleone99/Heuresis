import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, FilePlus2, FolderPlus, Home, MoreHorizontal, Plus, Trash2, Pencil, X } from "lucide-react";
import type { KnowledgeTopic } from "../../lib/knowledgeWorkspace";
import { isDocument, isOpenQuestion } from "../../lib/knowledgeWorkspace";
import { useWorkspace } from "./WorkspaceContext";
import { RowMenu } from "./NotebookView";
import { useConfirm } from "./ui";

type CreateTarget = { subjectId: string | null; parentId: string | null };
type RenameTarget = { kind: "subject" | "topic"; id: string; name: string };

export function NotebookSidebarTree() {
  const workspace = useWorkspace();
  const { memory, snapshot, updateMemory } = workspace;
  const [creating, setCreating] = useState<CreateTarget | null>(null);
  const [renaming, setRenaming] = useState<RenameTarget | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmElement, confirm] = useConfirm();
  const activeTopic = memory.notebook.docId
    ? workspace.entryById.get(memory.notebook.docId)?.topic_id ?? memory.notebook.topicId
    : memory.notebook.topicId;
  const activeSubject = activeTopic ? workspace.topicById.get(activeTopic)?.subject_id
    : memory.notebook.subjectId;
  const expanded = new Set(memory.notebook.expanded);

  const subjects = useMemo(() => [...snapshot.subjects].sort((a,b) => a.name.localeCompare(b.name)),
    [snapshot.subjects]);
  const counts = useMemo(() => {
    const counts = new Map<string, { notes: number; questions: number }>();
    for (const entry of snapshot.entries) {
      if (!isDocument(entry)) continue;
      const count = counts.get(entry.topic_id) ?? { notes: 0, questions: 0 };
      count.notes++;
      if (isOpenQuestion(entry)) count.questions++;
      counts.set(entry.topic_id, count);
    }
    return counts;
  }, [snapshot.entries]);
  function goHome() {
    updateMemory((current) => ({ ...current, notebook: {
      ...current.notebook, topicId: null, docId: null, subjectId: null,
    } }));
  }
  function goSubject(subjectId: string) {
    updateMemory((current) => ({ ...current, notebook: {
      ...current.notebook, subjectId, topicId: null, docId: null,
      expanded: Array.from(new Set([...current.notebook.expanded, subjectId])),
    } }));
  }
  function goTopic(topicId: string) {
    workspace.openTopic(topicId);
  }
  function toggle(id: string) {
    updateMemory((current) => {
      const next = new Set(current.notebook.expanded);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...current, notebook: { ...current.notebook, expanded: [...next] } };
    });
  }
  function prepareCreate(target: CreateTarget) {
    setError(""); setRenaming(null); setCreating(target); setName("");
    if (target.subjectId) updateMemory((current) => ({ ...current, notebook: {
      ...current.notebook, expanded: Array.from(new Set([...current.notebook.expanded,
        target.subjectId!, ...(target.parentId ? [target.parentId] : [])])),
    } }));
  }
  function prepareRename(kind: RenameTarget["kind"], id: string, initial: string) {
    setCreating(null); setError(""); setRenaming({ kind, id, name: initial }); setName(initial);
  }
  async function submit() {
    if (busy || !workspace.writable) return;
    const clean = name.trim();
    if (!clean) { setError("Enter a name first."); return; }
    setBusy(true); setError("");
    try {
      if (renaming) {
        if (renaming.kind === "subject") await workspace.renameSubjectById(renaming.id, clean);
        else await workspace.changeTopic(renaming.id, { name: clean });
        setRenaming(null);
      } else if (creating) {
        if (!creating.subjectId) {
          const subject = await workspace.addSubject(clean);
          const inbox = await workspace.ensureInbox(subject.id);
          goSubject(subject.id);
          goTopic(inbox.id);
        } else {
          const topic = await workspace.addTopic(creating.subjectId, clean, creating.parentId);
          goTopic(topic.id);
        }
        setCreating(null);
      }
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save. Try again."); }
    finally { setBusy(false); }
  }
  async function removeTopic(topic: KnowledgeTopic) {
    const subtree = workspace.subtreeIds(topic.id);
    const entries = snapshot.entries.filter((entry) => subtree.includes(entry.topic_id)).length;
    if (entries || workspace.childrenOf(topic.id, topic.subject_id).length) {
      setError("Move or delete the notes and sub-topics before removing this topic.");
      return;
    }
    if (!await confirm({ title: `Delete “${topic.name}”?`,
      body: "This empty topic will be permanently deleted.", confirmLabel:"Delete topic", danger:true })) return;
    try {
      setError(""); await workspace.removeTopic(topic.id);
      if (activeTopic === topic.id) goSubject(topic.subject_id);
    } catch (err) { setError(err instanceof Error ? err.message : "Deletion failed."); }
  }
  async function removeSubject(id: string, label: string) {
    const topics = snapshot.topics.filter((topic) => topic.subject_id === id);
    const ids = new Set(topics.map((topic) => topic.id));
    if (snapshot.entries.some((entry) => ids.has(entry.topic_id))) {
      setError("Move or delete this language's entries before deleting it.");
      return;
    }
    if (!await confirm({ title: `Delete “${label}”?`,
      body: `The language and its ${topics.length} empty topics will be permanently removed.`,
      confirmLabel:"Delete language", danger:true })) return;
    try { setError(""); await workspace.removeSubject(id); if (activeSubject === id) goHome(); }
    catch (err) { setError(err instanceof Error ? err.message : "Deletion failed."); }
  }
  function editor() {
    return <form className="hw-nb-editor" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input aria-label={renaming ? "Rename" : "New language or topic"} autoFocus maxLength={100}
        placeholder={renaming ? renaming.name : creating?.subjectId ? "Topic name" : "Language name"}
        value={name} disabled={busy} onChange={(event) => setName(event.target.value)}/>
      <div><button type="submit" disabled={busy || !name.trim()}>{renaming ? "Rename" : "Create"}</button>
        <button type="button" disabled={busy} onClick={() => { setRenaming(null); setCreating(null); setError(""); }}>Cancel</button></div>
    </form>;
  }
  function topics(subjectId: string, parentId: string | null, depth: number): React.ReactNode {
    return workspace.childrenOf(parentId, subjectId).map((topic) => {
      const children = workspace.childrenOf(topic.id, subjectId);
      const open = expanded.has(topic.id);
      const count = counts.get(topic.id);
      return <div key={topic.id} className="hw-nb-group" role="treeitem"
        aria-expanded={children.length ? open : undefined} aria-selected={activeTopic === topic.id}>
        <div className={`hw-nb-row ${activeTopic === topic.id ? "is-active" : ""}`}
          style={{ paddingLeft: Math.min(depth, 4) * 10 }}>
          {children.length ? <button type="button" className="hw-nb-twist"
            title={open ? `Collapse ${topic.name}` : `Expand ${topic.name}`}
            aria-label={open ? `Collapse ${topic.name}` : `Expand ${topic.name}`}
            aria-expanded={open} onClick={() => toggle(topic.id)}>
            {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
            : <span className="hw-nb-leaf" aria-hidden="true"/>}
          <button type="button" className="hw-nb-link" onClick={() => goTopic(topic.id)}
            aria-current={activeTopic === topic.id ? "page" : undefined}
            title={topic.name}><span>{topic.name}</span>
            {count?.questions ? <small title={`${count.questions} open questions`}>?{count.questions}</small> : null}
          </button>
          {workspace.writable ? <RowMenu label={topic.name} items={[
            { label:"New note here", icon:<FilePlus2 size={14}/>, run:() => workspace.openCapture({mode:"note",topicId:topic.id}) },
            ...(depth < 4 ? [{ label:"New sub-topic", icon:<FolderPlus size={14}/>,
              run:() => prepareCreate({subjectId,parentId:topic.id}) }] : []),
            { label:"Rename", icon:<Pencil size={14}/>, run:() => prepareRename("topic",topic.id,topic.name) },
            { label:"Delete empty topic", icon:<Trash2 size={14}/>, danger:true, run:() => void removeTopic(topic) },
          ]}/> : null}
        </div>
        {renaming?.id === topic.id ? editor() : null}
        {creating?.parentId === topic.id ? editor() : null}
        {open ? <div role="group">{topics(subjectId,topic.id,depth+1)}</div> : null}
      </div>;
    });
  }
  return <section className="hw-notebook-tree" aria-label="Notebook languages and topics">
    {confirmElement}
    <div className="hw-nb-heading"><span>Languages & topics</span>
      {workspace.writable ? <button type="button" onClick={() => prepareCreate({subjectId:null,parentId:null})}
        title="Add language" aria-label="Add language"><Plus size={14}/></button> : null}
    </div>
    <nav className="hw-nb-tree-nav" aria-label="Notebook navigation">
      <button type="button" className={`hw-nb-home ${!activeSubject && !activeTopic ? "is-active" : ""}`}
        onClick={goHome}><Home size={13}/> All notes</button>
      <div role="tree" aria-label="Languages">
        {subjects.map((subject) => {
          const open=expanded.has(subject.id);
          const selected=activeSubject === subject.id && !activeTopic;
          return <div key={subject.id} className="hw-nb-group" role="treeitem" aria-expanded={open}>
            <div className={`hw-nb-row hw-nb-subject ${selected ? "is-active" : ""}`}>
              <button type="button" className="hw-nb-twist"
                aria-label={open ? `Collapse ${subject.name}` : `Expand ${subject.name}`} aria-expanded={open}
                onClick={() => toggle(subject.id)}>
                {open ? <ChevronDown size={13}/> : <ChevronRight size={13}/>}</button>
              <button type="button" className="hw-nb-link" title={subject.name}
                aria-current={selected ? "page" : undefined}
                onClick={() => goSubject(subject.id)}><BookOpen size={13}/><span>{subject.name}</span></button>
              {workspace.writable ? <RowMenu label={subject.name} items={[
                {label:"New topic",icon:<FolderPlus size={14}/>,run:() => prepareCreate({subjectId:subject.id,parentId:null})},
                {label:"Rename",icon:<Pencil size={14}/>,run:() => prepareRename("subject",subject.id,subject.name)},
                {label:"Delete empty language",icon:<Trash2 size={14}/>,danger:true,run:()=>void removeSubject(subject.id,subject.name)},
              ]}/> : null}
            </div>
            {renaming?.id===subject.id ? editor() : null}
            {open ? <div role="group">{topics(subject.id,null,1)}
              {creating?.subjectId===subject.id && !creating.parentId ? editor() : null}
            </div> : null}
          </div>;
        })}
      </div>
      {creating && !creating.subjectId ? editor() : null}
      {subjects.length === 0 && !creating ? <p className="hw-nb-empty">Add your first language to start organising notes.</p> : null}
      {error ? <p className="hw-nb-error" role="alert">{error}</p> : null}
    </nav>
  </section>;
}
