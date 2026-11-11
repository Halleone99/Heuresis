import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Clock3, Layers3, Play, TrendingUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Collection, PackWithType } from "../lib/heuresis";
import type { ReviewOverview } from "../lib/reviewOverview";
import { LEARN_SETUP_MESSAGE } from "../lib/learnRounds";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  overview: ReviewOverview | null;
  quota: number;
  opening: boolean;
  error: string;
  onReview: (collectionIds: string[], topicId?: string) => void;
  onStartNew: (pack: PackWithType, count: number) => void;
  onStartLearning: (packs: PackWithType[], scopeLabel: string) => void;
};

function plural(count: number, singular: string, pluralForm = singular + "s") {
  return count.toLocaleString() + " " + (count === 1 ? singular : pluralForm);
}

type StudyMode = "new" | "learn" | "review";
const MODE_KEY = "heuresis.study.mode.v1";
/** The chosen mode survives a refresh, so returning from a Learn session lands on Learn. */
function readMode(): StudyMode {
  try {
    const value = sessionStorage.getItem(MODE_KEY);
    return value === "learn" || value === "review" ? value : "new";
  } catch { return "new"; }
}

export default function TodayStudyPanel({ collections, packs, overview, quota, opening, error, onReview, onStartNew, onStartLearning }: Props) {
  const [mode, setModeState] = useState<StudyMode>(readMode);
  const setMode = (next: StudyMode) => {
    setModeState(next);
    try { sessionStorage.setItem(MODE_KEY, next); } catch { /* preference only */ }
  };
  const [selection, setSelection] = useState("all");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionSize, setSessionSize] = useState(10);

  const selectedCollection = collections.find((c) => selection === "collection:" + c.id) ?? null;
  const selectedPack = packs.find((pack) => selection === "topic:" + pack.id) ?? null;
  const selectedParent = selectedPack ? collections.find((c) => c.id === selectedPack.collection_id) : null;
  const collectionIds = selectedPack ? [selectedPack.collection_id] : selectedCollection
    ? [selectedCollection.id] : collections.map((c) => c.id);
  const scopePacks = selectedPack ? [selectedPack] : packs.filter((pack) => collectionIds.includes(pack.collection_id));
  type CountKey = "ready" | "newReady" | "reviewedToday" | "newToday" | "newLast7" | "reviewsLast7" | "reverseTomorrow"
    | "learnCards" | "learnReady" | "learnExercisesToday" | "learnExercisesLast7" | "learnScoredLast7" | "learnCorrectLast7";
  const total = (key: CountKey) => scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.[key] ?? 0), 0);
  const ready = total("ready"), newReady = total("newReady"), reviewedToday = total("reviewedToday"),
    newToday = total("newToday"), newLast7 = total("newLast7"), reviewsLast7 = total("reviewsLast7"),
    learnCards = total("learnCards"), learnReady = total("learnReady"),
    learnExercisesToday = total("learnExercisesToday"), learnExercisesLast7 = total("learnExercisesLast7"),
    learnScoredLast7 = total("learnScoredLast7"), learnCorrectLast7 = total("learnCorrectLast7");
  // New, Learning and Review never overlap: a card is counted in exactly one of them.
  const learning = Math.max(0, learnCards - learnReady);
  const newTopics = scopePacks.filter((pack) => (overview?.topics[pack.id]?.newReady ?? 0) > 0)
    .sort((a, b) => Date.parse(b.last_opened_at ?? "1970-01-01") - Date.parse(a.last_opened_at ?? "1970-01-01"));
  const nextTopic = newTopics[0] ?? null;
  const learningPacks = scopePacks.filter((pack) => (overview?.topics[pack.id]?.learnCards ?? 0) > 0);
  const topicReady = nextTopic ? overview?.topics[nextTopic.id]?.newReady ?? 0 : 0;
  const glyph = selectedParent?.glyph || selectedCollection?.glyph;
  const scopeLabel = selectedPack ? (selectedParent?.title ?? "Collection") + " · " + selectedPack.title :
    selectedCollection ? selectedCollection.title + " · All topics" : "All subjects · All topics";
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());
  const stats = mode === "new"
    ? [{ label: "New cards", value: newReady, icon: Layers3 },
       { label: "Introduced today", value: newToday, icon: CheckCircle2 },
       { label: "Learning", value: learning, icon: BookOpen }]
    : mode === "learn"
      ? [{ label: "Learning", value: learning, icon: BookOpen },
         { label: "Ready for Review", value: learnReady, icon: CheckCircle2 },
         { label: "Exercises today", value: learnExercisesToday, icon: Clock3 }]
      : [{ label: "Due now", value: ready, icon: Clock3 },
         { label: "Reviewed today", value: reviewedToday, icon: CheckCircle2 },
         { label: "Reverse tomorrow", value: total("reverseTomorrow"), icon: Layers3 }];
  // Learning exercises and reviews are reported separately; an exercise is never a review.
  const successRate = learnScoredLast7 ? Math.round((learnCorrectLast7 / learnScoredLast7) * 100) : null;
  const weeklyActivity = mode === "new" ? plural(newLast7, "new card")
    : mode === "learn" ? plural(learnExercisesLast7, "exercise") + (successRate === null ? "" : " · " + successRate + "% right first time")
    : plural(reviewsLast7, "review completed", "reviews completed");
  const learnBlocked = Boolean(overview) && !overview!.learnAvailable;

  useEffect(() => {
    if (!pickerOpen && !sessionOpen) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setPickerOpen(false); setSessionOpen(false); }
    };
    const onOutside = (event: PointerEvent) => {
      if (pickerOpen && pickerRef.current && !pickerRef.current.contains(event.target as Node)) setPickerOpen(false);
    };
    document.addEventListener("keydown", onEscape);
    document.addEventListener("pointerdown", onOutside);
    return () => { document.removeEventListener("keydown", onEscape); document.removeEventListener("pointerdown", onOutside); };
  }, [pickerOpen, sessionOpen]);

  const choose = (value: string) => { setSelection(value); setPickerOpen(false); };
  function launch() {
    if (!overview || opening) return;
    if (mode === "review") { onReview(collectionIds, selectedPack?.id); return; }
    if (mode === "learn") { onStartLearning(learningPacks, scopeLabel); return; }
    openNewSession();
  }

  function openNewSession() {
    if (!nextTopic || !topicReady || opening) return;
    const suggested = Math.max(1, quota - newToday || quota);
    setSessionSize(Math.min(topicReady, suggested));
    setSessionOpen(true);
  }

  function confirmSession() {
    if (!nextTopic || !Number.isInteger(sessionSize) || sessionSize < 1 || sessionSize > topicReady || opening) return;
    setSessionOpen(false);
    onStartNew(nextTopic, sessionSize);
  }

  return (
    <>
      <section className="library-study-panel library-study-v2 today-study-redesign" aria-label="Today's study">
        <div className="today-study-intro"><div><h2>Today's study</h2><p>{todayLabel}</p></div></div>
        <div className="today-study-workspace">
          <div className="today-study-controls">
            <div className="today-study-switch" role="group" aria-label="Study mode">
              <button type="button" aria-pressed={mode === "new"} className={mode === "new" ? "selected" : ""} onClick={() => setMode("new")}>New</button>
              <button type="button" aria-pressed={mode === "learn"} className={mode === "learn" ? "selected" : ""} onClick={() => setMode("learn")}>Learn</button>
              <button type="button" aria-pressed={mode === "review"} className={mode === "review" ? "selected" : ""} onClick={() => setMode("review")}>Review</button>
            </div>
            <div className="today-study-picker" ref={pickerRef}>
              <button type="button" className="today-study-picker-trigger" aria-label="Choose subject and topic"
                aria-expanded={pickerOpen} onClick={() => { setExpandedId(selectedParent?.id ?? selectedCollection?.id ?? null); setPickerOpen((open) => !open); }}>
                <span className="today-study-picker-glyph" aria-hidden="true">{glyph || <Layers3 size={17}/>}</span>
                <span className="today-study-picker-label">{scopeLabel}</span><ChevronDown size={18} aria-hidden="true"/>
              </button>
              {pickerOpen ? <div className="today-study-picker-menu" role="group" aria-label="Subjects and topics">
                <button type="button" className={selection === "all" ? "current" : ""} onClick={() => choose("all")}>All subjects · All topics</button>
                {collections.map((collection) => {
                  const children = packs.filter((pack) => pack.collection_id === collection.id);
                  const expanded = expandedId === collection.id;
                  return <div key={collection.id} className="today-study-picker-group">
                    <div className="today-study-picker-subject">
                      <button type="button" aria-expanded={expanded}
                        aria-label={(expanded ? "Collapse " : "Show ") + collection.title + " topics"}
                        onClick={() => setExpandedId(expanded ? null : collection.id)}>
                        <span aria-hidden="true">{collection.glyph || collection.title.slice(0, 1)}</span>
                        <span className="today-study-picker-subject-name">{collection.title}</span>
                        <small>{plural(children.length, "topic")}</small>
                        <ChevronRight size={16} aria-hidden="true"/>
                      </button>
                    </div>
                    {expanded ? <div className="today-study-picker-topics">
                      <button type="button" className={selection === "collection:" + collection.id ? "current all-topics" : "all-topics"}
                        aria-pressed={selection === "collection:" + collection.id}
                        onClick={() => choose("collection:" + collection.id)}>All topics</button>
                      {children.map((pack) => <button type="button" key={pack.id} className={selection === "topic:" + pack.id ? "current" : ""}
                        aria-pressed={selection === "topic:" + pack.id}
                        onClick={() => choose("topic:" + pack.id)}>{pack.title}</button>)}
                      {!children.length ? <small>No topics yet</small> : null}
                    </div> : null}
                  </div>;
                })}
              </div> : null}
            </div>
          </div>
          <button type="button" className="today-study-start" disabled={!overview || opening || (mode === "new" ? !nextTopic : mode === "learn" ? !learnCards : !collectionIds.length)}
            onClick={launch}><Play size={21} fill="currentColor" aria-hidden="true"/>{opening ? "Opening…" : "Start"}</button>
        </div>
        <aside className="today-study-statistics" aria-label="Statistics for the selected subject or topic">
          {stats.map(({ label, value, icon: Icon }) => <div className="today-study-stat" key={label}>
            <Icon size={18}/><span>{label}</span><strong>{overview ? value.toLocaleString() : "—"}</strong>
          </div>)}
          <div className="today-study-week"><TrendingUp size={16}/>{overview ? weeklyActivity : "—"} in the last 7 days</div>
        </aside>
        {error && (mode === "new" || mode === "learn") ? <p className="today-study-notice" role="alert">{error}</p> : null}
        {mode === "learn" && learnBlocked && !error ? <p className="today-study-notice" role="status">{LEARN_SETUP_MESSAGE}</p> : null}
        {overview?.incomplete ? <p className="today-study-notice" role="status">Some topic counts are unavailable.</p> : null}
      </section>

      {sessionOpen && nextTopic ? <div className="library-study-v2-backdrop" onClick={() => setSessionOpen(false)}>
        <section className="library-study-v2-dialog" role="dialog" aria-modal="true" aria-labelledby="library-study-session-title"
          onClick={(event) => event.stopPropagation()}>
          <div className="library-study-v2-dialog-head">
            <div><span className="library-study-kicker">NEW SESSION</span><h3 id="library-study-session-title">How many cards?</h3></div>
            <button type="button" className="library-study-v2-close" onClick={() => setSessionOpen(false)} aria-label="Close"><X size={17} /></button>
          </div>
          <p>{plural(topicReady, "card")} available in {nextTopic.title}</p>
          <div className="library-study-v2-amounts" role="group" aria-label="Session card count">
            {[5, 10, 15, 20].map((amount) => <button type="button" key={amount} disabled={amount > topicReady}
              className={sessionSize === amount ? "selected" : ""} aria-pressed={sessionSize === amount}
              onClick={() => setSessionSize(amount)}>{amount}</button>)}
          </div>
          <label className="library-study-v2-custom">Custom amount
            <input type="number" min={1} max={topicReady} step={1} value={sessionSize}
              onChange={(event) => setSessionSize(Number(event.target.value))} />
          </label>
          <button type="button" className="library-study-v2-primary library-study-v2-confirm"
            disabled={!Number.isInteger(sessionSize) || sessionSize < 1 || sessionSize > topicReady || opening}
            onClick={confirmSession}>{opening ? "Opening…" : "Start session"} <ArrowRight size={15} /></button>
        </section>
      </div> : null}
    </>
  );
}
