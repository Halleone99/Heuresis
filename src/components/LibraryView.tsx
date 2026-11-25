import type { Wallpaper } from "./PageWallpaper";
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, Link2, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { loadReviewOverview, type ReviewOverview } from "../lib/reviewOverview";
import { countCaptureInbox } from "../lib/captureInbox";
import { listCards, listTags, type CardWithStats, type Collection, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { NEW_CARD_QUOTA_EVENT, readNewCardQuota } from "../lib/newCardQuota";
import { listRelatedCounts } from "../lib/related";
import { cardHasCompletedSort } from "../lib/sort";
import { readOpenStudy, rememberOpenStudy, type OpenStudySession } from "../lib/studySessionMemory";
import { relativeOpened } from "../lib/relativeTime";
import { readKnowledgeMode, studySelectionKey, writeKnowledgeMode, type KnowledgeMode } from "../lib/studyKnowledgeMode";
import { createReviewRoute, openCosmosWindow } from "../lib/cosmosWindow";
import { loadLearnTopics, readOpenLearn, rememberOpenLearn, type LearnTopic } from "../lib/learnSession";
import KnowledgeModeMenu from "./KnowledgeModeMenu";
import LearningSession from "./LearningSession";
import ReviewCentre from "./ReviewCentre";
import SortModal from "./SortModal";
import TodayStudyPanel from "./TodayStudyPanel";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  archivedCount: number;
  newCardsWallpaper?: Wallpaper;
  onOpen: (pack: PackWithType) => void;
  onNewTopic: (collectionId: string) => void;
  onOpenCaptureInbox: (collection: Collection) => void;
  onEditPack: (pack: PackWithType) => void;
  onOpenNewWords: (collection: Collection) => void;
  onArchive: () => void;
  onNewCollection: (mode: KnowledgeMode) => void;
};

const LAST_COLLECTION_KEY = "pos.heuresis.lastCollection";
type QuickSortSession = { pack: PackWithType; cards: CardWithStats[]; tags: HeuresisTag[]; count: number; total: number; remainingIds?: string[]; validated?: number; toLearning?: number; toReview?: number; discarded?: number; leftForLater?: number };
const STUDY_SELECTION_KEY = "heuresis.study.selection.v1";

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

function collectionGlyph(collection: Collection) {
  if (collection.title.trim().toLowerCase() === "english" || collection.glyph === "þ") return "A";
  return collection.glyph || collection.title.slice(0, 1);
}

function newestOpen(packs: PackWithType[]) {
  return packs.reduce<string | null>((latest, pack) => {
    if (!pack.last_opened_at) return latest;
    if (!latest || Date.parse(pack.last_opened_at) > Date.parse(latest)) return pack.last_opened_at;
    return latest;
  }, null);
}

