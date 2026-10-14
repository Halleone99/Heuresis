import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, Table2 } from "lucide-react";
import { loadStudyActivity, meaningfulStudySessions, weekStart, type StudyActivity } from "../../lib/activity";
import { isLesson, mistakeStage, RETAINED_STREAK, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { getOfflineSyncState } from "../../lib/offlineFetch";
import { formatDay } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

type Range = 8 | 12 | 26;
type Week = { start: Date; key: string; value: number };

function emptyWeeks(count: number): Week[] {
  const current = weekStart(new Date());
  return Array.from({ length: count }, (_, index) => {
    const start = new Date(current);
    start.setDate(start.getDate() - (count - 1 - index) * 7);
    return { start, key: start.toISOString(), value: 0 };
  });
}
function bucket(weeks: Week[], dates: Array<string | null | undefined>) {
  const result = weeks.map((week) => ({ ...week }));
  const first = result[0]?.start.getTime() ?? 0;
  for (const value of dates) {
    if (!value) continue;
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T12:00:00`) : new Date(value);
    const time = date.getTime();
    if (!Number.isFinite(time) || time < first) continue;
    const index = Math.floor((weekStart(date).getTime() - first) / (7 * 86400000) + 0.01);
    if (index >= 0 && index < result.length) result[index].value += 1;
  }
  return result;
}
function niceMax(value: number) {
  if (value <= 4) return Math.max(1, value);
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const steps = [1, 2, 2.5, 5, 10];
  return steps.map((step) => step * magnitude).find((candidate) => candidate >= value) ?? value;
}

function useWidth(fallback: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(120, Math.round(entry.contentRect.width))));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

function WeeklyBars({ title, unit, weeks, note, table }: { title: string; unit: string; weeks: Week[]; note?: string; table: boolean }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = weeks.reduce((sum, week) => sum + week.value, 0);
  const max = niceMax(Math.max(...weeks.map((week) => week.value), 0));
  const [plotRef, width] = useWidth(320);
  const height = 120; const top = 14; const bottom = 22; const plot = height - top - bottom;
  const slot = width / weeks.length;
  const barWidth = Math.min(24, Math.max(4, slot - 2));
  const thisWeek = weekStart(new Date()).getTime();

  return <figure className="pg-chart">
    <figcaption>
      <span className="pg-chart-title">{title}</span>
      <strong className="pg-chart-total">{total.toLocaleString()}</strong>
      {note ? <small>{note}</small> : null}
    </figcaption>
    {table ? <table className="pg-table">
      <thead><tr><th scope="col">Week of</th><th scope="col">{unit}</th></tr></thead>
      <tbody>{weeks.map((week) => <tr key={week.key}><td>{formatDay(week.start.toISOString())}</td><td>{week.value}</td></tr>)}</tbody>
    </table> : <div className="pg-plot" ref={plotRef}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${total} in ${weeks.length} weeks`}>
        <line x1="0" x2={width} y1={top} y2={top} className="pg-grid" />
        <line x1="0" x2={width} y1={top + plot / 2} y2={top + plot / 2} className="pg-grid" />
        <line x1="0" x2={width} y1={top + plot} y2={top + plot} className="pg-axis" />
        {weeks.map((week, index) => {
          const h = week.value ? Math.max(2, (week.value / max) * plot) : 0;
          const x = index * slot + (slot - barWidth) / 2;
          const y = top + plot - h;
          const r = Math.min(4, h, barWidth / 2);
          const path = h ? `M${x},${top + plot} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barWidth - r},${y} Q${x + barWidth},${y} ${x + barWidth},${y + r} L${x + barWidth},${top + plot} Z` : "";
          return <g key={week.key} className={`pg-bar ${hover === index ? "is-hover" : ""}`} tabIndex={0}
            aria-label={`Week of ${formatDay(week.start.toISOString())}: ${week.value} ${unit}`}
            onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}>
            <rect x={index * slot} y={top} width={slot} height={plot} fill="transparent" />
            {path ? <path d={path} /> : null}
          </g>;
        })}
      </svg>
      <span className="pg-axis-label is-max">{max}</span>
      <div className="pg-xlabels"><span>{formatDay(weeks[0]?.start.toISOString())}</span><span>this week</span></div>
      {hover !== null && weeks[hover] ? <div className="pg-tip" style={{ left: `${((hover + 0.5) / weeks.length) * 100}%` }}>
        <strong>{weeks[hover].value.toLocaleString()} {unit}</strong>
        <span>{weeks[hover].start.getTime() === thisWeek ? "This week (so far)" : `Week of ${formatDay(weeks[hover].start.toISOString())}`}</span>
      </div> : null}
    </div>}
  </figure>;
}

