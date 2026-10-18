import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, LibraryBig, Pencil, Plus, Search, X } from "lucide-react";
import { parseReferenceChapters, referenceSummary } from "../../lib/referenceChapters";
import type { KnowledgeEntry, KnowledgeSubject, KnowledgeTopic } from "../../lib/knowledgeWorkspace";
import { isInboxTopic } from "../../lib/lessonCleanup";
import { RichText } from "./RichText";
import { useWorkspace } from "./WorkspaceContext";
import "./reference-library.css";
import "./knowledge-catalogue.css";

type Props = {
  onClose: () => void;
  initialWorkId: string | null;
  onCreate: (topicId: string) => void;
  onEdit: (entry: KnowledgeEntry) => void;
};
type NewKind = "subject" | "topic" | "article";

function byRecent(a: KnowledgeEntry, b: KnowledgeEntry) {
  return b.updated_at.localeCompare(a.updated_at);
}
function published(entry: KnowledgeEntry) {
  return new Date(entry.updated_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function heading(entry: KnowledgeEntry) {
  return entry.title.trim() || referenceSummary(entry.body).slice(0, 72) || "Untitled article";
}
function excerpt(entry: KnowledgeEntry) {
  const text = referenceSummary(entry.body);
  return text && text !== heading(entry) ? text : "Open this entry to read more.";
}

/** Catalogue is an editorial view of the Notebook, never a separate data store.
 * Every existing note can be read here; Markdown headings are optional, not a requirement.
 * Lessons, mistakes and flashcards retain their own dedicated workflows.
 */
export function ReferenceLibrary({ onClose, onCreate, onEdit, initialWorkId }: Props) {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const [subjectId, setSubjectId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [workId, setWorkId] = useState<string | null>(initialWorkId);
  const [query, setQuery] = useState("");
  const [composer, setComposer] = useState(false);
  const [newKind, setNewKind] = useState<NewKind>("article");
  const [name, setName] = useState("");
  const [destinationSubject, setDestinationSubject] = useState("");
  const [destinationTopic, setDestinationTopic] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const articles = useMemo(() => snapshot.entries
    .filter((entry) => entry.kind === "note" && Boolean(entry.title.trim() || entry.body.trim()))
    .filter((entry) => workspace.topicById.has(entry.topic_id))
    .sort(byRecent), [snapshot.entries, workspace.topicById]);
  const subjects = useMemo(() => [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name)), [snapshot.subjects]);
  const topics = useMemo(() => snapshot.topics, [snapshot.topics]);
  const subject = subjects.find((item) => item.id === subjectId) ?? null;
  const topic = topics.find((item) => item.id === topicId) ?? null;
  const work = articles.find((entry) => entry.id === workId) ?? null;
  const workTopic = work ? workspace.topicById.get(work.topic_id) ?? null : null;
  const workSubject = workTopic ? workspace.subjectById.get(workTopic.subject_id) ?? null : null;
  const activeSubject = workSubject ?? subject;
  const activeTopic = workTopic ?? topic;
  const chapters = useMemo(() => work ? parseReferenceChapters(work.body) : [], [work]);

  const belonging = (entry: KnowledgeEntry, sid: string) =>
    workspace.topicById.get(entry.topic_id)?.subject_id === sid;
  const subjectArticles = (sid: string) => articles.filter((entry) => belonging(entry, sid));
  const scopeTopicIds = topic ? new Set(workspace.subtreeIds(topic.id)) : null;
  const scopedArticles = (topic && scopeTopicIds
    ? articles.filter((entry) => scopeTopicIds.has(entry.topic_id))
    : subject ? subjectArticles(subject.id) : articles);
  const scopeTopics = topic
    ? topics.filter((item) => !isInboxTopic(item) && item.subject_id === topic.subject_id && item.parent_id === topic.id)
    : subject
      ? topics.filter((item) => !isInboxTopic(item) && item.subject_id === subject.id && (!item.parent_id || !topics.some((candidate) => candidate.id === item.parent_id)))
      : [];
  const scopeTitle = topic?.name ?? subject?.name ?? "Knowledge Catalogue";
  const searchText = query.trim().toLocaleLowerCase();
  const matches = searchText ? articles.filter((entry) => [
    heading(entry), entry.body, workspace.pathLabel(entry.topic_id)
  ].join(" ").toLocaleLowerCase().includes(searchText)) : [];
  const availableDestinations = topics.filter((item) => item.subject_id === (destinationSubject || activeSubject?.id) && !isInboxTopic(item));
  const chosenTopic = availableDestinations.find((item) => item.id === destinationTopic)
    ?? (activeTopic && availableDestinations.some((item) => item.id === activeTopic.id) ? activeTopic : availableDestinations[0]) ?? null;

  function home() {
    setWorkId(null); setTopicId(null); setSubjectId(null); setQuery("");
    window.scrollTo(0, 0);
  }
  function openSubject(id: string) {
    setSubjectId(id); setTopicId(null); setWorkId(null); setQuery("");
    window.scrollTo(0, 0);
  }
  function openTopic(id: string) {
    const selected = topics.find((item) => item.id === id);
    if (!selected) return;
    setSubjectId(selected.subject_id); setTopicId(id); setWorkId(null); setQuery("");
    window.scrollTo(0, 0);
  }
  function openArticle(id: string) {
    setWorkId(id); setQuery(""); window.scrollTo(0, 0);
  }
  function back() {
    if (work) {
      setWorkId(null);
      if (!subjectId && workSubject) setSubjectId(workSubject.id);
      if (!topicId && workTopic) setTopicId(workTopic.id);
    } else if (topic) setTopicId(topic.parent_id);
    else if (subject) setSubjectId(null);
    else onClose();
    window.scrollTo(0, 0);
  }
  function startCreate(kind: NewKind) {
    setNewKind(kind); setComposer(true); setName(""); setError("");
    setDestinationSubject(activeSubject?.id ?? subjects[0]?.id ?? "");
    setDestinationTopic(activeTopic?.id ?? "");
  }
  async function save() {
    if (saving) return;
    if (newKind !== "article" && !name.trim()) { setError("Enter a name first."); return; }
    if (!workspace.writable) { setError("The catalogue is read-only."); return; }
    if (newKind === "article") {
      if (!chosenTopic) { setError("Create or select a topic before writing an article."); return; }
      setComposer(false);
      onCreate(chosenTopic.id);
      return;
    }
    setSaving(true); setError("");
    try {
      if (newKind === "subject") {
        const created = await workspace.addSubject(name.trim());
        openSubject(created.id);
      } else {
        const sid = destinationSubject || activeSubject?.id;
        if (!sid) { setError("Choose a subject first."); return; }
        const parent = activeTopic?.subject_id === sid ? activeTopic.id : null;
        const created = await workspace.addTopic(sid, name.trim(), parent);
        openTopic(created.id);
      }
      setComposer(false); setName("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setSaving(false); }
  }

  function articleCard(entry: KnowledgeEntry, featured = false) {
    const entryTopic = workspace.topicById.get(entry.topic_id);
    const entrySubject = workspace.subjectById.get(entryTopic?.subject_id ?? "");
    return <button type="button" className={"kc-story " + (featured ? "kc-story-feature" : "")}
      key={entry.id} onClick={() => openArticle(entry.id)}>
      <span className="kc-story-kicker">{entrySubject?.name ?? "Knowledge"}{entryTopic ? " / " + entryTopic.name : ""}</span>
      <strong>{heading(entry)}</strong>
      <span className="kc-story-summary">{excerpt(entry)}</span>
      <span className="kc-story-foot">{published(entry)} <ArrowRight size={15} /></span>
    </button>;
  }

  const latest = articles.slice(0, 7);
  const featured = articles.find((entry) => entry.pinned) ?? articles[0] ?? null;
  const neighbours = work ? articles.filter((entry) => entry.topic_id === work.topic_id && entry.id !== work.id).slice(0, 3) : [];

  return <div className="rl kc" aria-label="Knowledge catalogue">
    <nav className="kc-breadcrumbs" aria-label="Catalogue navigation">
      <button type="button" onClick={back} aria-label="Go back"><ArrowLeft size={15} /></button>
      <button type="button" onClick={home}>Catalogue</button>
      {activeSubject ? <><ChevronRight size={13} /><button type="button" onClick={() => openSubject(activeSubject.id)}>{activeSubject.name}</button></> : null}
      {activeTopic ? <><ChevronRight size={13} /><button type="button" onClick={() => openTopic(activeTopic.id)}>{activeTopic.name}</button></> : null}
      {work ? <><ChevronRight size={13} /><span>{heading(work)}</span></> : null}
    </nav>

    {work ? <div className="kc-reading-layout">
      <aside className="kc-reading-rail">
        <button type="button" onClick={() => openTopic(work.topic_id)}><ArrowLeft size={14} /> {workTopic?.name ?? "All articles"}</button>
        {chapters.length > 1 ? <nav aria-label="On this page">
          <small>IN THIS ARTICLE</small>
          {chapters.map((chapter, i) => <a key={i} href={"#kc-section-" + i}>{chapter.title}</a>)}
        </nav> : null}
      </aside>
      <article className="kc-reading-article">
        <header className="kc-reading-head">
          <span className="kc-kicker">{workSubject?.name ?? "Knowledge"} / {workTopic?.name ?? "Article"}</span>
          <h1>{heading(work)}</h1>
          <p className="kc-reading-meta">Updated {published(work)} · Personal knowledge library</p>
          <div className="kc-reading-tools">
            <button type="button" onClick={() => onEdit(work)}><Pencil size={15} /> Edit article</button>
            <button type="button" onClick={() => openTopic(work.topic_id)}><BookOpen size={15} /> More in this topic</button>
          </div>
        </header>
        <div className="kc-reading-body">
          {chapters.map((chapter, i) => <section id={"kc-section-" + i} key={i}>
            {chapter.title !== "Introduction" ? <h2>{chapter.title}</h2> : null}
            {chapter.content ? <RichText text={chapter.content} className="rl-prose" /> : null}
          </section>)}
        </div>
        <footer className="kc-reading-footer">
          <span>End of article</span>
          <button type="button" onClick={() => onEdit(work)}><Pencil size={14} /> Edit</button>
        </footer>
        {neighbours.length ? <section className="kc-related"><h2>Continue exploring</h2><div className="kc-story-grid">{neighbours.map((entry) => articleCard(entry))}</div></section> : null}
      </article>
    </div> : <>
      <header className="kc-masthead">
        <div className="kc-masthead-label"><LibraryBig size={15} /> HEURESIS / PERSONAL ENCYCLOPAEDIA</div>
        <div className="kc-masthead-title">
          <div><h1>{scopeTitle}</h1>
            <p>{topic ? "Ideas, explanations and examples gathered around this topic." : subject ? "A collection of knowledge, organised by theme." : "A place to explore everything you have learned and want to keep."}</p>
          </div>
          <div className="kc-masthead-actions"><span>{scopedArticles.length} {scopedArticles.length === 1 ? "article" : "articles"}</span>
            {workspace.writable ? <button type="button" className="kc-new" onClick={() => startCreate(topic ? "article" : subject ? "topic" : "subject")}><Plus size={15} /> New</button> : null}
          </div>
        </div>
      </header>

      <div className="kc-search"><Search size={18} /><input type="search" aria-label="Search knowledge catalogue"
        placeholder="Search articles, subjects and ideas…" value={query} onChange={(event) => setQuery(event.target.value)} />
        {query ? <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={16} /></button> : null}</div>

      {searchText ? <section className="kc-section">
        <div className="kc-section-heading"><h2>Search results</h2><span>{matches.length} found across your catalogue</span></div>
        {matches.length ? <div className="kc-story-grid">{matches.map((entry, i) => articleCard(entry, i === 0))}</div>
          : <p className="kc-note-empty">No matching articles. Try another term.</p>}
      </section> : !subject ? <>
        {featured ? <section className="kc-cover">
          <div className="kc-cover-copy"><span className="kc-kicker">FROM THE CATALOGUE / FEATURED</span>
            <button type="button" onClick={() => openArticle(featured.id)}><h2>{heading(featured)}</h2></button>
            <p>{excerpt(featured)}</p>
            <button type="button" className="kc-read" onClick={() => openArticle(featured.id)}>Read article <ArrowRight size={16} /></button>
          </div>
          <div className="kc-cover-index"><span>KNOWLEDGE, IN CONTEXT</span>
            <strong>{String(articles.length).padStart(2, "0")}</strong><small>Articles in your library</small></div>
        </section> : null}
        <section className="kc-section">
          <div className="kc-section-heading"><h2>Explore by subject</h2><span>{subjects.length} collections</span></div>
          <div className="kc-domain-grid">{subjects.map((item: KnowledgeSubject, index: number) => {
            const count = subjectArticles(item.id).length;
            const sample = subjectArticles(item.id).slice(0, 2).map(heading).join(" · ");
            return <button type="button" className="kc-domain" key={item.id} onClick={() => openSubject(item.id)}>
              <span className="kc-domain-num">{String(index + 1).padStart(2, "0")} / SUBJECT</span>
              <h3>{item.name}</h3><p>{sample || "Open this subject to develop its knowledge collection."}</p>
              <span className="kc-domain-foot">{count} {count === 1 ? "article" : "articles"} <ArrowRight size={16} /></span>
            </button>;
          })}</div>
          {!subjects.length ? <div className="kc-empty"><h3>Begin your catalogue</h3><p>Create a subject such as Philosophy, History or Chinese. Add topics and notes; they will appear here automatically.</p><button type="button" onClick={() => startCreate("subject")}><Plus size={15} /> Create subject</button></div> : null}
        </section>
        {latest.length ? <section className="kc-section"><div className="kc-section-heading"><h2>Recently added & revised</h2><span>The latest from your Notebook</span></div>
          <div className="kc-story-grid">{latest.map((entry, i) => articleCard(entry, i === 0))}</div></section> : null}
      </> : <>
        {scopeTopics.length ? <section className="kc-section"><div className="kc-section-heading"><h2>{topic ? "Subtopics" : "Topics"}</h2><span>Browse this collection</span></div>
          <div className="kc-topic-grid">{scopeTopics.map((item: KnowledgeTopic, i) => {
            const descendants = new Set(workspace.subtreeIds(item.id));
            const count = articles.filter((entry) => descendants.has(entry.topic_id)).length;
            return <button type="button" className="kc-topic" key={item.id} onClick={() => openTopic(item.id)}>
              <span>{String(i + 1).padStart(2, "0")}</span><h3>{item.name}</h3>
              <small>{count} {count === 1 ? "article" : "articles"}</small><ArrowRight size={18} />
            </button>;
          })}</div>
        </section> : null}
        <section className="kc-section"><div className="kc-section-heading"><h2>{topic ? "Articles in this topic" : "Articles"}</h2><span>{scopedArticles.length} entries</span></div>
          {scopedArticles.length ? <div className="kc-story-grid">{scopedArticles.map((entry, i) => articleCard(entry, i === 0))}</div>
            : <div className="kc-empty"><h3>No articles yet</h3><p>Write in your Notebook or create an article here. It will appear in this collection.</p>
              {workspace.writable ? <button type="button" onClick={() => startCreate(topic ? "article" : "topic")}><Plus size={15} /> {topic ? "New article" : "New topic"}</button> : null}</div>}
        </section>
      </>}
    </>}

    {composer ? <div className="kc-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setComposer(false); }}>
      <form className="kc-modal" onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="kc-modal-head"><h2>Add to catalogue</h2><button type="button" aria-label="Close" onClick={() => setComposer(false)}><X size={18} /></button></div>
        <div className="kc-kind-pills">{(["subject", "topic", "article"] as NewKind[]).map((kind) =>
          <button key={kind} type="button" className={newKind === kind ? "active" : ""} aria-pressed={newKind === kind} onClick={() => { setNewKind(kind); setError(""); }}>{kind === "article" ? "Article" : kind === "topic" ? "Topic" : "Subject"}</button>)}</div>
        {newKind !== "article" ? <label className="kc-field">{newKind === "topic" ? "Topic name" : "Subject name"}
          <input autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)}
            placeholder={newKind === "subject" ? "e.g. Philosophy" : "e.g. Stoicism"} /></label> : <p className="kc-compose-description">An article opens the full Notebook editor, with formatting, colour, images and headings. It remains in the same knowledge collection.</p>}
        {newKind === "topic" && !activeSubject ? <label className="kc-field">Subject<select value={destinationSubject} onChange={(event) => setDestinationSubject(event.target.value)}>
          {subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label> : null}
        {newKind === "article" ? <label className="kc-field">Save under topic
          <select value={chosenTopic?.id ?? ""} onChange={(event) => setDestinationTopic(event.target.value)}>
            {availableDestinations.map((item) => <option key={item.id} value={item.id}>{workspace.pathLabel(item.id)}</option>)}
          </select>{!chosenTopic ? <small>Create a subject and topic first.</small> : null}
        </label> : null}
        {error ? <p className="kc-form-error" role="alert">{error}</p> : null}
        <div className="kc-modal-actions"><button type="button" onClick={() => setComposer(false)}>Cancel</button>
          <button type="submit" disabled={saving || (newKind === "article" && !chosenTopic) || (newKind === "topic" && !(destinationSubject || activeSubject?.id))}>
            {saving ? "Saving…" : newKind === "article" ? "Open editor" : "Create " + newKind} <ArrowRight size={15} /></button></div>
      </form>
    </div> : null}
  </div>;
}
