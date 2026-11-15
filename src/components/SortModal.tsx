import { ArrowLeftRight, ArrowRight, Brain, Check, ChevronDown, PanelLeftOpen, Search, Shuffle, Tag, Undo2, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fieldByRole, fieldText, patchCardData, saveCardNote, type CardWithStats, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { SegmentedChoice } from "./SegmentedChoice";
import { enterLearning, enterReview, readAcquisition, serializeAcquisition, LEARNING_STAGE_KEY, type AcquisitionPhase } from "../lib/learningStage";
import { cardHasCompletedSort, completeCardSort, discardCard, restoreDiscardedCard, setSortInterest, setSortTags } from "../lib/sort";
import { IMPORTANCE_HINT, IMPORTANCE_LABEL, IMPORTANCE_ORDER, IMPORTANCE_RANK } from "../lib/importance";
import SortEnrichmentPanel from "./SortEnrichmentPanel";
import { InlineSortText } from "./InlineSortText";
import { reviewSpeechLanguage, speakReviewText } from "../lib/reviewAudio";
import "./sort.css";
import "./sort-enrichment.css";
import "./sort-refined.css";
import "./sort-session.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  tags: HeuresisTag[];
  startCardId?: string | null;
  /** One-tap daily quota launcher bypasses setup with this many unsorted cards. */
  quickStartCount?: number;
  onClose: () => void;
  onChanged: () => void;
  /** Offered when the pass is finished: the next useful learning action. */
  onReview?: () => void;
  onLearning?: () => void;
};