export function ProgressView() {
  const workspace = useWorkspace();
  const { snapshot } = workspace;
  const [range, setRange] = useState<Range>(12);
  const [activity, setActivity] = useState<StudyActivity | null>(null);
  const [studyError, setStudyError] = useState("");
  const [table, setTable] = useState(false);
  const offline = !getOfflineSyncState().online;

  useEffect(() => {
    let alive = true;
    setStudyError("");
    void loadStudyActivity(workspace.userId, range * 7).then((value) => { if (alive) setActivity(value); })
      .catch((error) => { if (alive) setStudyError(error instanceof Error ? error.message : String(error)); });
    return () => { alive = false; };
  }, [range, workspace.userId]);

  const weeks = useMemo(() => emptyWeeks(range), [range]);
  const reviews = activity?.reviews ?? [];
  const activeSessions = useMemo(() => meaningfulStudySessions(activity?.sessions ?? [], reviews), [activity, reviews]);
  const goodShare = reviews.length ? Math.round(reviews.filter((event) => event.event_type === "good" || event.event_type === "easy").length / reviews.length * 100) : null;
  const lessons = snapshot.entries.filter(isLesson);
  const notes = snapshot.entries.filter((entry) => entry.kind === "note" && !isLesson(entry));
  const since = weeks[0]?.start.toISOString() ?? "";
  const practice = snapshot.practice.filter((event) => event.created_at >= since);
  const recallShare = practice.length ? Math.round(practice.filter((event) => event.outcome === "correct").length / practice.length * 100) : null;
  const mistakes = snapshot.entries.filter((entry) => entry.kind === "mistake");
  const retained = mistakes.filter((entry) => entry.recall_streak >= RETAINED_STREAK).length;

  const bySubject = useMemo(() => [...snapshot.subjects].sort((a, b) => a.name.localeCompare(b.name)).map((subject) => {
    const topicIds = new Set(snapshot.topics.filter((topic) => topic.subject_id === subject.id).map((topic) => topic.id));
    const rows = snapshot.entries.filter((entry) => topicIds.has(entry.topic_id));
    const ids = new Set(rows.map((entry) => entry.id));
    const events = practice.filter((event) => ids.has(event.record_id));
    return {
      subject, lessons: rows.filter(isLesson).length, notes: rows.filter((entry) => entry.kind === "note" && !isLesson(entry)).length,
      mistakes: rows.filter((entry) => entry.kind === "mistake").length,
      recalls: events.length, correct: events.filter((event) => event.outcome === "correct").length,
      lessonsInRange: rows.filter((entry) => isLesson(entry) && (entry.lesson_date ?? entry.created_at) >= since.slice(0, 10)).length,
    };
  }), [practice, since, snapshot.entries, snapshot.subjects, snapshot.topics]);

  const stageCount = (stage: ReturnType<typeof mistakeStage>) => mistakes.filter((entry: KnowledgeEntry) => mistakeStage(entry) === stage).length;

  return <div className="pg-page">
    <header className="ws-page-head">
      <div>
        <span className="ws-eyebrow">Learning activity</span>
        <h1>Progress</h1>
        <p className="ws-page-sub">Your lessons, reviews and recall over time.</p>
      </div>
      <div className="ws-page-actions">
        <div className="ws-segmented" role="tablist" aria-label="Period">
          {([8, 12, 26] as Range[]).map((value) => <button type="button" role="tab" key={value} aria-selected={range === value} className={range === value ? "is-active" : ""} onClick={() => setRange(value)}>{value} weeks</button>)}
        </div>
        <button type="button" className={`ws-icon-button ${table ? "is-on" : ""}`} aria-pressed={table} title={table ? "Show charts" : "Show as tables"} onClick={() => setTable((value) => !value)}>{table ? <BarChart3 size={16} /> : <Table2 size={16} />}</button>
      </div>
    </header>

    {snapshot.practiceError ? <div role="alert" className="ws-inline-warning">
      Mistake recall history is temporarily unavailable: {snapshot.practiceError}
      <button type="button" className="ws-button is-small" onClick={() => void workspace.reload()}>Retry</button>
    </div> : null}
    <div className="pg-grid">
      <WeeklyBars title="Card reviews in Study" unit="reviews" table={table} weeks={bucket(weeks, reviews.map((event) => event.created_at))}
        note={studyError ? "Study activity could not be loaded." : offline && !activity ? "Needs a connection." : goodShare !== null ? `${goodShare}% answered good or easy` : "Graded answers in flashcard review"} />
      <WeeklyBars title="Study sessions" unit="sessions" table={table} weeks={bucket(weeks, activeSessions.map((session) => session.started_at))}
        note={studyError ? "Study session data could not be loaded." : "Sessions with a card encounter or a graded review; empty launches excluded"} />
      <WeeklyBars title="Lessons recorded" unit="lessons" table={table} weeks={bucket(weeks, lessons.map((entry) => entry.lesson_date ?? entry.created_at))}
        note="By lesson date" />
      <WeeklyBars title="Mistake recalls" unit="recalls" table={table} weeks={bucket(weeks, practice.map((event) => event.created_at))}
        note={snapshot.practiceError ? "Recall history unavailable — not a zero count." : recallShare !== null ? `${recallShare}% produced correctly from memory` : "Produce the correction before seeing it"} />
      <WeeklyBars title="Notes captured" unit="notes" table={table} weeks={bucket(weeks, notes.map((entry) => entry.created_at))}
        note="Quick notes and written notes" />
    </div>

    <div className="pg-columns">
      <section className="ws-panel">
        <div className="ws-panel-head"><h2>Mistakes — what the evidence says</h2></div>
        <dl className="pg-evidence">
          <div><dt>Need a correction</dt><dd>{stageCount("to_correct")}</dd></div>
          <div><dt>In review</dt><dd>{stageCount("practising")}</dd></div>
          <div><dt>Marked “I understand” <small>self-assessed</small></dt><dd>{stageCount("understood")}</dd></div>
          <div><dt>Recalled correctly on {RETAINED_STREAK}+ separate days</dt><dd>{retained}</dd></div>
        </dl>
      </section>
      <section className="ws-panel">
        <div className="ws-panel-head"><h2>By subject</h2></div>
        {bySubject.length ? <table className="pg-subjects">
          <thead><tr><th scope="col">Subject</th><th scope="col">Lessons</th><th scope="col">Notes</th><th scope="col">Mistakes</th><th scope="col">Recalls ({range} wk)</th></tr></thead>
          <tbody>{bySubject.map((row) => <tr key={row.subject.id}>
            <th scope="row">{row.subject.name}</th><td>{row.lessons}{row.lessonsInRange ? <small> · {row.lessonsInRange} recent</small> : null}</td><td>{row.notes}</td><td>{row.mistakes}</td>
            <td>{row.recalls ? `${row.correct}/${row.recalls} correct` : "—"}</td>
          </tr>)}</tbody>
        </table> : <p className="ws-muted">Subjects appear here once you create them in the Notebook.</p>}
      </section>
    </div>
  </div>;
}
