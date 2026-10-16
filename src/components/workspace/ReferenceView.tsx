import { useMemo, useState } from "react";
import { ArrowLeft, BookMarked, ChevronRight, FileText, Folder, FolderPlus, Plus, Search } from "lucide-react";
import { entryPreview, entryTitle, isDocument } from "../../lib/knowledgeWorkspace";
import { useWorkspace } from "./WorkspaceContext";

/** Reference is a view of the existing Notebook knowledge model, not a second store. */
export function ReferenceView() {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState<"subject" | "topic" | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const subjects = useMemo(() => [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name)), [snapshot.subjects]);
  const subject = subjects.find((row) => row.id === subjectId) ?? null;
  const topic = snapshot.topics.find((row) => row.id === topicId && row.subject_id === subjectId) ?? null;
  const subjectTopics = snapshot.topics.filter((row) => row.subject_id === subjectId);
  const visibleTopics = subjectTopics
    .filter((row) => !topic ? !row.parent_id : row.parent_id === topic.id)
    .filter((row) => row.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  const visibleEntries = !topic ? [] : snapshot.entries
    .filter((row) => row.topic_id === topic.id && isDocument(row))
    .filter((row) => [entryTitle(row), entryPreview(row)].join(" ").toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => entryTitle(a).localeCompare(entryTitle(b)));
  async function save() {
    if (!name.trim() || saving) return;
    setSaving(true); setError("");
    try {
      if (creating === "subject") {
        const row = await workspace.addSubject(name.trim());
        setSubjectId(row.id); setTopicId(null);
      } else if (creating === "topic" && subject) {
        const row = await workspace.addTopic(subject.id, name.trim(), topic?.id ?? null);
        setTopicId(row.id);
      }
      setCreating(null); setName(""); setQuery("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }
  function openTopic(id: string) { setTopicId(id); setQuery(""); }
  function openNotebookTopic(id: string) { workspace.openTopic(id); }
  return <div className="lit-page">
    <header className="lit-page-head">
      <div><span className="lit-eyebrow">KNOWLEDGE AT HAND</span><h1>Reference</h1>
        <p>Subjects, topics and titled entries — maintained in your existing Notebook.</p></div>
      <button className="lit-button is-primary" disabled={!workspace.writable} onClick={() => { setCreating(subject ? "topic" : "subject"); setName(""); setError(""); }}>
        <Plus size={16}/>{subject ? "New topic" : "New subject"}</button>
    </header>
    <div className="lit-breadcrumb">
      <button onClick={() => { setSubjectId(null); setTopicId(null); setQuery(""); }}>Subjects</button>
      {subject ? <><ChevronRight size={14}/><button onClick={() => { setTopicId(null); setQuery(""); }}>{subject.name}</button></> : null}
      {topic ? <><ChevronRight size={14}/><span>{topic.name}</span></> : null}
    </div>
    <div className="lit-reference-search"><label className="lit-search"><Search size={15}/><input
      aria-label="Find a subject, topic or entry" placeholder={topic ? "Find an entry…" : "Find a subject or topic…"}
      value={query} onChange={(event) => setQuery(event.target.value)}/></label>
      {subject ? <button className="lit-button" onClick={() => { if (topic) openNotebookTopic(topic.id); else workspace.goTo("notebook"); }}>
        <FileText size={14}/> Open in Notebook</button> : null}
    </div>
    {workspace.loading ? <p className="lit-feedback">Opening your reference material…</p>
      : !subject ? <div className="lit-reference-grid">
        {subjects.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())).map((item) => {
          const topics = snapshot.topics.filter((row) => row.subject_id === item.id);
          return <button key={item.id} className="lit-reference-tile" onClick={() => { setSubjectId(item.id); setTopicId(null); setQuery(""); }}>
            <Folder size={22}/><h2>{item.name}</h2><p>{topics.length} topic{topics.length === 1 ? "" : "s"}</p><ChevronRight className="lit-tile-arrow" size={17}/>
          </button>;
        })}
        {subjects.length === 0 ? <div className="lit-empty"><FolderPlus size={28}/><h2>Begin with a subject</h2><p>For example, German, Philosophy or History. Then add B1 and your individual topics.</p></div> : null}
      </div> : <div className="lit-reference-stack">
        {topic ? <div className="lit-reference-intro"><BookMarked size={18}/><div><h2>{topic.name}</h2><p>{visibleEntries.length} entries</p></div></div> : <div className="lit-reference-intro"><Folder size={18}/><div><h2>{subject.name}</h2><p>Choose a topic, or create one.</p></div></div>}
        <div className="lit-reference-grid">
          {visibleTopics.map((item) => <button key={item.id} className="lit-reference-tile" onClick={() => openTopic(item.id)}>
            <Folder size={21}/><h2>{item.name}</h2><p>{snapshot.entries.filter((entry) => entry.topic_id === item.id && isDocument(entry)).length} entries</p><ChevronRight className="lit-tile-arrow" size={17}/>
          </button>)}
        </div>
        {topic ? <div className="lit-reference-entries">
          {visibleEntries.map((entry) => <button key={entry.id} className="lit-reference-entry" onClick={() => workspace.openDocument(entry.id)}>
            <FileText size={18}/><span><strong>{entryTitle(entry)}</strong><small>{entryPreview(entry, 110) || "Open entry"}</small></span><ChevronRight size={17}/>
          </button>)}
          {visibleEntries.length === 0 && visibleTopics.length === 0 ? <p className="lit-feedback">No entries here yet. Open this topic in Notebook to write the first one.</p> : null}
          <button className="lit-button" onClick={() => openNotebookTopic(topic.id)}><Plus size={14}/> Write or edit entries in Notebook</button>
        </div> : null}
      </div>}
    {subject ? <button className="lit-back-link" onClick={() => { if (topic) setTopicId(topic.parent_id); else setSubjectId(null); setQuery(""); }}><ArrowLeft size={15}/> Back</button> : null}
    {creating ? <div className="lit-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setCreating(null); }}>
      <form className="lit-dialog" role="dialog" aria-modal="true" aria-label={creating === "subject" ? "New subject" : "New topic"} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <header><h2>{creating === "subject" ? "New subject" : "New topic"}</h2></header>
        <label className="lit-field">Title<input required maxLength={120} autoFocus placeholder={creating === "subject" ? "e.g. German" : "e.g. B1"} value={name} onChange={(event) => setName(event.target.value)}/></label>
        {error ? <p className="lit-feedback is-error" role="alert">{error}</p> : null}
        <div className="lit-form-actions"><button type="button" className="lit-button" onClick={() => setCreating(null)}>Cancel</button>
          <button type="submit" className="lit-button is-primary" disabled={!name.trim() || saving}>{saving ? "Saving…" : "Create"}</button></div>
      </form></div> : null}
  </div>;
}
