import { ArrowLeft, ArrowRight, Archive, BookOpen, Link2, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { countCaptureInbox } from "../lib/captureInbox";
import type { Collection, PackWithType } from "../lib/heuresis";
import { listRelatedCounts } from "../lib/related";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  archivedCount: number;
  onOpen: (pack: PackWithType) => void;
  onCapture: (pack: PackWithType) => void;
  onOpenCaptureInbox: (collection: Collection) => void;
  onEditPack: (pack: PackWithType) => void;
  onOpenNewWords: (collection: Collection) => void;
  onArchive: () => void;
  onNewCollection: () => void;
};

const LAST_COLLECTION_KEY = "pos.heuresis.lastCollection";

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

function collectionGlyph(collection: Collection) {
  if (collection.title.trim().toLowerCase() === "english" || collection.glyph === "þ") return "A";
  return collection.glyph || collection.title.slice(0, 1);
}

export default function LibraryView({ collections, packs, archivedCount, onOpen, onOpenCaptureInbox, onEditPack, onOpenNewWords, onArchive, onNewCollection }: Props) {
  const [collectionId, setCollectionId] = useState<string | null>(() => {
    try {
      const stored = sessionStorage.getItem(LAST_COLLECTION_KEY);
      return stored && collections.some((collection) => collection.id === stored) ? stored : null;
    } catch { return null; }
  });
  const [relatedCounts, setRelatedCounts] = useState<Record<string, number>>({});
  const [captureRevision, setCaptureRevision] = useState(0);
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === collectionId) ?? null, [collectionId, collections]);
  const totalCards = packs.reduce((sum, pack) => sum + pack.card_count, 0);

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
            {newWordsCount ? <span><strong>{newWordsCount.toLocaleString()}</strong><em>new words</em></span> : null}
          </div>
        </header>

        <div className="topics-intro"><div><p className="eyebrow">TOPICS</p><h2>Choose what you want to explore.</h2></div></div>

        {collectionPacks.length ? <div className="topic-grid">
          <article className="topic-card topic-card-inbox">
            <div className="topic-card-main topic-card-static">
              <span className="topic-ghost">+</span>
              <p className="eyebrow">INBOX</p>
              <h3>Learning inbox</h3>
              <p>New vocabulary and drafts waiting for you.</p>
              <div className="topic-meta"><span>{plural(newWordsCount, "new word")}</span><span>·</span><span>{plural(captureCount, "draft")}</span></div>
            </div>
            <div className="topic-card-tools topic-card-footer-actions">
              <button onClick={() => onOpenNewWords(activeCollection)}><Link2 size={14} /> New words <span className="footer-count">{newWordsCount}</span></button>
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
              <div className="topic-card-tools topic-card-footer-actions">
                <button onClick={() => onOpen(pack)}><ArrowRight size={14} /> Open</button>
                <button onClick={() => onEditPack(pack)} title={`Edit ${pack.title}`}><Pencil size={14} /> Settings</button>
              </div>
            </article>
          ))}
        </div> : <div className="library-empty"><BookOpen size={22} /><strong>No topics yet.</strong><p>Create a topic to start building this collection.</p></div>}
      </section>
    );
  }

  return (
    <section className="library-page">
      <div className="library-hero library-identity-hero">
        <div className="library-identity-title"><p className="eyebrow">LIBRARY</p><h1>Heuresis<span className="library-title-dot">.</span></h1></div>
      </div>
      <div className="library-summary library-summary-bar">
        <div className="library-summary-metrics" aria-label="Library totals">
          <span><strong>{collections.length.toLocaleString()}</strong><em>{collections.length === 1 ? "collection" : "collections"}</em></span>
          <span><strong>{packs.length.toLocaleString()}</strong><em>{packs.length === 1 ? "topic" : "topics"}</em></span>
          <span><strong>{totalCards.toLocaleString()}</strong><em>{totalCards === 1 ? "card" : "cards"}</em></span>
        </div>
        <div className="library-summary-actions">
          {archivedCount ? <button className="text-button library-archive-link" onClick={onArchive}><Archive size={14} /> Archive · {archivedCount}</button> : null}
          <button className="library-new-collection" onClick={onNewCollection}><Plus size={14} /> New collection</button>
        </div>
      </div>
      <div className="collection-overview-grid">{collections.map((collection) => {
        const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
        const cards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
        const newWords = relatedCounts[collection.id] ?? 0;
        return <button className="collection-overview-card" key={collection.id} data-accent={collection.accent} onClick={() => openCollection(collection.id)}><span className="collection-overview-glyph">{collectionGlyph(collection)}</span><div><h2>{collection.title}</h2>{collection.description ? <p>{collection.description}</p> : null}</div><span className="collection-overview-meta">{plural(collectionPacks.length, "topic")} · {plural(cards, "card")}{newWords ? ` · ${plural(newWords, "new word")}` : ""}</span><span className="collection-open">Open <ArrowRight size={14} /></span></button>;
      })}</div>
      {!collections.length ? <div className="library-empty"><BookOpen size={22} /><strong>No collections yet.</strong><p>Create one and name it however you want.</p></div> : null}
    </section>
  );
}
