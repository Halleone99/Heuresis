import { useEffect, useMemo, useState } from "react";
import { ArrowRight, BookOpen, ChevronRight, CircleHelp, GraduationCap, NotebookPen, Pin, Radio, RotateCcw, Target, TriangleAlert } from "lucide-react";
import {
  entryPreview, entryTitle, isDocument, isLesson, isOpenQuestion, isRecallDue, mistakeStage, normaliseSearch,
  type KnowledgeEntry,
} from "../../lib/knowledgeWorkspace";
import { loadLastStudySession, type StudySession } from "../../lib/activity";
import { KindIcon, Kbd, MOD_KEY, formatDay, formatLongDay, relativeTime } from "./ui";
import { usePersonalOsCaptures, usePersonalOsObjectives } from "./usePersonalOs";
import { useWorkspace } from "./WorkspaceContext";

const SESSION_MODE_LABELS: Record<string, string> = { sort: "sorting", review: "review", browse: "browsing", related: "connections" };

export type StudySummary = { cards: number; collections: number; topics: number };

export function OverviewView({ study, onOpenStudy }: { study: StudySummary; onOpenStudy: () => void }) {
  const workspace = useWorkspace();
  const { snapshot, memory, currentLesson } = workspace;
  const { objectives } = usePersonalOsObjectives(workspace.userId);
  const legacy = usePersonalOsCaptures(workspace.userId);
  const [subjectFilter, setSubjectFilter] = useState<string | null>(null);
  const [lastSession, setLastSession] = useState<StudySession | null>(null);

  useEffect(() => {
    let alive = true;
    void loadLastStudySession(workspace.userId).then((row) => { if (alive) setLastSession(row); }).catch(() => undefined);
    return () => { alive = false; };
  }, [workspace.userId]);

  const subjects = [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name));
  const filterId = subjectFilter && workspace.subjectById.has(subjectFilter) ? subjectFilter : null;
  const inScope = (entry: KnowledgeEntry) => !filterId || workspace.topicById.get(entry.topic_id)?.subject_id === filterId;
  const entries = snapshot.entries.filter(inScope);
  const docs = entries.filter(isDocument);
  const lessons = docs.filter(isLesson).sort((a, b) => (b.lesson_date ?? b.created_at).localeCompare(a.lesson_date ?? a.created_at)).slice(0, 4);
  const questions = docs.filter(isOpenQuestion).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const pinned = docs.filter((entry) => entry.pinned).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 6);
  const mistakes = entries.filter((entry) => entry.kind === "mistake");
  const due = mistakes.filter((entry) => isRecallDue(entry));
  const toCorrect = mistakes.filter((entry) => mistakeStage(entry) === "to_correct");
  const lastDoc = memory.recentDocs.map((id) => workspace.entryById.get(id)).find((entry): entry is KnowledgeEntry => Boolean(entry && isDocument(entry) && inScope(entry)));
  const recentEdits = docs.filter((entry) => entry.id !== lastDoc?.id && !entry.pinned).sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4);

  const subjectName = filterId ? workspace.subjectById.get(filterId)?.name ?? "" : "";
  const goals = useMemo(() => {
    const list = objectives?.objectives.filter((goal) => goal.status === "active") ?? [];
    return list.map((goal) => ({ goal, language: objectives?.languages.find((language) => language.id === goal.languageId)?.name ?? "Language" }))
      .filter((row) => !subjectName || normaliseSearch(row.language) === normaliseSearch(subjectName));
  }, [objectives, subjectName]);
  const legacyInScope = legacy.filter((item) => !subjectName || normaliseSearch(item.subject ?? "") === normaliseSearch(subjectName));

  const empty = !snapshot.entries.length && !snapshot.subjects.length;

  return <div className="ov-page">
    <header className="ws-page-head">
      <div>
        <span className="ws-eyebrow">{formatLongDay(new Date().toISOString())}</span>
        <h1>Overview</h1>
      </div>
      <div className="ws-page-actions">
        {workspace.writable ? <>
          <button type="button" className="ws-button is-primary" onClick={() => workspace.openCapture({ mode: "lesson" })} title={`${MOD_KEY}+Shift+L`}><GraduationCap size={15} /> Start a lesson</button>
        </> : null}
      </div>
    </header>

    {subjects.length > 1 ? <div className="ws-chips ov-subjects" role="group" aria-label="Subject">
      <button type="button" className={!filterId ? "is-active" : ""} onClick={() => setSubjectFilter(null)}>All</button>
      {subjects.map((subject) => <button type="button" key={subject.id} className={filterId === subject.id ? "is-active" : ""} onClick={() => setSubjectFilter(subject.id)}>{subject.name}</button>)}
    </div> : null}

    {empty ? <section className="ov-welcome">
      <h2>Capture first. Organise afterwards.</h2>
      <p>During a lesson, press <Kbd>{MOD_KEY} ⇧ N</Kbd> to note a sentence or question, <Kbd>{MOD_KEY} ⇧ M</Kbd> for a mistake, and <Kbd>{MOD_KEY} ⇧ L</Kbd> to start a lesson page that collects them. Everything lands in the Notebook, ready to be clarified, organised and practised.</p>
      <div className="ws-empty-actions">
        <button type="button" className="ws-button is-primary" onClick={() => workspace.goTo("notebook")}><NotebookPen size={15} /> Set up the Notebook</button>
        <button type="button" className="ws-button" onClick={onOpenStudy}><BookOpen size={15} /> Go to Study</button>
      </div>
    </section> : null}

    <div className="ov-grid">
      <div className="ov-col">
        {currentLesson && (!filterId || workspace.topicById.get(currentLesson.topic_id)?.subject_id === filterId) ? <section className="ov-continue is-live">
          <span className="ws-eyebrow"><Radio size={12} /> Lesson in progress</span>
          <button type="button" className="ov-continue-main" onClick={() => workspace.openDocument(currentLesson.id)}>
            <strong>{entryTitle(currentLesson)}</strong>
            <span>{workspace.pathLabel(currentLesson.topic_id)} · {snapshot.entries.filter((row) => row.lesson_id === currentLesson.id).length} captured</span>
          </button>
          <div className="ov-continue-actions">
            <button type="button" className="ws-button is-small is-primary" onClick={() => workspace.openDocument(currentLesson.id)}>Open lesson <ArrowRight size={13} /></button>
            <button type="button" className="ws-button is-small is-quiet" onClick={() => workspace.endLesson()}>End lesson</button>
          </div>
        </section> : lastDoc ? <section className="ov-continue">
          <span className="ws-eyebrow">Pick up where you left off</span>
          <button type="button" className="ov-continue-main" onClick={() => workspace.openDocument(lastDoc.id)}>
            <strong>{entryTitle(lastDoc)}</strong>
            <span>{workspace.pathLabel(lastDoc.topic_id)} · edited {relativeTime(lastDoc.updated_at)}</span>
            {entryPreview(lastDoc, 220) ? <p>{entryPreview(lastDoc, 220)}</p> : null}
          </button>
        </section> : null}

        {lessons.length ? <section className="ws-panel">
          <div className="ws-panel-head"><h2><GraduationCap size={16} /> Recent lessons</h2>
            <button type="button" className="nb-link-button" onClick={() => workspace.goTo("notebook")}>Notebook →</button></div>
          <ul className="ov-list">{lessons.map((lesson) => {
            const captured = snapshot.entries.filter((row) => row.lesson_id === lesson.id);
            return <li key={lesson.id}><button type="button" onClick={() => workspace.openDocument(lesson.id)}>
              <span className="ov-date">{formatDay(lesson.lesson_date ?? lesson.created_at)}</span>
              <span className="ov-list-main"><strong>{entryTitle(lesson)}</strong><small>{workspace.pathLabel(lesson.topic_id)}</small></span>
              <span className="ov-list-meta">{captured.length ? `${captured.length} captured` : ""}</span>
            </button></li>;
          })}</ul>
        </section> : <div className="ov-empty-line">
          <GraduationCap size={15} aria-hidden="true"/>
          <span>Recent lessons</span><small>None yet</small>
          {workspace.writable ? <button type="button" className="nb-link-button" onClick={() => workspace.openCapture({ mode: "lesson" })}>Start →</button> : null}
        </div>}

        {questions.length ? <section className="ws-panel">
          <div className="ws-panel-head"><h2><CircleHelp size={16} /> Questions to clarify</h2>
            <span className="ws-count">{questions.length}</span></div>
          <ul className="ov-list">{questions.slice(0, 5).map((entry) => <li key={entry.id}>
            <button type="button" onClick={() => workspace.openDocument(entry.id)}>
              <span className="ov-list-main"><strong>{entryTitle(entry)}</strong><small>{workspace.pathLabel(entry.topic_id)} · {relativeTime(entry.created_at)}</small></span>
            </button>
          </li>)}</ul>
        </section> : <div className="ov-empty-line">
          <CircleHelp size={15} aria-hidden="true"/>
          <span>Questions to clarify</span><small>Nothing pending</small>
        </div>}

        {recentEdits.length ? <section className="ws-panel">
          <div className="ws-panel-head"><h2><NotebookPen size={16} /> Recently edited</h2></div>
          <ul className="ov-list">{recentEdits.map((entry) => <li key={entry.id}><button type="button" onClick={() => workspace.openDocument(entry.id)}>
            <span className="ov-icon"><KindIcon entry={entry} size={14} /></span>
            <span className="ov-list-main"><strong>{entryTitle(entry)}</strong><small>{workspace.pathLabel(entry.topic_id)}</small></span>
            <span className="ov-list-meta">{relativeTime(entry.updated_at)}</span>
          </button></li>)}</ul>
        </section> : null}
      </div>

      <div className="ov-col">
        <section className="ws-panel">
          <div className="ws-panel-head"><h2><TriangleAlert size={16} /> Mistakes</h2>
            <button type="button" className="nb-link-button" onClick={() => workspace.goTo("mistakes")}>Mistake Log →</button></div>
          {mistakes.length ? <>
            <div className="ov-figures">
              <div><strong>{due.length}</strong><span>due for recall</span></div>
              <div><strong>{toCorrect.length}</strong><span>need a correction</span></div>
              <div><strong>{mistakes.filter((entry) => mistakeStage(entry) === "practising").length}</strong><span>in review</span></div>
            </div>
            {due.length ? <button type="button" className="ws-button is-primary is-block" onClick={() => workspace.openMistake(due[0].id, { practise: true, ids: due.map((entry) => entry.id) })}>
              <RotateCcw size={14} /> {due.length === 1 ? "Practise the due mistake" : `Practise ${due.length} due mistakes`}</button> : null}
            {toCorrect.slice(0, 3).map((entry) => <button type="button" key={entry.id} className="ov-mistake" onClick={() => workspace.openMistake(entry.id)}>
              <span>{entry.attempt}</span><small>add the correct form →</small></button>)}
          </> : <p className="ws-muted">Record a mistake with <Kbd>{MOD_KEY} ⇧ M</Kbd>: what you said, then the correction — now or later.</p>}
        </section>

        {pinned.length ? <section className="ws-panel">
          <div className="ws-panel-head"><h2><Pin size={16} /> Pinned</h2></div>
          <ul className="ov-list">{pinned.map((entry) => <li key={entry.id}><button type="button" onClick={() => workspace.openDocument(entry.id)}>
            <span className="ov-icon"><KindIcon entry={entry} size={14} /></span>
            <span className="ov-list-main"><strong>{entryTitle(entry)}</strong><small>{workspace.pathLabel(entry.topic_id)}</small></span>
          </button></li>)}</ul>
        </section> : null}

        <section className="ws-panel">
          <div className="ws-panel-head"><h2><Target size={16} /> Objectives</h2><span className="ws-muted ws-tiny" title="Objectives are displayed from Personal OS and cannot be edited here." aria-label="Objectives information">ⓘ</span></div>
          {goals.length ? <ul className="ov-goals">{goals.slice(0, 6).map(({ goal, language }) => {
            const done = goal.kind === "counted" ? goal.current : goal.steps.filter((step) => step.done).length;
            const total = goal.kind === "counted" ? goal.target : goal.steps.length;
            const share = total > 0 ? Math.min(1, done / total) : 0;
            return <li key={goal.id}>
              <div className="ov-goal-line"><span><small>{language}</small>{goal.title}</span>
                <b>{goal.kind === "counted" ? `${done.toLocaleString()} / ${total.toLocaleString()} ${goal.unit}` : `${done} / ${total} steps`}</b></div>
              <div className="ov-meter" role="meter" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done} aria-label={goal.title}><span style={{ width: `${share * 100}%` }} /></div>
              {goal.kind === "stepped" ? <small className="ws-muted">Next: {goal.steps.find((step) => !step.done)?.label ?? "all steps done"}</small> : null}
            </li>;
          })}</ul> : <p className="ws-muted">{objectives ? "No active objectives for this selection." : "Objectives from Personal OS appear here when available."}</p>}
        </section>

        <section className="ws-panel">
          <div className="ws-panel-head"><h2><BookOpen size={16} /> Study</h2>
            <button type="button" className="nb-link-button" onClick={onOpenStudy}>Open Study →</button></div>
          <p className="ov-study-line">{study.cards.toLocaleString()} cards in {study.topics} {study.topics === 1 ? "topic" : "topics"} across {study.collections} {study.collections === 1 ? "collection" : "collections"}.</p>
          <p className="ws-muted">{lastSession ? `Last studied ${relativeTime(lastSession.started_at)} · ${SESSION_MODE_LABELS[lastSession.mode] ?? lastSession.mode}${lastSession.cards_encountered ? `, ${lastSession.cards_encountered} cards` : ""}.` : "No study session recorded yet."}</p>
        </section>
      </div>
    </div>

    {legacyInScope.length ? <details className="ov-legacy">
      <summary title="Read-only earlier captures from Personal OS. These are not unsynchronised Heuresis changes.">
        <span>{legacyInScope.length} earlier {legacyInScope.length === 1 ? "capture" : "captures"} in Personal OS</span>
        <ChevronRight size={13} className="ov-legacy-chevron" aria-hidden="true"/>
      </summary>
      <ul>{legacyInScope.slice(0, 30).map((item) => <li key={item.id}>
        <span className="ws-muted ws-tiny">{item.subject ?? "Language"} · {formatDay(item.created_at)} · {item.entry_type}</span>
        <strong>{item.front}</strong>{item.back ? <span>{item.back}</span> : null}{item.third_side ? <small>{item.third_side}</small> : null}
      </li>)}</ul>
    </details> : null}
  </div>;
}
