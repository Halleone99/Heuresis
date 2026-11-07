import { ArrowLeft, ArrowRight, Archive, BookOpen, ChevronRight, Layers3, Link2, Pencil, Play, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadReviewOverview, type ReviewOverview } from "../lib/reviewOverview";
import { countCaptureInbox } from "../lib/captureInbox";
import { listCards, listTags, type CardWithStats, type Collection, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { NEW_CARD_QUOTA_EVENT, readNewCardQuota } from "../lib/newCardQuota";
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
  const newBatchSize = Math.min(newTopicReady, Math.max(1, newCardQuota - todayNew || newCardQuota));

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
  const selectedNewWords = selectedCollection ? relatedCounts[selectedCollection.id] ?? 0 : 0;
  const lastOpened = newestOpen(selectedPacks);
  const resumePack = selectedPacks.find((pack) => pack.last_opened_at === lastOpened) ?? selectedPacks[0];
  const recentPacks = selectedPacks.slice().sort((a, b) => Date.parse(b.last_opened_at ?? "1970-01-01") - Date.parse(a.last_opened_at ?? "1970-01-01")).slice(0, 2);
  const selectedIsLatest = Boolean(selectedCollection && latestCollection && selectedCollection.id === latestCollection.id);

  return (
    <section className="library-page intelligent-library">
      <header className="intelligent-library-head">
        <div className="library-head-copy">
          <h1>Heuresis<span>.</span></h1>
          
          <div className="library-home-totals" aria-label="Library totals">
            <span><BookOpen size={15} aria-hidden="true" /><strong>{totalCards.toLocaleString()}</strong> cards</span>
            <span><Layers3 size={15} aria-hidden="true" /><strong>{collections.length.toLocaleString()}</strong> collections</span>
            {waitingTotal > 0 ? <span><Sparkles size={15} aria-hidden="true" /><strong>{waitingTotal.toLocaleString()}</strong> uncatalogued discoveries</span> : null}
          </div>
        </div>
      </header>

      {collections.length ? <section className="library-study-panel" aria-label="Today's study">
        <div className="library-study-heading">
          <h2>Today's study</h2>
          <span>{reviewOverview ? plural(reviewsDone, "card") + " reviewed today" : "Checking study progress…"}</span>
        </div>
        <div className="library-study-actions">
          <section className="library-review-today" aria-label="Reviews today">
            <div className="library-study-main">
              <span className="library-study-kicker">REVIEW</span>
              <div className="library-study-metric"><strong>{reviewOverview ? reviewsReady.toLocaleString() : "—"}</strong><span>due</span></div>
              <p>Keep the cards you've learnt in memory.</p>
            </div>
            <div className="library-review-language-filters" role="group" aria-label="Choose collections for review">
              <button type="button" aria-pressed={reviewFilterIds === null} className={reviewFilterIds === null ? "is-active" : ""}
                onClick={() => setReviewFilterIds(null)}>All</button>
              {collections.map((collection) => <button type="button" key={collection.id}
                aria-pressed={reviewFilterIds !== null && reviewFilterIds.includes(collection.id)}
                className={reviewFilterIds !== null && reviewFilterIds.includes(collection.id) ? "is-active" : ""}
                onClick={() => toggleReviewCollection(collection.id)}>{collection.title}</button>)}
            </div>
            <button type="button" className="library-review-start" disabled={!reviewOverview || !filteredReviewIds.length}
              onClick={() => setReviewsOpen(true)}>{reviewsReady > 0 ? "Review " + plural(reviewsReady, "card") : "Open reviews"} <ArrowRight size={15} aria-hidden="true" /></button>
          </section>
          <section className="library-new-today" aria-label="New cards">
            <div className="library-study-main">
              <span className="library-study-kicker">NEW CARDS</span>
              <div className="library-study-metric"><strong>{reviewOverview ? newReady.toLocaleString() : "—"}</strong><span>available</span></div>
              <p>{reviewOverview ? plural(todayNew, "card") + " introduced today" : "Checking available cards…"}</p>
            </div>
            <div className="library-new-launch">
              <label htmlFor="library-new-topic">Choose a topic</label>
              <select id="library-new-topic" aria-label="Choose a topic for new cards" value={nextNewTopic?.id ?? ""} disabled={!newTopics.length || newOpening}
                onChange={(event) => setNewTopicId(event.target.value)}>
                {newTopics.length ? newTopics.map((pack) => <option key={pack.id} value={pack.id}>{collections.find((item) => item.id === pack.collection_id)?.title ?? "Collection"} · {pack.title} ({reviewOverview?.topics[pack.id]?.newReady ?? 0})</option>)
                  : <option value="">No new cards available</option>}
              </select>
              <button type="button" className="library-new-start" disabled={!reviewOverview || !nextNewTopic || !newBatchSize || newOpening}
                onClick={() => void startNewCards()}>{newOpening ? "Opening…" : todayNew >= newCardQuota ? "Study extra cards" : "Start " + plural(newBatchSize, "card")} <ArrowRight size={15} aria-hidden="true" /></button>
            </div>
            {newError ? <p className="library-new-error" role="alert">{newError}</p> : null}
          </section>
        </div>
        {reviewOverview?.incomplete || reverseTomorrow > 0 ? <div className="library-study-footnote">
          {reverseTomorrow > 0 ? plural(reverseTomorrow, "reverse side") + " scheduled tomorrow" : ""}
          {reviewOverview?.incomplete ? (reverseTomorrow > 0 ? " · " : "") + "Some topics could not be counted." : ""}
        </div> : null}
      </section> : null}

      {selectedCollection ? <div className="library-desk">
        <section className="library-resume" data-accent={selectedCollection.accent} aria-label="Continue learning">
          <div className="library-continue-heading">
            <h2>Continue learning</h2>
            <span>{selectedIsLatest ? "Recently opened" : "Selected collection"}</span>
          </div>
          <div className="library-resume-head">
            <span className="library-resume-glyph" aria-hidden="true">{collectionGlyph(selectedCollection)}</span>
            <div className="library-resume-copy">
              <button type="button" className="library-resume-title" onClick={() => openCollection(selectedCollection.id)}>{selectedCollection.title}</button>
              <p className="library-resume-summary">{selectedCards ? selectedSeen.toLocaleString() + " of " + selectedCards.toLocaleString() + " cards explored" : "No cards yet"}</p>
            </div>
          </div>
          {recentPacks.length ? <div className="library-resume-topics" aria-label="Recent topics">
            {recentPacks.map((pack) => <button type="button" key={pack.id} onClick={() => onOpen(pack)} title={"Open " + pack.title}>
              <span className="library-topic-copy"><strong>{pack.title}</strong><small>{plural(pack.card_count, "card")}</small></span>
              <ChevronRight size={16} className="library-topic-chevron" aria-hidden="true" />
            </button>)}
          </div> : <button type="button" className="library-resume-empty" onClick={() => onNewTopic(selectedCollection.id)}>Create your first topic <ArrowRight size={14} /></button>}
          <div className="library-resume-actions">
            {resumePack ? <button type="button" className="library-resume-primary" onClick={() => onOpen(resumePack)} title={"Continue " + resumePack.title}><Play size={14} fill="currentColor" aria-hidden="true" /> Continue last topic</button>
              : <button type="button" className="library-resume-primary" onClick={() => onNewTopic(selectedCollection.id)}><Plus size={14} aria-hidden="true" /> New topic</button>}
            <button type="button" className="library-resume-secondary" onClick={() => openCollection(selectedCollection.id)}>View all topics</button>
          </div>
          {selectedNewWords > 0 ? <button type="button" className="library-resume-discoveries" onClick={() => onOpenNewWords(selectedCollection)}>
            <Sparkles size={14} aria-hidden="true" /> {plural(selectedNewWords, "uncatalogued discovery")} <ArrowRight size={13} aria-hidden="true" />
          </button> : null}
        </section>
        <aside className="library-stack" aria-label="Collections">
          <div className="library-stack-head">
            <h2>Collections</h2>
            <button type="button" className="library-stack-new" onClick={onNewCollection}><Plus size={14} aria-hidden="true" /> New</button>
          </div>
          {collections.map((collection) => {
            const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
            const cards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
            return <button type="button" key={collection.id} className={"library-mini" + (!collectionPacks.length ? " off" : "") + (collection.id === selectedCollection.id ? " is-current" : "")}
              data-accent={collection.accent} onClick={() => openCollection(collection.id)} title={"Open " + collection.title}>
              <span className="library-mini-glyph" aria-hidden="true">{collectionGlyph(collection)}</span>
              <span className="library-mini-copy">
                <strong>{collection.title}</strong>
                <small>{plural(cards, "card")} · {plural(collectionPacks.length, "topic")}</small>
              </span>
              <ChevronRight size={16} className="library-mini-chevron" aria-hidden="true" />
            </button>;
          })}
          {archivedCount > 0 ? <button type="button" className="library-stack-archive-link" onClick={onArchive}>
            <Archive size={14} aria-hidden="true" /> Archive · {plural(archivedCount, "topic")}
          </button> : null}
        </aside>
      </div> : <div className="library-empty"><BookOpen size={22} /><strong>No collections yet.</strong><p>Create one and name it however you want.</p><button type="button" className="library-new-collection" onClick={onNewCollection}><Plus size={14} /> New collection</button></div>}
      {quickSort ? <SortModal key={quickSort.pack.id} pack={quickSort.pack} cards={quickSort.cards} tags={quickSort.tags}
        quickStartCount={quickSort.count} onClose={closeQuickSort} onChanged={() => undefined} /> : null}
    </section>
  );
}
