import { Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, type PackWithType } from "../lib/heuresis";
import { searchCards, type SearchCardResult } from "../lib/advanced";

type Props = { packs: PackWithType[]; onClose: () => void; onOpen: (pack: PackWithType) => void };

export default function SearchOverlay({ packs, onClose, onOpen }: Props) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<SearchCardResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setItems([]); setLoading(false); setError(""); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLoading(true); setError("");
      void searchCards(term).then((results) => { if (!cancelled) setItems(results); }).catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Search failed.");
      }).finally(() => { if (!cancelled) setLoading(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [query]);

  return (
    <div className="modal-backdrop search-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="search-modal" role="dialog" aria-modal="true" aria-label="Search Heuresis">
        <header className="search-head"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search every Heuresis card…" /><button className="icon-button" onClick={onClose} aria-label="Close search"><X size={17} /></button></header>
        <div className="search-meta">{query.trim().length < 2 ? "Type at least two characters." : loading ? "Searching…" : error ? error : `${items.length} result${items.length === 1 ? "" : "s"}`}</div>
        <div className="search-results">
          {items.map((item) => {
            const pack = packMap.get(item.pack_id);
            if (!pack) return null;
            const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
            const reading = fieldByRole(pack.cardType, "reading");
            const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
            return <button key={item.id} className="search-result" onClick={() => { onOpen(pack); onClose(); }}><span><small>{pack.title}</small><strong>{fieldText(item.data, term?.key) || "Untitled"}</strong>{reading ? <em>{fieldText(item.data, reading.key)}</em> : null}</span><p>{fieldText(item.data, meaning?.key)}{item.note ? <i> · {item.note}</i> : null}</p></button>;
          })}
          {!loading && !error && query.trim().length >= 2 && !items.length ? <div className="search-empty">No matching cards.</div> : null}
        </div>
      </section>
    </div>
  );
}
