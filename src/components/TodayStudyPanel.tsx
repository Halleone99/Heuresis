import { Check, ChevronDown, ChevronLeft, ChevronRight, Clock3, Layers3, Play, RotateCcw, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Collection, PackWithType } from "../lib/heuresis";
import type { ReviewOverview } from "../lib/reviewOverview";
import { loadStudyActivity, type StudyActivity } from "../lib/studyActivity";
import { LEARN_SETUP_MESSAGE } from "../lib/learnRounds";

type StudyMode = "new" | "learn" | "review";
type StatsView = "activity" | "today" | "quality";
type CountKey =
  | "ready" | "reviewCards" | "strongCards" | "reviewFirstTryLast7" | "reviewGradedLast7"
  | "movedToReviewLast7" | "returnedToLearnLast7" | "learnEnteredCohort" | "learnSucceededCohort"
  | "learnCards" | "learnReady" | "learnExercisesToday" | "learnExercisesLast7"
  | "learnScoredLast7" | "learnCorrectLast7" | "reviewedToday" | "reverseTomorrow"
  | "newReady" | "newToday" | "newLast7" | "reviewsLast7";
type Props = {
  collections: Collection[];
  packs: PackWithType[];
  overview: ReviewOverview | null;
  selection: string;
  onSelectionChange: (value: string) => void;
  launchRequest?: { topicId: string; nonce: number } | null;
  quota: number;
  opening: boolean;
  error: string;
  onReview: (collectionIds: string[], topicId?: string) => void;
  onStartNew: (pack: PackWithType, count: number) => void;
  onStartLearning: (packs: PackWithType[], scopeLabel: string) => void;
  onStartReview: (count: number, scopedPacks: PackWithType[]) => void;
};
const MODE_KEY = "heuresis.study.mode.v1";
const VIEW_KEY = "heuresis.study.statistics.v1";
const STAGES: StudyMode[] = ["new", "learn", "review"];
const MODES: Record<StudyMode, string> = { new: "New", learn: "Learn", review: "Review" };
const countText = (n: number) => n.toLocaleString("en-GB");
const sum = (a: number[]) => a.reduce((acc, n) => acc + n, 0);
function percent(numerator: number, denominator: number): number | null {
  return denominator > 0 ? Math.min(100, Math.round(numerator / denominator * 100)) : null;
}
function storedMode(): StudyMode {
  try { const saved = sessionStorage.getItem(MODE_KEY); return saved === "new" || saved === "learn" || saved === "review" ? saved : "review"; }
  catch { return "review"; }
}
function storedView(): StatsView {
  try { const saved = sessionStorage.getItem(VIEW_KEY); return saved === "today" || saved === "quality" ? saved : "activity"; }
  catch { return "activity"; }
}
function localWindow(offset: number) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  end.setDate(end.getDate() - offset * 14);
  return Array.from({ length: 14 }, (_, index) => {
    const day = new Date(end);
    day.setDate(end.getDate() - 13 + index);
    return day;
  });
}
const dayFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short" });
const dateFormat = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
function rangeLabel(from: Date, to: Date) {
  return from.getMonth() === to.getMonth() && from.getFullYear() === to.getFullYear()
    ? String(from.getDate()) + "–" + dateFormat.format(to)
    : dateFormat.format(from) + " – " + dateFormat.format(to);
}
function weekName(date: Date) { return dayFormat.format(date).slice(0, 2); }

