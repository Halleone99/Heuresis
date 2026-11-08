import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, Layers3, Link2, Pencil, Play, Plus, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadReviewOverview, type ReviewOverview } from "../lib/reviewOverview";
import { countCaptureInbox } from "../lib/captureInbox";
import { listCards, listTags, type CardWithStats, type Collection, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { NEW_CARD_QUOTA_EVENT, readNewCardQuota } from "../lib/newCardQuota";
import { listRelatedCounts } from "../lib/related";
import { cardHasCompletedSort } from "../lib/sort";
import ReviewCentre from "./ReviewCentre";
import SortModal from "./SortModal";
import TodayStudyPanel from "./TodayStudyPanel";

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

export default function LibraryView({ collections, packs, onOpen, onOpenCaptureInbox, onNewTopic, onEditPack, onOpenNewWords, onNewCollection }: Props) {
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [reviewsOpen, setReviewsOpen] = useState(false);
  const [reviewOverview, setReviewOverview] = useState<ReviewOverview | null>(null);
  const [reviewRevision, setReviewRevision] = useState(0);
  const [newCardQuota, setNewCardQuota] = useState(readNewCardQuota);
  const [quickSort, setQuickSort] = useState<QuickSortSession | null>(null);
  const [newOpening, setNewOpening] = useState(false);
  const [newError, setNewError] = useState("");
  const [reviewLaunchIds, setReviewLaunchIds] = useState<string[] | null>(null);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(LAST_COLLECTION_KEY); } catch { return null; }
  });
  const [relatedCounts, setRelatedCounts] = useState<Record<string, number>>({});
  const [captureRevision, setCaptureRevision] = useState(0);
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === collectionId) ?? null, [collectionId, collections]);
  const totalCards = packs.reduce((sum, pack) => sum + pack.card_count, 0);
  const filteredReviewIds = reviewLaunchIds ?? collections.map((item) => item.id);
  const refreshReviews = () => setReviewRevision((previous) => previous + 1);

  async function startNewCards(pack: PackWithType, count: number) {
    if (!Number.isInteger(count) || count < 1 || newOpening) return;
    setNewOpening(true);
    setNewError("");
    try {
      const [cards, tags] = await Promise.all([listCards(pack.id), listTags()]);
      const unsorted = cards.filter((card) => !cardHasCompletedSort(card));
      if (!unsorted.length) { refreshReviews(); setNewError("No unclassified cards remain in this topic."); return; }
      setQuickSort({ pack, cards, tags, count: Math.min(count, unsorted.length) });
    } catch (failure) {
      setNewError(failure instanceof Error ? failure.message : "Could not start new cards.");
    } finally { setNewOpening(false); }
  }

  function closeQuickSort() {
    setQuickSort(null);
    refreshReviews();
    window.dispatchEvent(new Event("heuresis:study-changed"));
  }

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
          </div>
        </div>
      </header>

      {collections.length ? <TodayStudyPanel collections={collections} packs={packs} overview={reviewOverview}
        quota={newCardQuota} opening={newOpening} error={newError}
        onReview={(ids) => { setReviewLaunchIds(ids); setReviewsOpen(true); }}
        onStartNew={(pack, count) => void startNewCards(pack, count)} /> : null}

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
          
        </aside>
      </div> : <div className="library-empty"><BookOpen size={22} /><strong>No collections yet.</strong><p>Create one and name it however you want.</p><button type="button" className="library-new-collection" onClick={onNewCollection}><Plus size={14} /> New collection</button></div>}
      {quickSort ? <SortModal key={quickSort.pack.id} pack={quickSort.pack} cards={quickSort.cards} tags={quickSort.tags}
        quickStartCount={quickSort.count} onClose={closeQuickSort} onChanged={() => undefined} /> : null}
    </section>
  );
}
