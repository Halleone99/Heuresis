import { ArrowRight, BookOpen, Check, ChevronDown, ChevronUp, Search, Shuffle, SkipForward, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, setCardRetention, type CardWithStats, type HeuresisTag, type PackWithType } from "../lib/heuresis";
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
  const unsorted = useMemo(() => cards.filter((item) => !cardHasCompletedSort(item)), [cards]);
  // An explicit card deep link starts immediately, preserving the older route.
  // Normal Sort opens a single setup screen, then the existing rank/tag decisions.
  const [queue, setQueue] = useState<CardWithStats[]>(() => {
    if (!startCardId) return [];
    const selected = unsorted.find((item) => item.id === startCardId);
    return selected ? [selected, ...unsorted.filter((item) => item.id !== startCardId)] : unsorted;
  });
  const [started, setStarted] = useState(Boolean(startCardId));
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [randomOrder, setRandomOrder] = useState(false);
  const [count, setCount] = useState(Math.min(20, Math.max(1, unsorted.length)));
  const scopeTags = useMemo(() => tags.filter((tag) => !tag.is_badge), [tags]);
  const candidates = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return unsorted.filter((item) => {
      if (selectedTags.length && !item.tags.some((tag) => selectedTags.includes(tag.id))) return false;
      if (!search) return true;
      return [item.note ?? "", ...item.tags.map((tag) => tag.name),
        ...Object.values(item.data).flatMap((value) => Array.isArray(value) ? value : [value])
          .filter((value): value is string => typeof value === "string")].join(" ").toLocaleLowerCase().includes(search);
    });
  }, [query, selectedTags, unsorted]);
  function beginSort() {
    if (!candidates.length) return;
    const selection = [...candidates];
    if (randomOrder) {
      for (let i = selection.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [selection[i], selection[j]] = [selection[j], selection[i]];
      }
    }
    setQueue(selection.slice(0, Math.min(count, selection.length)));
    setStarted(true);
    setIndex(0);
  }
  const [index, setIndex] = useState(0);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [saved, setSaved] = useState(0);
  const [references, setReferences] = useState(0);

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

  async function keepReference() {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      await setCardRetention(card.id, "reference");
      setReferences((count) => count + 1);
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not keep this card as reference."); }
    finally { setBusy(false); }
  }

  function skip() {
    if (busy || !card) return;
    setIndex((current) => current + 1);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      // Study shortcuts must never act on text typed in Quick Capture or an editor.
      if (event.defaultPrevented || event.isComposing || (target instanceof Element && target.closest('input, textarea, select, [contenteditable], .qc-panel, .ws-dialog'))) return;
      if (event.key === "Escape") { onClose(); return; }
      if (!card || busy) return;
      if (["1","2","3","4","5"].includes(event.key)) { event.preventDefault(); void rank(Number(event.key)); }
      if (event.key.toLowerCase() === "r") { event.preventDefault(); void keepReference(); }
      if (event.key.toLowerCase() === "s") { event.preventDefault(); skip(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const extraFields = useMemo(() => (pack.cardType?.field_schema ?? []).filter((field) => ![term?.key, reading?.key, meaning?.key].includes(field.key)), [pack.cardType?.field_schema, term?.key, reading?.key, meaning?.key]);

  const renderTag = (tag: HeuresisTag, compactLesson = false) => <button key={tag.id} disabled={busy} title={tag.name} className={`${tagIds.includes(tag.id) ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} onClick={() => void toggleTag(tag.id)}>{compactLesson ? tag.name.match(/\d+/)?.[0] ?? tag.name : tag.name}</button>;

  return <div className="sort-backdrop"><section className="sort-modal" role="dialog" aria-modal="true">
    <header className="sort-topbar"><div><span className="eyebrow">SORT CARDS</span><strong>{pack.title}</strong></div><span>{!started ? `${unsorted.length} unsorted` : card ? `${index + 1} / ${queue.length}` : `${saved + references} prepared`}</span><button onClick={onClose} aria-label="Close sort"><X size={18} /></button></header>
    {!started && unsorted.length ? <div className="sort-setup">
      <p className="eyebrow">ONE SORT WORKFLOW</p>
      <h2>Prepare your cards</h2>
      <p>Select which cards to sort. You'll then set an interest score, choose tags, or keep each card as a reference.</p>
      <div className="sort-setup-grid">
        <label className="sort-setup-field"><span>Search unsorted cards</span>
          <span className="sort-setup-search"><Search size={16} aria-hidden="true" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Term, meaning or tag" /></span>
        </label>
        <label className="sort-setup-field"><span>Cards to prepare</span>
          <input type="number" min={1} max={Math.max(1, candidates.length)} value={Math.min(count, Math.max(1, candidates.length))}
            onChange={(event) => setCount(Math.max(1, Math.min(10000, Number(event.target.value) || 1)))} />
          <button type="button" className="sort-setup-all" onClick={() => setCount(Math.max(1, candidates.length))}>All {candidates.length} matching</button>
        </label>
      </div>
      {scopeTags.length ? <div className="sort-setup-tag-filter">
        <span>Filter by tags <small>optional · matches any selected tag</small></span>
        <div>
          <button type="button" className={!selectedTags.length ? "selected" : ""} onClick={() => setSelectedTags([])}>Any tag</button>
          {scopeTags.map((tag) => <button type="button" key={tag.id} className={selectedTags.includes(tag.id) ? "selected" : ""}
            aria-pressed={selectedTags.includes(tag.id)}
            onClick={() => setSelectedTags((current) => current.includes(tag.id) ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>{tag.name}</button>)}
        </div>
      </div> : null}
      <div className="sort-setup-order"><span>Card order</span>
        <div><button type="button" className={!randomOrder ? "selected" : ""} onClick={() => setRandomOrder(false)}>Topic order</button>
          <button type="button" className={randomOrder ? "selected" : ""} onClick={() => setRandomOrder(true)}><Shuffle size={14}/> Random</button></div>
      </div>
      <div className="sort-setup-bottom">
        <span>{candidates.length} matching unsorted · {candidates.length ? Math.min(count, candidates.length) : 0} selected</span>
        <button type="button" className="sort-setup-start" disabled={!candidates.length} onClick={beginSort}>
          Start sorting <ArrowRight size={16}/></button>
      </div>
    </div> : null}
    {!started && !unsorted.length ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">SORT COMPLETE</p><h2>Nothing left to sort.</h2><p>Every loaded card has already been prepared.</p><button onClick={onClose}>Return to topic</button></div> : null}
    {started && queue.length && !card ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">PASS COMPLETE</p><h2>{saved + references} cards prepared.</h2><p>{saved ? `${saved} kept in review. ` : ""}{references ? `${references} kept as reference. ` : ""}Skipped cards remain unsorted and will return next time.</p><button onClick={onClose}>Return to topic</button></div> : null}
    {started && card ? <div className="sort-body">
      <div className="sort-card" onClick={() => setDetails((value) => !value)} role="button" tabIndex={0}>
        <span className="sort-card-hint">Click to show all fields</span>
        <strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>
        {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
        {meaning ? <p>{fieldText(card.data, meaning.key)}</p> : null}
        {details ? <div className="sort-details">{extraFields.map((field) => { const value = fieldText(card.data, field.key); return value ? <div key={field.key}><span>{field.label}</span><p>{value}</p></div> : null; })}{card.note ? <div><span>Note</span><p>{card.note}</p></div> : null}</div> : <span className="sort-details-toggle">{details ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>}
      </div>
      <div className="sort-panel">
        <div className="sort-interest-panel"><div className="sort-panel-heading"><p className="eyebrow">KEEP IN REVIEW</p><small>Set how important this is to you</small></div><div className="sort-ranks">{[1,2,3,4,5].map((value) => <button key={value} disabled={busy} onClick={() => void rank(value)} title={`Keyboard: ${value}`}><b>{value}</b><span>{INTEREST_LABELS[value]}</span></button>)}</div><small>Choosing a score keeps this card in Review, completes Sort and moves to the next card.</small></div>
        <div className="sort-tags"><div className="sort-panel-heading"><p className="eyebrow">TAGS</p><small>Optional</small></div>
          {lessonTags.length ? <div className="sort-tag-group"><p>HSK2 Lessons</p><div className="sort-lesson-tags">{lessonTags.map((tag) => renderTag(tag, true))}</div></div> : null}
          {otherTags.length ? <div className="sort-tag-group"><p>Other tags</p><div>{otherTags.map((tag) => renderTag(tag))}</div></div> : null}
          {!tags.length ? <small>No tags created yet.</small> : null}
        </div>
        {message ? <div className="sort-error">{message}</div> : null}
        <button className="sort-skip" disabled={busy} onClick={() => void keepReference()}><BookOpen size={15} /> Keep as reference <span>R</span></button>
        <button className="sort-skip" disabled={busy} onClick={skip}><SkipForward size={15} /> Decide later <span>S</span></button>
        <div className="sort-remaining">{remaining} remaining · {saved} review · {references} reference</div>
      </div>
    </div> : null}
  </section></div>;
}
