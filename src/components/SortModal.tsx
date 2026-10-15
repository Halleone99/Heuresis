import { ArrowRight, BookOpen, Brain, Check, ChevronDown, ChevronUp, Filter, Search, Shuffle, SkipForward, Tag, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fieldByRole, fieldText, setCardRetention, type CardWithStats, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { IMPORTANCE_HINT, IMPORTANCE_LABEL, IMPORTANCE_ORDER, IMPORTANCE_RANK, importanceForDigit, type Importance } from "../lib/importance";
import { SegmentedChoice } from "./SegmentedChoice";
import { cardHasCompletedSort, completeCardSort, discardCard, restoreDiscardedCard, setSortTags } from "../lib/sort";
import "./sort.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  tags: HeuresisTag[];
  startCardId?: string | null;
  onClose: () => void;
  onChanged: () => void;
  /** Offered when the pass is finished: the next useful learning action. */
  onReview?: () => void;
};

type Removal = { kind: "reference" | "discard"; card: CardWithStats };
const ORDER_KEY = "heuresis.sort.order.v1";

function readOrder(): "topic" | "random" {
  try { return localStorage.getItem(ORDER_KEY) === "random" ? "random" : "topic"; } catch { return "topic"; }
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Sort is triage, one card at a time, with four outcomes:
 *   Learn (Core / Useful / Peripheral) · Reference · Discard (recoverable) · Later.
 * It opens straight into the queue; Filter narrows it when needed.
 */
export default function SortModal({ pack, cards, tags, startCardId = null, onClose, onChanged, onReview }: Props) {
  const unsorted = useMemo(() => cards.filter((item) => !cardHasCompletedSort(item)), [cards]);
  const dialogRef = useRef<HTMLElement>(null);
  const [randomOrder, setRandomOrder] = useState(() => readOrder() === "random");
  const [queue, setQueue] = useState<CardWithStats[]>(() => {
    const ordered = readOrder() === "random" ? shuffled(unsorted) : unsorted;
    if (!startCardId) return ordered;
    const selected = ordered.find((item) => item.id === startCardId);
    return selected ? [selected, ...ordered.filter((item) => item.id !== startCardId)] : ordered;
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [count, setCount] = useState(Math.max(1, unsorted.length));
  const scopeTags = useMemo(() => tags.filter((tag) => !tag.is_badge), [tags]);
  const candidates = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return unsorted.filter((item) => {
      if (selectedTags.length && !item.tags.some((tag) => selectedTags.includes(tag.id))) return false;
      if (!search) return true;
      return [item.note ?? "", ...item.tags.map((tag) => tag.name),
        ...Object.entries(item.data).filter(([key]) => !key.startsWith("_")).flatMap(([, value]) => Array.isArray(value) ? value : [value])
          .filter((value): value is string => typeof value === "string")].join(" ").toLocaleLowerCase().includes(search);
    });
  }, [query, selectedTags, unsorted]);

  /** Applies the filter panel: a narrower queue, in the chosen order. */
  function beginSort() {
    if (!candidates.length) return;
    const selection = randomOrder ? shuffled(candidates) : [...candidates];
    try { localStorage.setItem(ORDER_KEY, randomOrder ? "random" : "topic"); } catch { /* preference only */ }
    setQueue(selection.slice(0, Math.min(count, selection.length)));
    setIndex(0);
    setFiltersOpen(false);
  }

  const [index, setIndex] = useState(0);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [learned, setLearned] = useState(0);
  const [references, setReferences] = useState(0);
  const [discarded, setDiscarded] = useState(0);
  const [lastRemoval, setLastRemoval] = useState<Removal | null>(null);

  const card = queue[index] ?? null;
  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
  const remaining = Math.max(0, queue.length - index);
  const lessonTags = useMemo(() => tags.filter((tag) => /^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0)), [tags]);
  const otherTags = useMemo(() => tags.filter((tag) => !/^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => a.name.localeCompare(b.name)), [tags]);
  const selectedTagNames = tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name);

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

  async function learn(level: Importance) {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      await completeCardSort(card, IMPORTANCE_RANK[level], tagIds);
      setLearned((value) => value + 1);
      setLastRemoval(null);
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this decision."); }
    finally { setBusy(false); }
  }

  async function keepReference() {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      await setCardRetention(card.id, "reference");
      setReferences((value) => value + 1);
      setLastRemoval({ kind: "reference", card });
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not keep this card as reference."); }
    finally { setBusy(false); }
  }

  async function discard() {
    if (!card || busy) return;
    setBusy(true); setMessage("");
    try {
      await discardCard(card);
      setDiscarded((value) => value + 1);
      setLastRemoval({ kind: "discard", card });
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not discard this card."); }
    finally { setBusy(false); }
  }

  /** Brings the last referenced or discarded card back, as the current card. */
  async function undo() {
    if (!lastRemoval || busy) return;
    const { kind, card: restored } = lastRemoval;
    setBusy(true); setMessage("");
    try {
      if (kind === "discard") await restoreDiscardedCard(restored.id);
      else await setCardRetention(restored.id, "learning");
      if (kind === "discard") setDiscarded((value) => Math.max(0, value - 1));
      else setReferences((value) => Math.max(0, value - 1));
      const position = queue.findIndex((item) => item.id === restored.id);
      const without = queue.filter((item) => item.id !== restored.id);
      const at = position >= 0 && position < index ? index - 1 : index;
      without.splice(at, 0, restored);
      setQueue(without);
      setIndex(at);
      setLastRemoval(null);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not undo."); }
    finally { setBusy(false); }
  }

  function later() {
    if (busy || !card) return;
    setLastRemoval(null);
    setIndex((current) => current + 1);
  }

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      // Sort shortcuts must never act on text typed in Quick Capture, a filter field or an editor.
      if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      // Escape works from the filter's search field too (it closes the filter first),
      // but never steals Escape from Quick Capture or another dialog on top.
      if (event.key === "Escape" && !(target instanceof Element && target.closest(".qc-panel, .ws-dialog"))) {
        if (!busy) { event.preventDefault(); if (filtersOpen) setFiltersOpen(false); else onClose(); }
        return;
      }
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], .qc-panel, .ws-dialog')) return;
      if (filtersOpen && event.key === "Enter" && target === dialogRef.current) { event.preventDefault(); beginSort(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { if (lastRemoval) { event.preventDefault(); void undo(); } return; }
      if (event.ctrlKey || event.metaKey || event.altKey || !card || busy || filtersOpen) return;
      const key = event.key.toLowerCase();
      const digit = /^[1-5]$/.test(key) ? importanceForDigit(Number(key)) : null;
      const level: Importance | null = digit ?? (key === "c" ? "core" : key === "u" ? "useful" : key === "p" ? "peripheral" : null);
      if (level) { event.preventDefault(); void learn(level); return; }
      if (key === "r") { event.preventDefault(); void keepReference(); return; }
      if (key === "d" || event.key === "Delete") { event.preventDefault(); void discard(); return; }
      if (key === "l" || key === "s") { event.preventDefault(); later(); return; }
      if (key === "t") { event.preventDefault(); setTagsOpen((value) => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const extraFields = useMemo(() => (pack.cardType?.field_schema ?? []).filter((field) => ![term?.key, reading?.key, meaning?.key].includes(field.key)), [pack.cardType?.field_schema, term?.key, reading?.key, meaning?.key]);

  const renderTag = (tag: HeuresisTag, compactLesson = false) => <button key={tag.id} disabled={busy} title={tag.name} className={`${tagIds.includes(tag.id) ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} aria-pressed={tagIds.includes(tag.id)} onClick={() => void toggleTag(tag.id)}>{compactLesson ? tag.name.match(/\d+/)?.[0] ?? tag.name : tag.name}</button>;
  const finished = Boolean(queue.length && !card);
  const decided = learned + references + discarded;

  return <div className="sort-backdrop"><section ref={dialogRef} tabIndex={-1} className="sort-modal" role="dialog" aria-modal="true" aria-label="Sort cards">
    <header className="sort-topbar">
      <div><span className="eyebrow">SORT CARDS</span><strong>{pack.title}</strong></div>
      <span>{filtersOpen ? `${unsorted.length} unsorted` : card ? `${index + 1} / ${queue.length}` : `${decided} decided`}</span>
      <div className="sort-topbar-actions">
        {unsorted.length ? <button type="button" className={`sort-filter-toggle ${filtersOpen ? "is-on" : ""}`} aria-expanded={filtersOpen} disabled={busy}
          onClick={() => setFiltersOpen((value) => !value)} title="Narrow the queue by search or tag, or change the order"><Filter size={14} /> Filter</button> : null}
        <button type="button" disabled={busy} onClick={onClose} aria-label="Close sort"><X size={18} /></button>
      </div>
    </header>
    {filtersOpen && unsorted.length ? <div className="sort-setup">
      <h2>Filter the queue</h2>
      <p>Sort everything by default, or narrow the queue to a search, tags or a number of cards.</p>
      <div className="sort-setup-grid">
        <label className="sort-setup-field"><span>Search unsorted cards</span>
          <span className="sort-setup-search"><Search size={16} aria-hidden="true" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Term, meaning or tag"
            onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); beginSort(); } }} /></span>
        </label>
        <label className="sort-setup-field"><span>Cards in this pass</span>
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
        <SegmentedChoice label="Sort card order" value={randomOrder ? "random" : "topic"}
          onChange={(choice) => setRandomOrder(choice === "random")}
          options={[{ value: "topic", label: "Topic order" }, { value: "random", label: "Random", icon: <Shuffle size={14} /> }]} />
      </div>
      <div className="sort-setup-bottom">
        <span>{candidates.length} matching unsorted · {candidates.length ? Math.min(count, candidates.length) : 0} selected</span>
        <button type="button" className="sort-setup-start" disabled={!candidates.length} onClick={beginSort}>
          Sort {Math.min(count, candidates.length)} {Math.min(count, candidates.length) === 1 ? "card" : "cards"} <ArrowRight size={16}/></button>
      </div>
    </div> : null}
    {!filtersOpen && !unsorted.length && !queue.length ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">NOTHING TO SORT</p><h2>Every card here is sorted.</h2><p>New cards arrive here when you capture them.</p>
      <div className="sort-finished-actions">{onReview ? <button type="button" onClick={() => { onClose(); onReview(); }}><Brain size={15} /> Review</button> : null}<button type="button" className="is-quiet" onClick={onClose}>Return to topic</button></div></div> : null}
    {!filtersOpen && finished ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">PASS COMPLETE</p>
      <h2>{decided} {decided === 1 ? "card" : "cards"} decided.</h2>
      <p>{[learned ? `${learned} to learn` : "", references ? `${references} kept as reference` : "", discarded ? `${discarded} discarded (in Trash)` : ""].filter(Boolean).join(" · ") || "Nothing decided."}{remaining || queue.length - decided > 0 ? " Cards left for later stay unsorted." : ""}</p>
      {lastRemoval ? <button type="button" className="sort-undo-inline" disabled={busy} onClick={() => void undo()}><Undo2 size={14} /> Undo {lastRemoval.kind === "discard" ? "discard" : "reference"}</button> : null}
      <div className="sort-finished-actions">{onReview && learned ? <button type="button" onClick={() => { onClose(); onReview(); }}><Brain size={15} /> Review now</button> : null}<button type="button" className={onReview && learned ? "is-quiet" : ""} disabled={busy} onClick={onClose}>Return to topic</button></div>
    </div> : null}
    {!filtersOpen && card ? <div className="sort-body">
      <div className="sort-card" onClick={() => setDetails((value) => !value)} role="button" tabIndex={0} aria-expanded={details} aria-label="Show or hide additional card details"
        onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); setDetails((value) => !value); } }}>
        <span className="sort-card-hint">{details ? "Tap to hide details" : "Tap to show details"}</span>
        <strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>
        {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
        {meaning ? <p>{fieldText(card.data, meaning.key)}</p> : null}
        {details ? <div className="sort-details" aria-label="Additional card fields">{extraFields.map((field) => { const value = fieldText(card.data, field.key); return value ? <div key={field.key}><span>{field.label}</span><p>{value}</p></div> : null; })}{card.note ? <div><span>Note</span><p>{card.note}</p></div> : null}</div> : null}<span className="sort-details-toggle" aria-hidden="true">{details ? <ChevronUp size={13} /> : <ChevronDown size={13} />}</span>
      </div>
      <div className="sort-panel">
        {/* The four outcomes of sorting stay together, in a fixed place. */}
        <div className="sort-decision" role="group" aria-label="Decide what happens to this card">
          <div className="sort-interest-panel"><div className="sort-panel-heading"><p className="eyebrow">LEARN IT</p><small>How important is it to you?</small></div>
            <div className="sort-levels">{IMPORTANCE_ORDER.map((level) => <button key={level} type="button" data-level={level} disabled={busy} onClick={() => void learn(level)}
              title={`${IMPORTANCE_HINT[level]} · adds the card to Review (key ${level[0].toUpperCase()})`}><b>{IMPORTANCE_LABEL[level]}</b><span>{IMPORTANCE_HINT[level]}</span><kbd>{level[0].toUpperCase()}</kbd></button>)}</div>
            <small>Each adds the card to Review. Importance only nudges recommendations.</small></div>
          <div className="sort-alternatives">
            <button className="sort-skip" disabled={busy} onClick={() => void keepReference()} title="Keep it to look up, without ever reviewing it (key R)"><BookOpen size={15} /> Reference <span>R</span></button>
            <button className="sort-skip" disabled={busy} onClick={() => void discard()} title="Remove it from this topic. Recoverable from Trash (key D)"><Trash2 size={15} /> Discard <span>D</span></button>
            <button className="sort-skip" disabled={busy} onClick={later} title="Leave it unsorted; it comes back next time (key L)"><SkipForward size={15} /> Later <span>L</span></button>
          </div>
          {lastRemoval ? <div className="sort-undo" role="status"><span>{lastRemoval.kind === "discard" ? "Discarded" : "Kept as reference"}: “{fieldText(lastRemoval.card.data, term?.key) || "card"}”.</span>
            <button type="button" disabled={busy} onClick={() => void undo()}><Undo2 size={13} /> Undo</button></div> : null}
          {message ? <div className="sort-error" role="alert">{message}</div> : null}
        </div>
        <div className="sort-tags-control">
          <button type="button" className="sort-tags-toggle" aria-expanded={tagsOpen} onClick={() => setTagsOpen((value) => !value)} title="Tags (key T)">
            <Tag size={14} /> Tags{selectedTagNames.length ? <em>{selectedTagNames.join(", ")}</em> : <em>none</em>}<ChevronDown size={13} className={tagsOpen ? "is-open" : ""} /></button>
          {tagsOpen ? <div className="sort-tags">
            {lessonTags.length ? <div className="sort-tag-group"><p>Lessons</p><div className="sort-lesson-tags">{lessonTags.map((tag) => renderTag(tag, true))}</div></div> : null}
            {otherTags.length ? <div className="sort-tag-group"><p>Other tags</p><div>{otherTags.map((tag) => renderTag(tag))}</div></div> : null}
            {!tags.length ? <small>No tags yet. Create them in Settings.</small> : null}
          </div> : null}
        </div>
        <div className="sort-remaining">{remaining} remaining · {learned} to learn · {references} reference · {discarded} discarded</div>
      </div>
    </div> : null}
  </section></div>;
}
