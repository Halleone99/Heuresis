import { ArrowRight, ChevronLeft, ChevronRight, TrendingUp, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Collection, PackWithType } from "../lib/heuresis";
import type { ReviewOverview } from "../lib/reviewOverview";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  overview: ReviewOverview | null;
  quota: number;
  opening: boolean;
  error: string;
  onReview: (collectionIds: string[]) => void;
  onStartNew: (pack: PackWithType, count: number) => void;
  onStartLearning: (pack: PackWithType) => void;
};

function plural(count: number, singular: string, pluralForm = singular + "s") {
  return count.toLocaleString() + " " + (count === 1 ? singular : pluralForm);
}

export default function TodayStudyPanel({ collections, packs, overview, quota, opening, error, onReview, onStartNew, onStartLearning }: Props) {
  const [mode, setMode] = useState<"new" | "learning" | "review">("new");
  const [languageId, setLanguageId] = useState<string | null>(null);
  const [topicId, setTopicId] = useState<string | null>(null);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionSize, setSessionSize] = useState(10);

  const language = collections.find((collection) => collection.id === languageId) ?? null;
  const languageIndex = language ? collections.findIndex((collection) => collection.id === language.id) + 1 : 0;
  const collectionIds = language ? [language.id] : collections.map((collection) => collection.id);
  const scopePacks = packs.filter((pack) => collectionIds.includes(pack.collection_id));
  const ready = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.ready ?? 0), 0);
  const learningReady = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.learningReady ?? 0), 0);
  const reviewedToday = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.reviewedToday ?? 0), 0);
  const reverseTomorrow = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.reverseTomorrow ?? 0), 0);
  const reviewsLast7 = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.reviewsLast7 ?? 0), 0);
  const newReady = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.newReady ?? 0), 0);
  const newToday = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.newToday ?? 0), 0);
  const newLast7 = scopePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.newLast7 ?? 0), 0);
  const newTopics = scopePacks.filter((pack) => (overview?.topics[pack.id]?.newReady ?? 0) > 0)
    .sort((a, b) => Date.parse(b.last_opened_at ?? "1970-01-01") - Date.parse(a.last_opened_at ?? "1970-01-01"));
  const learningTopics = scopePacks.filter((pack) => (overview?.topics[pack.id]?.learningReady ?? 0) > 0);
  const nextLearningTopic = learningTopics.find((pack) => pack.id === topicId) ?? learningTopics[0] ?? null;
  const nextTopic = newTopics.find((pack) => pack.id === topicId) ?? newTopics[0] ?? null;
  const topicReady = nextTopic ? overview?.topics[nextTopic.id]?.newReady ?? 0 : 0;

  useEffect(() => {
    if (!sessionOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSessionOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sessionOpen]);

  function moveLanguage(direction: -1 | 1) {
    const length = collections.length + 1;
    const next = (languageIndex + direction + length) % length;
    setLanguageId(next === 0 ? null : collections[next - 1].id);
    setTopicId(null);
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
      <section className="library-study-panel library-study-v2" aria-label="Today's study">
        <div className="library-study-v2-top">
          <h2>Today's study</h2>
          <div className="library-study-v2-modes" role="group" aria-label="Study mode">
            <button type="button" className={mode === "new" ? "active" : ""} aria-pressed={mode === "new"}
              onClick={() => setMode("new")}>New</button>
            <button type="button" className={mode === "learning" ? "active" : ""} aria-pressed={mode === "learning"} onClick={() => { setMode("learning"); setTopicId(null); }}>Learning</button>
            <button type="button" className={mode === "review" ? "active" : ""} aria-pressed={mode === "review"}
              onClick={() => setMode("review")}>Review</button>
          </div>
        </div>
        <div className="library-study-v2-toolbar">
          <div className="library-study-v2-language" role="group" aria-label="Study language">
            <button type="button" onClick={() => moveLanguage(-1)} aria-label="Previous language"><ChevronLeft size={16} /></button>
            <span aria-live="polite">{language?.title ?? "All"}</span>
            <button type="button" onClick={() => moveLanguage(1)} aria-label="Next language"><ChevronRight size={16} /></button>
          </div>
          <span className="library-study-v2-summary">{overview ? plural(reviewedToday, "card") + " reviewed today" : "Loading study progress"}</span>
        </div>
        <div className="library-study-v2-content" key={mode}>
          <div className="library-study-v2-count">
            <span className="library-study-kicker">{mode === "new" ? "NEW CARDS" : mode === "learning" ? "IN LEARNING" : "DUE FOR REVIEW"}</span>
            <div className="library-study-v2-number">
              <strong>{overview ? (mode === "new" ? newReady : mode === "learning" ? learningReady : ready).toLocaleString() : "—"}</strong>
              <span>{mode === "new" ? "available" : mode === "learning" ? "to practise" : "due"}</span>
            </div>
            <span className="library-study-v2-week"><TrendingUp size={13} aria-hidden="true" />
              {mode === "learning" ? "Complete 10 exercises per card to unlock Review" : <>{overview ? (mode === "new" ? newLast7 : reviewsLast7).toLocaleString() : "—"} {mode === "new" ? "new cards in the last 7 days" : "reviews in the last 7 days"}</>}
            </span>
          </div>
          {mode === "new" ? <div className="library-study-v2-launch">
            <label className="library-study-v2-topic">
              <span className="sr-only">Choose a topic</span>
              <select aria-label="Choose a topic for new cards" value={nextTopic?.id ?? ""} disabled={!newTopics.length || opening}
                onChange={(event) => setTopicId(event.target.value)}>
                {newTopics.length ? newTopics.map((pack) => <option key={pack.id} value={pack.id}>
                  {language ? "" : (collections.find((item) => item.id === pack.collection_id)?.title ?? "Collection") + " · "}{pack.title} ({overview?.topics[pack.id]?.newReady ?? 0})
                </option>) : <option value="">No new cards available</option>}
              </select>
            </label>
            <button type="button" className="library-study-v2-primary" disabled={!overview || !nextTopic || opening}
              onClick={openNewSession}>Start new <ArrowRight size={15} aria-hidden="true" /></button>
          </div> : mode === "learning" ? <div className="library-study-v2-launch">
            <label className="library-study-v2-topic"><span className="sr-only">Choose a Learning topic</span>
              <select aria-label="Choose a topic for Learning" disabled={!learningTopics.length || opening} value={nextLearningTopic?.id ?? ""}
                onChange={(event) => setTopicId(event.target.value)}>
                {learningTopics.length ? learningTopics.map((pack) => <option key={pack.id} value={pack.id}>
                  {language ? "" : (collections.find((item) => item.id === pack.collection_id)?.title ?? "Collection") + " · "}{pack.title} ({overview?.topics[pack.id]?.learningReady ?? 0})
                </option>) : <option value="">No cards in Learning</option>}
              </select>
            </label>
            <button type="button" className="library-study-v2-primary" disabled={!nextLearningTopic || opening}
              onClick={() => nextLearningTopic && onStartLearning(nextLearningTopic)}>Start Learning <ArrowRight size={15}/></button>
          </div> : <div className="library-study-v2-launch library-study-v2-review-action">
            <span>{reverseTomorrow > 0 ? plural(reverseTomorrow, "reverse side") + " scheduled for tomorrow" : "Keep what you've learnt in memory"}</span>
            <button type="button" className="library-study-v2-primary" disabled={!overview || !collectionIds.length}
              onClick={() => onReview(collectionIds)}>Review <ArrowRight size={15} aria-hidden="true" /></button>
          </div>}
        </div>
        {error && mode === "new" ? <p className="library-study-v2-error" role="alert">{error}</p> : null}
        {overview?.incomplete ? <p className="library-study-v2-error" role="status">Some topics could not be counted.</p> : null}
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
