import { ArrowLeft, ArrowRight, BookOpen, Brain, Layers3, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";
import { listTopicCards, type CardWithStats, type Collection, type PackWithType } from "../lib/heuresis";
import { openCosmosWindow } from "../lib/cosmosWindow";
import { defaultDirections } from "../lib/recommend";
import { loadStudySetup } from "../lib/study";
import type { ReviewOverview } from "../lib/reviewOverview";
import StudyModal from "./StudyModal";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  overview: ReviewOverview | null;
  initialCollectionIds: string[];
  onBack: () => void;
  onRefresh: () => void;
};

type SelectedReview = { pack: PackWithType; cards: CardWithStats[] };

export default function ReviewCentre({ collections, packs, overview, initialCollectionIds, onBack, onRefresh }: Props) {
  const [selected, setSelected] = useState<SelectedReview | null>(null);
  const [collectionIds, setCollectionIds] = useState<string[]>(initialCollectionIds);
  const [loadingPackId, setLoadingPackId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [route, setRoute] = useState<string[]>([]);
  const [routePosition, setRoutePosition] = useState(0);
  const request = useRef(0);

  const availableCollections = collections.filter((collection) => collectionIds.includes(collection.id)).map((collection) => ({
    collection,
    topics: packs.filter((pack) => pack.collection_id === collection.id && pack.card_count > 0),
  })).filter((group) => group.topics.length > 0);
  const eligiblePacks = availableCollections.flatMap((group) => group.topics)
    .filter((pack) => (overview?.topics[pack.id]?.ready ?? 0) > 0);
  const topicCount = availableCollections.reduce((sum, group) => sum + group.topics.length, 0);
  const readyCount = eligiblePacks.reduce((sum, pack) => sum + (overview?.topics[pack.id]?.ready ?? 0), 0);
  const nextPack = packs.find((pack) => pack.id === route[routePosition]);

  function toggleCollection(id: string) {
    setCollectionIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
    setRoute([]);
    setRoutePosition(0);
  }

  async function chooseTopic(pack: PackWithType) {
    const thisRequest = ++request.current;
    setSelected(null);
    setError("");
    setLoadingPackId(pack.id);
    try {
      const { learning } = await listTopicCards(pack.id);
      if (thisRequest !== request.current) return;
      if (!learning.length) {
        setError(`No learning cards are available in “${pack.title}”. Move cards from Reference to Learning, or finish sorting them, before reviewing.`);
        return;
      }
      setSelected({ pack, cards: learning });
    } catch (failure) {
      if (thisRequest === request.current) setError(failure instanceof Error ? failure.message : "Could not load this topic.");
    } finally {
      if (thisRequest === request.current) setLoadingPackId(null);
    }
  }

  /** A guided review across collections, preserving the existing topic-specific
   * templates, grading and Supabase session records. Each topic opens in Review,
   * then the next can be launched from this page. */
  async function launchPack(packId: string, nextPosition: number) {
    const pack = packs.find((entry) => entry.id === packId);
    if (!pack || loadingPackId) return;
    const cardIds = overview?.topics[packId]?.readyCardIds ?? [];
    if (!cardIds.length) { setRoutePosition(nextPosition); return; }
    setError("");
    setLoadingPackId(packId);
    try {
      const setup = await loadStudySetup(pack.id, pack.card_type_id);
      const templateIds = defaultDirections(setup.templates, setup.defaultTemplateId).map((item) => item.id);
      if (!templateIds.length) throw new Error(`No review directions are configured for “${pack.title}”.`);
      await openCosmosWindow({
        mode: "review", packId, templateIds, source: "all", order: "weakest",
        count: "all", cardIds,
      });
      setRoutePosition(nextPosition);
      onRefresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not open Review.");
    } finally {
      setLoadingPackId(null);
    }
  }

  function startAll() {
    if (loadingPackId || !eligiblePacks.length) return;
    const ids = eligiblePacks.map((pack) => pack.id);
    setRoute(ids);
    setRoutePosition(0);
    void launchPack(ids[0], 1);
  }

  function leave() {
    request.current += 1;
    onBack();
  }

  return (
    <section className="reviews-centre" aria-label="Review Centre">
      <button type="button" className="reviews-centre-back" onClick={leave}><ArrowLeft size={16} /> Library</button>
      <header className="reviews-centre-header">
        <div className="reviews-centre-intro">
          <span className="reviews-centre-eyebrow"><Brain size={14} /> YOUR PRACTICE SPACE</span>
          <h1>Review Centre<span>.</span></h1>
          <p>Review every available card from the languages you choose, one topic at a time. The reverse side is left for tomorrow after a successful answer.</p>
        </div>
        <div className="reviews-centre-summary" aria-label="Review totals">
          <span><strong>{overview ? readyCount.toLocaleString() : "–"}</strong><small>ready today</small></span>
          <span><strong>{topicCount}</strong><small>{topicCount === 1 ? "topic" : "topics"}</small></span>
        </div>
      </header>
      <div className="reviews-centre-review-bar">
        <div className="reviews-centre-filter-group" role="group" aria-label="Filter review languages">
          <button type="button" className={collectionIds.length === collections.length ? "active" : ""} aria-pressed={collectionIds.length === collections.length}
            onClick={() => { setCollectionIds(collections.map((collection) => collection.id)); setRoute([]); setRoutePosition(0); }}>All</button>
          {collections.map((collection) => <button type="button" key={collection.id}
            className={collectionIds.includes(collection.id) && collectionIds.length !== collections.length ? "active" : ""}
            aria-pressed={collectionIds.includes(collection.id)} onClick={() => toggleCollection(collection.id)}>{collection.title}</button>)}
        </div>
        <button type="button" className="reviews-centre-start-all" disabled={!overview || !eligiblePacks.length || loadingPackId !== null}
          onClick={startAll}>{loadingPackId ? "Opening…" : `Review all available · ${readyCount}`} <ArrowRight size={15}/></button>
      </div>
      {route.length ? <div className="reviews-centre-route" role="status">
        <span>{routePosition >= route.length ? "All selected topics opened" : `${routePosition} of ${route.length} topics opened`}</span>
        {nextPack ? <button type="button" onClick={() => void launchPack(nextPack.id, routePosition + 1)}
          disabled={loadingPackId !== null}>Next · {nextPack.title} <ArrowRight size={14}/></button>
          : <button type="button" onClick={() => { setRoute([]); setRoutePosition(0); onRefresh(); }}><RefreshCw size={14}/> Recheck reviews</button>}
      </div> : null}
      {overview?.incomplete ? <p className="reviews-centre-error" role="status">Some topics could not be counted. Only verified available cards are included.</p> : null}
      {error ? <p className="reviews-centre-error" role="alert">{error}</p> : null}
      {availableCollections.length ? (
        <div className="reviews-centre-collections">
          {availableCollections.map(({ collection, topics }) => (
            <section className="reviews-centre-group" key={collection.id} data-accent={collection.accent} aria-label={collection.title}>
              <header className="reviews-centre-group-header">
                <span className="reviews-centre-glyph" aria-hidden="true">{collection.glyph || collection.title.slice(0, 1)}</span>
                <div><h2>{collection.title}</h2><small>{topics.length} {topics.length === 1 ? "topic" : "topics"}</small></div>
                <Layers3 size={16} aria-hidden="true" className="reviews-centre-group-icon" />
              </header>
              <div className="reviews-centre-topic-list">
                {topics.map((pack) => (
                  <button type="button" key={pack.id} onClick={() => void chooseTopic(pack)}
                    disabled={loadingPackId !== null} aria-busy={loadingPackId === pack.id}
                    className="reviews-centre-topic">
                    <span className="reviews-centre-topic-info"><strong>{pack.title}</strong>
                      <small>{overview ? `${overview.topics[pack.id]?.ready ?? 0} ready · ` : ""}{pack.card_count.toLocaleString()} total cards</small></span>
                    <span className="reviews-centre-topic-action">{loadingPackId === pack.id ? "Loading…" : "Review topic"} <ArrowRight size={15} aria-hidden="true" /></span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="reviews-centre-empty"><BookOpen size={25} /><h2>{collectionIds.length ? "No review topics yet" : "Choose a language"}</h2>
          <p>{collectionIds.length ? "Create a topic and add learning cards to begin." : "Select one or more collections to review."}</p></div>
      )}
      {selected ? <StudyModal key={selected.pack.id} pack={selected.pack} cards={selected.cards}
        onClose={() => setSelected(null)} onComplete={onRefresh} /> : null}
    </section>
  );
}
