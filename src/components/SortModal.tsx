import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, SkipForward, X } from "lucide-react";
import { fieldByRole, fieldText, type CardWithStats, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { cardHasCompletedSort, completeCardSort, setSortTags } from "../lib/sort";
import "./sort.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  tags: HeuresisTag[];
  onClose: () => void;
  onChanged: () => void;
};

export default function SortModal({ pack, cards, tags, onClose, onChanged }: Props) {
  const [queue] = useState(() => cards.filter((card) => !cardHasCompletedSort(card)));
  const [index, setIndex] = useState(0);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(0);

  const card = queue[index] ?? null;
  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
  const remaining = Math.max(0, queue.length - index);

  useEffect(() => {
    setTagIds(card?.tags.map((tag) => tag.id) ?? []);
    setDetails(false);
    setMessage("");
  }, [card?.id]);

  async function toggleTag(tagId: string) {
    if (!card || busy) return;
    const next = tagIds.includes(tagId) ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId];
    setTagIds(next); setBusy(true); setMessage("");
    try { await setSortTags(card.id, next); onChanged(); }
    catch (error) { setTagIds(tagIds); setMessage(error instanceof Error ? error.message : "Could not save tags."); }
    finally { setBusy(false); }
  }

  async function rank(value: number) {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      await completeCardSort(card, value, tagIds);
      setSaved((count) => count + 1);
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save priority."); }
    finally { setBusy(false); }
  }

  function skip() {
    if (busy || !card) return;
    setIndex((current) => current + 1);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { onClose(); return; }
      if (!card || busy) return;
      if (["1","2","3","4","5"].includes(event.key)) { event.preventDefault(); void rank(Number(event.key)); }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); skip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const extraFields = useMemo(() => (pack.cardType?.field_schema ?? []).filter((field) => ![term?.key, reading?.key, meaning?.key].includes(field.key)), [pack.cardType?.field_schema, term?.key, reading?.key, meaning?.key]);

  return <div className="sort-backdrop"><section className="sort-modal" role="dialog" aria-modal="true">
    <header className="sort-topbar"><div><span className="eyebrow">SORT</span><strong>{pack.title}</strong></div><span>{card ? `${index + 1} / ${queue.length}` : `${saved} sorted`}</span><button onClick={onClose} aria-label="Close sort"><X size={18} /></button></header>
    {!queue.length ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">SORT COMPLETE</p><h2>Nothing unsorted in the loaded cards.</h2><p>Cards with an existing priority are kept as completed, matching the previous Heuresis sort logic.</p><button onClick={onClose}>Return to topic</button></div> : null}
    {queue.length && !card ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">PASS COMPLETE</p><h2>{saved} cards sorted.</h2><p>Skipped cards were deliberately left unsorted and will return on the next pass.</p><button onClick={onClose}>Return to topic</button></div> : null}
    {card ? <div className="sort-body">
      <div className="sort-card" onClick={() => setDetails((value) => !value)} role="button" tabIndex={0}>
        <span className="sort-card-hint">Click card for all fields</span>
        <strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>
        {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
        {meaning ? <p>{fieldText(card.data, meaning.key)}</p> : null}
        {details ? <div className="sort-details">{extraFields.map((field) => { const value = fieldText(card.data, field.key); return value ? <div key={field.key}><span>{field.label}</span><p>{value}</p></div> : null; })}{card.note ? <div><span>Note</span><p>{card.note}</p></div> : null}</div> : <span className="sort-details-toggle">{details ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>}
      </div>
      <div className="sort-panel"><div><p className="eyebrow">PRIORITY</p><div className="sort-ranks">{[1,2,3,4,5].map((value) => <button key={value} disabled={busy} onClick={() => void rank(value)}><b>{value}</b><span>{value === 1 ? "Low" : value === 5 ? "Highest" : ""}</span></button>)}</div><small>1–5 saves the card as sorted and moves on.</small></div>
        <div className="sort-tags"><p className="eyebrow">TAGS</p><div>{tags.map((tag) => <button key={tag.id} disabled={busy} className={`${tagIds.includes(tag.id) ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} onClick={() => void toggleTag(tag.id)}>{tag.name}</button>)}</div>{!tags.length ? <small>No tags created yet.</small> : null}</div>
        {message ? <div className="sort-error">{message}</div> : null}
        <button className="sort-skip" disabled={busy} onClick={skip}><SkipForward size={15} /> Skip for now <span>S</span></button>
        <div className="sort-remaining">{remaining} remaining in this pass · {saved} sorted</div>
      </div>
    </div> : null}
  </section></div>;
}
