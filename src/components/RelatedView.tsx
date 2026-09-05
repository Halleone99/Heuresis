import { ArrowLeft, ArrowUpRight, Brain, Download, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  listRelatedCatalogue,
  promoteRelatedCard,
  removeRelatedRelation,
  type RelatedCatalogueRow,
  type RelationType,
} from "../lib/related";
import type { PackWithType } from "../lib/heuresis";
import { openCosmosWindow } from "../lib/cosmosWindow";
import "./related.css";

type RelatedFilter = "all" | RelationType;
const FILTERS: Array<[RelatedFilter, string]> = [["all","All"],["synonym","Synonyms"],["antonym","Antonyms"],["related","Related"]];

function label(type: RelationType) { return type === "synonym" ? "Synonym" : type === "antonym" ? "Antonym" : "Related"; }
function csvCell(value: string) { return `"${value.replace(/"/g, '""')}"`; }

export default function RelatedView({ pack, onBack, onChanged }: { pack: PackWithType; onBack: () => void; onChanged: () => void }) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [filter, setFilter] = useState<RelatedFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");

  async function load() {
    setLoading(true); setError("");
    try { setRows(await listRelatedCatalogue(pack.id)); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load related vocabulary."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [pack.id]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => {
      if (filter !== "all" && row.relation_type !== filter) return false;
      if (!needle) return true;
      return [row.source_term,row.source_reading,row.source_meaning,row.term,row.reading,row.meaning,...row.source_tags].join(" ").toLowerCase().includes(needle);
    });
  }, [rows, filter, query]);
  const uniqueWords = new Set(rows.map((row) => row.target_card_id)).size;

  async function promote(row: RelatedCatalogueRow) {
    if (row.target_role === "main" || busyId) return;
    setBusyId(row.relation_id); setError("");
    try { await promoteRelatedCard(row.target_card_id); await load(); onChanged(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not promote word."); }
    finally { setBusyId(""); }
  }

  async function remove(row: RelatedCatalogueRow) {
    if (busyId) return;
    setBusyId(row.relation_id); setError("");
    try { await removeRelatedRelation(row.relation_id); await load(); }
    catch (actionError) { setError(actionError instanceof Error ? actionError.message : "Could not remove relation."); }
    finally { setBusyId(""); }
  }

  async function reviewRelated() {
    if (!rows.length) return;
    setError("");
    try {
      await openCosmosWindow({ mode: "review", packId: pack.id, related: true, count: "all", order: "pack" });
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "Could not open related review.");
    }
  }

  function exportCsv() {
    if (!rows.length) return;
    const header = ["Added word","Reading","Meaning","Relation","Source flashcard","Source reading","Source meaning","Pack","Tags"];
    const body = rows.map((row) => [
      row.term,
      row.reading,
      row.meaning,
      label(row.relation_type),
      row.source_term,
      row.source_reading,
      row.source_meaning,
      row.pack_title,
      row.source_tags.join(" | "),
    ]);
    const csv = [header, ...body].map((line) => line.map((cell) => csvCell(cell)).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${pack.title.replace(/[^a-z0-9\p{L}\p{N}]+/giu, "-").replace(/^-|-$/g, "") || "heuresis"}-related.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return <section className="related-page">
    <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> Cards</button>
    <header className="related-page-head"><div><p className="eyebrow">RELATED VOCABULARY</p><h1>Words gathered while studying.</h1><p>{uniqueWords} words · {rows.length} connections · {pack.title}</p></div><div className="related-page-actions"><button className="secondary-button" disabled={!rows.length} onClick={exportCsv}><Download size={14} /> CSV</button><button className="primary-button" disabled={!rows.length} onClick={() => void reviewRelated()}><Brain size={14} /> Review related</button></div></header>
    <div className="related-tools"><label className="pack-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search added word or source flashcard" /></label><div className="filter-strip">{FILTERS.map(([key,text]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{text}</button>)}</div></div>
    {error ? <div className="related-error">{error}</div> : null}
    {loading ? <div className="content-state">Opening related vocabulary…</div> : <div className="related-table">
      <div className="related-table-head"><span>Source flashcard</span><span>Type</span><span>Added word</span><span>State</span><span /></div>
      {shown.map((row) => <div className="related-row" key={row.relation_id}>
        <div className="related-copy"><strong>{row.source_term || "Untitled"}</strong>{row.source_reading ? <em>{row.source_reading}</em> : null}{row.source_meaning ? <small>{row.source_meaning}</small> : null}{row.source_tags.length ? <span className="row-tags">{row.source_tags.map((tag) => <i key={tag}>{tag}</i>)}</span> : null}</div>
        <div><span className={`relation-badge is-${row.relation_type}`}>{label(row.relation_type)}</span></div>
        <div className="related-copy"><strong>{row.term || "Untitled"}</strong>{row.reading ? <em>{row.reading}</em> : null}{row.meaning ? <small>{row.meaning}</small> : null}</div>
        <div><span className={`role-badge ${row.target_role}`}>{row.target_role === "main" ? "Main card" : "Related only"}</span></div>
        <div className="related-row-actions">{row.target_role === "related" ? <button disabled={busyId === row.relation_id} title="Promote to a normal card" onClick={() => void promote(row)}><ArrowUpRight size={13} /></button> : null}<button disabled={busyId === row.relation_id} title="Remove connection" onClick={() => void remove(row)}><Trash2 size={13} /></button></div>
      </div>)}
      {!shown.length ? <div className="pack-empty"><strong>{rows.length ? "No matching related words." : "No related words yet."}</strong><span>{rows.length ? "Change the search or filter." : "Open a card and use Related words to add the first connection."}</span></div> : null}
    </div>}
  </section>;
}
