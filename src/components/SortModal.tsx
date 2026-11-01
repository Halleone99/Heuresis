import { ArrowRight, Brain, Check, ChevronDown, Pencil, Search, Shuffle, SkipForward, Tag, Trash2, Undo2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * New opens with an explicit tag and quantity selection; a directly opened card bypasses setup.
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
  // The topic's New button must show setup before any sorting decision can be made.
  // Direct links to a particular card can still open that card immediately.
  const [filtersOpen, setFiltersOpen] = useState(!startCardId);
  const [sessionStarted, setSessionStarted] = useState(Boolean(startCardId));
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  // Keep the draft as text: clearing and retyping a number must work normally.
  const [count, setCount] = useState(() => String(Math.min(20, Math.max(1, unsorted.length))));
  const requestedCount = Number(count);
  const validCount = /^\d+$/.test(count.trim()) && Number.isSafeInteger(requestedCount) && requestedCount > 0;
  const scopeTags = useMemo(() => {
    const usedIds = new Set(unsorted.flatMap((item) => item.tags.map((tag) => tag.id)));
    return tags.filter((tag) => !tag.is_badge && usedIds.has(tag.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [tags, unsorted]);
  const matchingScopeTags = useMemo(() => scopeTags.filter((tag) => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase())), [scopeTags, tagSearch]);
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

  const selectedCount = validCount ? Math.min(requestedCount, candidates.length) : 0;

  /** Uses the selected tags and typed quantity to construct the actual sorting queue. */
  function beginSort() {
    if (!candidates.length || !validCount) return;
    const selection = randomOrder ? shuffled(candidates) : [...candidates];
    try { localStorage.setItem(ORDER_KEY, randomOrder ? "random" : "topic"); } catch { /* preference only */ }
    setQueue(selection.slice(0, selectedCount));
    setIndex(0);
    setSessionStarted(true);
    setFiltersOpen(false);
  }

  const [index, setIndex] = useState(0);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingCard, setEditingCard] = useState(false);
  const [enrichmentOpen, setEnrichmentOpen] = useState(false);
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  const [cardDraft, setCardDraft] = useState<Record<string, string>>({});
  const [cardEditError, setCardEditError] = useState("");
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
  // The centre editor changes only the visible flashcard fields. Rich details remain in the left rail.
  const editFields = (pack.cardType?.field_schema ?? []).filter((field) =>
    [term?.key, reading?.key, meaning?.key].includes(field.key));
  const remaining = Math.max(0, queue.length - index);
  const lessonTags = useMemo(() => tags.filter((tag) => /^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0)), [tags]);
  const otherTags = useMemo(() => tags.filter((tag) => !/^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => a.name.localeCompare(b.name)), [tags]);
  const selectedTagNames = tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => tag.name);

  useEffect(() => {
    setTagIds(card?.tags.map((tag) => tag.id) ?? []);
    setNoteDraft(card?.note ?? ""); setTagsOpen(false);
    setEditingCard(false); setCardEditError("");
    setEnrichmentOpen(false); setSelectedRank(null);
    setMessage("");
  }, [card?.id]);

  async function toggleTag(tagId: string) {
    if (!card || busy || enrichmentBlocked || editingCard) return;
    const next = tagIds.includes(tagId) ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId];
    setTagIds(next); setBusy(true); setMessage("");
    try { await setSortTags(card.id, next); onChanged(); }
    catch (error) { setTagIds(tagIds); setMessage(error instanceof Error ? error.message : "Could not save tags."); }
    finally { setBusy(false); }
  }

  function beginCardEdit() {
    if (!card || busy || enrichmentBlocked) return;
    setEnrichmentOpen(true);
    setCardDraft(Object.fromEntries(editFields.map((field) => [field.key, fieldText(card.data, field.key)])));
    setCardEditError("");
    setEditingCard(true);
  }

  async function saveCardEdit() {
    if (!card || !editingCard || busy || enrichmentBlocked) return;
    const missing = editFields.find((field) => field.required && !cardDraft[field.key]?.trim());
    if (missing) { setCardEditError(`${missing.label} is required.`); return; }
    setBusy(true); setCardEditError("");
    try {
      const patch = Object.fromEntries(editFields.map((field) => [field.key, (cardDraft[field.key] ?? "").trim()]));
      const savedData = await patchCardData(card.id, patch);
      // A sorting pass holds its own queue; refresh it immediately as well as the topic list.
      setQueue((current) => current.map((item) => item.id === card.id ? { ...item, data: savedData } : item));
      setEditingCard(false);
      onChanged();
    } catch (error) {
      setCardEditError(error instanceof Error ? error.message : "Could not save the card.");
    } finally { setBusy(false); }
  }

  async function saveQuickNote() {
    if (card && noteDraft.trim() !== (card.note ?? "").trim()) await saveCardNote(card.id, noteDraft);
  }

  async function closeSort() {
    if (busy || enrichmentBlocked || editingCard) return;
    if (card && noteDraft.trim() !== (card.note ?? "").trim()) {
      setBusy(true); setMessage("");
      try { await saveQuickNote(); onChanged(); onClose(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the quick note."); }
      finally { setBusy(false); }
    } else onClose();
  }

  async function learn(rank: number) {
    if (!card || busy || enrichmentBlocked || editingCard) return;
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
    if (!card || busy || enrichmentBlocked || editingCard) return;
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
    if (busy || enrichmentBlocked || editingCard || !card) return;
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
        if (editingCard && !busy) { event.preventDefault(); setEditingCard(false); setCardEditError(""); return; }
        if (enrichmentOpen && !busy && !enrichmentBlocked && !filtersOpen) { event.preventDefault(); setEnrichmentOpen(false); return; }
        if (!busy && !enrichmentBlocked) { event.preventDefault(); if (filtersOpen && sessionStarted) setFiltersOpen(false); else void closeSort(); }
        return;
      }
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable], .qc-panel, .ws-dialog')) return;
      if (filtersOpen && event.key === "Enter" && target === dialogRef.current) { event.preventDefault(); beginSort(); return; }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") { if (lastRemoval) { event.preventDefault(); void undo(); } return; }
      if (event.ctrlKey || event.metaKey || event.altKey || !card || busy || enrichmentBlocked || editingCard || filtersOpen) return;
      const key = event.key.toLowerCase();
      // Retain older Sort keyboard actions for existing users, without
      // crowding the new interface with shortcut labels.
      if (key === "c" || key === "u" || key === "p") {
        event.preventDefault(); setSelectedRank(key === "c" ? 5 : key === "u" ? 3 : 1); return;
      }
      if (event.key === "Enter" && selectedRank !== null) { event.preventDefault(); void learn(selectedRank); return; }
      if (key === "e") { event.preventDefault(); setEnrichmentOpen((open) => !open); return; }
      if (key === "d" || event.key === "Delete") { event.preventDefault(); void discard(); return; }
      if (key === "l" || key === "s") { event.preventDefault(); later(); return; }
      if (key === "t") { event.preventDefault(); setTagsOpen((value) => !value); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const renderTag = (tag: HeuresisTag, compactLesson = false) => <button key={tag.id} disabled={busy || enrichmentBlocked || editingCard} title={tag.name} className={`${tagIds.includes(tag.id) ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} aria-pressed={tagIds.includes(tag.id)} onClick={() => void toggleTag(tag.id)}>{compactLesson ? tag.name.match(/\d+/)?.[0] ?? tag.name : tag.name}</button>;
  const finished = Boolean(queue.length && !card);
  const decided = learned + discarded;

  // Render outside the workspace column stacking context: otherwise the desktop
  // header can cover Sort controls even though the backdrop has a high z-index.
  return createPortal(<div className="sort-backdrop"><section ref={dialogRef} tabIndex={-1} className={filtersOpen && unsorted.length ? "sort-modal sort-modal--setup" : card ? `sort-modal sort-modal--session${enrichmentOpen ? " sort-modal--editing" : ""}` : "sort-modal"} role="dialog" aria-modal="true" aria-label="New cards">

    <header className="sort-topbar">
      <div><span className="eyebrow">NEW CARDS</span><strong>{pack.title}</strong></div>
      {filtersOpen && unsorted.length ? null : <div className="sort-top-progress" aria-label={card ? `Card ${index + 1} of ${queue.length}` : `${decided} cards decided`}><span>{card ? `${index + 1} / ${queue.length}` : `${decided} decided`}</span>{card ? <div className="sort-progress-track"><div style={{width: `${((index + 1) / queue.length) * 100}%`}} /></div> : null}</div>}
      <div className="sort-topbar-actions">
        {filtersOpen && unsorted.length ? <span className="sort-setup-pending"><span className="sort-setup-pending-dot" aria-hidden="true" /> {unsorted.length} awaiting sorting</span> : null}
        {sessionStarted ? <button type="button" className="sort-filter-open" aria-expanded={filtersOpen} disabled={busy || enrichmentBlocked || editingCard} onClick={() => setFiltersOpen((open) => !open)}><Search size={15} /> {filtersOpen ? "Back to cards" : "Change selection"}</button> : null}
        <button type="button" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void closeSort()} aria-label="Close New cards"><X size={20} /></button>
      </div>
    </header>
    {filtersOpen && unsorted.length ? <div className="sort-setup">
      <div className="sort-setup-intro">
        <h2>Choose cards to sort</h2>
        <p>Select the tags and number of cards for this sorting session.</p>
      </div>
      <div className="sort-setup-tag-filter">
        <div className="sort-setup-label">TAGS <small>optional</small></div>
        {scopeTags.length ? <details className="sort-setup-tag-picker">
          <summary>
            <Tag size={19} aria-hidden="true" />
            <span className="sort-setup-tag-summary">
              <strong>{selectedTags.length ? `${selectedTags.length} ${selectedTags.length === 1 ? "tag" : "tags"} selected` : "All tags"}</strong>
              <small>{selectedTags.length ? `${candidates.length} matching unsorted cards` : `Include all ${unsorted.length} unsorted cards`}</small>
            </span>
            <ChevronDown size={19} aria-hidden="true" />
          </summary>
          <div className="sort-setup-tag-menu">
            <input type="search" aria-label="Search tags" value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="Find a tag…" />
            <div className="sort-setup-tag-list">
              {matchingScopeTags.map((tag) => <label key={tag.id}>
                <input type="checkbox" checked={selectedTags.includes(tag.id)} onChange={(event) => setSelectedTags((current) => event.target.checked ? [...current, tag.id] : current.filter((id) => id !== tag.id))} />
                <span>{tag.name}</span>
              </label>)}
              {!matchingScopeTags.length ? <p>No matching tags.</p> : null}
            </div>
            <button type="button" className="sort-setup-clear-tags" disabled={!selectedTags.length} onClick={() => setSelectedTags([])}>Clear tag selection</button>
          </div>
        </details> : <div className="sort-setup-tag-empty"><Tag size={19} aria-hidden="true" /><span><strong>All tags</strong><small>Include all {unsorted.length} unsorted cards</small></span></div>}
      </div>
      <div className="sort-setup-grid">
        <div className="sort-setup-quantity">
          <label className="sort-setup-label" htmlFor="sort-session-count">NUMBER OF CARDS</label>
          <div className="sort-setup-quantity-control">
            <input id="sort-session-count" type="number" inputMode="numeric" min={1} step={1} value={count}
              aria-invalid={!validCount} aria-describedby={!validCount || requestedCount > candidates.length ? "sort-count-help" : undefined}
              onChange={(event) => setCount(event.target.value)} />
            <div className="sort-setup-count-info"><span>cards in this session</span><small>{candidates.length} available</small></div>
            <button type="button" className="sort-setup-all" disabled={!candidates.length} onClick={() => setCount(String(candidates.length))}>All {candidates.length}</button>
          </div>
          {!validCount || requestedCount > candidates.length ? <small id="sort-count-help" className="sort-setup-count-help" role="status">
            {!validCount ? "Enter a positive whole number." : `Only ${candidates.length} cards match. The session will use ${selectedCount}.`}
          </small> : null}
        </div>
        <div className="sort-setup-order">
          <span className="sort-setup-label">CARD ORDER</span>
          <SegmentedChoice label="New card order" value={randomOrder ? "random" : "topic"}
            onChange={(choice) => setRandomOrder(choice === "random")}
            options={[{ value: "topic", label: "Topic order" }, { value: "random", label: "Random", icon: <Shuffle size={14} /> }]} />
        </div>
      </div>
      <div className="sort-setup-search-row">
        <Search size={19} aria-hidden="true" />
        <input id="sort-session-search" aria-label="Search by term or meaning" value={query}
          onChange={(event) => setQuery(event.target.value)} placeholder="Search by term or meaning"
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); beginSort(); } }} />
        <span>Optional</span>
      </div>
      <div className="sort-setup-bottom">
        <div className="sort-setup-selection" role="status">
          <strong>{selectedCount} {selectedCount === 1 ? "card" : "cards"} selected</strong>
          <small>From {candidates.length} matching new {candidates.length === 1 ? "card" : "cards"}</small>
        </div>
        <button type="button" className="sort-setup-start" disabled={!selectedCount} onClick={beginSort}>
          Start sorting <ArrowRight size={19} aria-hidden="true" />
        </button>
      </div>
    </div> : null}
    {!filtersOpen && !unsorted.length && !queue.length ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">NO NEW CARDS</p><h2>All cards have been classified.</h2><p>New cards arrive here when you capture them.</p>
      <div className="sort-finished-actions">{onReview ? <button type="button" onClick={() => { onClose(); onReview(); }}><Brain size={15} /> Review</button> : null}<button type="button" className="is-quiet" onClick={onClose}>Return to topic</button></div></div> : null}
    {!filtersOpen && finished ? <div className="sort-finished"><Check size={27} /><p className="eyebrow">PASS COMPLETE</p>
      <h2>{decided} {decided === 1 ? "card" : "cards"} decided.</h2>
      <p>{[learned ? `${learned} to learn` : "", discarded ? `${discarded} discarded (in Trash)` : ""].filter(Boolean).join(" · ") || "Nothing decided."}{remaining || queue.length - decided > 0 ? " Cards left for later stay unsorted." : ""}</p>
      {lastRemoval ? <button type="button" className="sort-undo-inline" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void undo()}><Undo2 size={14} /> Undo {lastRemoval.kind === "discard" ? "discard" : "learn"}</button> : null}
      <div className="sort-finished-actions">{onReview && learned ? <button type="button" onClick={() => { onClose(); onReview(); }}><Brain size={15} /> Review now</button> : null}<button type="button" className={onReview && learned ? "is-quiet" : ""} disabled={busy || enrichmentBlocked || editingCard} onClick={onClose}>Return to topic</button></div>
    </div> : null}
    {!filtersOpen && card ? <div className="sort-body">
      <div id="sort-editing-tools" className="sort-editing-tools"><SortEnrichmentPanel key={card.id} pack={pack} card={card} onChanged={onChanged} onBlockedChange={setEnrichmentBlocked} /></div>
      <div className="sort-card" data-card-id={card.id} aria-label="Complete flashcard">
        {!editingCard ? <button type="button" className={`sort-enrichment-toggle${enrichmentOpen ? " active" : ""}`} aria-expanded={enrichmentOpen} aria-controls="sort-editing-tools" disabled={busy || enrichmentBlocked} onClick={() => setEnrichmentOpen((open) => !open)}><Pencil size={15} /> {enrichmentOpen ? "Done editing" : "Edit details"}</button> : null}
        {editingCard ? <form className="sort-card-editor" onSubmit={(event) => { event.preventDefault(); void saveCardEdit(); }}>
          <h3>Edit card</h3>
          <p>Correct the card before deciding its importance.</p>
          {editFields.map((field) => <label key={field.key}>
            <span>{field.label}{field.required ? " *" : ""}</span>
            {field.role === "meaning" ? <textarea rows={3} autoFocus={field.key === editFields[0]?.key}
              value={cardDraft[field.key] ?? ""} onChange={(event) => setCardDraft((draft) => ({ ...draft, [field.key]: event.target.value }))} />
              : <input autoFocus={field.key === editFields[0]?.key} value={cardDraft[field.key] ?? ""}
                onChange={(event) => setCardDraft((draft) => ({ ...draft, [field.key]: event.target.value }))} />}
          </label>)}
          {cardEditError ? <p className="sort-card-editor-error" role="alert">{cardEditError}</p> : null}
          <div className="sort-card-editor-actions">
            <button type="button" disabled={busy} onClick={() => { setEditingCard(false); setCardEditError(""); }}>Cancel</button>
            <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Save changes"}</button>
          </div>
        </form> : <>
          <strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>
          {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
          {meaning ? <p>{fieldText(card.data, meaning.key)}</p> : null}
          {enrichmentOpen ? <button type="button" className="sort-card-edit-trigger" disabled={busy || enrichmentBlocked || editingCard} onClick={beginCardEdit}>
            <Pencil size={14} /> Edit card text
          </button> : null}
        </>}
      </div>
      <div className="sort-panel">
        <div className="sort-interest-panel" role="group" aria-label="Learning importance">
          <h3>Importance</h3>
          <div className="sort-rating">{IMPORTANCE_ORDER.map((level) => {
            const rank = IMPORTANCE_RANK[level];
            return <button key={level} type="button"
              aria-label={"Select " + IMPORTANCE_LABEL[level] + " importance"}
              aria-pressed={selectedRank === rank}
              className={selectedRank === rank ? "selected" : ""}
              disabled={busy || enrichmentBlocked || editingCard}
              onClick={() => setSelectedRank(rank)}>{IMPORTANCE_LABEL[level]}</button>;
          })}</div>
          <span className="sort-rating-caption">Select importance, then Save & Next · C / U / P</span>
        </div>
        <div className="sort-tags-control">
          <div className="sort-side-heading"><h3><Tag size={15}/> Tags</h3>
            <button type="button" aria-expanded={tagsOpen} disabled={busy || enrichmentBlocked || editingCard}
              onClick={() => setTagsOpen((value) => !value)}>+ Add tag</button></div>
          {selectedTagNames.length ? <div className="sort-selected-tags">
            {tags.filter((tag) => tagIds.includes(tag.id)).map((tag) =>
              <button type="button" key={tag.id} disabled={busy || enrichmentBlocked || editingCard} onClick={() => void toggleTag(tag.id)}
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
          <textarea rows={3} aria-label="Quick note" value={noteDraft} placeholder="A useful example or something to remember…"
            disabled={busy || enrichmentBlocked || editingCard} onChange={(event) => setNoteDraft(event.target.value)} />
        </div>
        {message ? <div className="sort-error" role="alert">{message}</div> : null}
      </div>
    </div> : null}
    {!filtersOpen && card ? <footer className="sort-session-footer">
      <button type="button" className="sort-footer-discard" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void discard()}><Trash2 size={15} /> Discard</button>
      {lastRemoval ? <div className="sort-undo" role="status"><span>Previous card: {fieldText(lastRemoval.card.data, term?.key) || "Card"} · {lastRemoval.kind === "discard" ? "discarded" : "added to learning"}</span>
        <button type="button" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void undo()}><Undo2 size={13} /> Undo</button></div> : null}
      <div className="sort-footer-end">
        <button type="button" className="sort-footer-later" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void later()}><SkipForward size={15} /> Later</button>
        <button type="button" className="sort-save-next" disabled={selectedRank === null || busy || enrichmentBlocked || editingCard} onClick={() => { if (selectedRank !== null) void learn(selectedRank); }}>Save & Next <ArrowRight size={17} /></button>
      </div>
    </footer> : null}
  </section></div>, document.querySelector(".heuresis-desktop") ?? document.body);
}
