import { useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ChevronDown, ChevronRight, FilePlus2, LibraryBig, Pencil, Search } from "lucide-react";
import { parseReferenceChapters, referenceSummary } from "../../lib/referenceChapters";
import type { KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { isInboxTopic } from "../../lib/lessonCleanup";
import { RichText } from "./RichText";
import { useWorkspace } from "./WorkspaceContext";
import "./reference-library.css";

type Props = {
  onClose: () => void;
  initialWorkId: string | null;
  onCreate: (topicId: string) => void;
  onEdit: (entry: KnowledgeEntry) => void;
};

export function ReferenceLibrary({ onClose, onCreate, onEdit, initialWorkId }: Props) {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const references = useMemo(() => snapshot.entries.filter((entry) => entry.kind === "note" && entry.category === "reference"), [snapshot.entries]);
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [workId, setWorkId] = useState<string | null>(initialWorkId);
  const [chapterIndex, setChapterIndex] = useState<number | null>(null);
  const [destination, setDestination] = useState("");
  const [showSubjectPicker, setShowSubjectPicker] = useState(false);

  const availableTopics = snapshot.topics.filter((topic) => !isInboxTopic(topic));
  const createTopic = availableTopics.find((topic) => topic.id === destination) ?? availableTopics[0] ?? snapshot.topics[0] ?? null;
  const work = references.find((entry) => entry.id === workId) ?? null;
  const chapters = useMemo(() => work ? parseReferenceChapters(work.body) : [], [work]);
  const active = chapterIndex === null ? null : chapters[chapterIndex] ?? null;
  const workSubject = work ? workspace.subjectById.get(workspace.topicById.get(work.topic_id)?.subject_id ?? "") : null;

  const matching = references.filter((entry) => {
    const subject = workspace.topicById.get(entry.topic_id)?.subject_id ?? "";
    if (filter !== "all" && filter !== subject) return false;
    if (!query.trim()) return true;
    const haystack = [entry.title, entry.body, workspace.pathLabel(entry.topic_id)].join(" ").toLocaleLowerCase();
    return haystack.includes(query.trim().toLocaleLowerCase());
  });
  const librarySubjects = snapshot.subjects.filter((subject) =>
    references.some((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === subject.id));

  function showWork(id: string) {
    setWorkId(id);
    setChapterIndex(null);
    window.scrollTo(0, 0);
  }
  function showChapter(index: number) {
    setChapterIndex(index);
    window.scrollTo(0, 0);
  }
  function back() {
    if (chapterIndex !== null) { setChapterIndex(null); window.scrollTo(0, 0); }
    else if (work) { setWorkId(null); window.scrollTo(0, 0); }
    else onClose();
  }
  function create() {
    if (!createTopic) { onClose(); workspace.toast("Create a Notebook topic before adding a reference."); return; }
    onCreate(createTopic.id);
  }

  return <div className="rl" aria-label="Reference library">
    <nav className="rl-crumbs" aria-label="Reference navigation">
      <button type="button" onClick={back} aria-label="Back"><ArrowLeft size={15} /> Back</button>
      <button type="button" onClick={() => { setWorkId(null); setChapterIndex(null); }}>References</button>
      {work ? <><ChevronRight size={13} /><button type="button" onClick={() => setChapterIndex(null)}>{work.title || "Untitled reference"}</button></> : null}
      {active ? <><ChevronRight size={13} /><span>{active.title}</span></> : null}
    </nav>

    {work && active ? <article className="rl-reader">
      <aside className="rl-reader-contents">
        <button type="button" className="rl-work-return" onClick={() => setChapterIndex(null)}>{work.title || "Untitled reference"}</button>
        <p>Contents</p>
        <ol>{chapters.map((chapter, index) =>
          <li key={index}><button className={index === chapterIndex ? "active" : ""} type="button" onClick={() => showChapter(index)}>{chapter.title}</button></li>)}</ol>
      </aside>
      <div className="rl-paper">
        <header className="rl-page-head">
          <span className="rl-eyebrow">{workSubject?.name ?? "Reference"} · Chapter {chapterIndex! + 1}</span>
          <h1>{active.title}</h1>
          <div className="rl-page-rule" />
        </header>
        {active.content ? <RichText text={active.content} className="rl-prose" /> : <p className="rl-empty-copy">This chapter has no text yet. Edit the reference to write it.</p>}
        <div className="rl-page-actions">
          <button type="button" onClick={() => onEdit(work)}><Pencil size={14} /> Edit reference</button>
          <button type="button" onClick={() => setChapterIndex(null)}><BookOpen size={14} /> Contents</button>
        </div>
        <footer className="rl-paging">
          {chapterIndex! > 0 ? <button type="button" onClick={() => showChapter(chapterIndex! - 1)}><ArrowLeft size={14} /><span><small>Previous</small>{chapters[chapterIndex! - 1].title}</span></button> : <span />}
          {chapterIndex! < chapters.length - 1 ? <button type="button" onClick={() => showChapter(chapterIndex! + 1)}><span><small>Next</small>{chapters[chapterIndex! + 1].title}</span><ArrowRight size={14} /></button> : <span />}
        </footer>
      </div>
    </article> : work ? <div className="rl-spread">
      <header className="rl-titlepage">
        <span className="rl-eyebrow">{workSubject?.name ?? "Reference"}</span>
        <h1>{work.title || "Untitled reference"}</h1>
        <p>{referenceSummary(work.body) || "A personal reference work."}</p>
        <div className="rl-title-rule" />
        <button type="button" className="rl-read-start" onClick={() => showChapter(0)}><BookOpen size={16} /> Begin reading <ArrowRight size={15} /></button>
        <button type="button" className="rl-edit-link" onClick={() => onEdit(work)}><Pencil size={14} /> Edit reference</button>
      </header>
      <section className="rl-contents">
        <h2>Contents</h2>
        {chapters.map((chapter, index) => <button key={index} type="button" className="rl-chapter" onClick={() => showChapter(index)}>
          <span>{String(index + 1).padStart(2, "0")}</span><span>{chapter.title}</span><ChevronRight size={16} />
        </button>)}
      </section>
    </div> : <div className="rl-home">
      <header className="rl-home-head">
        <span className="rl-eyebrow"><LibraryBig size={15} /> Notebook · Reference</span>
        <h1>Reference library</h1>
        <p>Your organised knowledge, ready to consult.</p>
      </header>
      <div className="rl-find">
        <label><Search size={17} /><input type="search" placeholder="Find a reference or a chapter" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <button type="button" className="rl-new-toggle" onClick={() => setShowSubjectPicker((open) => !open)}><FilePlus2 size={16} /> New reference <ChevronDown size={14} /></button>
      </div>
      {showSubjectPicker ? <div className="rl-create">
        <label>Save under <select aria-label="Reference location" value={createTopic?.id ?? ""} onChange={(event) => setDestination(event.target.value)}>
          {availableTopics.map((topic) => <option key={topic.id} value={topic.id}>{workspace.pathLabel(topic.id)}</option>)}
          {!availableTopics.length && createTopic ? <option value={createTopic.id}>{workspace.pathLabel(createTopic.id)}</option> : null}
        </select></label>
        <button type="button" className="ws-button is-primary" disabled={!createTopic} onClick={create}>Create</button>
        {!createTopic ? <p>Create a subject and topic in Notebook first.</p> : null}
      </div> : null}
      <div className="rl-home-body">
        <aside className="rl-subjects">
          <button type="button" className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All subjects <span>{references.length}</span></button>
          {librarySubjects.map((subject) => <button type="button" key={subject.id} className={filter === subject.id ? "active" : ""} onClick={() => setFilter(subject.id)}>
            {subject.name}<span>{references.filter((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === subject.id).length}</span>
          </button>)}
        </aside>
        <div className="rl-shelves">
          {matching.length ? librarySubjects.filter((subject) => filter === "all" || filter === subject.id).map((subject) => {
            const works = matching.filter((entry) => workspace.topicById.get(entry.topic_id)?.subject_id === subject.id).sort((a, b) => a.title.localeCompare(b.title));
            return works.length ? <section className="rl-shelf" key={subject.id}>
              <h2>{subject.name}</h2>
              <div className="rl-works">{works.map((entry) => {
                const count = parseReferenceChapters(entry.body).length;
                return <button type="button" className="rl-work" key={entry.id} onClick={() => showWork(entry.id)}>
                  <span className="rl-spine" aria-hidden="true" />
                  <span className="rl-work-copy"><strong>{entry.title || "Untitled reference"}</strong>
                    <span>{workspace.pathLabel(entry.topic_id)}</span>
                    <small>{count} {count === 1 ? "chapter" : "chapters"}</small>
                  </span>
                </button>;
              })}</div>
            </section> : null;
          }) : <div className="rl-empty">
            <BookOpen size={26} />
            <h2>{query ? "No matching references" : "A shelf for knowledge worth keeping"}</h2>
            <p>{query ? "Try another search." : "Create a reference in a Notebook topic. Use Heading 2 for each chapter; it becomes an ordered table of contents automatically."}</p>
            {!query && !showSubjectPicker ? <button className="ws-button is-primary" onClick={() => setShowSubjectPicker(true)}>New reference</button> : null}
          </div>}
        </div>
      </div>
    </div>}
  </div>;
}
