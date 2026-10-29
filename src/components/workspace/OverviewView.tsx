import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { loadStudyActivity, weekStart, type ReviewEvent, type StudyActivity } from "../../lib/activity";
import type { Collection, PackWithType } from "../../lib/heuresis";
import { useWorkspace } from "./WorkspaceContext";
import "./overview-heatmap.css";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  studyLoading: boolean;
  studyError: string;
  onOpenTopic: (pack: PackWithType) => void;
};

const dayKey = (date: Date) =>
  [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");

const level = (count: number) =>
  count === 0 ? "0" : count === 1 ? "1" : count <= 3 ? "2" : count <= 7 ? "3" : "4";

type Summary = {
  cards: number;
  answers: number;
  activeDays: number;
  days: Map<string, number>;
  weeks: Map<string, number>;
};

function summarise(reviews: ReviewEvent[]): Summary {
  const distinct = new Set<string>();
  const byDay = new Map<string, Set<string>>();
  const byWeek = new Map<string, Set<string>>();
  for (const review of reviews) {
    if (!review.card_id) continue;
    const date = new Date(review.created_at);
    if (!Number.isFinite(date.getTime())) continue;
    const day = dayKey(date);
    const week = dayKey(weekStart(date));
    distinct.add(review.card_id);
    if (!byDay.has(day)) byDay.set(day, new Set());
    if (!byWeek.has(week)) byWeek.set(week, new Set());
    byDay.get(day)!.add(review.card_id);
    byWeek.get(week)!.add(review.card_id);
  }
  return {
    cards: distinct.size,
    answers: reviews.length,
    activeDays: byDay.size,
    days: new Map([...byDay].map(([day, cards]) => [day, cards.size])),
    weeks: new Map([...byWeek].map(([week, cards]) => [week, cards.size])),
  };
}

export function OverviewView({ collections, packs, studyLoading, studyError, onOpenTopic }: Props) {
  const { userId } = useWorkspace();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<StudyActivity | null>(null);
  const [activityError, setActivityError] = useState("");
  const [activityLoading, setActivityLoading] = useState(true);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let alive = true;
    setActivityLoading(true);
    setActivityError("");
    setActivity(null);
    void loadStudyActivity(userId, 190, 0)
      .then((result) => { if (alive) setActivity(result); })
      .catch((error) => { if (alive) setActivityError(error instanceof Error ? error.message : "Study history is unavailable."); })
      .finally(() => { if (alive) setActivityLoading(false); });
    return () => { alive = false; };
  }, [userId, retry]);

  const calendar = useMemo(() => {
    const start = weekStart(new Date());
    start.setDate(start.getDate() - 25 * 7);
    const today = dayKey(new Date());
    const weeks = Array.from({ length: 26 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index * 7);
      const previous = new Date(date);
      previous.setDate(previous.getDate() - 7);
      return {
        key: dayKey(date),
        label: index === 0 || date.getMonth() !== previous.getMonth()
          ? date.toLocaleDateString("en-GB", { month: "short" }) : "",
      };
    });
    const days = Array.from({ length: 26 * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      const key = dayKey(date);
      return { key, future: key > today, label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) };
    });
    return { weeks, days, first: days[0].key, today };
  }, []);

  const packById = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);
  const selected = selectedId && packById.has(selectedId) ? selectedId : null;
  const reviews = useMemo(() => (activity?.reviews ?? []).filter((review) => {
    if (!packById.has(review.pack_id) || !review.card_id) return false;
    const time = new Date(review.created_at);
    if (!Number.isFinite(time.getTime())) return false;
    const key = dayKey(time);
    return key >= calendar.first && key <= calendar.today;
  }), [activity, packById, calendar.first, calendar.today]);

  const byPack = useMemo(() => {
    const grouped = new Map<string, ReviewEvent[]>();
    for (const review of reviews) {
      const current = grouped.get(review.pack_id) ?? [];
      current.push(review);
      grouped.set(review.pack_id, current);
    }
    return new Map(packs.map((pack) => [pack.id, summarise(grouped.get(pack.id) ?? [])]));
  }, [packs, reviews]);
  const summary = useMemo(
    () => summarise(selected ? reviews.filter((review) => review.pack_id === selected) : reviews),
    [reviews, selected],
  );
  const selectedTitle = selected ? packById.get(selected)?.title ?? "Selected topic" : "All Study topics";
  const groups = useMemo(() => {
    const sorted = [...collections].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
    const rows = sorted.map((collection) => ({
      collection,
      topics: packs.filter((pack) => pack.collection_id === collection.id)
        .sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)),
    })).filter((group) => group.topics.length);
    const ungrouped = packs.filter((pack) => !collections.some((collection) => collection.id === pack.collection_id));
    if (ungrouped.length) rows.push({
      collection: { id: "ungrouped", title: "Other topics", description: null, accent: "slate", glyph: null, sort_order: 999 } as Collection,
      topics: ungrouped.sort((a, b) => a.title.localeCompare(b.title)),
    });
    return rows;
  }, [collections, packs]);

  const historyReady = !!activity && !activityLoading && !activityError;
  return <div className="ov-page oh-overview">
    <header className="ws-page-head">
      <div>
        <span className="ws-eyebrow">STUDY ACTIVITY</span>
        <h1>Overview</h1>
        <p className="ws-page-sub">Cards reviewed across your Study topics.</p>
      </div>
    </header>

    <section className="ws-panel oh-calendar-panel" aria-labelledby="oh-calendar-title">
      <div className="ws-panel-head oh-calendar-heading">
        <div>
          <h2 id="oh-calendar-title">{selectedTitle}</h2>
          <span className="ws-muted ws-tiny">Last 26 weeks · one square per day</span>
        </div>
        {selected ? <button className="nb-link-button" type="button" onClick={() => setSelectedId(null)}>Show all topics <ArrowRight size={14}/></button> : null}
      </div>
      {activityError ? <div className="ws-inline-warning" role="alert">
        <span>Study history is unavailable. The figures below are not zero: {activityError}</span>
        <button type="button" className="ws-button is-small" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={14}/> Retry</button>
      </div> : null}
      {activityLoading ? <p className="ws-muted" role="status">Loading study activity…</p> : null}
      {historyReady ? <>
        <div className="oh-totals">
          <span><strong>{summary.cards.toLocaleString()}</strong> unique cards reviewed</span>
          <span><strong>{summary.answers.toLocaleString()}</strong> review answers</span>
          <span><strong>{summary.activeDays.toLocaleString()}</strong> active days</span>
        </div>
        <div className="oh-calendar-scroll">
          <div className="oh-calendar-inner">
            <div className="oh-months" aria-hidden="true">{calendar.weeks.map((week) => <span key={week.key}>{week.label}</span>)}</div>
            <div className="oh-calendar-body">
              <div className="oh-weekdays" aria-hidden="true"><span>M</span><span/><span>W</span><span/><span>F</span><span/><span/></div>
              <div className="oh-days" role="img" aria-label={selectedTitle + ": " + summary.cards + " distinct cards reviewed in the last 26 weeks"}>
                {calendar.days.map((day) => {
                  const count = summary.days.get(day.key) ?? 0;
                  return <span key={day.key} className="oh-cell" data-level={day.future ? "future" : level(count)}
                    title={day.future ? day.label : day.label + ": " + count + " unique " + (count === 1 ? "card" : "cards") + " reviewed"} />;
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="oh-calendar-footer">
          <span>A card counts once per day, even if reviewed repeatedly.</span>
          <div className="oh-legend" aria-label="Fewer to more cards reviewed"><span>Less</span>{[0, 1, 2, 3, 4].map((n) => <i className="oh-cell" data-level={n} key={n} />)}<span>More</span></div>
        </div>
      </> : null}
    </section>

    <section className="ws-panel oh-topics-panel" aria-labelledby="oh-topics-title">
      <div className="ws-panel-head">
        <div><h2 id="oh-topics-title">By topic</h2><span className="ws-muted ws-tiny">Select a topic to filter the calendar, or open it in Study.</span></div>
      </div>
      {studyError ? <p role="alert" className="ws-muted">Study topics are unavailable: {studyError}</p>
        : studyLoading ? <p role="status" className="ws-muted">Loading topics…</p>
        : groups.length ? groups.map(({ collection, topics }) => <div className="oh-group" key={collection.id}>
          <h3>{collection.title} <small>{topics.length} {topics.length === 1 ? "topic" : "topics"}</small></h3>
          <div className="oh-topic-list">
            {topics.map((pack) => {
              const stats = byPack.get(pack.id);
              return <div className={"oh-topic-row" + (selected === pack.id ? " is-selected" : "")} key={pack.id}>
                <button type="button" className="oh-topic-select" onClick={() => setSelectedId(selected === pack.id ? null : pack.id)}
                  aria-pressed={selected === pack.id} title={"Show activity for " + pack.title}>
                  <span className="oh-topic-name">{pack.title}</span>
                  <small>{pack.card_count.toLocaleString()} cards in library</small>
                </button>
                <div className="oh-topic-weeks" role="img" aria-label={pack.title + ": " + (historyReady ? (stats?.cards ?? 0) + " distinct cards reviewed" : "review history unavailable")}>
                  {calendar.weeks.map((week) => {
                    const count = historyReady ? stats?.weeks.get(week.key) ?? 0 : 0;
                    return <i key={week.key} className="oh-cell" data-level={historyReady ? level(count) : "unknown"}
                      title={historyReady ? week.key + ": " + count + " unique cards reviewed" : "Review history not loaded"} />;
                  })}
                </div>
                <span className="oh-topic-count" title="Distinct cards reviewed in the last 26 weeks">
                  {historyReady ? (stats?.cards ?? 0).toLocaleString() : "—"} <small>reviewed</small>
                </span>
                <button type="button" className="oh-topic-open" aria-label={"Open " + pack.title + " in Study"} title="Open in Study" onClick={() => onOpenTopic(pack)}><ArrowRight size={15}/></button>
              </div>;
            })}
          </div>
        </div>) : <p className="ws-muted">No Study topics yet. Create your first topic in Study.</p>}
    </section>
  </div>;
}
