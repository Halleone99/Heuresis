import { ArrowRight, BookOpen, Layers3, Plus } from "lucide-react";
import type { Collection, PackWithType } from "../lib/heuresis";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  onOpen: (pack: PackWithType) => void;
  onCapture: (pack: PackWithType) => void;
};

export default function LibraryView({ collections, packs, onOpen, onCapture }: Props) {
  const totalCards = packs.reduce((sum, pack) => sum + pack.card_count, 0);
  return (
    <section className="page-section">
      <div className="page-heading">
        <div><p className="eyebrow">LIBRARY</p><h1>Your learning world.</h1></div>
        <p className="page-subtitle">{collections.length} collections · {packs.length} topics · {totalCards.toLocaleString()} cards. Same Supabase data, now independent of Personal OS.</p>
      </div>

      <div className="collection-grid">
        {collections.map((collection) => {
          const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
          const collectionCards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
          return (
            <article className="collection-card" key={collection.id} data-accent={collection.accent}>
              <div className="collection-topline">
                <span className="collection-glyph">{collection.glyph || collection.title.slice(0, 1)}</span>
                <span>{collectionPacks.length} topics · {collectionCards.toLocaleString()} cards</span>
              </div>
              <h2>{collection.title}</h2>
              {collection.description ? <p>{collection.description}</p> : null}
              <div className="pack-list">
                {collectionPacks.map((pack) => (
                  <div key={pack.id} className="pack-row-wrap">
                    <button className="pack-row" onClick={() => onOpen(pack)}>
                      <span><BookOpen size={15} /><strong>{pack.title}</strong></span>
                      <small>{pack.card_count} cards <ArrowRight size={13} /></small>
                    </button>
                    <button className="pack-capture" onClick={() => onCapture(pack)} title={`Capture into ${pack.title}`} aria-label={`Capture into ${pack.title}`}><Plus size={14} /></button>
                  </div>
                ))}
                {!collectionPacks.length ? <div className="empty-line"><Layers3 size={15} /> No active topics</div> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
