import { ArrowRight, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CardWithStats, type PackWithType } from "../lib/heuresis";
import { SegmentedChoice } from "./SegmentedChoice";
import { reviewGradeCount } from "../lib/learningSignals";
import { openCosmosWindow } from "../lib/cosmosWindow";
import { directionPairs } from "../lib/recommend";
import { readReviewPrefs, writeReviewPrefs, type ReviewSourceChoice } from "../lib/reviewPrefs";
import { cardHasCompletedSort } from "../lib/sort";
import { loadStudySetup, type StudyTemplate } from "../lib/study";
import "./study.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  onClose: () => void;
  onComplete: () => void;
};

type DirectionMode = "both" | "one";

function sourceCards(cards: CardWithStats[], source: ReviewSourceChoice) {
  if (source === "new") return cards.filter((card) => reviewGradeCount(card) === 0);
  if (source === "favourites") return cards.filter((card) => card.favourite);
  if (source === "interesting") return cards.filter((card) => (card.interest_rank ?? 0) >= 4 || card.interesting);
  if (source === "again") return cards.filter((card) => card.stats.again_count >= 2);
  return cards;
}

function clampCount(value: number, available: number) {
  if (!available) return 1;
  return Math.min(Math.max(1, value), available);
}

function CountControl({ value, available, onChange }: { value: number; available: number; onChange: (value: number) => void }) {
  const safe = clampCount(value, available);
  return <div className="study-count-control compact-count-control">
    <div className="study-compact-label"><span>Session size</span><b>{available ? safe : 0}/{available}</b></div>
    <input type="range" aria-label="Number of cards to review" min={1} max={Math.max(1, available)} value={safe} disabled={!available} onChange={(event) => onChange(Number(event.target.value))} />
    {available > 1 ? <button type="button" className="study-count-all" aria-pressed={safe === available} onClick={() => onChange(available)}>All {available}</button> : null}
  </div>;
}

