import { useMemo, useState } from "react";
import { ArrowRight, BookOpen, LibraryBig, NotebookPen, Quote, TriangleAlert } from "lucide-react";
import { entryTitle } from "../../lib/knowledgeWorkspace";
import { KindIcon } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

/**
 * Heuresis is a library of knowledge worth keeping, not an activity tracker.
 * Dates are used privately to find recently edited material, never as a score.
 */
export function OverviewView({ onOpenStudy }: { onOpenStudy: () => void }) {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const [filter, setFilter] = useState<string | null>(null);
  const subjects = useMemo(
    () => [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name)),
    [snapshot.subjects],
  );
  const selected = filter && subjects.some((subject) => subject.id === filter) ? filter : null;
  const currentLabel = subjects.find((subject) => subject.id === selected)?.name ?? "";
  const notes = useMemo(() => snapshot.entries
    .filter((entry) => entry.kind === "note" && entry.category !== "reference" &&
      (!selected || workspace.topicById.get(entry.topic_id)?.subject_id === selected))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 5), [snapshot.entries, selected, workspace.topicById]);

  function openSubject(subjectId: string) {
    // Going to Notebook resets its location. Select the subject afterwards.
    workspace.goTo("notebook");
    workspace.updateMemory((current) => ({
      ...current,
      notebook: { ...current.notebook, subjectId, topicId: null, docId: null },
    }));
  }

  return <div className="ov-page ov-simple ov-library">
    <header className="ws-page-head">
      <div>
        <span className="ws-eyebrow">PERSONAL KNOWLEDGE LIBRARY</span>
        <h1>Overview</h1>
        <p className="ov-library-intro">Ideas, words and discoveries worth keeping — ready whenever you want to return to them.</p>
      </div>
    </header>

    {subjects.length ? <nav className="ws-chips ov-subjects" aria-label="Filter notes by subject">
      <button type="button" className={!selected ? "is-active" : ""} aria-pressed={!selected} onClick={() => setFilter(null)}>All</button>
      {subjects.map((subject) => <button type="button" key={subject.id} className={selected === subject.id ? "is-active" : ""} aria-pressed={selected === subject.id} onClick={() => setFilter(subject.id)}>{subject.name}</button>)}
    </nav> : null}

    <div className="ov-simple-grid">
      <section className="ws-panel">
        <div className="ws-panel-head">
          <h2><NotebookPen size={16}/> Notes to revisit{currentLabel ? " · " + currentLabel : ""}</h2>
          <button type="button" className="nb-link-button" onClick={() => workspace.goTo("notebook")}>Open Notebook <ArrowRight size={14}/></button>
        </div>
        {notes.length ? <ul className="ov-list ov-library-notes">{notes.map((entry) =>
          <li key={entry.id}><button type="button" onClick={() => workspace.openDocument(entry.id)}>
            <span className="ov-icon"><KindIcon entry={entry} size={14}/></span>
            <span className="ov-list-main">
              <strong>{entryTitle(entry)}</strong>
              <small>{workspace.pathLabel(entry.topic_id)}</small>
              {entry.description.trim() ? <span className="ov-library-preview">{entry.description}</span> : null}
            </span>
            <ArrowRight size={14} aria-hidden="true"/>
          </button></li>
        )}</ul> : <div className="ov-library-empty">
          <p>{selected ? "No saved notes in this subject yet." : "Your saved notes will appear here as your library grows."}</p>
          <button type="button" className="nb-link-button" onClick={() => workspace.goTo("notebook")}>Explore the Notebook <ArrowRight size={14}/></button>
        </div>}
      </section>

      <div className="ov-simple-side">
        <section className="ws-panel">
          <div className="ws-panel-head"><h2><LibraryBig size={16}/> Browse subjects</h2></div>
          {subjects.length ? <div className="ov-library-subjects">{subjects.map((subject) =>
            <button type="button" key={subject.id} onClick={() => openSubject(subject.id)}>
              <span>{subject.name}</span><ArrowRight size={14} aria-hidden="true"/>
            </button>)}</div>
            : <p className="ws-muted">Start with a subject in your Notebook, then add ideas and notes beneath it.</p>}
        </section>
        <section className="ws-panel ov-quicklinks" aria-label="Explore your library">
          <button type="button" onClick={() => workspace.goTo("reading")}><BookOpen size={17}/><span><strong>Reading</strong><small>Books, reflections and passages</small></span><ArrowRight size={16}/></button>
          <button type="button" onClick={() => workspace.goTo("quotations")}><Quote size={17}/><span><strong>Quotations</strong><small>Words worth remembering</small></span><ArrowRight size={16}/></button>
          <button type="button" onClick={onOpenStudy}><LibraryBig size={17}/><span><strong>Study library</strong><small>Flashcards and discoveries</small></span><ArrowRight size={16}/></button>
          <button type="button" onClick={() => workspace.goTo("mistakes")}><TriangleAlert size={17}/><span><strong>Mistake Log</strong><small>Corrections and lessons learnt</small></span><ArrowRight size={16}/></button>
        </section>
      </div>
    </div>
  </div>;
}
