import { useEffect, useMemo, useRef, useState } from "react";
import { BarChart3, RefreshCw, Table2 } from "lucide-react";
import { loadStudyActivity, meaningfulStudySessions, weekStart, type StudyActivity } from "../../lib/activity";
import { isLesson, RETAINED_STREAK } from "../../lib/knowledgeWorkspace";
import { mistakeJourney, MISTAKE_MILESTONES } from "../../lib/mistakeJourney";
import { languageStack, type LanguageSeries } from "../../lib/progressLanguage";
import { getOfflineSyncState } from "../../lib/offlineFetch";
import { formatDay } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

type Range = 8 | 12 | 26;
type Week = { start: Date; key: string; value: number; segments?: Record<string, number> };
const seriesColor = (index: number) => `var(--ws-chart-series-${index % 5 + 1})`;

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

function WeeklyBars({ title, unit, weeks, note, table, series = [], seriesLabel = "language" }: {
  title: string; unit: string; weeks: Week[]; note?: string; table: boolean;
  series?: LanguageSeries[]; seriesLabel?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = weeks.reduce((sum, week) => sum + week.value, 0);
  const max = niceMax(Math.max(...weeks.map((week) => week.value), 0));
  const [plotRef, width] = useWidth(320);
  const height = 120; const top = 14; const bottom = 22; const plot = height - top - bottom;
  const slot = width / weeks.length;
  const barWidth = Math.min(24, Math.max(4, slot - 2));
  const thisWeek = weekStart(new Date()).getTime();
  // Keep the tooltip centre inside the chart, including the first and last weeks.
  const tooltipLeft = hover === null ? 50 : Math.max(17, Math.min(83, ((hover + 0.5) / weeks.length) * 100));

  return <figure className={`pg-chart ${total === 0 ? "is-empty" : ""}`}>
    <figcaption>
      <span className="pg-chart-title">{title}</span>
      <strong className={`pg-chart-total ${total === 0 ? "is-zero" : ""}`}>{total.toLocaleString()} <small className="pg-total-period">· {weeks.length} wk</small></strong>
      {note ? <small>{note}</small> : null}
    </figcaption>
    {series.length ? <div className="pg-language-legend" aria-label={`${title} ${seriesLabel} legend`}>
      {series.map((item, index) => <span key={item.id}><i style={{ backgroundColor: seriesColor(index) }} aria-hidden="true"/>{item.name}</span>)}
    </div> : null}
    {total === 0 ? <div className="pg-empty-chart" role="status">No activity in this period</div> : table ? <table className="pg-table">
      <thead><tr><th scope="col">Week of</th><th scope="col">{unit}</th>
        {series.map((item) => <th key={item.id} scope="col">{item.name}</th>)}</tr></thead>
      <tbody>{weeks.map((week) => <tr key={week.key}><td>{formatDay(week.start.toISOString())}</td><td>{week.value}</td>
        {series.map((item) => <td key={item.id}>{week.segments?.[item.id] ?? 0}</td>)}</tr>)}</tbody>
    </table> : <div className="pg-plot" ref={plotRef}>
      <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${title}: ${total} in ${weeks.length} weeks${series.length ? `, stacked by ${seriesLabel}` : ""}`}>
        <line x1="0" x2={width} y1={top} y2={top} className="pg-grid" />
        <line x1="0" x2={width} y1={top + plot / 2} y2={top + plot / 2} className="pg-grid" />
        <line x1="0" x2={width} y1={top + plot} y2={top + plot} className="pg-axis" />
        {weeks.map((week, index) => {
          const h = week.value ? Math.max(2, (week.value / max) * plot) : 0;
          const x = index * slot + (slot - barWidth) / 2;
          const y = top + plot - h;
          const r = Math.min(4, h, barWidth / 2);
          const path = h ? `M${x},${top + plot} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + barWidth - r},${y} Q${x + barWidth},${y} ${x + barWidth},${y + r} L${x + barWidth},${top + plot} Z` : "";
          let segmentTop = top + plot;
          const stacked = series.length ? series.map((item, seriesIndex) => {
            const count = week.segments?.[item.id] ?? 0;
            if (!count) return null;
            const segmentHeight = count / max * plot;
            segmentTop -= segmentHeight;
            return <rect key={item.id} className="pg-stack-segment" x={x}
              y={segmentTop} width={barWidth} height={segmentHeight}
              fill={seriesColor(seriesIndex)} rx={1}/>;
          }) : null;
          return <g key={week.key} className={`pg-bar ${hover === index ? "is-hover" : ""}`} tabIndex={0}
            aria-label={`Week of ${formatDay(week.start.toISOString())}: ${week.value} ${unit}`}
            onPointerEnter={() => setHover(index)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(index)} onBlur={() => setHover(null)}>
            <rect x={index * slot} y={top} width={slot} height={plot} fill="transparent" />
            {stacked ?? (path ? <path d={path} /> : null)}
          </g>;
        })}
      </svg>
      <span className="pg-axis-label is-max">{max}</span>
      <div className="pg-xlabels"><span>{formatDay(weeks[0]?.start.toISOString())}</span><span>this week</span></div>
      {hover !== null && weeks[hover] ? <div className="pg-tip" role="tooltip" style={{ left: `${tooltipLeft}%` }}>
        <strong>{weeks[hover].value.toLocaleString()} {unit}</strong>
        <span>{weeks[hover].start.getTime() === thisWeek ? "This week (so far)" : `Week of ${formatDay(weeks[hover].start.toISOString())}`}</span>
        {series.length ? <div className="pg-tip-languages">
          {series.filter((item) => (weeks[hover].segments?.[item.id] ?? 0) > 0).map((item) =>
            <span key={item.id}>{item.name}: <strong>{weeks[hover].segments?.[item.id] ?? 0}</strong></span>)}
        </div> : null}
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
  const [studyLoading, setStudyLoading] = useState(true);
  const [studyRetry, setStudyRetry] = useState(0);
  const [table, setTable] = useState(false);
  const offline = !getOfflineSyncState().online;

  useEffect(() => {
    let alive = true;
    setActivity(null); // Never display results from a different date range.
    setStudyError("");
    setStudyLoading(true);
    void loadStudyActivity(workspace.userId, range * 7, studyRetry ? 0 : 60_000)
      .then((value) => {
        if (alive) { setActivity(value); setStudyLoading(false); }
      })
      .catch((error) => {
        if (alive) { setStudyError(error instanceof Error ? error.message : String(error)); setStudyLoading(false); }
      });
    return () => { alive = false; };
  }, [range, workspace.userId, studyRetry]);

  const weeks = useMemo(() => emptyWeeks(range), [range]);
  const reviews = activity?.reviews ?? [];
  const activeSessions = useMemo(() => meaningfulStudySessions(activity?.sessions ?? [], reviews), [activity, reviews]);
  const goodShare = reviews.length ? Math.round(reviews.filter((event) => event.event_type === "good" || event.event_type === "easy").length / reviews.length * 100) : null;
  const since = weeks[0]?.start.toISOString() ?? "";
  const practice = snapshot.practice.filter((event) => event.created_at >= since);
  const recallShare = practice.length ? Math.round(practice.filter((event) => event.outcome === "correct").length / practice.length * 100) : null;
  const mistakes = snapshot.entries.filter((entry) => entry.kind === "mistake");
  const byTopic = useMemo(() => new Map(snapshot.topics.map((row) => [row.id, row.subject_id])),
    [snapshot.topics]);
  const subjectFor = (topicId: string | undefined) => topicId ? byTopic.get(topicId) ?? null : null;
  const lessonStack = useMemo(() => languageStack(weeks,
    snapshot.entries.filter(isLesson).map((entry) => ({
      at: entry.lesson_date ?? entry.created_at, subjectId: byTopic.get(entry.topic_id),
    })), snapshot.subjects), [weeks, snapshot.entries, snapshot.subjects, byTopic]);
  const noteStack = useMemo(() => languageStack(weeks,
    snapshot.entries.filter((entry) => entry.kind === "note" && !isLesson(entry)).map((entry) => ({
      at: entry.created_at, subjectId: byTopic.get(entry.topic_id),
    })), snapshot.subjects), [weeks, snapshot.entries, snapshot.subjects, byTopic]);
  const recallStack = useMemo(() => languageStack(weeks,
    practice.map((event) => ({
      at: event.created_at,
      subjectId: subjectFor(workspace.entryById.get(event.record_id)?.topic_id),
    })), snapshot.subjects), [weeks, practice, snapshot.subjects, byTopic, workspace.entryById]);
  const retained = mistakes.filter((entry) => entry.recall_streak >= RETAINED_STREAK).length;
  // Build milestone history from every loaded recall (including before the
  // selected interval), otherwise the 3rd-day count would be inaccurate.
  const journey = useMemo(() => mistakeJourney(weeks, mistakes, snapshot.practice),
    [weeks, mistakes, snapshot.practice]);

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

    {!studyLoading && studyError ? <div role="alert" className="ws-inline-warning pg-study-load-state">
      <strong>Study statistics unavailable.</strong>
      <span>{offline ? "Check the connection or load the offline Study copy." : studyError}
        {" "}Other Notebook and recall statistics remain available.</span>
      <button type="button" className="ws-button is-small" onClick={() => setStudyRetry((value) => value + 1)}>
        <RefreshCw size={14}/> Retry Study statistics</button>
    </div> : studyLoading ? <div role="status" className="pg-study-load-state pg-study-loading">
      <span className="ws-spinner is-small" aria-hidden="true"/>
      Loading Study statistics for {range} weeks…
    </div> : null}
    {snapshot.practiceError ? <div role="alert" className="ws-inline-warning">
      Mistake recall history is temporarily unavailable: {snapshot.practiceError}
      <button type="button" className="ws-button is-small" onClick={() => void workspace.reload()}>Retry</button>
    </div> : null}
    <div className="pg-grid">
      {activity && !studyLoading && !studyError ? <>
        <WeeklyBars title="Card reviews in Study" unit="reviews" table={table}
          weeks={bucket(weeks, reviews.map((event) => event.created_at))}
          note={goodShare !== null ? `${goodShare}% answered good or easy` : "Graded answers in flashcard review"} />
        <WeeklyBars title="Study sessions" unit="sessions" table={table}
          weeks={bucket(weeks, activeSessions.map((session) => session.started_at))}
          note="Sessions with a card encounter or a graded review; empty launches excluded" />
      </> : null}
      <WeeklyBars title="Lessons recorded" unit="lessons" table={table} weeks={lessonStack.weeks} series={lessonStack.series}
        note="By lesson date" />
      <WeeklyBars title="Mistake recalls" unit="recalls" table={table} weeks={recallStack.weeks} series={recallStack.series}
        note={snapshot.practiceError ? "Recall history unavailable — not a zero count." : recallShare !== null ? `${recallShare}% produced correctly from memory` : "Produce the correction before seeing it"} />
      <WeeklyBars title="Notes captured" unit="notes" table={table} weeks={noteStack.weeks} series={noteStack.series}
        note="Quick notes and written notes" />
      {!snapshot.practiceError ? <WeeklyBars title="Mistake learning milestones" unit="events"
        table={table} weeks={journey.weeks} series={MISTAKE_MILESTONES} seriesLabel="milestone"
        note="Logged → first successful recall → three different recall days" /> : null}
    </div>

    <div className="pg-columns">
      <section className="ws-panel">
        <div className="ws-panel-head"><h2>Mistake learning milestones</h2></div>
        {snapshot.practiceError ? <p className="ws-muted">
          Recall evidence is unavailable. Retry loading the history to see the milestones.
        </p> : <dl className="pg-evidence">
          <div><dt>Recalled correctly at least once</dt><dd>{journey.firstCorrectCount}</dd></div>
          <div><dt>Reached three different correct recall days <small>historical milestones</small></dt>
            <dd>{journey.achievedThreeDays}</dd></div>
          <div><dt>Currently on a {RETAINED_STREAK}+-day correct streak <small>resets after a miss</small></dt>
            <dd>{retained}</dd></div>
        </dl>}
        <p className="pg-evidence-footnote">Milestones use recorded answers, not self-assessed status labels.
          A missed recall resets the current streak, but does not erase a historical milestone.</p>
      </section>
      <section className="ws-panel">
        <div className="ws-panel-head"><h2>By language</h2></div>
        {bySubject.length ? <table className="pg-subjects">
          <thead><tr><th scope="col">Language</th><th scope="col">Lessons</th><th scope="col">Notes</th><th scope="col">Mistakes</th><th scope="col">Recalls ({range} wk)</th></tr></thead>
          <tbody>{bySubject.map((row) => <tr key={row.subject.id}>
            <th scope="row">{row.subject.name}</th><td>{row.lessons}{row.lessonsInRange ? <small> · {row.lessonsInRange} recent</small> : null}</td><td>{row.notes}</td><td>{row.mistakes}</td>
            <td>{row.recalls ? `${row.correct}/${row.recalls} correct` : "—"}</td>
          </tr>)}</tbody>
        </table> : <p className="ws-muted">Languages appear here once you create them in Notebook.</p>}
      </section>
    </div>
  </div>;
}
