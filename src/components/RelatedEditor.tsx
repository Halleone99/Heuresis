import { Link2, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  addRelatedWord,
  connectCards,
  listRelatedCatalogue,
  relationLabel,
  removeRelatedRelation,
  type RelatedCatalogueRow,
  type RelationType,
} from "../lib/related";
import { fieldByRole, fieldText, listPacks, type CardWithStats, type PackWithType } from "../lib/heuresis";
import { searchCards, type SearchCardResult } from "../lib/search";
import "./related.css";

const NEW_RELATION_TYPES: RelationType[] = ["related", "part_of", "depends_on", "contrasts_with", "example_of", "synonym"];

export default function RelatedEditor({ pack, card, onChanged }: { pack: PackWithType; card: CardWithStats; onChanged?: () => void }) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [matches, setMatches] = useState<SearchCardResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [type, setType] = useState<RelationType>("related");
  const [term, setTerm] = useState("");
  const [reading, setReading] = useState("");
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const packMap = useMemo(() => new Map(packs.map((item) => [item.id, item])), [packs]);

  async function load() {
    try { setRows(await listRelatedCatalogue(null, card.id)); }
    catch { setRows([]); }
  }

  useEffect(() => {
    void load();
    void listPacks().then(setPacks).catch(() => setPacks([]));
  }, [pack.id, card.id]);

  useEffect(() => {
    const query = term.trim();
    if (query.length < 2) { setMatches([]); setSearching(false); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void searchCards(query)
        .then((items) => { if (!cancelled) setMatches(items.filter((item) => item.id !== card.id).slice(0, 6)); })
        .catch(() => { if (!cancelled) setMatches([]); })
        .finally(() => { if (!cancelled) setSearching(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [card.id, term]);

  function copyFor(item: SearchCardResult) {
    const targetPack = packMap.get(item.pack_id);
    const primary = fieldByRole(targetPack?.cardType, "term") ?? targetPack?.cardType?.field_schema[0] ?? null;
    const secondary = fieldByRole(targetPack?.cardType, "meaning") ?? targetPack?.cardType?.field_schema[1] ?? null;
    return {
      title: fieldText(item.data, primary?.key) || "Untitled",
      detail: fieldText(item.data, secondary?.key),
      topic: targetPack?.title ?? "Other topic",
    };
  }

  async function add() {
    if (!term.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      await addRelatedWord({ sourceCardId: card.id, term, reading, meaning, relationType: type });
      setTerm(""); setReading(""); setMeaning(""); setMatches([]);
      await load(); onChanged?.(); setMessage("Connection added");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add connection."); }
    finally { setBusy(false); }
  }

  async function connectExisting(item: SearchCardResult) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      await connectCards(card.id, item.id, type);
      setTerm(""); setReading(""); setMeaning(""); setMatches([]);
      await load(); onChanged?.(); setMessage(`Connected to ${copyFor(item).title}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not connect this entry."); }
    finally { setBusy(false); }
  }

  async function remove(row: RelatedCatalogueRow) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await removeRelatedRelation(row.relation_id); await load(); onChanged?.(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove connection."); }
    finally { setBusy(false); }
  }

  return <div className="related-editor">
    <div className="related-editor-head"><div><span className="eyebrow">CONNECTIONS</span><p>Connect this entry to knowledge anywhere in Heuresis.</p></div><span>{rows.length}</span></div>
    {rows.length ? <div className="related-mini-list">{rows.map((row) => <div key={row.relation_id}><span className={`relation-badge is-${row.relation_type}`}>{relationLabel(row.relation_type)}</span><strong>{row.term}</strong>{row.reading ? <em>{row.reading}</em> : null}{row.meaning ? <small>{row.meaning}</small> : null}<button type="button" disabled={busy} onClick={() => void remove(row)} aria-label={`Remove ${row.term}`}><Trash2 size={12} /></button></div>)}</div> : null}
    <div className="related-add-grid">
      <select value={type} onChange={(event) => setType(event.target.value as RelationType)}>{NEW_RELATION_TYPES.map((value) => <option key={value} value={value}>{relationLabel(value)}</option>)}</select>
      <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Entry / concept" />
      <input value={reading} onChange={(event) => setReading(event.target.value)} placeholder="Context / reading · optional" />
      <input value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="Meaning / note · optional" />
      <button type="button" disabled={!term.trim() || busy} onClick={() => void add()}><Plus size={14} /> New entry</button>
    </div>
    {term.trim().length >= 2 ? <div className="related-existing-results">
      <span className="eyebrow">EXISTING KNOWLEDGE</span>
      {searching ? <small>Searching Heuresis…</small> : matches.length ? matches.map((item) => {
        const copy = copyFor(item);
        return <button type="button" key={item.id} disabled={busy} onClick={() => void connectExisting(item)}><Link2 size={13} /><span><strong>{copy.title}</strong><small>{copy.topic}{copy.detail ? ` · ${copy.detail}` : ""}</small></span><b>Connect</b></button>;
      }) : <small>No matching entry yet — create it above if useful.</small>}
    </div> : null}
    {message ? <div className="related-message">{message}</div> : null}
  </div>;
}
