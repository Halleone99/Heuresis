import { ArrowRight, Brain, Check, Search, Shuffle, SkipForward, Tag, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { fieldByRole, fieldText, patchCardData, saveCardNote, type CardWithStats, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { SegmentedChoice } from "./SegmentedChoice";
import { cardHasCompletedSort, completeCardSort, discardCard, restoreDiscardedCard, setSortInterest, setSortTags } from "../lib/sort";
import { IMPORTANCE_LABEL, IMPORTANCE_ORDER, IMPORTANCE_RANK } from "../lib/importance";
import SortEnrichmentPanel from "./SortEnrichmentPanel";
import "./sort.css";
import "./sort-enrichment.css";
import "./sort-refined.css";

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

type Removal = { kind: "learn" | "discard"; card: CardWithStats };
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
 * Sort enriches each card and then triages it with three classifications and two secondary actions:
 *   Core / Active / Passive · Sort Later · Discard (recoverable).
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
  const [noteDraft, setNoteDraft] = useState("");
  const [enrichmentBlocked, setEnrichmentBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [learned, setLearned] = useState(0);
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
    setNoteDraft(card?.note ?? ""); setTagsOpen(false);
    setMessage("");
  }, [card?.id]);

  async function toggleTag(tagId: string) {
    if (!card || busy || enrichmentBlocked) return;
    const next = tagIds.includes(tagId) ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId];
    setTagIds(next); setBusy(true); setMessage("");
    try { await setSortTags(card.id, next); onChanged(); }
    catch (error) { setTagIds(tagIds); setMessage(error instanceof Error ? error.message : "Could not save tags."); }
    finally { setBusy(false); }
  }

  async function saveQuickNote() {
    if (card && noteDraft.trim() !== (card.note ?? "").trim()) await saveCardNote(card.id, noteDraft);
  }

  async function closeSort() {
    if (busy || enrichmentBlocked) return;
    if (card && noteDraft.trim() !== (card.note ?? "").trim()) {
      setBusy(true); setMessage("");
      try { await saveQuickNote(); onChanged(); onClose(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the quick note."); }
      finally { setBusy(false); }
    } else onClose();
  }

  async function learn(rank: number) {
    if (!card || busy || enrichmentBlocked) return;
    setBusy(true); setMessage("");
    try {
      // The three visible priorities retain the existing numeric database representation.
      await saveQuickNote();
      await completeCardSort(card, rank, tagIds);
      setLearned((value) => value + 1);
      setLastRemoval({ kind: "learn", card });
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save this decision."); }
    finally { setBusy(false); }
  }

  async function discard() {
    if (!card || busy || enrichmentBlocked) return;
    setBusy(true); setMessage("");
    try {
      await saveQuickNote();
      await discardCard(card);
      setDiscarded((value) => value + 1);
      setLastRemoval({ kind: "discard", card });
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not discard this card."); }
    finally { setBusy(false); }
  }

  /** Restores the last discarded or classified card to the current queue. */
  async function undo() {
    if (!lastRemoval || busy) return;
    const { kind, card: restored } = lastRemoval;
    setBusy(true); setMessage("");
    try {
      if (kind === "discard") await restoreDiscardedCard(restored.id);
      else {
        await setSortInterest(restored.id, restored.interest_rank);
        await setSortTags(restored.id, restored.tags.map((tag) => tag.id));
        await patchCardData(restored.id, { _sorted_at: null });
      }
      if (kind === "discard") setDiscarded((value) => Math.max(0, value - 1));
      else setLearned((value) => Math.max(0, value - 1));
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

  async function later() {
    if (busy || enrichmentBlocked || !card) return;
    setBusy(true); setMessage("");
    try {
      await saveQuickNote();
      setLastRemoval(null);
      setIndex((current) => current + 1);
      onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the quick note."); }
    finally { setBusy(false); }
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
        if (!busy && !enrichmentBlocked) { event.preventDefault(); if (filtersOpen) setFiltersOpen(false); else void closeSort(); }
        return;
      }
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], .qc-panel, .ws-dialog')) return;
      if (filtersOpen && event.key === "Enter" && target === dialogRef.current) { event.preventDefault(); beginSort(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { if (lastRemoval) { event.preventDefault(); void undo(); } return; }
      if (event.ctrlKey || event.metaKey || event.altKey || !card || busy || enrichmentBlocked || filtersOpen) return;
      const key = event.key.toLowerCase();
      // Retain older Sort keyboard actions for existing users, without
      // crowding the new interface with shortcut labels.
      if (key === "c" || key === "u" || key === "p") {
        event.preventDefault(); void learn(key === "c" ? 5 : key === "u" ? 3 : 1); return;
      }
      if (key === "d" || event.key === "Delete") { event.preventDefault(); void discard(); return; }
      if (key === "l" || key === "s") { event.preventDefault(); later(); return; }
      if (key === "t") { event.preventDefault(); setTagsOpen((value) => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const renderTag = (tag: HeuresisTag, compactLesson = false) => <button key={tag.id} disabled={busy || enrichmentBlocked} title={tag.name} className={`${tagIds.includes(tag.id) ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} aria-pressed={tagIds.includes(tag.id)} onClick={() => void toggleTag(tag.id)}>{compactLesson ? tag.name.match(/\d+/)?.[0] ?? tag.name : tag.name}</button>;
  const finished = Boolean(queue.length && !card);
  const decided = learned + discarded;

  return <div className="sort-backdrop"><section ref={dialogRef} tabIndex={-1} className="sort-modal" role="dialog" aria-modal="true" aria-label="Sort cards">
    <header className="sort-topbar">
      <div><span className="eyebrow">SORT CARDS</span><strong>{pack.title}</strong></div>
      <span>{filtersOpen ? `${unsorted.length} unsorted` : card ? `${index + 1} / ${queue.length}` : `${decided} decided`}</span>
      <div className="sort-topbar-actions">
        <button type="button" className="sort-filter-open" aria-expanded={filtersOpen} disabled={busy || enrichmentBlocked} onClick={() => setFiltersOpen((open) => !open)}><Search size={15} /> {filtersOpen ? "Back to cards" : "Filter"}</button>
        <button type="button" disabled={busy || enrichmentBlocked} onClick={() => void closeSort()} aria-label="Close sort"><X size={18} /></button>
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
      <p>{[learned ? `${learned} to learn` : "", discarded ? `${discarded} discarded (in Trash)` : ""].filter(Boolean).join(" · ") || "Nothing decided."}{remaining || queue.length - decided > 0 ? " Cards left for later stay unsorted." : ""}</p>
      {lastRemoval ? <button type="button" className="sort-undo-inline" disabled={busy || enrichmentBlocked} onClick={() => void undo()}><Undo2 size={14} /> Undo {lastRemoval.kind === "discard" ? "discard" : "learn"}</button> : null}
      <div className="sort-finished-actions">{onReview && learned ? <button type="button" onClick={() => { onClose(); onReview(); }}><Brain size={15} /> Review now</button> : null}<button type="button" className={onReview && learned ? "is-quiet" : ""} disabled={busy || enrichmentBlocked} onClick={onClose}>Return to topic</button></div>
    </div> : null}
    {!filtersOpen && card ? <div className="sort-body">
      <SortEnrichmentPanel key={card.id} pack={pack} card={card} onChanged={onChanged} onBlockedChange={setEnrichmentBlocked} />
      <div className="sort-card" data-card-id={card.id} aria-label="Complete flashcard">
        <strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>
        {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
        {meaning ? <p>{fieldText(card.data, meaning.key)}</p> : null}
      </div>
      <div className="sort-panel">
        <div className="sort-interest-panel" role="group" aria-label="Learning importance">
          <h3>Importance</h3>
          <div className="sort-rating">{IMPORTANCE_ORDER.map((level) => {
            const rank = IMPORTANCE_RANK[level];
            return <button key={level} type="button"
              aria-label={"Learn as " + IMPORTANCE_LABEL[level]}
              disabled={busy || enrichmentBlocked}
              onClick={() => void learn(rank)}>{IMPORTANCE_LABEL[level]}</button>;
          })}</div>
          <span className="sort-rating-caption">Choose one to save and continue · C / U / P</span>
        </div>
        <div className="sort-tags-control">
          <div className="sort-side-heading"><h3><Tag size={15}/> Tags</h3>
            <button type="button" aria-expanded={tagsOpen} disabled={busy || enrichmentBlocked}
              onClick={() => setTagsOpen((value) => !value)}>+ Add tag</button></div>
          {selectedTagNames.length ? <div className="sort-selected-tags">
            {tags.filter((tag) => tagIds.includes(tag.id)).map((tag) =>
              <button type="button" key={tag.id} disabled={busy || enrichmentBlocked} onClick={() => void toggleTag(tag.id)}
                title={"Remove " + tag.name}>{tag.name} <X size={12}/></button>)}
          </div> : <span className="sort-tags-empty">No tags on this card</span>}
          {tagsOpen ? <div className="sort-tags">
            {lessonTags.length ? <div className="sort-tag-group"><p>Lessons</p><div className="sort-lesson-tags">{lessonTags.map((tag) => renderTag(tag, true))}</div></div> : null}
            {otherTags.length ? <div className="sort-tag-group"><p>Available tags</p><div>{otherTags.map((tag) => renderTag(tag))}</div></div> : null}
            {!tags.length ? <small>No tags yet. Create them in Settings.</small> : null}
          </div> : null}
        </div>
        <div className="sort-note-panel">
          <h3>Quick note</h3>
          <textarea rows={5} aria-label="Quick note" value={noteDraft} placeholder="A useful example or something to remember…"
            disabled={busy || enrichmentBlocked} onChange={(event) => setNoteDraft(event.target.value)} />
        </div>
        {message ? <div className="sort-error" role="alert">{message}</div> : null}
        <div className="sort-panel-actions">
          <div className="sort-quiet-actions">
            <button type="button" disabled={busy || enrichmentBlocked} onClick={later}><SkipForward size={14}/> Sort Later <small>L</small></button>
            <button type="button" disabled={busy || enrichmentBlocked} onClick={() => void discard()}><Trash2 size={14}/> Discard <small>D</small></button>
          </div>
          {lastRemoval ? <div className="sort-undo" role="status"><span>Previous card: {fieldText(lastRemoval.card.data, term?.key) || "Card"} · {lastRemoval.kind === "discard" ? "discarded" : "added to learning"}</span>
            <button type="button" disabled={busy || enrichmentBlocked} onClick={() => void undo()}><Undo2 size={13}/> Undo</button></div> : null}
        </div>
      </div>
    </div> : null}
  </section></div>;
}