export default function LibraryView({ collections, packs, newCardsWallpaper, onOpen, onOpenCaptureInbox, onNewTopic, onEditPack, onOpenNewWords, onNewCollection }: Props) {
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [knowledgeMode, setKnowledgeMode] = useState<KnowledgeMode>(readKnowledgeMode);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewOverview, setReviewOverview] = useState<ReviewOverview | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [newCardQuota, setNewCardQuota] = useState(readNewCardQuota);
  const [quickSort, setQuickSort] = useState<QuickSortSession | null>(null);
  const [learningSession, setLearningSession] = useState<{ topics: LearnTopic[]; title: string } | null>(null);
  const [learningOpening, setLearningOpening] = useState(false);
  const [newOpening, setNewOpening] = useState(false);
  const [reviewOpening, setReviewOpening] = useState(false);
  const [newError, setNewError] = useState("");
  const [reviewLaunchIds, setReviewLaunchIds] = useState<string[] | null>(null);
  const [reviewLaunchTopicId, setReviewLaunchTopicId] = useState<string | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(LAST_COLLECTION_KEY); } catch { return null; }
  });
  const [selection, setSelection] = useState<string>(() => {
    try {
      return sessionStorage.getItem(studySelectionKey(readKnowledgeMode()))
        ?? (readKnowledgeMode() === "languages" ? sessionStorage.getItem(STUDY_SELECTION_KEY) : null)
        ?? "all";
    } catch { return "all"; }
  });
  const [launchRequest, setLaunchRequest] = useState<{ topicId: string; nonce: number } | null>(null);
  const [showAllCollections, setShowAllCollections] = useState(false);
  const [relatedCounts, setRelatedCounts] = useState<Record<string, number>>({});
  const [captureRevision, setCaptureRevision] = useState(0);
  const modeCollections = useMemo(() => collections.filter((collection) => collection.study_mode === knowledgeMode), [collections, knowledgeMode]);
  const modePacks = useMemo(() => {
    const visible = new Set(modeCollections.map((collection) => collection.id));
    return packs.filter((pack) => visible.has(pack.collection_id));
  }, [packs, modeCollections]);
  const activeCollection = useMemo(() => modeCollections.find((collection) => collection.id === collectionId) ?? null, [collectionId, modeCollections]);
  const filteredReviewIds = reviewLaunchIds ?? modeCollections.map((item) => item.id);
  const refreshReviews = () => setReviewRevision((previous) => previous + 1);

  async function startNewCards(pack: PackWithType, count: number, resume?: OpenStudySession) {
    if (!Number.isInteger(count) || count < 1 || newOpening || !modePacks.some((item) => item.id === pack.id)) return;
    setNewOpening(true);
    setNewError("");
    try {
      const [cards, tags] = await Promise.all([listCards(pack.id), listTags()]);
      const unsorted = cards.filter((card) => !cardHasCompletedSort(card));
      if (!unsorted.length) {
        rememberOpenStudy(null, pack.id);
        refreshReviews(); setNewError("No unclassified cards remain in this topic."); return;
      }
      const eligible = new Set(unsorted.map((card) => card.id));
      const remainingIds = resume?.remainingIds.filter((id) => eligible.has(id));
      if (resume && !remainingIds?.length) {
        rememberOpenStudy(null, pack.id);
        refreshReviews(); setNewError("This session's remaining cards have already been classified."); return;
      }
      setQuickSort({ pack, cards, tags, count: resume ? remainingIds!.length : Math.min(count, unsorted.length),
        total: resume?.total ?? Math.min(count, unsorted.length), remainingIds,
        validated: resume?.validated, toLearning: resume?.toLearning, toReview: resume?.toReview,
        discarded: resume?.discarded, leftForLater: resume?.leftForLater });
    } catch (failure) {
      setNewError(failure instanceof Error ? failure.message : "Could not start new cards.");
    } finally { setNewOpening(false); }
  }

  async function startReview(size: number, scopedPacks: PackWithType[]) {
    if (!reviewOverview || reviewOpening || !Number.isInteger(size) || size < 1) return;
    scopedPacks = scopedPacks.filter((pack) => modePacks.some((item) => item.id === pack.id));
    let remaining = size;
    const entries: Array<{ packId: string; cardIds: string[] }> = [];
    // The scope and topic order come directly from the subject picker.
    for (const pack of scopedPacks) {
      if (remaining <= 0) break;
      const cards = (reviewOverview.topics[pack.id]?.readyCardIds ?? []).slice(0, remaining);
      if (!cards.length) continue;
      entries.push({ packId: pack.id, cardIds: cards });
      remaining -= cards.length;
    }
    if (!entries.length) return;
    setReviewOpening(true);
    setNewError("");
    try {
      const reviewRouteToken = createReviewRoute(entries);
      await openCosmosWindow({
        mode: "review", packId: entries[0].packId,
        source: "all", order: "weakest", count: "all",
        cardIds: entries[0].cardIds, reviewRouteToken,
      });
      refreshReviews();
    } catch (failure) {
      setNewError(failure instanceof Error ? failure.message : "Could not open Review.");
    } finally { setReviewOpening(false); }
  }

  async function startLearning(requested: PackWithType | PackWithType[], scopeTitle?: string) {
    if (learningOpening) return;
    setLearningOpening(true);
    setNewError("");
    try {
      const requestedPacks = (Array.isArray(requested) ? requested : [requested]).filter((pack) => modePacks.some((item) => item.id === pack.id));
      const topics = await loadLearnTopics(requestedPacks, collections);
      if (!topics.length) { rememberOpenLearn(null); refreshReviews(); setNewError("No cards are currently in Learn for this selection."); return; }
      const title = scopeTitle || (topics.length === 1 ? topics[0].pack.title : "Learn");
      // Remembered for this tab only: a refresh mid-session reopens Learn at the same exercise.
      rememberOpenLearn({ origin: "library", packIds: topics.map((topic) => topic.pack.id), title });
      setLearningSession({ topics, title });
    } catch (failure) {
      setNewError(failure instanceof Error ? failure.message : "Could not open Learn.");
    } finally { setLearningOpening(false); }
  }

  function closeLearning() {
    rememberOpenLearn(null);
    setLearningSession(null);
    refreshReviews();
    window.dispatchEvent(new Event("heuresis:study-changed"));
  }

  function closeQuickSort() {
    setQuickSort(null);
    refreshReviews();
    window.dispatchEvent(new Event("heuresis:study-changed"));
  }

  const latestCollection = useMemo(() => {
    if (!modeCollections.length) return null;
    const ranked = modeCollections.map((collection) => {
      const collectionPacks = modePacks.filter((pack) => pack.collection_id === collection.id);
      return { collection, hasPacks: collectionPacks.length > 0, last: newestOpen(collectionPacks) };
    }).sort((a, b) => {
      if (a.hasPacks !== b.hasPacks) return Number(b.hasPacks) - Number(a.hasPacks);
      return Date.parse(b.last ?? "1970-01-01") - Date.parse(a.last ?? "1970-01-01");
    });
    return ranked[0]?.collection ?? modeCollections[0];
  }, [modeCollections, modePacks]);

  const selectedCollection = useMemo(() => {
    const id = selection.startsWith("collection:") ? selection.slice(11)
      : selection.startsWith("topic:") ? modePacks.find((pack) => pack.id === selection.slice(6))?.collection_id
      : selectedCollectionId;
    return modeCollections.find((collection) => collection.id === id) ?? latestCollection;
  }, [modeCollections, modePacks, latestCollection, selectedCollectionId, selection]);
  useEffect(() => {
    const valid = selection === "all" ||
      (selection.startsWith("collection:") && modeCollections.some((c) => c.id === selection.slice(11))) ||
      (selection.startsWith("topic:") && modePacks.some((p) => p.id === selection.slice(6)));
    if (valid) return;
    const next = latestCollection ? "collection:" + latestCollection.id : "all";
    setSelection(next);
    setSelectedCollectionId(latestCollection?.id ?? null);
    try { sessionStorage.setItem(studySelectionKey(knowledgeMode), next); } catch { /* navigation only */ }
  }, [modeCollections, modePacks, knowledgeMode, selection, latestCollection]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const counts = await listRelatedCounts();
        if (!alive) return;
        const packCollection = new Map(packs.map((pack) => [pack.id, pack.collection_id]));
        const byCollection: Record<string, number> = {};
        counts.forEach((row) => {
          const nextCollectionId = packCollection.get(row.pack_id);
          if (nextCollectionId) byCollection[nextCollectionId] = (byCollection[nextCollectionId] ?? 0) + row.word_count;
        });
        setRelatedCounts(byCollection);
      } catch {
        if (alive) setRelatedCounts({});
      }
    };
    void load();
    const onFocus = () => { void load(); setCaptureRevision((value) => value + 1); };
    const onStorage = () => setCaptureRevision((value) => value + 1);
    window.addEventListener("focus", onFocus);
    window.addEventListener("storage", onStorage);
    return () => {
      alive = false;
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("storage", onStorage);
    };
  }, [packs]);

  useEffect(() => {
    const syncTarget = () => setNewCardQuota(readNewCardQuota());
    window.addEventListener(NEW_CARD_QUOTA_EVENT, syncTarget);
    window.addEventListener("storage", syncTarget);
    window.addEventListener("focus", syncTarget);
    return () => {
      window.removeEventListener(NEW_CARD_QUOTA_EVENT, syncTarget);
      window.removeEventListener("storage", syncTarget);
      window.removeEventListener("focus", syncTarget);
    };
  }, []);

  // A Learn session that was open when the page was refreshed continues where it stopped.
  const learnResumed = useRef(false);
  useEffect(() => {
    if (learnResumed.current || !modePacks.length) return;
    learnResumed.current = true;
    const open = readOpenLearn("library");
    if (!open) return;
    const wanted = modePacks.filter((pack) => open.packIds.includes(pack.id));
    if (wanted.length) void startLearning(wanted, open.title);
    else rememberOpenLearn(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modePacks]);

  useEffect(() => {
    let alive = true;
    void loadReviewOverview(packs).then((overview) => {
      if (alive) setReviewOverview(overview);
    }).catch(() => {
      if (alive) setReviewOverview(null);
    });
    return () => { alive = false; };
  }, [packs, reviewRevision]);

  useEffect(() => {
    const onReturn = () => refreshReviews();
    const onVisibility = () => { if (!document.hidden) refreshReviews(); };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onVisibility);
    return () => { window.removeEventListener("focus", onReturn); document.removeEventListener("visibilitychange", onVisibility); };
  }, []);

  function selectCollection(id: string) {
    setSelectedCollectionId(id);
    try { sessionStorage.setItem(LAST_COLLECTION_KEY, id); } catch { /* navigation preference only */ }
  }

  function chooseKnowledgeMode(next: KnowledgeMode) {
    if (next === knowledgeMode) return;
    writeKnowledgeMode(next);
    setKnowledgeMode(next);
    let saved = "all";
    try { saved = sessionStorage.getItem(studySelectionKey(next)) ?? "all"; } catch { /* optional */ }
    setSelection(saved);
    setSelectedCollectionId(null);
    setCollectionId(null);
    setLaunchRequest(null);
    setShowAllCollections(false);
    setNewError("");
  }

  function chooseStudyScope(value: string) {
    const id = value.startsWith("collection:") ? value.slice(11)
      : value.startsWith("topic:") ? modePacks.find((pack) => pack.id === value.slice(6))?.collection_id : null;
    if (value !== "all" && (!id || !modeCollections.some((collection) => collection.id === id))) return;
    if (id) selectCollection(id);
    setSelection(value);
    try { sessionStorage.setItem(studySelectionKey(knowledgeMode), value); } catch { /* navigation only */ }
  }
  function openCollection(id: string) {
    if (!modeCollections.some((collection) => collection.id === id)) return;
    selectCollection(id);
    setCollectionId(id);
  }
  function studyTopic(pack: PackWithType) {
    chooseStudyScope("topic:" + pack.id);
    setLaunchRequest((current) => ({ topicId: pack.id, nonce: (current?.nonce ?? 0) + 1 }));
  }
  function resumeTopic(pack: PackWithType, session: OpenStudySession) {
    chooseStudyScope("topic:" + pack.id);
    void startNewCards(pack, session.remainingIds.length, session);
  }

  function backToCollections() {
    setCollectionId(null);
  }

  if (reviewsOpen) return <ReviewCentre collections={modeCollections} packs={modePacks} overview={reviewOverview}
    initialCollectionIds={filteredReviewIds} initialTopicId={reviewLaunchTopicId} onBack={() => { setReviewsOpen(false); refreshReviews(); }} onRefresh={refreshReviews} />;

  if (activeCollection) {
    const collectionPacks = modePacks.filter((pack) => pack.collection_id === activeCollection.id);
    const collectionCards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
    const newWordsCount = relatedCounts[activeCollection.id] ?? 0;
    void captureRevision;
    const captureCount = countCaptureInbox(packs, activeCollection.id);
    const glyph = collectionGlyph(activeCollection);

    return (
      <section className="library-page collection-page" data-accent={activeCollection.accent}>
        <button className="text-button back-button" onClick={backToCollections}><ArrowLeft size={15} /> Library</button>
        <header className="collection-page-head">
          <div className="collection-title-block">
            <span className="collection-page-glyph" aria-hidden="true">{glyph}</span>
            <div><p className="eyebrow">COLLECTION</p><h1>{activeCollection.title}</h1>{activeCollection.description ? <p>{activeCollection.description}</p> : null}</div>
          </div>
          <div className="collection-metrics" aria-label="Collection totals">
            <span><strong>{collectionPacks.length.toLocaleString()}</strong><em>{collectionPacks.length === 1 ? "topic" : "topics"}</em></span>
            <span><strong>{collectionCards.toLocaleString()}</strong><em>{collectionCards === 1 ? "card" : "cards"}</em></span>
            {newWordsCount ? <span><strong>{newWordsCount.toLocaleString()}</strong><em>uncatalogued</em></span> : null}
          </div>
        </header>

        <div className="topics-intro"><div><p className="eyebrow">TOPICS</p><h2>Choose what you want to explore.</h2></div>
          <button type="button" className="collection-new-topic" onClick={() => onNewTopic(activeCollection.id)}><Plus size={15} aria-hidden="true" /> New topic</button>
        </div>

        {collectionPacks.length ? <div className="topic-grid">
          <article className="topic-card topic-card-inbox">
            <div className="topic-card-main topic-card-static">
              <span className="topic-ghost">+</span>
              <p className="eyebrow">INBOX</p>
              <h3>Inbox</h3>
              <p>Uncatalogued discoveries and drafts waiting in this collection.</p>
              <div className="topic-meta"><span>{plural(newWordsCount, "discovery", "discoveries")}</span><span>·</span><span>{plural(captureCount, "draft")}</span></div>
            </div>
            <div className="topic-card-tools topic-card-footer-actions">
              <button onClick={() => onOpenNewWords(activeCollection)}><Link2 size={14} /> Discoveries <span className="footer-count">{newWordsCount}</span></button>
              <button onClick={() => onOpenCaptureInbox(activeCollection)}><Plus size={14} /> Drafts <span className="footer-count">{captureCount}</span></button>
            </div>
          </article>
          {collectionPacks.map((pack) => (
            <article className="topic-card" key={pack.id}>
              <button className="topic-card-main" onClick={() => onOpen(pack)}>
                <span className="topic-ghost">{glyph}</span>
                <p className="eyebrow">TOPIC</p>
                <h3>{pack.title}</h3>
                {pack.description ? <p>{pack.description}</p> : null}
                <div className="topic-meta"><span>{plural(pack.card_count, "card")}</span><span>·</span><span>{pack.encountered_cards.toLocaleString()} seen</span></div>
                <span className="topic-open">Open <ArrowRight size={14} /></span>
              </button>
              <div className="topic-card-tools topic-card-footer-actions is-settings-only">
                <button type="button" onClick={() => onEditPack(pack)} title={`Edit settings for ${pack.title}`}><Pencil size={14} /> Topic settings</button>
              </div>
            </article>
          ))}
        </div> : <div className="library-empty"><BookOpen size={22} /><strong>No topics yet.</strong><p>Create a topic to start building this collection.</p><button type="button" className="collection-new-topic" onClick={() => onNewTopic(activeCollection.id)}><Plus size={15} aria-hidden="true" /> Create first topic</button></div>}
      </section>
    );
  }

  const selectedPacks = selectedCollection ? modePacks.filter((pack) => pack.collection_id === selectedCollection.id) : [];
  const sortedTopics = selectedPacks.slice().sort((a, b) =>
    Date.parse(b.last_opened_at ?? "1970-01-01") - Date.parse(a.last_opened_at ?? "1970-01-01") || a.title.localeCompare(b.title));
  const selectedIsLatest = Boolean(selectedCollection && latestCollection && selectedCollection.id === latestCollection.id);
  const otherCollections = modeCollections.filter((collection) => collection.id !== selectedCollection?.id)
    .sort((a, b) => Date.parse(newestOpen(modePacks.filter((p) => p.collection_id === b.id)) ?? "1970-01-01")
       - Date.parse(newestOpen(modePacks.filter((p) => p.collection_id === a.id)) ?? "1970-01-01"));

  const activityPanel = modeCollections.length ? <TodayStudyPanel collections={modeCollections} packs={modePacks} key="activity" overview={reviewOverview}
        selection={selection} onSelectionChange={chooseStudyScope} launchRequest={launchRequest}
        quota={newCardQuota} opening={newOpening || learningOpening || reviewOpening} error={newError}
        onReview={(ids, topicId) => { setReviewLaunchIds(ids); setReviewLaunchTopicId(topicId ?? null); setReviewsOpen(true); }}
        onStartReview={(count, scopedPacks) => void startReview(count, scopedPacks)}
        onStartNew={(pack, count) => void startNewCards(pack, count)}
        onStartLearning={(eligible, scopeTitle) => void startLearning(eligible, scopeTitle)} /> : null;
  const collectionDesk = selectedCollection ? <div className="library-desk study-desk" key="collections">
        <section className="study-desk-feature" data-accent={selectedCollection.accent} aria-label={selectedCollection.title}>
          <span className="study-desk-ghost" aria-hidden="true">{collectionGlyph(selectedCollection)}</span>
          <span className="study-desk-eyebrow">{selectedIsLatest ? "CONTINUE" : "COLLECTION"}</span>
          <div className="study-desk-heading">
            <button type="button" className="study-desk-title" onClick={() => openCollection(selectedCollection.id)}>
              {selectedCollection.title}
            </button>
            {newestOpen(selectedPacks) ? <span className="study-desk-opened"><i />Last opened {relativeOpened(newestOpen(selectedPacks))}</span> : null}
          </div>
          <div className="study-desk-topics" aria-label="Topics">
            {sortedTopics.slice(0, 6).map((pack) => {
              const stats = reviewOverview?.topics[pack.id];
              let resume = readOpenStudy(pack.id);
              // Review continuation is not available until the Review window reports answered IDs.
              if (resume?.kind !== "new") resume = null;
              if (stats?.newReady === 0 && resume) { rememberOpenStudy(null, pack.id); resume = null; }
              const chosen = selection === "topic:" + pack.id;
              const actionable = stats ? [stats.newReady,
                reviewOverview?.learnAvailable ? stats.learnDue + stats.learnReady : 0,
                stats.ready] : null;
              const canStudy = actionable ? actionable.some((count) => count > 0) : true;
              return <div className={"study-desk-topic" + (chosen ? " chosen" : "")} key={pack.id}>
                <div className="study-desk-topic-copy">
                  <strong>{pack.title}</strong>
                  <small>{plural(pack.card_count, "card")}{resume ? <span className="study-desk-session"> · New · {Math.max(0, resume.total - (resume.validated ?? 0))} of {resume.total} left</span> : null}</small>
                </div>
                <div className="study-desk-counts" aria-label="New, Learn and Review cards available today">
                  {(["new", "learn", "review"] as const).map((stage, index) =>
                    <span className={stage} key={stage} title={stats ? [
                      `${stats.newReady} new cards`,
                      `${stats.learnDue} to practise · ${stats.learnReady} ready to move · ${stats.learnCards} in Learn`,
                      `${stats.ready} due now · ${stats.reviewCards} in Review`,
                    ][index] : undefined}>
                      <i />{actionable ? actionable[index].toLocaleString("en-GB") : "—"}
                    </span>)}
                </div>
                <button type="button" className={"study-desk-action" + (resume ? " resume" : "")}
                  disabled={newOpening || learningOpening || reviewOpening || !canStudy}
                  title={!canStudy ? "Nothing to study in this topic right now" : undefined}
                  onClick={() => resume ? resumeTopic(pack, resume) : studyTopic(pack)}>{resume ? "Resume" : "Study"}</button>
              </div>;
            })}
            {sortedTopics.length > 6 ? <button type="button" className="study-desk-more-topics"
              onClick={() => openCollection(selectedCollection.id)}>+ {sortedTopics.length - 6} more topics</button> : null}
            {!sortedTopics.length ? <button type="button" className="study-desk-empty"
              onClick={() => onNewTopic(selectedCollection.id)}><Plus size={14} />Create your first topic</button> : null}
          </div>
        </section>
        <aside className="study-desk-side" aria-label="Other collections">
          <span className="study-desk-eyebrow">OTHER COLLECTIONS</span>
          <div className="study-desk-others">
            {(showAllCollections ? otherCollections : otherCollections.slice(0, 3)).map((collection) => {
              const topicPacks = modePacks.filter((p) => p.collection_id === collection.id);
              const total = topicPacks.reduce((n, pack) => n + pack.card_count, 0);
              const counts = topicPacks.reduce((acc, pack) => {
                const stats = reviewOverview?.topics[pack.id];
                if (stats) { acc[0] += stats.newReady; acc[1] += stats.learnCards; acc[2] += stats.reviewCards; }
                return acc;
              }, [0, 0, 0]);
              const latest = relativeOpened(newestOpen(topicPacks));
              return <button type="button" key={collection.id}
                className={"study-desk-mini" + (!topicPacks.length ? " off" : "")}
                onClick={() => chooseStudyScope("collection:" + collection.id)}>
                <span className="study-desk-mini-glyph" aria-hidden="true">{collectionGlyph(collection)}</span>
                <span className="study-desk-mini-body"><strong>{collection.title}</strong>
                  <small>{plural(total, "card")}{latest ? " · opened " + latest : ""}</small>
                  <span className="study-desk-mini-track" aria-label="Proportion in New, Learn and Review">
                    {counts.map((number, index) => <i key={index} className={["new", "learn", "review"][index]}
                      style={{ flexGrow: number || 0.01 }} />)}
                  </span>
                </span><ChevronRight size={14} aria-hidden="true" />
              </button>;
            })}
            <button type="button" className="study-desk-new" onClick={() => onNewCollection(knowledgeMode)}><Plus size={13} /> New collection</button>
          </div>
          {otherCollections.length > 3 ? <button type="button" className="study-desk-all"
            onClick={() => setShowAllCollections((value) => !value)}>{showAllCollections ? "Show fewer" : "All collections"}</button> : null}
        </aside>
      </div> : <div className="library-empty study-knowledge-empty" key="collections"><BookOpen size={22} /><strong>{knowledgeMode === "applied" ? "Applied knowledge starts here." : "No language collections yet."}</strong><p>{knowledgeMode === "applied" ? "Create a collection for customs, Incoterms, compliance or another practical subject. Your language decks stay in Languages." : "Create your first language collection to begin studying."}</p><button type="button" className="library-new-collection" onClick={() => onNewCollection(knowledgeMode)}><Plus size={14} /> New {knowledgeMode === "applied" ? "Applied" : "Languages"} collection</button></div>;

  return (
    <section className="library-page intelligent-library">
      <header className="intelligent-library-head">
        <div className="library-head-copy">
          <div className="study-knowledge-heading">
            <h1>Study<span>.</span></h1>
            <KnowledgeModeMenu mode={knowledgeMode} collections={collections} onChange={chooseKnowledgeMode} />
          </div>
        </div>
      </header>

      <div className="study-workspace">
        {activityPanel}
        {collectionDesk}
      </div>
      {quickSort ? <SortModal key={quickSort.pack.id} pack={quickSort.pack} cards={quickSort.cards} tags={quickSort.tags}
        wallpaper={newCardsWallpaper} quickStartCount={quickSort.count} studySession={{ total: quickSort.total, remainingIds: quickSort.remainingIds, validated: quickSort.validated,
          toLearning: quickSort.toLearning, toReview: quickSort.toReview,
          discarded: quickSort.discarded, leftForLater: quickSort.leftForLater }} onClose={closeQuickSort} onChanged={() => undefined}
        onLearning={() => void startLearning(quickSort.pack)} /> : null}
      {learningSession ? <LearningSession topics={learningSession.topics} title={learningSession.title}
        onClose={closeLearning} onChanged={refreshReviews} /> : null}
    </section>
  );
}
