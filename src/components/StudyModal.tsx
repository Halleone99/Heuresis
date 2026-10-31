import { ArrowRight, ChevronDown, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CardWithStats, type PackWithType } from "../lib/heuresis";
import { SegmentedChoice } from "./SegmentedChoice";
import { openCosmosWindow, type CosmosOrder } from "../lib/cosmosWindow";
import { cardBarProgress, reviewEligible } from "../lib/cardProgress";
import { assessState, directionEvidence, type GradeEvent } from "../lib/knowledgeState";
import { loadGradeEvents } from "../lib/reviewEvidence";
import { directionPairs } from "../lib/recommend";
import { readReviewPrefs, writeReviewPrefs } from "../lib/reviewPrefs";
import { cardHasCompletedSort } from "../lib/sort";
import { loadStudySetup, type StudyTemplate } from "../lib/study";
import "./study.css";

type Props = { pack: PackWithType; cards: CardWithStats[]; onClose: () => void; onComplete: () => void };
type SpecialFlag = "favourite" | "important" | "missed";

function flagged(card: CardWithStats, flag: SpecialFlag) {
  if (flag === "favourite") return card.favourite;
  if (flag === "important") return (card.data["_review_important"] === "true" || card.tags.some((tag) => tag.name.toLowerCase() === "important"));
  return card.stats.again_count >= 2;
}