type Removal = { kind: "learn" | "discard" | "later"; card: CardWithStats; phase?: AcquisitionPhase; rank?: number };
const ORDER_KEY = "heuresis.sort.order.v1";
const DESTINATION_KEY = "heuresis.sort.destination.v1";
function readDestination(): AcquisitionPhase {
  try { return localStorage.getItem(DESTINATION_KEY) === "review" ? "review" : "learning"; } catch { return "learning"; }
}

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
export default function SortModal({ pack, cards, tags, startCardId = null, quickStartCount, onClose, onChanged, onReview, onLearning }: Props) {
  const unsorted = useMemo(() => cards.filter((item) => !cardHasCompletedSort(item)), [cards]);
  const dialogRef = useRef<HTMLElement>(null);
  const fastStart = quickStartCount !== undefined && Number.isFinite(quickStartCount) && quickStartCount > 0;
  const [randomOrder, setRandomOrder] = useState(() => readOrder() === "random");
  const [queue, setQueue] = useState<CardWithStats[]>(() => {
    const ordered = readOrder() === "random" ? shuffled(unsorted) : unsorted;
    if (startCardId) {
      const selected = ordered.find((item) => item.id === startCardId);
      return selected ? [selected, ...ordered.filter((item) => item.id !== startCardId)] : ordered;
    }
    return fastStart ? ordered.slice(0, Math.floor(quickStartCount!)) : ordered;
  });
  // The topic's New button retains its setup screen; the daily quota can begin immediately.
  const [filtersOpen, setFiltersOpen] = useState(!startCardId && !fastStart);
  const [sessionStarted, setSessionStarted] = useState(Boolean(startCardId || fastStart));
  const [query, setQuery] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagSearch, setTagSearch] = useState("");
  // Keep the draft as text: clearing and retyping a number must work normally.
  const [count, setCount] = useState(() => String(Math.min(quickStartCount ?? 20, Math.max(1, unsorted.length))));
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
    setLearned(0); setToLearning(0); setToReview(0); setDiscarded(0); setLeftForLater(0); setLastRemoval(null);
    setSessionStarted(true);
    setFiltersOpen(false);
  }

  const [index, setIndex] = useState(0);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [tagsOpen, setTagsOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [editingCard, setEditingCard] = useState(false);
  const [enrichmentOpen, setEnrichmentOpen] = useState(false);
  const [detailsCount, setDetailsCount] = useState(0);
  const [destination, setDestination] = useState<AcquisitionPhase>(readDestination);
  const [noteOpen, setNoteOpen] = useState(false);
  const [enrichmentBlocked, setEnrichmentBlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [learned, setLearned] = useState(0);
  const [toLearning, setToLearning] = useState(0);
  const [toReview, setToReview] = useState(0);
  const [discarded, setDiscarded] = useState(0);
  const [leftForLater, setLeftForLater] = useState(0);
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
    setEditingCard(false); setNoteOpen(Boolean(card?.note));
    setEnrichmentOpen(false); setDetailsCount(0);
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

  async function saveInlineField(fieldKey: string, value: string) {
    if (!card || busy || enrichmentBlocked) return;
    setBusy(true); setMessage("");
    try {
      const saved = await patchCardData(card.id, { [fieldKey]: value });
      setQueue((items) => items.map((item) => item.id === card.id ? { ...item, data: saved } : item));
      onChanged();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not save the card.";
      setMessage(message); throw error;
    } finally { setBusy(false); }
  }

  function switchDestination() {
    const next: AcquisitionPhase = destination === "learning" ? "review" : "learning";
    setDestination(next);
    try { localStorage.setItem(DESTINATION_KEY, next); } catch { /* preference only */ }
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

  async function learn(rank: number, phase: AcquisitionPhase = destination) {
    if (!card || busy || enrichmentBlocked || editingCard) return;
    setBusy(true); setMessage("");
    try {
      // The three visible priorities retain the existing numeric database representation.
      await saveQuickNote();
      const state = readAcquisition(card.data);
      // Phase is saved before sorting, so a partially completed action cannot leak into Review.
      // "To Review" skips the exercises and changes the phase only: no review grade is recorded,
      // so the card arrives in Review exactly as an unreviewed card.
      const next = phase === "learning" ? enterLearning(state, "new") : enterReview(state, "direct");
      await patchCardData(card.id, { [LEARNING_STAGE_KEY]: serializeAcquisition(next) });
      await completeCardSort(card, rank, tagIds);
      setLearned((value) => value + 1);
      if (phase === "learning") setToLearning((value) => value + 1);
      else setToReview((value) => value + 1);
      setLastRemoval({ kind: "learn", card, phase, rank });
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
      else if (kind === "learn") {
        await setSortInterest(restored.id, restored.interest_rank);
        await setSortTags(restored.id, restored.tags.map((tag) => tag.id));
        await patchCardData(restored.id, { _sorted_at: null, [LEARNING_STAGE_KEY]: restored.data[LEARNING_STAGE_KEY] ?? null });
      }
      if (kind === "discard") setDiscarded((value) => Math.max(0, value - 1));
      else if (kind === "later") setLeftForLater((value) => Math.max(0, value - 1));
      else {
        setLearned((value) => Math.max(0, value - 1));
        if (lastRemoval.phase === "learning") setToLearning((value) => Math.max(0, value - 1));
        if (lastRemoval.phase === "review") setToReview((value) => Math.max(0, value - 1));
      }
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
      setLastRemoval({ kind: "later", card });
      setLeftForLater((value) => value + 1);
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
      if (["1", "2", "3", "c", "u", "p"].includes(key)) {
        event.preventDefault(); void learn(key === "1" || key === "c" ? 5 : key === "2" || key === "u" ? 3 : 1); return;
      }
      if (key === "r") { event.preventDefault(); switchDestination(); return; }
      if (key === "e") { event.preventDefault(); setEnrichmentOpen((open) => !open); return; }
      if (key === "d" || event.key === "Delete") { event.preventDefault(); void discard(); return; }
      if (key === "l" || key === "s") { event.preventDefault(); later(); return; }
      if (key === "t") { event.preventDefault(); setTagsOpen((value) => !value); return; }
      if (key === "n") { event.preventDefault(); setNoteOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const renderTag = (tag: HeuresisTag, compactLesson = false) => <button key={tag.id} disabled={busy || enrichmentBlocked || editingCard} title={tag.name} className={`${tagIds.includes(tag.id) ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} aria-pressed={tagIds.includes(tag.id)} onClick={() => void toggleTag(tag.id)}>{compactLesson ? tag.name.match(/\d+/)?.[0] ?? tag.name : tag.name}</button>;
  const finished = Boolean(queue.length && !card);
  const decided = learned + discarded;
  const languageLabel = pack.cardType?.name?.replace(/\b(cards?|vocabulary|words?)\b/gi, "").trim() || "CARD";
  const exampleField = fieldByRole(pack.cardType, "example");
  const translationField = fieldByRole(pack.cardType, "example_translation");
  const rawBlocks = card?.data["_workspace_blocks"];
  const firstBlock = Array.isArray(rawBlocks) ? rawBlocks.find((value) => { try { const parsed = JSON.parse(value); return parsed.dim === "examples" && parsed.type === "text"; } catch { return false; } }) : undefined;
  const firstExample = card ? fieldText(card.data, exampleField?.key) || (typeof firstBlock === "string" ? String(JSON.parse(firstBlock).text).split("\n")[0] : "") : "";
  const exampleTranslation = card ? fieldText(card.data, translationField?.key) || (typeof firstBlock === "string" ? String(JSON.parse(firstBlock).text).split("\n").slice(2).join(" ") : "") : "";

  // Render outside the workspace column stacking context: otherwise the desktop
  // header can cover Sort controls even though the backdrop has a high z-index.
  return createPortal(<div className="sort-backdrop"><section ref={dialogRef} tabIndex={-1} className={filtersOpen && unsorted.length ? "sort-modal sort-modal--setup" : "sort-modal sort-modal--session" + (enrichmentOpen ? " sort-modal--editing" : "")} role="dialog" aria-modal="true" aria-label="New cards">

    <header className="sort-topbar">
      <div className="sort-new-heading"><span className="sort-stage-chip">● New</span><strong>{pack.title}</strong></div>
      {filtersOpen && unsorted.length ? null : <div className="sort-top-progress" aria-label={card ? `Card ${index + 1} of ${queue.length}` : `${decided} cards decided`}><span>{card ? `${index + 1} of ${queue.length}` : `${queue.length} of ${queue.length}`}</span>{card ? <div className="sort-progress-track"><div style={{width: `${((index + 1) / queue.length) * 100}%`}} /></div> : null}</div>}
      <div className="sort-topbar-actions">
        {filtersOpen && unsorted.length ? <span className="sort-setup-pending"><span className="sort-setup-pending-dot" aria-hidden="true" /> {unsorted.length} awaiting sorting</span> : null}
        {sessionStarted && !fastStart && !startCardId ? <button type="button" className="sort-filter-open" aria-expanded={filtersOpen} disabled={busy || enrichmentBlocked || editingCard} onClick={() => setFiltersOpen((open) => !open)}><Search size={15} /> {filtersOpen ? "Back to cards" : "Change selection"}</button> : null}
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

    {!filtersOpen && (!unsorted.length && !queue.length || finished) ? <div className="sort-finished">
      <p className="eyebrow">{finished ? "SESSION COMPLETE" : "NO NEW CARDS"}</p>
      <h2>{finished ? queue.length + " new " + (queue.length === 1 ? "card" : "cards") + " met" : "All cards have been classified."}</h2>
      {finished ? <div className="sort-summary-stats">
        <span><b>{toLearning}</b> to Learn</span><span><b>{toReview}</b> to Review</span>
        <span><b>{discarded}</b> discarded</span><span><b>{leftForLater}</b> for later</span>
      </div> : <p>New cards appear here when you capture them.</p>}
      <div className="sort-finished-actions">
        {onLearning && toLearning > 0 ? <button type="button" onClick={() => { onClose(); onLearning(); }}>Start Learning</button> : null}
        {onReview && toReview > 0 ? <button type="button" onClick={() => { onClose(); onReview(); }}>Review now</button> : null}
        <button type="button" className="is-quiet" onClick={onClose}>Back to Study</button>
      </div>
      {lastRemoval ? <button type="button" className="sort-undo-inline" disabled={busy} onClick={() => void undo()}>
        Undo last ({fieldText(lastRemoval.card.data, term?.key) || "card"})
      </button> : null}
    </div> : null}
    {!filtersOpen && card ? <div className="sort-session-stage">
      <div id="sort-editing-tools" className={"sort-editing-tools" + (enrichmentOpen ? " is-open" : "")}>
        <SortEnrichmentPanel key={card.id} pack={pack} card={card} onChanged={onChanged}
          onBlockedChange={setEnrichmentBlocked} onCountChange={setDetailsCount} />
      </div>
      <article className="sort-card" data-card-id={card.id} aria-label="New flashcard">
        <div className="sort-new-card-header">
          <span><small>{languageLabel.toUpperCase()}</small><i>·</i> New card</span>
          <button type="button" className={"sort-new-details" + (enrichmentOpen ? " on" : "")}
            aria-expanded={enrichmentOpen} aria-controls="sort-editing-tools" disabled={busy || enrichmentBlocked || editingCard}
            onClick={() => setEnrichmentOpen((open) => !open)} title="Details (E)">
            <PanelLeftOpen size={15} /> Details {detailsCount ? <b>{detailsCount}</b> : null}
          </button>
        </div>
        <div className="sort-new-content">
          <div className="sort-new-term">
            {term ? <InlineSortText key={card.id + term.key} value={fieldText(card.data, term.key)}
              label={term.label} placeholder="add the term" required={term.required} disabled={busy || enrichmentBlocked}
              className="term" onEditingChange={setEditingCard}
              onCommit={(value) => saveInlineField(term.key, value)} /> : null}
            {fieldText(card.data, term?.key) ? <button type="button" className="sort-new-audio"
              aria-label="Hear term" title="Hear term" onClick={() => void speakReviewText(
                fieldText(card.data, term?.key), reviewSpeechLanguage(fieldText(card.data, term?.key), pack.title, pack.cardType?.name ?? "", "term"))}>
              <Volume2 size={19} /></button> : null}
          </div>
          <span className="sort-new-rule" aria-hidden="true" />
          {reading ? <InlineSortText key={card.id + reading.key} value={fieldText(card.data, reading.key)}
            label={reading.label} placeholder="add the reading" required={reading.required} disabled={busy || enrichmentBlocked}
            className="reading" onEditingChange={setEditingCard}
            onCommit={(value) => saveInlineField(reading.key, value)} /> : null}
          {meaning ? <InlineSortText key={card.id + meaning.key} value={fieldText(card.data, meaning.key)}
            label={meaning.label} placeholder="add the meaning" required={meaning.required} multiline
            className="meaning" disabled={busy || enrichmentBlocked} onEditingChange={setEditingCard}
            onCommit={(value) => saveInlineField(meaning.key, value)} /> : null}
          <div className="sort-new-example">
            {exampleField ? <InlineSortText key={card.id + exampleField.key} value={fieldText(card.data, exampleField.key)}
              label="Example sentence" placeholder="+ Example sentence" disabled={busy || enrichmentBlocked}
              onEditingChange={setEditingCard} className="example"
              onCommit={(value) => saveInlineField(exampleField.key, value)} />
              : firstExample ? <button type="button" className="sort-new-example-link" onClick={() => setEnrichmentOpen(true)} title="Edit example in Details">{firstExample}</button>
              : <button type="button" className="sort-new-add-example" onClick={() => setEnrichmentOpen(true)}>+ Example sentence</button>}
            {translationField ? <InlineSortText key={card.id + translationField.key} value={fieldText(card.data, translationField.key)}
              label="Example translation" placeholder="Translation" disabled={busy || enrichmentBlocked}
              onEditingChange={setEditingCard} className="example-translation"
              onCommit={(value) => saveInlineField(translationField.key, value)} />
              : exampleTranslation ? <em>{exampleTranslation}</em> : null}
          </div>
          <div className="sort-new-tags">
            {tags.filter((tag) => tagIds.includes(tag.id)).map((tag) => <button type="button" key={tag.id}
              className={tag.is_badge ? "is-badge" : ""} disabled={busy || enrichmentBlocked || editingCard}
              onClick={() => void toggleTag(tag.id)} title={"Remove " + tag.name}>{tag.name} <X size={11}/></button>)}
            <button type="button" className="sort-new-add-tag" aria-expanded={tagsOpen} disabled={busy || enrichmentBlocked || editingCard}
              onClick={() => setTagsOpen((v) => !v)}>+ Tag</button>
            {tagsOpen ? <div className="sort-new-tag-popover">
              {lessonTags.length ? <div><small>LESSONS</small>{lessonTags.map((tag) => renderTag(tag))}</div> : null}
              {otherTags.length ? <div><small>OTHER TAGS</small>{otherTags.map((tag) => renderTag(tag))}</div> : null}
              {!tags.length ? <p>Create tags in Settings.</p> : null}
            </div> : null}
          </div>
          <div className="sort-new-note">
            {noteOpen ? <textarea rows={2} autoFocus aria-label="Quick note" placeholder="Something to remember…"
              value={noteDraft} disabled={busy || enrichmentBlocked || editingCard}
              onChange={(event) => setNoteDraft(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); setNoteOpen(false); } }} />
              : <button type="button" onClick={() => setNoteOpen(true)}>+ Note</button>}
          </div>
        </div>
        <div className="sort-new-footer">
          <div className="sort-new-decision-heading"><span>How important is it?</span>
            <button type="button" onClick={switchDestination} disabled={busy || enrichmentBlocked || editingCard}
              aria-label={"Goes to " + (destination === "learning" ? "Learn" : "Review") + "; change destination"}
              title="Switch destination (R)">Goes to <b>{destination === "learning" ? "Learn" : "Review"}</b> <ArrowLeftRight size={14}/></button>
          </div>
          <div className="sort-new-ratings" role="group" aria-label="Learning importance">
            {IMPORTANCE_ORDER.map((level, i) => <button type="button" key={level}
              disabled={busy || enrichmentBlocked || editingCard} title={IMPORTANCE_HINT[level]}
              onClick={() => void learn(IMPORTANCE_RANK[level])}>
              <span className="sort-new-rating-top" /><span className="sort-new-rating-name">{IMPORTANCE_LABEL[level]} <kbd>{i + 1}</kbd></span>
              <small>{IMPORTANCE_HINT[level]}</small>
            </button>)}
          </div>
          <div className="sort-new-secondary">
            <button type="button" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void later()}>Later</button>
            <span aria-hidden="true">·</span>
            <button type="button" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void discard()}>Discard</button>
          </div>
          {message ? <p className="sort-error" role="alert">{message}</p> : null}
        </div>
      </article>
      {lastRemoval ? <div className="sort-new-undo" role="status">
        <span>{fieldText(lastRemoval.card.data, term?.key) || "Card"} {lastRemoval.kind === "discard" ? "discarded" : lastRemoval.kind === "later" ? "left for later" :
          "→ " + (lastRemoval.phase === "review" ? "Review" : "Learn") + " · " +
          (lastRemoval.rank === 5 ? "Core" : lastRemoval.rank === 3 ? "Active" : "Passive")}</span>
        <button type="button" disabled={busy || enrichmentBlocked || editingCard} onClick={() => void undo()}><Undo2 size={13}/> Undo</button>
      </div> : null}
    </div> : null}
  </section></div>, document.querySelector(".heuresis-desktop") ?? document.body);
}
