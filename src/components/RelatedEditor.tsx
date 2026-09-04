import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import {
  addRelatedWord,
  listRelatedCatalogue,
  removeRelatedRelation,
  type RelatedCatalogueRow,
  type RelationType,
} from "../lib/related";
import type { CardWithStats, PackWithType } from "../lib/heuresis";
import "./related.css";

function label(type: RelationType) {
  return type === "synonym" ? "Synonym" : type === "antonym" ? "Antonym" : "Related";
}

export default function RelatedEditor({ pack, card, onChanged }: { pack: PackWithType; card: CardWithStats; onChanged?: () => void }) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [type, setType] = useState<RelationType>("related");
  const [term, setTerm] = useState("");
  const [reading, setReading] = useState("");
  const [meaning, setMeaning] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function load() {
    try { setRows(await listRelatedCatalogue(pack.id, card.id)); }
    catch { setRows([]); }
  }

  useEffect(() => { void load(); }, [pack.id, card.id]);

  async function add() {
    if (!term.trim() || busy) return;
    setBusy(true); setMessage("");
    try {
      await addRelatedWord({ sourceCardId: card.id, term, reading, meaning, relationType: type });
      setTerm(""); setReading(""); setMeaning("");
      await load(); onChanged?.(); setMessage("Related word added");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not add related word."); }
    finally { setBusy(false); }
  }

  async function remove(row: RelatedCatalogueRow) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await removeRelatedRelation(row.relation_id); await load(); onChanged?.(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove relation."); }
    finally { setBusy(false); }
  }

  return <div className="related-editor">
    <div className="related-editor-head"><div><span className="eyebrow">RELATED WORDS</span><p>Attach vocabulary discovered from this card.</p></div><span>{rows.length}</span></div>
    {rows.length ? <div className="related-mini-list">{rows.map((row) => <div key={row.relation_id}><span className={`relation-badge is-${row.relation_type}`}>{label(row.relation_type)}</span><strong>{row.term}</strong>{row.reading ? <em>{row.reading}</em> : null}{row.meaning ? <small>{row.meaning}</small> : null}<button type="button" disabled={busy} onClick={() => void remove(row)} aria-label={`Remove ${row.term}`}><Trash2 size={12} /></button></div>)}</div> : null}
    <div className="related-add-grid">
      <select value={type} onChange={(event) => setType(event.target.value as RelationType)}><option value="synonym">Synonym</option><option value="antonym">Antonym</option><option value="related">Related</option></select>
      <input value={term} onChange={(event) => setTerm(event.target.value)} placeholder="Word / expression" />
      <input value={reading} onChange={(event) => setReading(event.target.value)} placeholder="Reading / pinyin · optional" />
      <input value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="Meaning · optional" />
      <button type="button" disabled={!term.trim() || busy} onClick={() => void add()}><Plus size={14} /> Add</button>
    </div>
    {message ? <div className="related-message">{message}</div> : null}
  </div>;
}
