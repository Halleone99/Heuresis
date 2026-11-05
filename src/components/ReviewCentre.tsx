import { ArrowLeft, ArrowRight, BookOpen, Brain, Layers3 } from "lucide-react";
import { useRef, useState } from "react";
import { listTopicCards, type CardWithStats, type Collection, type PackWithType } from "../lib/heuresis";
import StudyModal from "./StudyModal";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  onBack: () => void;
};

type SelectedReview = { pack: PackWithType; cards: CardWithStats[] };

export default function ReviewCentre({ collections, packs, onBack }: Props) {
  const [selected, setSelected] = useState<SelectedReview | null>(null);
  const [loadingPackId, setLoadingPackId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const request = useRef(0);
  const availableCollections = collections.map((collection) => ({
    collection,
    topics: packs.filter((pack) => pack.collection_id === collection.id && pack.card_count > 0),
  })).filter((group) => group.topics.length > 0);
  const topicCount = availableCollections.reduce((sum, group) => sum + group.topics.length, 0);

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
          <p>One place to revisit what you are learning. Choose any topic, then use its existing review directions, session settings and filters.</p>
        </div>
        <div className="reviews-centre-summary" aria-label="Review library totals">
          <span><strong>{topicCount}</strong><small>{topicCount === 1 ? "topic" : "topics"}</small></span>
          <span><strong>{availableCollections.length}</strong><small>{availableCollections.length === 1 ? "collection" : "collections"}</small></span>
        </div>
      </header>
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
                      <small>{pack.card_count.toLocaleString()} {pack.card_count === 1 ? "card" : "cards"} · {pack.cardType?.name ?? "Study topic"}</small></span>
                    <span className="reviews-centre-topic-action">{loadingPackId === pack.id ? "Loading…" : "Review"} <ArrowRight size={15} aria-hidden="true" /></span>
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="reviews-centre-empty"><BookOpen size={25} /><h2>No review topics yet</h2><p>Create a topic and add learning cards to begin.</p>
          <button type="button" onClick={leave}>Back to Library <ArrowRight size={15} /></button></div>
      )}
      {selected ? <StudyModal key={selected.pack.id} pack={selected.pack} cards={selected.cards}
        onClose={() => setSelected(null)} onComplete={() => undefined} /> : null}
    </section>
  );
}
