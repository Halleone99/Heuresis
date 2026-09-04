import { ArrowLeft, ArrowRight, Archive, BookOpen, Pencil, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { Collection, PackWithType } from "../lib/heuresis";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  archivedCount: number;
  onOpen: (pack: PackWithType) => void;
  onCapture: (pack: PackWithType) => void;
  onEditPack: (pack: PackWithType) => void;
  onArchive: () => void;
};

const LAST_COLLECTION_KEY = "pos.heuresis.lastCollection";

export default function LibraryView({ collections, packs, archivedCount, onOpen, onCapture, onEditPack, onArchive }: Props) {
  const [collectionId, setCollectionId] = useState<string | null>(() => {
    try {
      const stored = sessionStorage.getItem(LAST_COLLECTION_KEY);
      return stored && collections.some((collection) => collection.id === stored) ? stored : null;
    } catch { return null; }
  });
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === collectionId) ?? null, [collectionId, collections]);
  const totalCards = packs.reduce((sum, pack) => sum + pack.card_count, 0);

  function openCollection(id: string) {
    setCollectionId(id);
    try { sessionStorage.setItem(LAST_COLLECTION_KEY, id); } catch { /* navigation preference only */ }
  }

  function backToCollections() {
    setCollectionId(null);
    try { sessionStorage.removeItem(LAST_COLLECTION_KEY); } catch { /* navigation preference only */ }
  }

  if (activeCollection) {
    const collectionPacks = packs.filter((pack) => pack.collection_id === activeCollection.id);
    const collectionCards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
    return (
      <section className="library-page collection-page" data-accent={activeCollection.accent}>
        <button className="text-button back-button" onClick={backToCollections}><ArrowLeft size={15} /> Library</button>
        <header className="collection-page-head">
          <div className="collection-title-block">
            <span className="collection-page-glyph">{activeCollection.glyph || activeCollection.title.slice(0, 1)}</span>
            <div><p className="eyebrow">COLLECTION</p><h1>{activeCollection.title}</h1>{activeCollection.description ? <p>{activeCollection.description}</p> : null}</div>
          </div>
          <span className="library-stat">{collectionPacks.length} topics · {collectionCards.toLocaleString()} cards</span>
        </header>

        <div className="topics-intro"><div><p className="eyebrow">TOPICS</p><h2>Choose what you want to explore.</h2></div><span>Bounded sets: lessons, verbs, sentences, reviews, concepts.</span></div>

        {collectionPacks.length ? <div className="topic-grid">{collectionPacks.map((pack) => (
          <article className="topic-card" key={pack.id}>
            <button className="topic-card-main" onClick={() => onOpen(pack)}>
              <span className="topic-ghost">{activeCollection.glyph || "·"}</span>
              <p className="eyebrow">TOPIC</p>
              <h3>{pack.title}</h3>
              {pack.description ? <p>{pack.description}</p> : null}
              <div className="topic-meta"><span>{pack.card_count.toLocaleString()} cards</span><span>·</span><span>{pack.encountered_cards.toLocaleString()} encountered</span></div>
              <span className="topic-open">Open <ArrowRight size={14} /></span>
            </button>
            <div className="topic-card-tools">
              <button onClick={() => onCapture(pack)} title={`Add a card to ${pack.title}`}><Plus size={14} /> Add</button>
              <button onClick={() => onEditPack(pack)} title={`Edit ${pack.title}`}><Pencil size={14} /> Edit</button>
            </div>
          </article>
        ))}</div> : <div className="library-empty"><BookOpen size={22} /><strong>No topics yet.</strong><p>Create a topic for a bounded thing you want to learn or review.</p></div>}
      </section>
    );
  }

  return (
    <section className="library-page">
      <div className="library-summary"><span>{collections.length} collections · {packs.length} topics · {totalCards.toLocaleString()} cards</span>{archivedCount ? <button className="text-button" onClick={onArchive}><Archive size={14} /> Archive · {archivedCount}</button> : null}</div>
      <div className="library-hero"><div><p className="eyebrow">LIBRARY</p><h1>Your learning world.</h1></div><p>The same Heuresis database as Personal OS, now in its own desktop application.</p></div>
      <div className="collection-overview-grid">{collections.map((collection) => {
        const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
        const cards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
        return <button className="collection-overview-card" key={collection.id} data-accent={collection.accent} onClick={() => openCollection(collection.id)}><span className="collection-overview-glyph">{collection.glyph || collection.title.slice(0, 1)}</span><div><h2>{collection.title}</h2>{collection.description ? <p>{collection.description}</p> : null}</div><span className="collection-overview-meta">{collectionPacks.length} topics · {cards.toLocaleString()} cards</span><span className="collection-open">Open <ArrowRight size={14} /></span></button>;
      })}</div>
      {!collections.length ? <div className="library-empty"><BookOpen size={22} /><strong>No collections yet.</strong><p>Create one from Collections in the top bar.</p></div> : null}
    </section>
  );
}
