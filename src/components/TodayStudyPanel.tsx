import { ArrowRight, BookOpen, CheckCircle2, ChevronDown, ChevronRight, Clock3, Layers3, Play, TrendingUp, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Collection, PackWithType } from "../lib/heuresis";
import type { ReviewOverview } from "../lib/reviewOverview";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  overview: ReviewOverview | null;
  quota: number;
  opening: boolean;
  error: string;
  onReview: (collectionIds: string[], topicId?: string) => void;
  onStartNew: (pack: PackWithType, count: number) => void;
  onStartLearning: (pack: PackWithType) => void;
};

function plural(count: number, singular: string, pluralForm = singular + "s") {
  return count.toLocaleString() + " " + (count === 1 ? singular : pluralForm);
}

export default function TodayStudyPanel({ collections, packs, overview, quota, opening, error, onReview, onStartNew, onStartLearning }: Props) {
  const [mode, setMode] = useState<"new" | "review">("new");
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
  const total = (key: "ready" | "newReady" | "reviewedToday" | "newToday" | "newLast7" | "learningReady") =>
    scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.[key] ?? 0), 0);
  const ready = total("ready"), newReady = total("newReady"), reviewedToday = total("reviewedToday"),
    newToday = total("newToday"), newLast7 = total("newLast7"), learningReady = total("learningReady");
  const newTopics = scopePacks.filter((pack) => (overview?.topics[pack.id]?.newReady ?? 0) > 0)
    .sort((a, b) => Date.parse(b.last_opened_at ?? "1970-01-01") - Date.parse(a.last_opened_at ?? "1970-01-01"));
  const nextTopic = newTopics[0] ?? null;
  const nextLearningTopic = scopePacks.find((pack) => (overview?.topics[pack.id]?.learningReady ?? 0) > 0) ?? null;
  const topicReady = nextTopic ? overview?.topics[nextTopic.id]?.newReady ?? 0 : 0;
  const glyph = selectedParent?.glyph || selectedCollection?.glyph;
  const scopeLabel = selectedPack ? (selectedParent?.title ?? "Collection") + " · " + selectedPack.title :
    selectedCollection ? selectedCollection.title + " · All topics" : "All subjects · All topics";
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

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
                      <button type="button" className={selection === "collection:" + collection.id ? "current" : ""}
                        onClick={() => choose("collection:" + collection.id)}>
                        <span aria-hidden="true">{collection.glyph || collection.title.slice(0,1)}</span>{collection.title}<small>All topics</small>
                      </button>
                      <button type="button" className="today-study-expand" aria-expanded={expanded}
                        aria-label={(expanded ? "Collapse " : "Expand ") + collection.title + " topics"}
                        onClick={() => setExpandedId(expanded ? null : collection.id)}><ChevronRight size={16}/></button>
                    </div>
                    {expanded ? <div className="today-study-picker-topics">
                      {children.map((pack) => <button type="button" key={pack.id} className={selection === "topic:" + pack.id ? "current" : ""}
                        onClick={() => choose("topic:" + pack.id)}>{pack.title}</button>)}
                      {!children.length ? <small>No topics yet</small> : null}
                    </div> : null}
                  </div>;
                })}
              </div> : null}
            </div>
          </div>
          <button type="button" className="today-study-start" disabled={!overview || opening || (mode === "new" ? !nextTopic : !collectionIds.length)}
            onClick={launch}><Play size={21} fill="currentColor" aria-hidden="true"/>{opening ? "Opening…" : "Start"}</button>
          {learningReady > 0 && nextLearningTopic ? <button type="button" className="today-study-learning" disabled={opening}
            onClick={() => onStartLearning(nextLearningTopic)}><BookOpen size={14}/> Continue Learning · {plural(learningReady, "card")}</button> : null}
        </div>
        <aside className="today-study-statistics" aria-label="Statistics for the selected subject or topic">
          <div className="today-study-stat"><Clock3 size={18}/><span>Due now</span><strong>{overview ? ready.toLocaleString() : "—"}</strong></div>
          <div className="today-study-stat"><Layers3 size={18}/><span>New available</span><strong>{overview ? newReady.toLocaleString() : "—"}</strong></div>
          <div className="today-study-stat"><CheckCircle2 size={18}/><span>Reviewed today</span><strong>{overview ? reviewedToday.toLocaleString() : "—"}</strong></div>
          <div className="today-study-week"><TrendingUp size={16}/>{overview ? newLast7.toLocaleString() : "—"} new in the last 7 days</div>
        </aside>
        {error && mode === "new" ? <p className="today-study-notice" role="alert">{error}</p> : null}
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