export default function TodayStudyPanel({
  collections, packs, overview, selection, onSelectionChange, launchRequest, quota, opening, error, onReview, onStartNew, onStartLearning, onStartReview,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [menuCollectionId, setMenuCollectionId] = useState<string | null>(null);
  const [mode, setModeState] = useState<StudyMode>(storedMode);
  const [view, setViewState] = useState<StatsView>(storedView);
  const [allStages, setAllStages] = useState(false);
  const [offset, setOffset] = useState(0);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionSize, setSessionSize] = useState(10);
  const [activity, setActivity] = useState<StudyActivity | null>(null);
  const [activityStatus, setActivityStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const pickerRef = useRef<HTMLDivElement>(null);
  const startRef = useRef<HTMLDivElement>(null);
  const handledLaunch = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);

  const selectedCollection = collections.find((c) => selection === "collection:" + c.id) ?? null;
  const selectedPack = packs.find((p) => selection === "topic:" + p.id) ?? null;
  const parent = selectedPack ? collections.find((c) => c.id === selectedPack.collection_id) : null;
  const collectionIds = selectedPack ? [selectedPack.collection_id] : selectedCollection
    ? [selectedCollection.id] : collections.map((c) => c.id);
  const scopePacks = selectedPack ? [selectedPack] : packs.filter((p) => collectionIds.includes(p.collection_id));
  const idsKey = scopePacks.map((p) => p.id).join("|");
  const count = (key: CountKey) => scopePacks.reduce((n, p) => n + (overview?.topics[p.id]?.[key] ?? 0), 0);
  const newReady = count("newReady");
  const learnCards = count("learnCards");
  const learnReady = count("learnReady");
  const ready = count("ready");
  const reviewCards = count("reviewCards");
  const reviewedToday = count("reviewedToday");
  const totalCards = scopePacks.reduce((n, p) => n + p.card_count, 0);
  const newToday = count("newToday");
  const newLast7 = count("newLast7");
  const learnExercisesLast7 = count("learnExercisesLast7");
  const reviewLast7 = count("reviewsLast7");
  const scopeLabel = selectedPack ? (parent?.title ?? "Collection") + " · " + selectedPack.title
    : selectedCollection ? selectedCollection.title : "All subjects";
  const scopeGlyph = parent?.glyph || selectedCollection?.glyph;
  const newTopics = scopePacks.filter((p) => (overview?.topics[p.id]?.newReady ?? 0) > 0)
    .sort((a, b) => Date.parse(b.last_opened_at ?? "1970-01-01") - Date.parse(a.last_opened_at ?? "1970-01-01"));
  const nextTopic = newTopics[0] ?? null;
  const topicReady = nextTopic ? overview?.topics[nextTopic.id]?.newReady ?? 0 : 0;
  const learningPacks = scopePacks.filter((p) => (overview?.topics[p.id]?.learnCards ?? 0) > 0);
  const stageCounts: Record<StudyMode, number> = { new: newReady, learn: learnCards, review: ready };
  const volumeCounts: Record<StudyMode, number> = { new: newReady, learn: learnCards, review: reviewCards };
  const volumeTotal = newReady + learnCards + reviewCards;
  const maximum = mode === "new" ? topicReady : ready;
  const days = useMemo(() => localWindow(offset), [offset]);

  function chooseMode(next: StudyMode) {
    if (stageCounts[next] <= 0) return;
    setModeState(next);
    setAllStages(false);
    setSessionOpen(false);
    try { sessionStorage.setItem(MODE_KEY, next); } catch { /* only a preference */ }
  }
  function chooseView(next: StatsView) {
    setViewState(next);
    try { sessionStorage.setItem(VIEW_KEY, next); } catch { /* only a preference */ }
  }
  useEffect(() => {
    if (!overview) return;
    if (stageCounts[mode] > 0) return;
    const next: StudyMode = ready > 0 ? "review" : learnCards > 0 ? "learn" : "new";
    setModeState(next);
    setAllStages(false);
    setSessionOpen(false);
    try { sessionStorage.setItem(MODE_KEY, next); } catch { /* only a preference */ }
  }, [selection, mode, overview, ready, learnCards, newReady]);

  useEffect(() => {
    if (view !== "activity" || !overview) return;
    let active = true;
    setActivity(null);
    setActivityStatus("loading");
    void loadStudyActivity(idsKey ? idsKey.split("|") : [], offset).then((data) => {
      if (active) { setActivity(data); setActivityStatus("ready"); }
    }).catch(() => {
      if (active) { setActivity(null); setActivityStatus("unavailable"); }
    });
    return () => { active = false; };
  }, [view, idsKey, offset, overview]);

  useEffect(() => {
    if (!pickerOpen && !sessionOpen) return;
    const outside = (event: PointerEvent) => {
      if (pickerOpen && !pickerRef.current?.contains(event.target as Node)) setPickerOpen(false);
      if (sessionOpen && !startRef.current?.contains(event.target as Node)) setSessionOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pickerOpen && menuCollectionId) setMenuCollectionId(null);
        else { setPickerOpen(false); setSessionOpen(false); }
      }
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [pickerOpen, sessionOpen, menuCollectionId]);

  function launchForStage(stage: StudyMode) {
    if (!overview || opening || !stageCounts[stage]) return;
    if (stage === "learn") { onStartLearning(learningPacks, scopeLabel); return; }
    const limit = stage === "new" ? topicReady : ready;
    if (!limit) return;
    setSessionSize(Math.min(limit, stage === "new" ? Math.max(1, quota - newToday || quota) : 10));
    setSessionOpen(true);
    panelRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  function launch() { launchForStage(mode); }
  useEffect(() => {
    if (!launchRequest || !overview || selection !== "topic:" + launchRequest.topicId
        || handledLaunch.current === launchRequest.nonce) return;
    handledLaunch.current = launchRequest.nonce;
    const target: StudyMode = stageCounts[mode] ? mode : ready ? "review" : learnCards ? "learn" : "new";
    if (target !== mode) {
      setModeState(target);
      try { sessionStorage.setItem(MODE_KEY, target); } catch { /* preference only */ }
    }
    launchForStage(target);
  // The nonce and controlled selection determine exactly one launch.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchRequest, selection, overview]);
  function confirmSession() {
    if (!Number.isInteger(sessionSize) || sessionSize < 1 || sessionSize > maximum || opening) return;
    setSessionOpen(false);
    if (mode === "new" && nextTopic) onStartNew(nextTopic, sessionSize);
    else if (mode === "review") onStartReview(sessionSize, scopePacks);
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat) return;
      const target = event.target as HTMLElement;
      if (target.closest("input,textarea,select,[contenteditable=true]") || pickerOpen) return;
      if (sessionOpen) {
        if (event.key === "Enter") { event.preventDefault(); confirmSession(); }
        return;
      }
      const stage = event.key === "1" ? "new" : event.key === "2" ? "learn" : event.key === "3" ? "review" : null;
      if (stage) { event.preventDefault(); chooseMode(stage); }
      else if (event.key === "Enter" && (target === document.body || target === document.documentElement)) {
        event.preventDefault(); launch();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  });

  function chooseScope(value: string) {
    onSelectionChange(value);
    setPickerOpen(false);
    setAllStages(false);
    setOffset(0);
    setMenuCollectionId(null);
  }

  const menuCollection = collections.find((c) => c.id === menuCollectionId) ?? null;
  const menuPacks = menuCollection ? packs.filter((p) => p.collection_id === menuCollection.id) : [];
  const chartValues = activity
    ? { new: activity.new, learn: activity.learn, review: activity.review } : null;
  const activeValues = chartValues?.[mode] ?? [];
  const fullValues = chartValues ? days.map((_, i) => chartValues.new[i] + chartValues.learn[i] + chartValues.review[i]) : [];
  const shownValues = allStages ? fullValues : activeValues;
  const chartTotal = sum(shownValues);
  // The activity RPC already returns each topic's counts. Aggregate those
  // under their parent subject for the day currently hovered or focused.
  const collectionNames = new Map(collections.map((item) => [item.id, item.title]));
  const chartBreakdowns = days.map((_, index) => {
    const groups = new Map<string, number>();
    for (const pack of scopePacks) {
      const values = activity?.byPack[pack.id];
      if (!values) continue;
      const n = allStages
        ? values.new[index] + values.learn[index] + values.review[index]
        : values[mode][index];
      if (!n) continue;
      const name = collectionNames.get(pack.collection_id) ?? "Unassigned";
      groups.set(name, (groups.get(name) ?? 0) + n);
    }
    const lines = [...groups].map(([name, count]) => ({ name, count }));
    const unassigned = (shownValues[index] ?? 0) - lines.reduce((total, item) => total + item.count, 0);
    if (unassigned > 0) lines.push({ name: "Unassigned", count: unassigned });
    return lines.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  });

  // A card contributes once per stage per local day, not once across all stages.
  const chartUnit = allStages ? "card activities" : mode === "new" ? "new cards" : mode === "learn" ? "cards practised" : "cards reviewed";
  const chartMaximum = Math.max(1, ...shownValues);
  const showChart = activityStatus === "ready" && chartTotal > 0;
  const trendRecent = sum(shownValues.slice(7));
  const trendPrevious = sum(shownValues.slice(0, 7));
  const weekUnit = allStages ? "cards" : mode === "new" ? "new cards" : mode === "learn" ? "exercises" : "reviews";
  const weekCaption = (n: number, start: Date, end: Date, name: string) =>
    (offset === 0 ? name : rangeLabel(start, end)) + " · " + countText(n) + " " + weekUnit;
  const label = (n: number) => overview ? countText(n) : "—";
  const qualityCard = (title: string, achieved: number, of: number, caption: string, stage: StudyMode) => {
    const pct = overview ? percent(achieved, of) : null;
    return <div className={"sh-quality tone-" + stage} key={title}>
      <div className="sh-quality-head"><strong>{pct === null ? "—" : pct}<small>{pct === null ? "" : "%"}</small></strong><span>{title}</span></div>
      <div className="sh-quality-meter"><i style={{ width: (pct ?? 0) + "%" }} /></div><p>{overview ? caption : "No results yet"}</p>
    </div>;
  };

  const retention = () => qualityCard("Retention", count("reviewFirstTryLast7"), count("reviewGradedLast7"),
    "Recalled on the first try · " + countText(count("reviewGradedLast7")) + " graded answers, last 7 days", "review");
  const success = () => qualityCard("Learning success", count("learnSucceededCohort"), count("learnEnteredCohort"),
    countText(count("learnSucceededCohort")) + " of " + countText(count("learnEnteredCohort")) +
    " learning entries from 2–6 weeks ago reached Review", "learn");

  const quality = allStages ? [retention(), success()]
    : mode === "review" ? [retention(), qualityCard("Strong or Mastered", count("strongCards"), reviewCards,
      countText(count("strongCards")) + " of " + countText(reviewCards) + " cards in Review", "review")]
    : mode === "learn" ? [success(), qualityCard("Right first time", count("learnCorrectLast7"), count("learnScoredLast7"),
      countText(count("learnScoredLast7")) + " exercises, last 7 days", "learn")]
    : [qualityCard("Started", Math.max(0, totalCards - newReady), totalCards,
      countText(Math.max(0, totalCards - newReady)) + " of " + countText(totalCards) + " cards started at least once", "new"),
      qualityCard("Of your weekly target", Math.min(newLast7, quota * 7), quota * 7,
        countText(newLast7) + " of " + countText(quota * 7) + " new cards this week", "new")];

  type TodayInfo = { done: number; of: number; title: string; note: string; facts: Array<{ icon: "clock" | "trend" | "back" | "layers"; count: number; label: string }> };
  const today: Record<StudyMode, TodayInfo> = {
    new: {
      done: newToday, of: quota, title: "new cards started today", note: "Daily target " + countText(quota),
      facts: [
        { icon: "layers", count: newReady, label: "not started yet" },
        { icon: "trend", count: newLast7, label: "started this week · " + (newLast7 / 7).toFixed(1) + " a day" },
        { icon: "clock", count: quota ? Math.ceil(newReady / quota) : 0, label: "days to start them all at " + quota + " a day" },
      ],
    },
    learn: {
      done: learnReady, of: learnCards, title: "ready for Review", note: countText(Math.max(0, learnCards - learnReady)) + " still working through the exercises",
      facts: [
        { icon: "layers", count: count("learnExercisesToday"), label: "exercises today" },
        { icon: "trend", count: learnExercisesLast7, label: "exercises this week" },
        { icon: "layers", count: count("movedToReviewLast7"), label: "moved to Review this week" },
      ],
    },
    review: {
      done: reviewedToday, of: ready + reviewedToday, title: "reviewed today",
      note: countText(reviewCards) + " cards in Review in total",
      facts: [
        { icon: "clock", count: count("reverseTomorrow"), label: "reverse sides open tomorrow" },
        { icon: "back", count: count("returnedToLearnLast7"), label: "returned to Learn this week" },
        { icon: "trend", count: reviewLast7, label: "reviews this week" },
      ],
    },
  };

  const selectedToday = today[mode];
  const sizeOptions = mode === "new" ? [5, 10, 15, 20] : [10, 20, 30];
  const startTitle = mode === "new" ? "Start new cards" : mode === "learn" ? "Continue learning" : "Start review";
  void onReview; // Retain the existing Review Centre callback for callers outside this panel.

  return <section className="study-home" aria-label="Study" ref={panelRef}>
    <div className="sh-top">
      <div className="sh-picker" ref={pickerRef}>
        <button type="button" className="sh-picker-trigger" aria-label="Choose subject and topic" aria-expanded={pickerOpen}
          onClick={() => { setMenuCollectionId(null); setPickerOpen(!pickerOpen); }}>
          <span className="sh-picker-glyph">{scopeGlyph || <Layers3 size={15} aria-hidden="true" />}</span>
          <span className="sh-picker-text"><strong>{parent?.title ?? selectedCollection?.title ?? "All subjects"}</strong>{selectedPack ? <small>{selectedPack.title}</small> : null}</span><ChevronDown size={14} strokeWidth={1.6} aria-hidden="true" />
        </button>
        {pickerOpen ? <div className={"sh-picker-pane" + (!menuCollection ? " one" : "")} role="dialog" aria-label="Choose subject and topic">
          <div className="sh-pane-left">
            <button className={"sh-pane-subject" + (selection === "all" ? " current" : "")} type="button" onClick={() => chooseScope("all")}>
              <Layers3 size={15} /><span>All subjects</span>{selection === "all" ? <Check size={13} /> : null}
            </button>
            {collections.map((collection) => <button type="button" key={collection.id} data-menu-collection={collection.id}
              className={"sh-pane-subject" + (menuCollectionId === collection.id ? " focus" : "") +
                (selection === "collection:" + collection.id || (selectedPack?.collection_id === collection.id) ? " current" : "")}
              onClick={() => setMenuCollectionId(collection.id)}
              onKeyDown={(event) => { if (event.key === "ArrowRight") {
                event.preventDefault(); setMenuCollectionId(collection.id);
                requestAnimationFrame(() => pickerRef.current?.querySelector<HTMLButtonElement>(".sh-pane-right button")?.focus());
              } }}>
              <b>{collection.glyph || collection.title.slice(0, 1)}</b><span>{collection.title}</span><ChevronRight size={13} />
            </button>)}
          </div>
          {menuCollection ? <div className="sh-pane-right" onKeyDown={(event) => { if (event.key === "ArrowLeft") {
            event.preventDefault(); const id = menuCollection.id; setMenuCollectionId(null);
            requestAnimationFrame(() => pickerRef.current?.querySelector<HTMLButtonElement>(`[data-menu-collection="${id}"]`)?.focus());
          } }}>
            <>
              <button type="button" className={"sh-pane-topic" + (selection === "collection:" + menuCollection.id ? " current" : "")}
                onClick={() => chooseScope("collection:" + menuCollection.id)}>
                <span>All of {menuCollection.title}</span><small>{menuPacks.reduce((n, p) => n + p.card_count, 0)}</small>
                {selection === "collection:" + menuCollection.id ? <Check size={13} /> : null}
              </button>
              {menuPacks.map((pack) => <button className={"sh-pane-topic" + (selection === "topic:" + pack.id ? " current" : "")}
                key={pack.id} type="button" onClick={() => chooseScope("topic:" + pack.id)}>
                <span>{pack.title}</span><small>{pack.card_count}</small>
                {selection === "topic:" + pack.id ? <Check size={13} /> : null}
              </button>)}
              {!menuPacks.length ? <p className="sh-empty-topics">No topics yet</p> : null}
            </>
          </div> : null}
        </div> : null}
      </div>

      <div className="sh-stage-bar" role="radiogroup" aria-label="Choose what Start opens">
        {STAGES.map((stage) => <button type="button" key={stage} role="radio"
          aria-checked={mode === stage} disabled={!overview || stageCounts[stage] === 0}
          className={"sh-stage tone-" + stage + (mode === stage ? " on" : "")}
          style={{ flexGrow: Math.max(volumeCounts[stage], volumeTotal * .24, 1) }}
          onClick={() => chooseMode(stage)}>
          <span className="sh-stage-label"><i className="sh-dot" /><span className="sh-stage-name">{MODES[stage]}</span>
            <strong>{overview ? countText(stageCounts[stage]) : "—"}</strong><small>{stage === "new" ? "new cards" : stage === "learn" ? "in progress" : "to review"}</small>
          </span><i className="sh-stage-track" />
        </button>)}
      </div>
      <div className="sh-start-area" ref={startRef}>
        <button className="sh-start" type="button" title={startTitle + " · " + scopeLabel} onClick={launch}
          disabled={!overview || opening || stageCounts[mode] === 0}>
          <Play size={12} fill="currentColor" aria-hidden="true" />{opening ? "Opening…" : "Start"}
        </button>
        {sessionOpen && maximum > 0 ? <div className="sh-session-pop" role="dialog" aria-label="Choose number of cards">
          <h3>HOW MANY CARDS?</h3>
          <div className="sh-session-options" role="group" aria-label="Session size">
            {sizeOptions.map((n) => <button key={n} type="button" disabled={n > maximum} aria-pressed={sessionSize === n}
              className={sessionSize === n ? "on" : ""} onClick={() => setSessionSize(n)}>{n}</button>)}
            <button type="button" className={sessionSize === maximum ? "on" : ""} aria-pressed={sessionSize === maximum}
              onClick={() => setSessionSize(maximum)}>All {countText(maximum)}</button>
          </div>
          <button className="sh-session-confirm" type="button" onClick={confirmSession}
            disabled={!sessionSize || sessionSize > maximum || opening}>Start {countText(sessionSize)} <span aria-hidden="true">→</span></button>
        </div> : null}
      </div>
    </div>

    <div className="sh-statistics">
      <div className="sh-stats-head">
        <span className={"sh-scope-chip" + (allStages ? "" : " tone-" + mode)}>{!allStages ? <i className="sh-dot" /> : null}{allStages ? "All stages" : MODES[mode]}</span>
        <span className="sh-stats-summary" title={view === "activity" ? "Each card counts once per stage each day. A card can appear in more than one stage." : undefined}>{view === "activity"
          ? showChart ? <><strong>{countText(chartTotal)}</strong> {chartUnit} · <strong>{(chartTotal / 14).toFixed(1)}</strong> a day</>
            : activityStatus === "loading" ? "Loading activity…" : "—"
          : view === "today" ? "Today so far" : "How well it is sticking"}</span>
        <span className="sh-head-grow" />
        {view === "activity" ? <div className="sh-date-nav">
          <button aria-label="Earlier 14 days" type="button" onClick={() => setOffset((n) => n + 1)}><ChevronLeft size={14} /></button>
          <span>{rangeLabel(days[0], days[13])}</span>
          <button aria-label="Later 14 days" type="button" onClick={() => setOffset((n) => Math.max(0, n - 1))} disabled={offset === 0}><ChevronRight size={14} /></button>
        </div> : null}
        <button type="button" className={"sh-all" + (allStages ? " on" : "")} aria-pressed={allStages}
          title={allStages ? "Return to " + MODES[mode] : "Show all stages"}
          onClick={() => setAllStages((on) => !on)}>All</button>
        <div className="sh-view-switch" role="group" aria-label="Statistics view">
          {(["activity", "today", "quality"] as StatsView[]).map((name) =>
            <button key={name} type="button" aria-pressed={view === name} className={view === name ? "on" : ""}
              onClick={() => chooseView(name)}>{name[0].toUpperCase() + name.slice(1)}</button>)}
        </div>
      </div>

      {view === "activity" ? showChart ? <>
        <div className={"sh-chart" + (allStages ? " all" : " tone-" + mode)} role="group" aria-label="Study activity for the last 14 days. Each card is counted once per stage per day.">
          {days.map((day, index) => {
            const n = shownValues[index];
            const height = n ? Math.max(6, n / chartMaximum * 100) : 0;
            return <div className={"sh-chart-column" + (index === 7 ? " divider" : "") + (index === 13 && offset === 0 ? " today" : "")}
              key={index} tabIndex={0}
              aria-label={dayFormat.format(day) + " " + dateFormat.format(day) + ": " + countText(n) + " " + chartUnit +
                (chartBreakdowns[index].length ? "; " + chartBreakdowns[index].map((item) => item.name + " " + item.count).join(", ") : "")}>
              <span className="sh-chart-count">{n ? countText(n) : ""}</span>
              {n ? <span className={"sh-chart-bar" + (!allStages ? " single" : "")} style={{ height: height + "%" }}>
                {allStages && chartValues ? <>
                  {chartValues.review[index] > 0 ? <i className="r" style={{ flex: chartValues.review[index] }} /> : null}
                  {chartValues.learn[index] > 0 ? <i className="l" style={{ flex: chartValues.learn[index] }} /> : null}
                  {chartValues.new[index] > 0 ? <i className="n" style={{ flex: chartValues.new[index] }} /> : null}
                </> : <i className={mode} />}
              </span> : <span className="sh-zero" />}
              <span className="sh-weekday">{index === 13 && offset === 0 ? "Today" : weekName(day)}</span>
              <div className="sh-chart-tooltip" role="tooltip">
                <span className="sh-chart-tip-date">{dayFormat.format(day)} {dateFormat.format(day)}</span>
                <strong>{countText(n)} {chartUnit}</strong>
                {chartBreakdowns[index].length ? <div className="sh-chart-tip-subjects">
                  {chartBreakdowns[index].map((item) => <span key={item.name}>
                    <span>{item.name}</span><b>{countText(item.count)}</b>
                  </span>)}
                </div> : <span className="sh-chart-tip-empty">No activity</span>}
                {allStages && chartValues ? <span className="sh-chart-tip-stages">
                  New {chartValues.new[index]} · Learn {chartValues.learn[index]} · Review {chartValues.review[index]}
                </span> : null}
              </div>
            </div>;
          })}
        </div>
        {allStages && chartValues ? <div className="sh-chart-foot sh-chart-legend">
          <span><i className="n" />New {countText(sum(chartValues.new))}</span>
          <span><i className="l" />Learn {countText(sum(chartValues.learn))}</span>
          <span><i className="r" />Review {countText(sum(chartValues.review))}</span>
        </div> : null}
        <div className="sh-week-captions">
          <span>{weekCaption(trendPrevious, days[0], days[6], "Previous 7 days")}</span>
          <span>{weekCaption(trendRecent, days[7], days[13], "Last 7 days")}</span>
        </div>
      </> : <p className="sh-no-history">{activityStatus === "loading" ? "Loading activity…" : "No activity history yet"}</p> : null}

      {view === "today" ? allStages ? <div className="sh-today-all">
        {STAGES.map((stage) => { const t = today[stage]; return <div className={"sh-today-row tone-" + stage} key={stage}>
          <span><i className="sh-dot" />{MODES[stage]}</span>
          <div className="sh-today-all-meter"><i style={{ width: (percent(t.done, t.of) ?? 0) + "%" }} /></div>
          <strong>{overview ? countText(t.done) + " of " + countText(t.of) : "—"} <small>{stage === "new" ? "daily target" : stage === "learn" ? "ready to move on" : "done today"}</small></strong>
        </div>; })}
        <p>{label(count("reverseTomorrow"))} reverse sides open tomorrow</p>
      </div> : <div className={"sh-today tone-" + mode}>
        <div className="sh-today-main">
          <div className="sh-today-n"><strong>{label(selectedToday.done)}</strong><span>/ {label(selectedToday.of)}</span></div>
          <p className="sh-today-title">{selectedToday.title}</p>
          <div className="sh-today-meter"><i style={{ width: (percent(selectedToday.done, selectedToday.of) ?? 0) + "%" }} />
            {selectedToday.of > 1 && selectedToday.of <= 40 ? <span className="sh-today-ticks">{Array.from({ length: selectedToday.of - 1 }, (_, n) => <b key={n} />)}</span> : null}
          </div>
          <p className="sh-today-note">{selectedToday.note}</p>
        </div>
        <ul className="sh-today-facts">
          {selectedToday.facts.map((fact, index) => { const Icon = fact.icon === "clock" ? Clock3 : fact.icon === "back" ? RotateCcw : fact.icon === "trend" ? TrendingUp : Layers3;
            return <li key={index}><Icon className={fact.icon === "back" ? "sh-back" : ""} size={15} />
              <strong>{label(fact.count)}</strong><span>{fact.label}</span></li>;
          })}
        </ul>
      </div> : null}

      {view === "quality" ? <div className="sh-quality-grid">{quality}</div> : null}
    </div>
    {error && (mode === "new" || mode === "learn") ? <p className="sh-notice" role="alert">{error}</p> : null}
    {mode === "learn" && overview?.learnAvailable === false && !error
      ? <p className="sh-notice" role="status">{LEARN_SETUP_MESSAGE}</p> : null}
    {overview?.incomplete ? <p className="sh-notice" role="status">Some topic counts are unavailable.</p> : null}
  </section>;
}
