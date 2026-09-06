import { ArrowLeft, ArrowRight, Archive, BookOpen, Link2, Pencil, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { countCaptureInbox } from "../lib/captureInbox";
import { listCards, type Collection, type PackWithType } from "../lib/heuresis";
import { formatSeen } from "../lib/learningSignals";
import { listRelatedCounts } from "../lib/related";
import { cardHasCompletedSort } from "../lib/sort";

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

function newestOpen(packs: PackWithType[]) {
  return packs.reduce<string | null>((latest, pack) => {
    if (!pack.last_opened_at) return latest;
    if (!latest || Date.parse(pack.last_opened_at) > Date.parse(latest)) return pack.last_opened_at;
    return latest;
  }, null);
}

export default function LibraryView({ collections, packs, archivedCount, onOpen, onOpenCaptureInbox, onEditPack, onOpenNewWords, onArchive, onNewCollection }: Props) {
  const [collectionId, setCollectionId] = useState<string | null>(() => {
    try {
      const stored = sessionStorage.getItem(LAST_COLLECTION_KEY);
      return stored && collections.some((collection) => collection.id === stored) ? stored : null;
    } catch { return null; }
  });
  const [relatedCounts, setRelatedCounts] = useState<Record<string, number>>({});
  const [unsortedCounts, setUnsortedCounts] = useState<Record<string, number>>({});
  const [captureRevision, setCaptureRevision] = useState(0);
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === collectionId) ?? null, [collectionId, collections]);
  const totalCards = packs.reduce((sum, pack) => sum + pack.card_count, 0);

  const resumeCollection = useMemo(() => {
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
  const resumePacks = useMemo(() => resumeCollection ? packs.filter((pack) => pack.collection_id === resumeCollection.id) : [], [packs, resumeCollection]);

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
    if (!resumePacks.length) { setUnsortedCounts({}); return; }
    void Promise.all(resumePacks.map(async (pack) => {
      const cards = await listCards(pack.id);
      return [pack.id, cards.filter((card) => !cardHasCompletedSort(card)).length] as const;
    })).then((rows) => { if (alive) setUnsortedCounts(Object.fromEntries(rows)); }).catch(() => { if (alive) setUnsortedCounts({}); });
    return () => { alive = false; };
  }, [resumePacks]);

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

  const resumeCards = resumePacks.reduce((sum, pack) => sum + pack.card_count, 0);
  const resumeSeen = resumePacks.reduce((sum, pack) => sum + pack.encountered_cards, 0);
  const resumePercent = resumeCards ? Math.round((resumeSeen / resumeCards) * 100) : 0;
  const resumeNewWords = resumeCollection ? relatedCounts[resumeCollection.id] ?? 0 : 0;
  const lastOpened = newestOpen(resumePacks);
  const otherCollections = resumeCollection ? collections.filter((collection) => collection.id !== resumeCollection.id) : collections;
  const waitingTotal = Object.values(relatedCounts).reduce((sum, count) => sum + count, 0);

  return (
    <section className="library-page intelligent-library">
      <header className="intelligent-library-head"><div><h1>Heuresis<span>.</span></h1><p>{totalCards.toLocaleString()} cards across {plural(collections.length, "collection")}.{waitingTotal ? ` ${waitingTotal.toLocaleString()} words waiting to be sorted.` : ""}</p></div><div className="library-summary-actions">{archivedCount ? <button className="text-button library-archive-link" onClick={onArchive}><Archive size={14} /> Archive · {archivedCount}</button> : null}<button className="library-new-collection" onClick={onNewCollection}><Plus size={14} /> New collection</button></div></header>

      {resumeCollection ? <div className="library-desk">
        <section className="library-resume" data-accent={resumeCollection.accent}>
          <div className="library-resume-head">
            <span className="library-resume-glyph">{collectionGlyph(resumeCollection)}</span>
            <div><p className="eyebrow">PICK UP WHERE YOU LEFT OFF</p><button className="library-resume-title" onClick={() => openCollection(resumeCollection.id)}>{resumeCollection.title}</button>{resumeCollection.description ? <p>{resumeCollection.description}</p> : null}<div className="library-resume-figs"><span><b>{resumeCards.toLocaleString()}</b><small>cards</small></span><span><b>{resumeSeen.toLocaleString()}</b><small>explored</small></span><span><b>{resumePercent}%</b><small>of the collection</small></span>{lastOpened ? <span><b>{formatSeen(lastOpened).replace("seen ", "")}</b><small>last opened</small></span> : null}</div></div>
          </div>
          {resumePacks.length ? <div className="library-resume-topics">{resumePacks.map((pack) => {
            const progress = pack.card_count ? Math.round((pack.encountered_cards / pack.card_count) * 100) : 0;
            const unsorted = unsortedCounts[pack.id] ?? 0;
            return <button key={pack.id} onClick={() => onOpen(pack)}><span><strong>{pack.title}</strong><small>{pack.card_count.toLocaleString()} CARDS{unsorted ? ` · ${unsorted.toLocaleString()} UNSORTED` : ""}</small></span><i><em style={{ width: `${progress}%` }} /></i><b>Continue</b></button>;
          })}</div> : <button className="library-resume-empty" onClick={() => openCollection(resumeCollection.id)}>Add the first topic <ArrowRight size={14} /></button>}
          {resumeNewWords ? <button className="library-waiting" onClick={() => onOpenNewWords(resumeCollection)}><strong>{resumeNewWords.toLocaleString()}</strong><span>words gathered while studying, not yet cards.</span><b>Sort them</b></button> : null}
        </section>

        <aside className="library-stack"><p className="eyebrow">EVERYTHING ELSE</p>{otherCollections.map((collection) => {
          const collectionPacks = packs.filter((pack) => pack.collection_id === collection.id);
          const cards = collectionPacks.reduce((sum, pack) => sum + pack.card_count, 0);
          const seen = collectionPacks.reduce((sum, pack) => sum + pack.encountered_cards, 0);
          const progress = cards ? Math.round((seen / cards) * 100) : 0;
          return <button key={collection.id} className={collectionPacks.length ? "library-mini" : "library-mini off"} data-accent={collection.accent} onClick={() => openCollection(collection.id)}><span className="library-mini-glyph">{collectionGlyph(collection)}</span><span><strong>{collection.title}</strong><small>{collectionPacks.length ? `${cards.toLocaleString()} CARDS · ${plural(collectionPacks.length, "TOPIC")} · ${progress}%` : "+ ADD THE FIRST TOPIC"}</small></span>{collectionPacks.length ? <i><em style={{ width: `${progress}%` }} /></i> : null}</button>;
        })}<button className="library-stack-add" onClick={onNewCollection}><Plus size={13} /> New collection</button></aside>
      </div> : <div className="library-empty"><BookOpen size={22} /><strong>No collections yet.</strong><p>Create one and name it however you want.</p></div>}
    </section>
  );
}