/** Adjust: every manual Review choice, remembered per topic. One-click Review uses its directions and size. */
export default function StudyModal({ pack, cards, onClose, onComplete }: Props) {
  const remembered = useMemo(() => readReviewPrefs(pack.id), [pack.id]);
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const [templateId, setTemplateId] = useState("");
  const [directionMode, setDirectionMode] = useState<DirectionMode>("one");
  const [directionPairKey, setDirectionPairKey] = useState("");
  const [reviewCount, setReviewCount] = useState(remembered.size);
  const [randomOrder, setRandomOrder] = useState(remembered.order === "random");
  const [source, setSource] = useState<ReviewSourceChoice>(remembered.source);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const readyCards = useMemo(() => cards.filter(cardHasCompletedSort), [cards]);
  const pool = useMemo(() => sourceCards(readyCards, source === "recommended" ? "all" : source), [readyCards, source]);
  const template = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0] ?? null, [templateId, templates]);
  const pairs = useMemo(() => directionPairs(templates), [templates]);
  const activePair = useMemo(() => pairs.find((pair) => pair.key === directionPairKey) ?? pairs[0] ?? null, [directionPairKey, pairs]);
  const selectedTemplateIds = useMemo(() => directionMode === "both" && activePair ? activePair.ids : template ? [template.id] : [], [activePair, directionMode, template]);
  const firstReviewCards = useMemo(() => readyCards.filter((card) => reviewGradeCount(card) === 0), [readyCards]);
  const reviewedCards = useMemo(() => readyCards.filter((card) => reviewGradeCount(card) > 0), [readyCards]);
  // A recommended session can use both directions of each card.
  const available = source === "recommended" ? pool.length * Math.max(1, selectedTemplateIds.length) : pool.length;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setTemplates([]);
    void loadStudySetup(pack.id, pack.card_type_id)
      .then(({ templates: next, defaultTemplateId }) => {
        if (cancelled) return;
        setTemplates(next);
        const nextPairs = directionPairs(next);
        const defaultId = defaultTemplateId && next.some((item) => item.id === defaultTemplateId) ? defaultTemplateId : next[0]?.id ?? "";
        const rememberedPair = remembered.directionMode === "both" ? nextPairs.find((pair) => pair.key === remembered.pairKey) : null;
        const rememberedOne = remembered.directionMode === "one" && remembered.templateId && next.some((item) => item.id === remembered.templateId) ? remembered.templateId : null;
        setTemplateId(rememberedOne ?? defaultId);
        const preferred = rememberedPair ?? nextPairs.find((pair) => pair.ids.includes(defaultId)) ?? nextPairs[0] ?? null;
        setDirectionPairKey(preferred?.key ?? "");
        setDirectionMode(rememberedOne ? "one" : preferred ? "both" : "one");
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load review setup."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pack.id, pack.card_type_id, remembered]);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, []);

  async function startReview() {
    if (!selectedTemplateIds.length || !pool.length || busy) return;
    setBusy(true); setError("");
    const size = clampCount(reviewCount, available);
    writeReviewPrefs(pack.id, {
      directionMode, pairKey: directionMode === "both" ? activePair?.key ?? null : null, templateId: directionMode === "one" ? template?.id ?? null : null,
      source, size: Math.max(1, reviewCount), order: randomOrder ? "random" : "pack",
    });
    try {
      await openCosmosWindow({ mode: "review", packId: pack.id, templateIds: selectedTemplateIds, source, order: randomOrder ? "random" : "pack", count: size });
      onComplete();
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Review.");
    } finally { setBusy(false); }
  }

  const reviewSources: Array<[ReviewSourceChoice, string, number]> = [
    ["recommended", "Recommended", readyCards.length],
    ["all", "All learning cards", readyCards.length],
    ["new", "Never reviewed", firstReviewCards.length],
    ["favourites", "Favourites", readyCards.filter((card) => card.favourite).length],
    ["interesting", "Core", readyCards.filter((card) => (card.interest_rank ?? 0) >= 4 || card.interesting).length],
    ["again", "Often missed", readyCards.filter((card) => card.stats.again_count >= 2).length],
  ];

  return <div className="study-backdrop" onMouseDown={(event) => { if (!busy && event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="study-modal review-launcher modern-study-launcher compact-study-launcher" role="dialog" aria-modal="true" aria-label="Review setup"
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <header className="study-topbar"><div><span className="eyebrow">ADJUST REVIEW</span><strong>{pack.title}</strong></div><button type="button" className="study-close" disabled={busy} onClick={onClose} aria-label="Close"><X size={18} /></button></header>

      <div className="study-launch compact-study-screen">
        <div className="compact-study-heading"><div><h2>Review cards</h2></div><div className="compact-study-meta"><span><b>{readyCards.length}</b> learning</span><span><b>{firstReviewCards.length}</b> never reviewed</span><span><b>{reviewedCards.length}</b> reviewed</span></div></div>

        {loading ? <div className="study-state" role="status">Loading review directions…</div> : null}
        {!loading && !error && !templates.length ? <div className="study-state">No review direction is configured. Open Topic settings to add one.</div> : null}
        {!loading && templates.length ? <div className="compact-study-controls review-controls">
          <section className="compact-direction-picker">
            <span>Direction</span>
            <SegmentedChoice label="Review directions" className="direction-mode-toggle" value={directionMode} onChange={setDirectionMode}
              options={[{ value: "both", label: "Both directions", disabled: !pairs.length }, { value: "one", label: "One direction" }]} />
            {directionMode === "both" ? <div className="direction-detail">
              {pairs.length > 1 ? <select value={activePair?.key ?? ""} onChange={(event) => setDirectionPairKey(event.target.value)}>{pairs.map((pair) => <option key={pair.key} value={pair.key}>{pair.label}</option>)}</select> : <strong>{activePair?.label ?? "No reversible pair"}</strong>}
            </div> : <div className="direction-detail"><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
            <small className="study-direction-hint">{source === "recommended"
              ? (directionMode === "both" ? "Each direction is judged on its own evidence; the weaker one tends to come first." : "Only this direction is recommended.")
              : directionMode === "both" ? "Alternates the two directions; each card appears once." : "Shows the selected front side on every card."}</small>
          </section>
          {/* Which cards and how many belong together: the size is out of the chosen cards. */}
          <section className="compact-field compact-cards-panel">
            <label className="compact-cards-select"><span>Cards</span><select value={source} onChange={(event) => setSource(event.target.value as ReviewSourceChoice)}>{reviewSources.map(([value, label, count]) => <option key={value} value={value} disabled={!count && value !== "all" && value !== "recommended"}>{label} · {count}</option>)}</select></label>
            {source === "recommended" ? <small className="study-direction-hint">Weak, untried and long-unseen cards first, mixed with familiar ones. Importance only nudges the choice. Nothing is ever due.</small> : null}
            <CountControl value={reviewCount} available={available} onChange={setReviewCount} />
          </section>
          <section className="compact-order-panel"><span>Order</span>{source === "recommended"
            // Order is part of the recommendation (weakest first, directions kept apart); it is offered for every other choice.
            ? <small className="study-direction-hint">Set by the recommendation. Choose other cards to pick topic or random order.</small>
            : <SegmentedChoice label="Review card order" className="study-order-toggle"
              value={randomOrder ? "random" : "topic"} onChange={(choice) => setRandomOrder(choice === "random")}
              options={[{ value: "topic", label: "Topic" }, { value: "random", label: "Random", icon: <Shuffle size={13} /> }]} />}</section>
        </div> : null}

        {error ? <div className="study-error" role="alert">{error}</div> : null}
        <div className="compact-study-footer"><button type="button" className="study-start" disabled={loading || !selectedTemplateIds.length || !pool.length || busy} onClick={() => void startReview()}>{busy ? "Opening…" : `Start review · ${pool.length ? clampCount(reviewCount, available) : 0} ${pool.length && clampCount(reviewCount, available) === 1 ? "card" : "cards"}` } <ArrowRight size={16} /></button></div>
      </div>
    </section>
  </div>;
}
