import { ArrowLeft, ArrowRight, Archive, BookOpen, Brain, ChevronRight, Layers3, Link2, Minus, Pencil, Play, Plus, Sparkles, Target } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadReviewOverview, type ReviewOverview } from "../lib/reviewOverview";
import { countCaptureInbox } from "../lib/captureInbox";
import { listCards, listTags, type CardWithStats, type Collection, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { formatSeen } from "../lib/learningSignals";
import { listRelatedCounts } from "../lib/related";
import { cardHasCompletedSort } from "../lib/sort";
import ReviewCentre from "./ReviewCentre";
import SortModal from "./SortModal";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  archivedCount: number;
  onOpen: (pack: PackWithType) => void;
  onNewTopic: (collectionId: string) => void;
  onOpenCaptureInbox: (collection: Collection) => void;
  onEditPack: (pack: PackWithType) => void;
  onOpenNewWords: (collection: Collection) => void;
  onArchive: () => void;
  onNewCollection: () => void;
};

const LAST_COLLECTION_KEY = "pos.heuresis.lastCollection";
const NEW_CARD_QUOTA_KEY = "heuresis.newCards.dailyQuota.v1";

function readNewCardQuota(): number {
  try {
    const value = Number(localStorage.getItem(NEW_CARD_QUOTA_KEY));
    if (Number.isSafeInteger(value) && value >= 5 && value <= 50) return value;
  } catch { /* Device preference; card progress is saved in Supabase. */ }
  return 10;
}

type QuickSortSession = { pack: PackWithType; cards: CardWithStats[]; tags: HeuresisTag[]; count: number };

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

