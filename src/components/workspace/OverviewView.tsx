import { useEffect, useMemo, useState } from "react";
import { ArrowRight, RefreshCw } from "lucide-react";
import { loadStudyActivity, loadStudyInventory, weekStart, type StudyActivity, type StudyInventoryCard, type ReviewEvent } from "../../lib/activity";
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

const intensity = (count: number) =>
  count === 0 ? "0" : count === 1 ? "1" : count <= 3 ? "2" : count <= 7 ? "3" : "4";

function summary(reviews: ReviewEvent[]) {
  const unique = new Set<string>();
  const byDay = new Map<string, Set<string>>();
  for (const review of reviews) {
    const date = new Date(review.created_at);
    if (!Number.isFinite(date.getTime()) || !review.card_id) continue;
    const key = dayKey(date);
    unique.add(review.card_id);
    if (!byDay.has(key)) byDay.set(key, new Set());
    byDay.get(key)!.add(review.card_id);
  }
  return {
    unique: unique.size,
    answers: reviews.length,
    activeDays: byDay.size,
    days: new Map([...byDay].map(([day, cards]) => [day, cards.size])),
  };
}

export function OverviewView({ collections, packs, studyLoading, studyError, onOpenTopic }: Props) {
  const { userId } = useWorkspace();
  const [topicId, setTopicId] = useState("");
  const [activity, setActivity] = useState<StudyActivity | null>(null);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState("");
  const [inventory, setInventory] = useState<StudyInventoryCard[] | null>(null);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [inventoryError, setInventoryError] = useState("");
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let mounted = true;
    setActivityLoading(true);
    setActivityError("");
    setActivity(null);
    void loadStudyActivity(userId, 190, 0)
      .then((data) => { if (mounted) setActivity(data); })
      .catch((error) => { if (mounted) setActivityError(error instanceof Error ? error.message : "Review history unavailable."); })
      .finally(() => { if (mounted) setActivityLoading(false); });
    return () => { mounted = false; };
  }, [userId, retry]);

  useEffect(() => {
    let mounted = true;
    setInventory(null);
    setInventoryError("");
    if (studyLoading || studyError) {
      setInventoryLoading(studyLoading);
      return () => { mounted = false; };
    }
    setInventoryLoading(true);
    void loadStudyInventory(packs.map((pack) => pack.id))
      .then((rows) => { if (mounted) setInventory(rows); })
      .catch((error) => { if (mounted) setInventoryError(error instanceof Error ? error.message : "Card inventory unavailable."); })
      .finally(() => { if (mounted) setInventoryLoading(false); });
    return () => { mounted = false; };
  }, [packs, studyLoading, studyError, retry]);

  const orderedCollections = useMemo(() => [...collections].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)), [collections]);
  const orderedPacks = useMemo(() => [...packs].sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)), [packs]);
  const selected = packs.find((pack) => pack.id === topicId) ?? null;
  const activeId = selected?.id ?? "";

  const calendar = useMemo(() => {
    const start = weekStart(new Date());
    start.setDate(start.getDate() - 25 * 7);
    const today = dayKey(new Date());
    const days = Array.from({ length: 26 * 7 }, (_, index) => {
      const date = new Date(start);
      date.setDate(date.getDate() + index);
      const key = dayKey(date);
      return { key, label: date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }), future: key > today };
    });
    const weeks = Array.from({ length: 26 }, (_, index) => {
      const startDate = new Date(start);
      startDate.setDate(startDate.getDate() + index * 7);
      const previous = new Date(startDate);
      previous.setDate(previous.getDate() - 7);
      return { key: dayKey(startDate), label: index === 0 || startDate.getMonth() !== previous.getMonth() ? startDate.toLocaleDateString("en-GB", { month: "short" }) : "" };
    });
    return { days, weeks, first: days[0].key, today };
  }, []);

  const last30 = useMemo(() => Date.now() - 30 * 86400000, []);
  const relevant = useMemo(() => {
    const allowedPacks = new Set(packs.map((pack) => pack.id));
    const activeLearning = inventory ? new Set(inventory.filter((card) => card.retention === "learning").map((card) => card.id)) : null;
    return (activity?.reviews ?? []).filter((review) => {
      if (!review.card_id || !allowedPacks.has(review.pack_id) || (activeId && review.pack_id !== activeId)) return false;
      if (activeLearning && !activeLearning.has(review.card_id)) return false;
      const date = new Date(review.created_at);
      return Number.isFinite(date.getTime()) && dayKey(date) >= calendar.first && dayKey(date) <= calendar.today;
    });
  }, [activity, activeId, packs, inventory, calendar.first, calendar.today]);

  const recent = useMemo(() => relevant.filter((review) => new Date(review.created_at).getTime() >= last30), [relevant, last30]);
  const period = useMemo(() => summary(relevant), [relevant]);
  const month = useMemo(() => summary(recent), [recent]);
  const matchingInventory = useMemo(() => inventory?.filter((card) => !activeId || card.pack_id === activeId) ?? null, [inventory, activeId]);
  const allCards = selected ? selected.card_count : packs.reduce((sum, pack) => sum + pack.card_count, 0);
  const recentAdditions = matchingInventory ? matchingInventory.filter((card) => new Date(card.created_at).getTime() >= last30).length : null;
  const learningCount = matchingInventory ? matchingInventory.filter((card) => card.retention === "learning").length : null;
  const coverage = learningCount === null || learningCount === 0 ? null : Math.min(100, Math.round((month.unique / learningCount) * 100));
  const historyReady = !activityLoading && !activityError && activity !== null;
  const title = selected ? selected.title : "All topics";
  const collection = selected ? collections.find((entry) => entry.id === selected.collection_id) : null;

  return <div className="ov-page oh-overview">
    <header className="ws-page-head">
      <div>
        <span className="ws-eyebrow">STUDY ACTIVITY</span>
        <h1>Overview</h1>
        <p className="ws-page-sub">One view of your cards and study activity.</p>
      </div>
    </header>
    <section className="ws-panel oh-main-panel" aria-label="Study Overview">
      <div className="oh-selection">
        <div className="oh-selection-heading">
          <span className="oh-label">VIEW</span>
          <h2>{title}</h2>
          {collection ? <p>{collection.title}</p> : <p>Your entire Study library</p>}
        </div>
        <div className="oh-controls">
          <label className="oh-sr" htmlFor="oh-topic-choice">Choose a Study topic</label>
          <select id="oh-topic-choice" className="oh-select" aria-label="Choose a Study topic" value={activeId}
            disabled={studyLoading || Boolean(studyError)} onChange={(event) => setTopicId(event.target.value)}>
            <option value="">All topics</option>
            {orderedCollections.map((collection) => <optgroup label={collection.title} key={collection.id}>
              {orderedPacks.filter((pack) => pack.collection_id === collection.id).map((pack) =>
                <option key={pack.id} value={pack.id}>{pack.title}</option>)}
            </optgroup>)}
            {orderedPacks.some((pack) => !collections.some((collection) => collection.id === pack.collection_id)) ? <optgroup label="Other topics">
              {orderedPacks.filter((pack) => !collections.some((collection) => collection.id === pack.collection_id)).map((pack) =>
                <option key={pack.id} value={pack.id}>{pack.title}</option>)}
            </optgroup> : null}
          </select>
          {selected ? <button type="button" className="nb-link-button oh-open" onClick={() => onOpenTopic(selected)}>Open topic <ArrowRight size={14}/></button> : null}
        </div>
      </div>

      {studyError ? <p className="ws-inline-warning" role="alert">Could not load Study topics: {studyError}</p> : null}

      <div className="oh-metrics">
        <div className="oh-metric">
          <span>Total cards</span>
          <strong>{studyLoading || studyError ? "—" : allCards.toLocaleString()}</strong>
          <small>Currently in {selected ? "this topic" : "your library"}</small>
        </div>
        <div className="oh-metric">
          <span>Added in 30 days</span>
          <strong>{inventoryLoading || inventoryError || recentAdditions === null ? "—" : "+" + recentAdditions.toLocaleString()}</strong>
          <small>New cards saved</small>
        </div>
        <div className="oh-metric">
          <span>Reviewed in 30 days</span>
          <strong>{historyReady ? month.unique.toLocaleString() : "—"}</strong>
          <small>Distinct cards reviewed</small>
        </div>
      </div>

      {inventoryError ? <p className="oh-note oh-error" role="alert">New-card statistics unavailable: {inventoryError} <button type="button" onClick={() => setRetry((value) => value + 1)}>Retry</button></p> : null}
      {activityError ? <p className="oh-note oh-error" role="alert">Review history unavailable: {activityError} <button type="button" onClick={() => setRetry((value) => value + 1)}><RefreshCw size={12}/> Retry</button></p> : null}
      {activityLoading || inventoryLoading ? <p className="oh-note" role="status">Loading study statistics…</p> : null}

      <div className="oh-coverage">
        <div className="oh-coverage-head">
          <div>
            <strong>30-day review coverage</strong>
            <small>How many of your learning cards you reviewed recently</small>
          </div>
          <b>{historyReady && learningCount !== null ? month.unique + " / " + learningCount : "—"}</b>
        </div>
        <div className="oh-track" role="progressbar" aria-label="Learning cards reviewed in the last 30 days"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={historyReady && coverage !== null ? coverage : undefined}
          aria-valuetext={historyReady && learningCount !== null ? month.unique + " of " + learningCount + " learning cards reviewed" : "Not available"}>
          <span style={{ width: historyReady && coverage !== null ? coverage + "%" : "0%" }} />
        </div>
        <p className="oh-coverage-note">{historyReady && learningCount === 0 ? "There are no learning cards in this selection." : "Coverage measures review activity, not whether a card has been mastered."}</p>
      </div>

      <div className="oh-heat-heading">
        <div><h3>Review activity</h3><p>Last 26 weeks · each square is one day</p></div>
        <div className="oh-heat-summary">{historyReady ? <><strong>{period.activeDays}</strong> active days <span>·</span> <strong>{period.answers.toLocaleString()}</strong> review answers</> : "—"}</div>
      </div>
      {historyReady ? <>
        <div className="oh-calendar-scroll">
          <div className="oh-calendar-inner">
            <div className="oh-months" aria-hidden="true">{calendar.weeks.map((week) => <span key={week.key}>{week.label}</span>)}</div>
            <div className="oh-calendar-body">
              <div className="oh-weekdays" aria-hidden="true"><span>M</span><span/><span>W</span><span/><span>F</span><span/><span/></div>
              <div className="oh-days" role="img" aria-label={title + ": daily number of different cards reviewed over 26 weeks"}>
                {calendar.days.map((day) => {
                  const count = period.days.get(day.key) ?? 0;
                  return <span key={day.key} className="oh-cell" data-level={day.future ? "future" : intensity(count)}
                    title={day.future ? day.label : day.label + " · " + count + (count === 1 ? " card" : " cards") + " reviewed"} />;
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="oh-calendar-footer">
          <span>Hover over any square to see the daily count.</span>
          <div className="oh-legend" aria-label="Daily count scale">
            <span>0</span>{[0, 1, 2, 3, 4].map((n) => <i key={n} className="oh-cell" data-level={String(n)} />)}<span>8+ cards</span>
          </div>
        </div>
      </> : <p className="oh-note">Review history has not loaded.</p>}
    </section>
  </div>;
}
