import { BookOpen, Layers3 } from "lucide-react";
import type { Collection, PackWithType } from "../lib/heuresis";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  onCapture: (pack: PackWithType) => void;
};

export default function LibraryView({ collections, packs, onCapture }: Props) {
  return (
    <section className="page-section">
      <div className="page-heading">
        <div><p className="eyebrow">LIBRARY</p><h1>Your learning world.</h1></div>
        <p className="page-subtitle">This first desktop cut reads the same Heuresis collections and packs already stored in Supabase.</p>
      </div>

      <div className="collection-grid">
        {collections.map((collection) => {
          const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
          return (
            <article className="collection-card" key={collection.id} data-accent={collection.accent}>
              <div className="collection-topline">
                <span className="collection-glyph">{collection.glyph || collection.title.slice(0, 1)}</span>
                <span>{collectionPacks.length} pack{collectionPacks.length === 1 ? "" : "s"}</span>
              </div>
              <h2>{collection.title}</h2>
              {collection.description ? <p>{collection.description}</p> : null}
              <div className="pack-list">
                {collectionPacks.map((pack) => (
                  <button key={pack.id} className="pack-row" onClick={() => onCapture(pack)}>
                    <span><BookOpen size={15} /><strong>{pack.title}</strong></span>
                    <small>{pack.cardType?.name || "Card"}</small>
                  </button>
                ))}
                {!collectionPacks.length ? <div className="empty-line"><Layers3 size={15} /> No active packs</div> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
