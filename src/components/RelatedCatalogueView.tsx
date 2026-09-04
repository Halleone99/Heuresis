import { ArrowLeft, Brain, ExternalLink, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listRelatedCatalogue, promoteRelatedCard, removeRelatedRelation, type RelatedCatalogueRow, type RelationType } from "../lib/related";
import type { Collection, PackWithType } from "../lib/heuresis";

type Props = {
  packs: PackWithType[];
  collection?: Collection | null;
  onBack: () => void;
  onOpenPack: (pack: PackWithType) => void;
};

type RelationFilter = "all" | RelationType;

function RelatedReview({ rows, onClose }: { rows: RelatedCatalogueRow[]; onClose: () => void }) {
  const uniqueRows = useMemo(() => {
    const seen = new Set<string>();
    return rows.filter((row) => {
      if (seen.has(row.target_card_id)) return false;
      seen.add(row.target_card_id);
      return true;
    });
  }, [rows]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const row = uniqueRows[index];
  useEffect(() => { setIndex(0); setRevealed(false); }, [uniqueRows.length]);
  useEffect(() => { setRevealed(false); }, [index]);
  if (!row) return null;
  return <div className="immersive-layer related-review-layer"><header className="immersive-bar"><span>New words · {index + 1} / {uniqueRows.length}</span><button onClick={onClose}><X size={16} /> Close</button></header><main className="related-review-stage"><article className="related-review-card"><p className="eyebrow">{row.relation_type.toUpperCase()}</p><h1>{row.term || "Untitled"}</h1>{row.reading ? <h2>{row.reading}</h2> : null}{revealed ? <div className="related-review-answer"><strong>{row.meaning || "No meaning saved"}</strong><span>Discovered from <b>{row.source_term || "source card"}</b>{row.source_reading ? ` · ${row.source_reading}` : ""}</span><p>{row.source_meaning}</p></div> : <button className="primary-button reveal-button" onClick={() => setRevealed(true)}>Reveal</button>}</article></main><footer className="immersive-controls"><button className="secondary-button" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>Previous</button><button className="primary-button" onClick={() => { if (index >= uniqueRows.length - 1) onClose(); else setIndex((value) => value + 1); }}>{index >= uniqueRows.length - 1 ? "Finish" : "Next"}</button></footer></div>;
}

export default function RelatedCatalogueView({ packs, collection = null, onBack, onOpenPack }: Props) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RelationFilter>("all");
  const [reviewing, setReviewing] = useState(false);
  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);

  async function reload() {
    setLoading(true); setError("");
    try { setRows(await listRelatedCatalogue()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load related vocabulary."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  const collectionRows = useMemo(() => collection
    ? rows.filter((row) => packMap.get(row.pack_id)?.collection_id === collection.id)
    : rows, [collection, packMap, rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return collectionRows.filter((row) => {
      if (filter !== "all" && row.relation_type !== filter) return false;
      if (!q) return true;
      return [row.pack_title, row.source_term, row.source_reading, row.source_meaning, row.term, row.reading, row.meaning, ...row.source_tags].join(" ").toLocaleLowerCase().includes(q);
    });
  }, [collectionRows, query, filter]);

  const uniqueWords = useMemo(() => new Set(shown.map((row) => row.target_card_id)).size, [shown]);

  async function remove(row: RelatedCatalogueRow) {
    if (!window.confirm(`Remove the ${row.relation_type} link to ${row.term}?`)) return;
    try { await removeRelatedRelation(row.relation_id); await reload(); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not remove the relation."); }
  }

  async function promote(row: RelatedCatalogueRow) {
    try { await promoteRelatedCard(row.target_card_id); await reload(); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not promote the related card."); }
  }

  const title = collection ? "New words" : "The vocabulary growing around your cards.";
  const description = collection
    ? `Words discovered while studying ${collection.title}. This is an automatic pack: every word you add from a card appears here without creating a duplicate.`
    : "Every word or expression you add as a synonym, antonym or related item lives here with its source flashcard.";

  return <section className="related-catalogue-page"><button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> {collection ? collection.title : "Library"}</button><header className="catalogue-heading"><div><p className="eyebrow">{collection ? "AUTOMATIC PACK" : "RELATED"}</p><h1>{title}</h1><p>{description}</p></div><span>{uniqueWords.toLocaleString()} words · {shown.length.toLocaleString()} relations</span></header><div className="related-toolbar"><label className="pack-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search source or added word" /></label><div className="filter-strip">{([['all','All'],['synonym','Synonyms'],['antonym','Antonyms'],['related','Related']] as Array<[RelationFilter,string]>).map(([value,label]) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div><button className="primary-button" disabled={!shown.length} onClick={() => setReviewing(true)}><Brain size={15} /> Review {uniqueWords}</button></div>{loading ? <div className="content-state compact">Loading new words…</div> : error ? <div className="content-state error-state compact">{error}</div> : <div className="related-table"><div className="related-table-head"><span>Source flashcard</span><span>Type</span><span>Added vocabulary</span><span>Actions</span></div>{shown.map((row) => { const pack = packMap.get(row.pack_id); return <div className="related-table-row" key={row.relation_id}><div className="related-source"><small>{row.pack_title}</small><strong>{row.source_term || "Untitled"}</strong>{row.source_reading ? <em>{row.source_reading}</em> : null}<p>{row.source_meaning}</p>{row.source_tags.length ? <div>{row.source_tags.map((tag) => <i key={tag}>{tag}</i>)}</div> : null}</div><span className={`relation-badge relation-${row.relation_type}`}>{row.relation_type}</span><div className="related-target"><strong>{row.term || "Untitled"}</strong>{row.reading ? <em>{row.reading}</em> : null}<p>{row.meaning}</p><small>{row.target_role === "main" ? "Main card" : "New word"}</small></div><div className="related-actions">{pack ? <button title="Open source topic" onClick={() => onOpenPack(pack)}><ExternalLink size={14} /></button> : null}{row.target_role === "related" ? <button title="Promote to main card" onClick={() => void promote(row)}>↑</button> : null}<button title="Remove relation" onClick={() => void remove(row)}><Trash2 size={14} /></button></div></div>; })}{!shown.length ? <div className="catalogue-empty">{collectionRows.length ? "No new words match this view." : "No new words in this collection yet."}</div> : null}</div>}{reviewing ? <RelatedReview rows={shown} onClose={() => setReviewing(false)} /> : null}</section>;
}
