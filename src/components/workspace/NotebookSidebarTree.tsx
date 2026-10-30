import { useMemo, useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, FilePlus2, FolderPlus, Home, Plus, Trash2, Pencil } from "lucide-react";
import type { KnowledgeTopic } from "../../lib/knowledgeWorkspace";
import { isDocument, isOpenQuestion } from "../../lib/knowledgeWorkspace";
import { useWorkspace } from "./WorkspaceContext";
import { RowMenu } from "./NotebookView";
import { KnowledgeRemovalDialog, type KnowledgeRemovalTarget } from "./KnowledgeRemovalDialog";
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
  const [confirmElement] = useConfirm();
  const [removingTarget, setRemovingTarget] = useState<KnowledgeRemovalTarget | null>(null);
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
  function removeTopic(topic: KnowledgeTopic) {
    setRemovingTarget({ kind: "topic", id: topic.id, name: topic.name });
  }
  function removeSubject(id: string, label: string) {
    setRemovingTarget({ kind: "subject", id, name: label });
  }
  function editor() {
    return <form className="hw-nb-editor" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <input aria-label={renaming ? "Rename" : "New subject or topic"} autoFocus maxLength={100}
        placeholder={renaming ? renaming.name : creating?.subjectId ? "Topic name" : "Subject name"}
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
            { label:"Delete", icon:<Trash2 size={14}/>, danger:true, run:() => void removeTopic(topic) },
          ]}/> : null}
        </div>
        {renaming?.id === topic.id ? editor() : null}
        {creating?.parentId === topic.id ? editor() : null}
        {open ? <div role="group">{topics(subjectId,topic.id,depth+1)}</div> : null}
      </div>;
    });
  }
  return <section className="hw-notebook-tree" aria-label="Notebook subjects and topics">
    {confirmElement}
    {removingTarget ? <KnowledgeRemovalDialog key={removingTarget.id} target={removingTarget}
      onClose={() => setRemovingTarget(null)} onRemoved={goHome}/> : null}
    <div className="hw-nb-heading"><span>Subjects & topics</span>

    </div>
    <nav className="hw-nb-tree-nav" aria-label="Notebook navigation">
      <button type="button" className={`hw-nb-home ${!activeSubject && !activeTopic ? "is-active" : ""}`}
        onClick={goHome}><Home size={13}/> All notes</button>
      <div role="tree" aria-label="Subjects">
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
                {label:"Delete",icon:<Trash2 size={14}/>,danger:true,run:()=>void removeSubject(subject.id,subject.name)},
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
      {subjects.length === 0 && !creating ? <p className="hw-nb-empty">Choose New → New subject to organise your notes.</p> : null}
      {error ? <p className="hw-nb-error" role="alert">{error}</p> : null}
    </nav>
  </section>;
}
