import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronUp, SkipForward, X } from "lucide-react";
import { fieldByRole, fieldText, type CardWithStats, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { cardHasCompletedSort, completeCardSort, setSortTags } from "../lib/sort";
import "./sort.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  tags: HeuresisTag[];
  startCardId?: string | null;
  onClose: () => void;
  onChanged: () => void;
};

const INTEREST_LABELS: Record<number, string> = {
  1: "Peripheral",
  2: "Low",
  3: "Useful",
  4: "High",
  5: "Core",
};

export default function SortModal({ pack, cards, tags, startCardId = null, onClose, onChanged }: Props) {
  const [queue] = useState(() => {
    const unsorted = cards.filter((card) => !cardHasCompletedSort(card));
    if (!startCardId) return unsorted;
    const selected = unsorted.find((card) => card.id === startCardId);
    return selected ? [selected, ...unsorted.filter((card) => card.id !== startCardId)] : unsorted;
  });
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
  const lessonTags = useMemo(() => tags.filter((tag) => /^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0)), [tags]);
  const otherTags = useMemo(() => tags.filter((tag) => !/^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => a.name.localeCompare(b.name)), [tags]);

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
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save interest."); }
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

  const renderTag = (tag: HeuresisTag, compactLesson = false) => <button key={tag.id} disabled={busy} title={tag.name} className={`${tagIds.includes(tag.id) ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} onClick={() => void toggleTag(tag.id)}>{compactLesson ? tag.name.match(/\d+/)?.[0] ?? tag.name : tag.name}</button>;

  return <div className="sort-backdrop"><section className="sort-modal" role="dialog" aria-modal="true">
    <header className="sort-topbar"><div><span className="eyebrow">SORT</span><strong>{pack.title}</strong></div><span>{card ? `${index + 1} / ${queue.length}` : `${saved} sorted`}</span><button onClick={onClose} aria-label="Close sort"><X size={18} /></button></header>
    {!queue.length ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">SORT COMPLETE</p><h2>Nothing left to sort.</h2><p>Every loaded card has already been prepared.</p><button onClick={onClose}>Return to topic</button></div> : null}
    {queue.length && !card ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">PASS COMPLETE</p><h2>{saved} cards sorted.</h2><p>Skipped cards remain unsorted and will return next time.</p><button onClick={onClose}>Return to topic</button></div> : null}
    {card ? <div className="sort-body">
      <div className="sort-card" onClick={() => setDetails((value) => !value)} role="button" tabIndex={0}>
        <span className="sort-card-hint">Click to show all fields</span>
        <strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>
        {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
        {meaning ? <p>{fieldText(card.data, meaning.key)}</p> : null}
        {details ? <div className="sort-details">{extraFields.map((field) => { const value = fieldText(card.data, field.key); return value ? <div key={field.key}><span>{field.label}</span><p>{value}</p></div> : null; })}{card.note ? <div><span>Note</span><p>{card.note}</p></div> : null}</div> : <span className="sort-details-toggle">{details ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>}
      </div>
      <div className="sort-panel">
        <div className="sort-interest-panel"><div className="sort-panel-heading"><p className="eyebrow">INTEREST</p><small>1 = peripheral · 5 = core</small></div><div className="sort-ranks">{[1,2,3,4,5].map((value) => <button key={value} disabled={busy} onClick={() => void rank(value)} title={`Keyboard: ${value}`}><b>{value}</b><span>{INTEREST_LABELS[value]}</span></button>)}</div><small>Choosing a score completes this card and moves to the next one.</small></div>
        <div className="sort-tags"><div className="sort-panel-heading"><p className="eyebrow">TAGS</p><small>Optional</small></div>
          {lessonTags.length ? <div className="sort-tag-group"><p>HSK2 Lessons</p><div className="sort-lesson-tags">{lessonTags.map((tag) => renderTag(tag, true))}</div></div> : null}
          {otherTags.length ? <div className="sort-tag-group"><p>Other tags</p><div>{otherTags.map((tag) => renderTag(tag))}</div></div> : null}
          {!tags.length ? <small>No tags created yet.</small> : null}
        </div>
        {message ? <div className="sort-error">{message}</div> : null}
        <button className="sort-skip" disabled={busy} onClick={skip}><SkipForward size={15} /> Skip for now <span>S</span></button>
        <div className="sort-remaining">{remaining} remaining · {saved} sorted this pass</div>
      </div>
    </div> : null}
  </section></div>;
}