/** Compact session setup: size, a single order rule, and combinable filters. */
export default function StudyModal({ pack, cards, onClose, onComplete }: Props) {
  const remembered = useMemo(() => readReviewPrefs(pack.id), [pack.id]);
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [history, setHistory] = useState<GradeEvent[] | null>(null);
  const [sizeInput, setSizeInput] = useState(String(remembered.size));
  const [order, setOrder] = useState<"random" | "weakest" | "oldest">(
    remembered.order === "random" ? "random" : remembered.order === "oldest" ? "oldest" : "weakest");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [flags, setFlags] = useState<SpecialFlag[]>([]);
  const [includeMastered, setIncludeMastered] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void Promise.all([loadStudySetup(pack.id, pack.card_type_id), loadGradeEvents(pack.id)])
      .then(([setup, grades]) => {
        if (cancelled) return;
        setTemplates(setup.templates);
        setDefaultTemplateId(setup.defaultTemplateId);
        setHistory(grades);
      }).catch((failure) => { if (!cancelled) setError(failure instanceof Error ? failure.message : "Could not prepare Review."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pack.id, pack.card_type_id]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, []);

  const tags = useMemo(() => {
    const byId = new Map(cards.flatMap((card) => card.tags.map((tag) => [tag.id, tag] as const)));
    return [...byId.values()].filter((tag) => tag.name.toLowerCase() !== "important")
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [cards]);
  const eventsByCard = useMemo(() => {
    const grouped = new Map<string, GradeEvent[]>();
    for (const grade of history ?? []) {
      const group = grouped.get(grade.cardId) ?? [];
      group.push(grade);
      grouped.set(grade.cardId, group);
    }
    return grouped;
  }, [history]);
  const pairs = useMemo(() => directionPairs(templates), [templates]);
  const activePair = pairs.find((pair) => pair.ids.includes(defaultTemplateId ?? "")) ?? pairs[0] ?? null;
  const selectedTemplateIds = activePair ? [...activePair.ids] : [defaultTemplateId ?? templates[0]?.id].filter((value): value is string => Boolean(value));
  const pairedIds = activePair ? [...activePair.ids] : [];

  const eligible = useMemo(() => cards.filter((card) => {
    if (!cardHasCompletedSort(card)) return false;
    if (tagIds.some((id) => !card.tags.some((tag) => tag.id === id))) return false;
    if (flags.some((flag) => !flagged(card, flag))) return false;
    const events = history ? eventsByCard.get(card.id) ?? [] : null;
    const legacyState = assessState(directionEvidence(card, null, events)).state;
    return reviewEligible(cardBarProgress(card, events, legacyState, pairedIds), events, card.stats.last_encountered_at, includeMastered, Date.now(), selectedTemplateIds);
  }), [cards, eventsByCard, flags, history, includeMastered, tagIds, pairedIds, selectedTemplateIds]);
  const requestedSize = Number(sizeInput);
  const validSize = /^\d+$/.test(sizeInput) && Number.isSafeInteger(requestedSize) && requestedSize >= 1 && requestedSize <= 500;
  const sessionCount = validSize ? Math.min(requestedSize, eligible.length) : 0;
  const activeFilterCount = tagIds.length + flags.length + Number(includeMastered);
  const clearFilters = () => { setTagIds([]); setFlags([]); setIncludeMastered(false); };

  const toggleTag = (id: string) => setTagIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  const toggleFlag = (flag: SpecialFlag) => setFlags((current) => current.includes(flag) ? current.filter((value) => value !== flag) : [...current, flag]);

  async function startReview() {
    if (!selectedTemplateIds.length || !eligible.length || !validSize || busy) return;
    setBusy(true); setError("");
    writeReviewPrefs(pack.id, { ...remembered, source: "all", size: requestedSize, order });
    try {
      await openCosmosWindow({
        mode: "review", packId: pack.id, templateIds: selectedTemplateIds,
        source: "all", order: order as CosmosOrder, count: sessionCount,
        tagIds, reviewFlags: flags, includeMastered,
      });
      onComplete();
      onClose();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not open Review."); }
    finally { setBusy(false); }
  }

  return <div className="study-backdrop" onMouseDown={(event) => { if (!busy && event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="study-modal review-launcher modern-study-launcher compact-study-launcher"
      role="dialog" aria-modal="true" aria-label="Review setup"
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <header className="study-topbar"><div><span className="eyebrow">REVIEW</span><strong>{pack.title}</strong></div>
        <button type="button" className="study-close" disabled={busy} onClick={onClose} aria-label="Close"><X size={18} /></button>
      </header>
      <div className="study-launch compact-study-screen">
        <div className="compact-study-heading"><h2>Review cards</h2><div className="compact-study-meta"><span><b>{eligible.length}</b> available</span></div></div>
        {loading ? <div className="study-state" role="status">Loading cards and review history…</div> : null}
        {!loading && !selectedTemplateIds.length ? <div className="study-state">No review direction is configured for this topic.</div> : null}
        <div className="compact-study-controls review-controls">
          <div className="review-count-field">
            <label htmlFor="review-session-size">Session size</label>
            <input id="review-session-size" type="number" inputMode="numeric" min={1} max={500} step={1}
              value={sizeInput} aria-invalid={!validSize}
              onChange={(event) => setSizeInput(event.target.value)}
              onBlur={() => { if (!validSize) setSizeInput(String(Math.max(1, Math.min(500, Math.floor(Number(sizeInput) || remembered.size))))); }}
              aria-describedby="review-size-hint" />
            <small id="review-size-hint">{validSize && requestedSize > eligible.length && eligible.length > 0
              ? `Only ${eligible.length} cards available` : "1–500 cards"}</small>
          </div>
          <div className="review-order-field">
            <span>Order</span>
            <SegmentedChoice label="Review card order" className="study-order-toggle review-order-options"
              value={order} onChange={(value) => setOrder(value as "random" | "weakest" | "oldest")}
              options={[{ value: "weakest", label: "Weakest first" }, { value: "oldest", label: "Longest unseen" }, { value: "random", label: "Random" }]} />
          </div>
        </div>
        <details className="review-filters">
          <summary><span>Filters</span><small>{activeFilterCount ? `${activeFilterCount} selected` : "Optional"}</small><ChevronDown size={16} aria-hidden="true" /></summary>
          <div className="review-filters-body">
            <div className="review-filter-heading"><span>Content tags</span>{activeFilterCount > 0 ? <button type="button" onClick={clearFilters}>Clear filters</button> : null}</div>
            <div className="review-filter-chips">{tags.map((tag) => <button type="button" key={tag.id}
              aria-pressed={tagIds.includes(tag.id)} className={tagIds.includes(tag.id) ? "selected" : ""}
              onClick={() => toggleTag(tag.id)}>{tag.name}</button>)}
              {!tags.length ? <small>No content tags</small> : null}
            </div>
            <div className="review-filter-heading"><span>Review tags</span></div>
            <div className="review-filter-chips">{([["favourite","Favourite"],["important","Important"],["missed","Frequently missed"]] as const).map(([id,label]) =>
              <button type="button" key={id} aria-pressed={flags.includes(id)}
                className={flags.includes(id) ? "selected" : ""} onClick={() => toggleFlag(id)}>{label}</button>)}</div>
            <label className="review-include-mastered"><input type="checkbox" checked={includeMastered}
              onChange={(event) => setIncludeMastered(event.target.checked)}/> Include mastered cards</label>
          </div>
        </details>
        {error ? <div className="study-error" role="alert">{error}</div> : null}
        <div className="compact-study-footer"><button type="button" className="study-start" disabled={loading || !selectedTemplateIds.length || !eligible.length || !validSize || busy}
          onClick={() => void startReview()}>{busy ? "Opening…" : "Start review · " + sessionCount + (sessionCount === 1 ? " card" : " cards")} <ArrowRight size={16}/></button></div>
      </div>
    </section>
  </div>;
}
