import { ArrowRight, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CardWithStats, type PackWithType } from "../lib/heuresis";
import { reviewGradeCount } from "../lib/learningSignals";
import { openCosmosWindow, type CosmosSource } from "../lib/cosmosWindow";
import { cardHasCompletedSort } from "../lib/sort";
import { loadStudySetup, type StudyTemplate } from "../lib/study";
import "./study.css";

type Props = {
  pack: PackWithType;
  cards: CardWithStats[];
  onClose: () => void;
  onComplete: () => void;
};

type ReviewSource = Exclude<CosmosSource, "unsorted">;
type DirectionMode = "both" | "one";
type DirectionPair = { key: string; ids: [string, string]; label: string };

function sourceCards(cards: CardWithStats[], source: ReviewSource) {
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

function sameFields(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function directionPairs(templates: StudyTemplate[]): DirectionPair[] {
  const used = new Set<string>();
  const pairs: DirectionPair[] = [];
  for (const template of templates) {
    if (used.has(template.id)) continue;
    const reverse = templates.find((candidate) => candidate.id !== template.id
      && !used.has(candidate.id)
      && sameFields(template.front, candidate.back)
      && sameFields(template.back, candidate.front));
    if (!reverse) continue;
    used.add(template.id);
    used.add(reverse.id);
    const raw = template.name.includes("→") ? template.name.replace(/\s*→\s*/, " ↔ ") : `${template.name} ↔ reverse`;
    pairs.push({ key: [template.id, reverse.id].sort().join(":"), ids: [template.id, reverse.id], label: raw });
  }
  return pairs;
}

function CountControl({ value, available, onChange }: { value: number; available: number; onChange: (value: number) => void }) {
  const safe = clampCount(value, available);
  return <div className="study-count-control compact-count-control">
    <div className="study-compact-label"><span>Amount</span><b>{available ? safe : 0}/{available}</b></div>
    <input type="range" aria-label="Number of cards to review" min={1} max={Math.max(1, available)} value={safe} disabled={!available} onChange={(event) => onChange(Number(event.target.value))} />
    {available > 1 ? <button type="button" className="study-count-all" aria-pressed={safe === available} onClick={() => onChange(available)}>All {available}</button> : null}
  </div>;
}

export default function StudyModal({ pack, cards, onClose, onComplete }: Props) {
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const dialogRef = useRef<HTMLElement>(null);
  const [templateId, setTemplateId] = useState("");
  const [directionMode, setDirectionMode] = useState<DirectionMode>("one");
  const [directionPairKey, setDirectionPairKey] = useState("");
  const [reviewCount, setReviewCount] = useState(Math.max(1, Math.min(20, cards.length)));
  const [randomOrder, setRandomOrder] = useState(false);
  const [source, setSource] = useState<ReviewSource>("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const readyCards = useMemo(() => cards.filter(cardHasCompletedSort), [cards]);
  const pool = useMemo(() => sourceCards(readyCards, source), [readyCards, source]);
  const template = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0] ?? null, [templateId, templates]);
  const pairs = useMemo(() => directionPairs(templates), [templates]);
  const activePair = useMemo(() => pairs.find((pair) => pair.key === directionPairKey) ?? pairs[0] ?? null, [directionPairKey, pairs]);
  const selectedTemplateIds = useMemo(() => directionMode === "both" && activePair ? activePair.ids : template ? [template.id] : [], [activePair, directionMode, template]);
  const firstReviewCards = useMemo(() => readyCards.filter((card) => reviewGradeCount(card) === 0), [readyCards]);
  const reviewedCards = useMemo(() => readyCards.filter((card) => reviewGradeCount(card) > 0), [readyCards]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setTemplates([]);
    void loadStudySetup(pack.id, pack.card_type_id)
      .then(({ templates: next, defaultTemplateId }) => {
        if (cancelled) return;
        setTemplates(next);
        const defaultId = defaultTemplateId && next.some((item) => item.id === defaultTemplateId) ? defaultTemplateId : next[0]?.id ?? "";
        setTemplateId(defaultId);
        const nextPairs = directionPairs(next);
        const preferred = nextPairs.find((pair) => pair.ids.includes(defaultId)) ?? nextPairs[0] ?? null;
        setDirectionPairKey(preferred?.key ?? "");
        setDirectionMode(preferred ? "both" : "one");
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load study setup."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pack.id, pack.card_type_id]);

  useEffect(() => { setReviewCount((current) => clampCount(current, pool.length)); }, [pool.length]);
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, []);

  async function startReview() {
    if (!selectedTemplateIds.length || !pool.length || busy) return;
    setBusy(true); setError("");
    try {
      await openCosmosWindow({ mode: "review", packId: pack.id, templateIds: selectedTemplateIds, source, order: randomOrder ? "random" : "pack", count: clampCount(reviewCount, pool.length) });
      onComplete();
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Review.");
    } finally { setBusy(false); }
  }

  const reviewSources: Array<[ReviewSource, string, number]> = [
    ["all", "All ready", readyCards.length],
    ["new", "First review", firstReviewCards.length],
    ["favourites", "Favourites", readyCards.filter((card) => card.favourite).length],
    ["interesting", "Interest 4–5", readyCards.filter((card) => (card.interest_rank ?? 0) >= 4 || card.interesting).length],
    ["again", "Often Again", readyCards.filter((card) => card.stats.again_count >= 2).length],
  ];

  return <div className="study-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section ref={dialogRef} tabIndex={-1} className="study-modal review-launcher modern-study-launcher compact-study-launcher" role="dialog" aria-modal="true" aria-label="Review setup"
      onKeyDown={(event) => { if (event.key === "Escape" && !busy) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <header className="study-topbar"><div><span className="eyebrow">REVIEW</span><strong>{pack.title}</strong></div><button type="button" className="study-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>

      <div className="study-launch compact-study-screen">
        <div className="compact-study-heading"><div><h2>Review cards</h2></div><div className="compact-study-meta"><span><b>{readyCards.length}</b> ready</span><span><b>{firstReviewCards.length}</b> first</span><span><b>{reviewedCards.length}</b> reviewed</span></div></div>

        {loading ? <div className="study-state" role="status">Loading review directions…</div> : null}
        {!loading && !error && !templates.length ? <div className="study-state">No review direction is configured. Open Topic settings to add one.</div> : null}
        {!loading && templates.length ? <div className="compact-study-controls review-controls">
          <section className="compact-direction-picker">
            <span>Direction</span>
            <div className="direction-mode-toggle">
              <button type="button" className={directionMode === "both" ? "selected" : ""} aria-pressed={directionMode === "both"} disabled={!pairs.length} onClick={() => setDirectionMode("both")}>Mixed directions</button>
              <button type="button" className={directionMode === "one" ? "selected" : ""} aria-pressed={directionMode === "one"} onClick={() => setDirectionMode("one")}>One side</button>
            </div>
            {directionMode === "both" ? <div className="direction-detail">
              {pairs.length > 1 ? <select value={activePair?.key ?? ""} onChange={(event) => setDirectionPairKey(event.target.value)}>{pairs.map((pair) => <option key={pair.key} value={pair.key}>{pair.label}</option>)}</select> : <strong>{activePair?.label ?? "No reversible pair"}</strong>}
            </div> : <div className="direction-detail"><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
            <small className="study-direction-hint">{directionMode === "both" ? "Alternates directions across cards; each card appears once." : "Uses the selected direction for every card."}</small>
          </section>
          <label className="compact-field"><span>Cards</span><select value={source} onChange={(event) => setSource(event.target.value as ReviewSource)}>{reviewSources.map(([value, label, count]) => <option key={value} value={value} disabled={!count && value !== "all"}>{label} · {count}</option>)}</select></label>
          <section className="compact-count-panel"><CountControl value={reviewCount} available={pool.length} onChange={setReviewCount} /></section>
          <section className="compact-order-panel"><span>Order</span><div className="study-order-toggle"><button type="button" className={!randomOrder ? "selected" : ""} aria-pressed={!randomOrder} onClick={() => setRandomOrder(false)}>Topic</button><button type="button" className={randomOrder ? "selected" : ""} aria-pressed={randomOrder} onClick={() => setRandomOrder(true)}><Shuffle size={13} /> Random</button></div></section>
        </div> : null}

        {error ? <div className="study-error" role="alert">{error}</div> : null}
        <div className="compact-study-footer"><button type="button" className="study-start" disabled={loading || !selectedTemplateIds.length || !pool.length || busy} onClick={() => void startReview()}>{busy ? "Opening…" : `Start review · ${pool.length ? clampCount(reviewCount, pool.length) : 0} cards` } <ArrowRight size={16} /></button></div>
      </div>
    </section>
  </div>;
}