export default function LibraryView({ collections, packs, archivedCount, onOpen, onOpenCaptureInbox, onNewTopic, onEditPack, onOpenNewWords, onArchive, onNewCollection }: Props) {
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewOverview, setReviewOverview] = useState<ReviewOverview | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [newCardQuota, setNewCardQuota] = useState(readNewCardQuota);
  const [newTopicId, setNewTopicId] = useState<string | null>(null);
  const [quickSort, setQuickSort] = useState<QuickSortSession | null>(null);
  const [newOpening, setNewOpening] = useState(false);
  const [newError, setNewError] = useState("");
  // null means every collection, otherwise the user can combine languages.
  const [reviewFilterIds, setReviewFilterIds] = useState<string[] | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(LAST_COLLECTION_KEY); } catch { return null; }
  });
  const [relatedCounts, setRelatedCounts] = useState<Record<string, number>>({});
  const [unsortedCounts, setUnsortedCounts] = useState<Record<string, number>>({});
  const [captureRevision, setCaptureRevision] = useState(0);
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === collectionId) ?? null, [collectionId, collections]);
  const totalCards = packs.reduce((sum, pack) => sum + pack.card_count, 0);
  const filteredReviewIds = reviewFilterIds === null ? collections.map((item) => item.id) : reviewFilterIds;
  const selectedReviewPacks = packs.filter((pack) => filteredReviewIds.includes(pack.collection_id));
  const reviewsReady = selectedReviewPacks.reduce((sum, pack) => sum + (reviewOverview?.topics[pack.id]?.ready ?? 0), 0);
  const reviewsDone = selectedReviewPacks.reduce((sum, pack) => sum + (reviewOverview?.topics[pack.id]?.reviewedToday ?? 0), 0);
  const reverseTomorrow = selectedReviewPacks.reduce((sum, pack) => sum + (reviewOverview?.topics[pack.id]?.reverseTomorrow ?? 0), 0);
  const refreshReviews = () => setReviewRevision((previous) => previous + 1);
  const todayNew = reviewOverview?.newToday ?? 0;
  const newReady = reviewOverview?.newReady ?? 0;
  const newTopics = packs.filter((pack) => (reviewOverview?.topics[pack.id]?.newReady ?? 0) > 0)
    .sort((a, b) => Date.parse(b.last_opened_at ?? "1970-01-01") - Date.parse(a.last_opened_at ?? "1970-01-01"));
  const nextNewTopic = newTopics.find((pack) => pack.id === newTopicId) ?? newTopics[0] ?? null;
  const newTopicReady = nextNewTopic ? reviewOverview?.topics[nextNewTopic.id]?.newReady ?? 0 : 0;
  const newBatchSize = Math.min(newTopicReady, todayNew >= newCardQuota ? newCardQuota : Math.max(1, newCardQuota - todayNew));
  const newProgress = Math.min(100, Math.round((todayNew / newCardQuota) * 100));

  function changeNewCardQuota(value: number) {
    const next = Math.min(50, Math.max(5, value));
    setNewCardQuota(next);
    try { localStorage.setItem(NEW_CARD_QUOTA_KEY, String(next)); } catch { /* Device preference only. */ }
  }

  async function startNewCards() {
    if (!nextNewTopic || !newBatchSize || newOpening) return;
    setNewOpening(true);
    setNewError("");
    try {
      const [cards, tags] = await Promise.all([listCards(nextNewTopic.id), listTags()]);
      const unsorted = cards.filter((card) => !cardHasCompletedSort(card));
      if (!unsorted.length) { refreshReviews(); setNewError("No unclassified cards remain in this topic."); return; }
      setQuickSort({ pack: nextNewTopic, cards, tags, count: Math.min(newBatchSize, unsorted.length) });
    } catch (failure) {
      setNewError(failure instanceof Error ? failure.message : "Could not start new cards.");
    } finally { setNewOpening(false); }
  }

  function closeQuickSort() {
    setQuickSort(null);
    refreshReviews();
    window.dispatchEvent(new Event("heuresis:study-changed"));
  }
  const toggleReviewCollection = (id: string) => {
    setReviewFilterIds((current) => {
      if (current === null) return [id];
      return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
    });
  };

  const latestCollection = useMemo(() => {
    if (!collections.length) return null;
    const ranked = collections.map((collection) => {
      const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
      return { collection, hasPacks: collectionPacks.length > 0, last: newestOpen(collectionPacks) };
    }).sort((a, b) => {
      if (a.hasPacks !== b.hasPacks) return Number(b.hasPacks) - Number(a.hasPacks);
      return Date.parse(b.last ?? "1970-01-01") - Date.parse(a.last ?? "1970-01-01");
    });
    return ranked[0]?.collection ?? collections[0];
  }, [collections, packs]);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? latestCollection,
    [collections, latestCollection, selectedCollectionId],
  );
  const selectedPacks = useMemo(
    () => selectedCollection ? packs.filter((pack) => pack.collection_id === selectedCollection.id) : [],
    [packs, selectedCollection],
  );

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
    let alive = true;
    if (!selectedPacks.length) { setUnsortedCounts({}); return; }
    void Promise.all(selectedPacks.map(async (pack) => {
      const cards = await listCards(pack.id);
      return [pack.id, cards.filter((card) => !cardHasCompletedSort(card)).length] as const;
    })).then((rows) => { if (alive) setUnsortedCounts(Object.fromEntries(rows)); }).catch(() => { if (alive) setUnsortedCounts({}); });
    return () => { alive = false; };
  }, [selectedPacks]);

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

  function openCollection(id: string) {
    selectCollection(id);
    setCollectionId(id);
  }

  function backToCollections() {
    setCollectionId(null);
  }

  if (reviewsOpen) return <ReviewCentre collections={collections} packs={packs} overview={reviewOverview}
    initialCollectionIds={filteredReviewIds} onBack={() => { setReviewsOpen(false); refreshReviews(); }} onRefresh={refreshReviews} />;

  if (activeCollection) {
    const collectionPacks = packs.filter((pack) => pack.collection_id === activeCollection.id);
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

  const selectedCards = selectedPacks.reduce((sum, pack) => sum + pack.card_count, 0);
  const selectedSeen = selectedPacks.reduce((sum, pack) => sum + pack.encountered_cards, 0);
  const selectedPercent = selectedCards ? Math.min(100, Math.round((selectedSeen / selectedCards) * 100)) : 0;
  const selectedNewWords = selectedCollection ? relatedCounts[selectedCollection.id] ?? 0 : 0;
  const lastOpened = newestOpen(selectedPacks);
  const resumePack = selectedPacks.find((pack) => pack.last_opened_at === lastOpened) ?? selectedPacks[0];
  const otherCollections = selectedCollection ? collections.filter((collection) => collection.id !== selectedCollection.id) : collections;
  const waitingTotal = Object.values(relatedCounts).reduce((sum, count) => sum + count, 0);
  const selectedIsLatest = Boolean(selectedCollection && latestCollection && selectedCollection.id === latestCollection.id);

  return (
    <section className="library-page intelligent-library">
      <header className="intelligent-library-head">
        <div className="library-head-copy">
          <h1>Heuresis<span>.</span></h1>
          <p className="library-home-subtitle">Your library of language, knowledge and discoveries.</p>
          <div className="library-home-totals" aria-label="Library totals">
            <span><BookOpen size={15} aria-hidden="true" /><strong>{totalCards.toLocaleString()}</strong> cards</span>
            <span><Layers3 size={15} aria-hidden="true" /><strong>{collections.length.toLocaleString()}</strong> collections</span>
            {waitingTotal > 0 ? <span><Sparkles size={15} aria-hidden="true" /><strong>{waitingTotal.toLocaleString()}</strong> uncatalogued discoveries</span> : null}
          </div>
        </div>
      </header>

      {collections.length ? <div className="library-daily-grid">
        <section className="library-review-today" aria-label="Reviews today">
        <div className="library-review-today-title">
          <span className="library-review-overline"><Brain size={14} aria-hidden="true" /> DAILY PRACTICE</span>
          <h2>Reviews today <span>{reviewOverview ? reviewsReady.toLocaleString() + " ready" : "Checking…"}</span></h2>
          <p>{reviewOverview ? (reviewsReady ? plural(reviewsDone, "card") + " completed today" : "Your selected languages are clear for today") : "Checking your review history…"}
            {reverseTomorrow > 0 ? " · " + plural(reverseTomorrow, "reverse side") + " tomorrow" : ""}
            {reviewOverview?.incomplete ? " · Some topics could not be counted" : ""}</p>
        </div>
        <div className="library-review-today-controls">
          <div className="library-review-language-filters" role="group" aria-label="Choose languages for review">
            <button type="button" aria-pressed={reviewFilterIds === null} className={reviewFilterIds === null ? "is-active" : ""}
              onClick={() => setReviewFilterIds(null)}>All</button>
            {collections.map((collection) => <button type="button" key={collection.id}
              aria-pressed={reviewFilterIds !== null && reviewFilterIds.includes(collection.id)}
              className={reviewFilterIds !== null && reviewFilterIds.includes(collection.id) ? "is-active" : ""}
              onClick={() => toggleReviewCollection(collection.id)}>{collection.title}</button>)}
          </div>
          <button type="button" className="library-review-start" disabled={!reviewOverview || !filteredReviewIds.length}
            onClick={() => setReviewsOpen(true)}>Review selection <ArrowRight size={15} aria-hidden="true" /></button>
        </div>
        </section>
        <section className="library-new-today" aria-label="New cards daily quota">
          <div className="library-new-head">
            <span className="library-review-overline"><BookOpen size={14} aria-hidden="true" /> NEW LEARNING</span>
            <h2>New cards <span>{reviewOverview ? plural(newReady, "available card") : "Checking…"}</span></h2>
            <p>Classify new cards and add them to your learning queue.</p>
          </div>
          <div className="library-new-quota">
            <div className="library-new-quota-count"><strong>{todayNew}</strong><span> / {newCardQuota} today</span></div>
            <div className="library-new-quota-adjust" role="group" aria-label="Daily new cards target">
              <Target size={14} aria-hidden="true" />
              <button type="button" aria-label="Decrease daily new cards target by 5" disabled={newCardQuota <= 5} onClick={() => changeNewCardQuota(newCardQuota - 5)}><Minus size={13} /></button>
              <span>{newCardQuota} / day</span>
              <button type="button" aria-label="Increase daily new cards target by 5" disabled={newCardQuota >= 50} onClick={() => changeNewCardQuota(newCardQuota + 5)}><Plus size={13} /></button>
            </div>
          </div>
          <div className="library-new-progress" role="progressbar" aria-label="Daily new cards completed" aria-valuenow={Math.min(todayNew, newCardQuota)} aria-valuemin={0} aria-valuemax={newCardQuota}><span style={{ width: newProgress + "%" }} /></div>
          <div className="library-new-launch">
            <label htmlFor="library-new-topic">NEXT TOPIC</label>
            <select id="library-new-topic" value={nextNewTopic?.id ?? ""} disabled={!newTopics.length || newOpening}
              onChange={(event) => setNewTopicId(event.target.value)}>
              {newTopics.length ? newTopics.map((pack) => <option key={pack.id} value={pack.id}>{collections.find((item) => item.id === pack.collection_id)?.title ?? "Collection"} · {pack.title} ({reviewOverview?.topics[pack.id]?.newReady ?? 0})</option>)
                : <option value="">No new cards available</option>}
            </select>
            <button type="button" className="library-new-start" disabled={!reviewOverview || !nextNewTopic || !newBatchSize || newOpening}
              onClick={() => void startNewCards()}>{newOpening ? "Opening…" : todayNew >= newCardQuota ? "Extra cards" : "Start " + newBatchSize + (newBatchSize === 1 ? " card" : " cards")} <ArrowRight size={15} aria-hidden="true" /></button>
          </div>
          {newError ? <p className="library-new-error" role="alert">{newError}</p> : null}
          {reviewOverview?.incomplete ? <p className="library-new-note">Some topics could not be counted.</p> : null}
        </section>
      </div> : null}

      {selectedCollection ? <div className="library-desk">
        <section className="library-resume" data-accent={selectedCollection.accent} aria-label="Continue learning">
          <div className="library-continue-heading">
            <h2>Continue learning</h2>
            <span>{selectedIsLatest ? "Recently opened" : "Selected collection"}</span>
          </div>
          <div className="library-resume-head">
            <span className="library-resume-glyph" aria-hidden="true">{collectionGlyph(selectedCollection)}</span>
            <div className="library-resume-copy">
              <p className="eyebrow">COLLECTION</p>
              <button type="button" className="library-resume-title" onClick={() => openCollection(selectedCollection.id)}>{selectedCollection.title}</button>
              {selectedCollection.description ? <p>{selectedCollection.description}</p> : null}
              <div className="library-resume-figs">
                <span><b>{selectedCards.toLocaleString()}</b><small>cards</small></span>
                <span><b>{selectedSeen.toLocaleString()}</b><small>explored</small></span>
                <span><b>{selectedPercent}%</b><small>explored</small></span>
                {lastOpened ? <span><b>{formatSeen(lastOpened).replace("seen ", "")}</b><small>last opened</small></span> : null}
              </div>
            </div>
          </div>

          {selectedPacks.length ? <div className="library-resume-topics" aria-label="Collection topics">
            {selectedPacks.map((pack) => {
              const progress = pack.card_count ? Math.min(100, Math.round((pack.encountered_cards / pack.card_count) * 100)) : 0;
              const unsorted = unsortedCounts[pack.id] ?? 0;
              return <button type="button" key={pack.id} onClick={() => onOpen(pack)} title={"Open " + pack.title}>
                <span className="library-topic-copy">
                  <strong>{pack.title}</strong>
                  <small>{plural(pack.card_count, "card")}{unsorted ? " · " + unsorted.toLocaleString() + " unsorted" : ""}</small>
                </span>
                <span className="library-topic-progress">
                  <i aria-hidden="true"><em style={{ width: progress + "%" }} /></i>
                  <b>{progress}%</b>
                </span>
                <ChevronRight size={16} className="library-topic-chevron" aria-hidden="true" />
              </button>;
            })}
          </div> : <button type="button" className="library-resume-empty" onClick={() => openCollection(selectedCollection.id)}>Create your first topic <ArrowRight size={14} /></button>}

          {selectedNewWords > 0 ? <button type="button" className="library-waiting" onClick={() => onOpenNewWords(selectedCollection)}>
            <Sparkles size={16} aria-hidden="true" />
            <strong>{selectedNewWords.toLocaleString()}</strong>
            <span>uncatalogued {selectedNewWords === 1 ? "discovery" : "discoveries"}</span>
            <ChevronRight size={17} aria-hidden="true" />
          </button> : null}

          <div className="library-resume-actions">
            {resumePack ? <button type="button" className="library-resume-primary" onClick={() => onOpen(resumePack)}><Play size={15} fill="currentColor" aria-hidden="true" /> Continue topic</button>
              : <button type="button" className="library-resume-primary" onClick={() => onNewTopic(selectedCollection.id)}><Plus size={15} aria-hidden="true" /> New topic</button>}
            <button type="button" className="library-resume-secondary" onClick={() => openCollection(selectedCollection.id)}><BookOpen size={15} aria-hidden="true" /> All topics</button>
          </div>
        </section>

        <aside className="library-stack" aria-label="Other collections">
          <div className="library-stack-head">
            <h2>Collections</h2>
            <button type="button" className="library-stack-new" onClick={onNewCollection}><Plus size={14} aria-hidden="true" /> New</button>
          </div>
          {otherCollections.map((collection) => {
            const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
            const cards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
            const seen = collectionPacks.reduce((sum, pack) => sum + pack.encountered_cards, 0);
            const progress = cards ? Math.min(100, Math.round((seen / cards) * 100)) : 0;
            return <button type="button" key={collection.id} className={collectionPacks.length ? "library-mini" : "library-mini off"} data-accent={collection.accent} onClick={() => selectCollection(collection.id)} title={"Show " + collection.title + " on the Library page"}>
              <span className="library-mini-glyph" aria-hidden="true">{collectionGlyph(collection)}</span>
              <span className="library-mini-copy">
                <strong>{collection.title}</strong>
                <small>{collectionPacks.length ? plural(cards, "card") + " · " + plural(collectionPacks.length, "topic") + " · " + progress + "% explored" : "No topics yet"}</small>
                {collectionPacks.length ? <i aria-hidden="true"><em style={{ width: progress + "%" }} /></i> : null}
              </span>
              <ChevronRight size={17} className="library-mini-chevron" aria-hidden="true" />
            </button>;
          })}
          {archivedCount > 0 ? <button type="button" className="library-stack-archive" onClick={onArchive}>
            <Archive size={19} aria-hidden="true" />
            <span><strong>Archive</strong><small>{plural(archivedCount, "archived topic")}</small></span>
            <ChevronRight size={17} aria-hidden="true" />
          </button> : null}
          <button type="button" className="library-reviews-entry" onClick={() => setReviewsOpen(true)} title="Open Review Centre for all your topics">
            <span className="library-reviews-entry-icon" aria-hidden="true"><Brain size={23} /></span>
            <span className="library-reviews-entry-copy"><strong>Reviews</strong><small>Practise across all collections</small></span>
            <ChevronRight size={18} className="library-reviews-entry-chevron" aria-hidden="true" />
          </button>
        </aside>
      </div> : <div className="library-empty"><BookOpen size={22} /><strong>No collections yet.</strong><p>Create one and name it however you want.</p><button type="button" className="library-new-collection" onClick={onNewCollection}><Plus size={14} /> New collection</button></div>}
      {quickSort ? <SortModal key={quickSort.pack.id} pack={quickSort.pack} cards={quickSort.cards} tags={quickSort.tags}
        quickStartCount={quickSort.count} onClose={closeQuickSort} onChanged={() => undefined} /> : null}
    </section>
  );
}
