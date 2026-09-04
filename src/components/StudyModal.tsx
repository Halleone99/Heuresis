import { ArrowRight, Shuffle, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type CardWithStats, type PackWithType } from "../lib/heuresis";
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

type CountChoice = "10" | "20" | "50" | "all";
type ReviewSource = Exclude<CosmosSource, "unsorted">;

function sourceCards(cards: CardWithStats[], source: ReviewSource) {
  if (source === "new") return cards.filter((card) => card.stats.encounter_count === 0);
  if (source === "favourites") return cards.filter((card) => card.favourite);
  if (source === "interesting") return cards.filter((card) => (card.interest_rank ?? 0) >= 4 || card.interesting);
  if (source === "again") return cards.filter((card) => card.stats.again_count >= 2);
  return cards;
}

export default function StudyModal({ pack, cards, onClose }: Props) {
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [countChoice, setCountChoice] = useState<CountChoice>(cards.length <= 10 ? "all" : "20");
  const [randomOrder, setRandomOrder] = useState(false);
  const [source, setSource] = useState<ReviewSource>("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const readyCards = useMemo(() => cards.filter(cardHasCompletedSort), [cards]);
  const pool = useMemo(() => sourceCards(readyCards, source), [readyCards, source]);
  const template = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0] ?? null, [templateId, templates]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadStudySetup(pack.id, pack.card_type_id)
      .then(({ templates: next, defaultTemplateId }) => {
        if (cancelled) return;
        setTemplates(next);
        setTemplateId(defaultTemplateId && next.some((item) => item.id === defaultTemplateId) ? defaultTemplateId : next[0]?.id ?? "");
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load review directions."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pack.id, pack.card_type_id]);

  async function start() {
    if (!template || !pool.length || busy) return;
    setBusy(true); setError("");
    try {
      const count = countChoice === "all" ? "all" : Math.min(Number(countChoice), pool.length);
      await openCosmosWindow({
        mode: "review",
        packId: pack.id,
        templateId: template.id,
        source,
        order: randomOrder ? "random" : "pack",
        count,
      });
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open the review popup.");
    } finally { setBusy(false); }
  }

  return <div className="study-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="study-modal review-launcher" role="dialog" aria-modal="true">
      <header className="study-topbar"><div><span className="eyebrow">FLASHCARDS</span><strong>{pack.title}</strong></div><button className="study-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <div className="study-launch">
        <div><p className="eyebrow">REVIEW</p><h2>Review is memory work.</h2><p>Reveal a sorted card, explore its knowledge panels, then grade recall. Sort is separate and never creates a review grade.</p></div>
        <div className="study-review-readiness"><strong>{readyCards.length}</strong><span>of {cards.length} cards ready for review</span><small>Cards enter Review after they have been through Sort.</small></div>
        {loading ? <div className="study-state">Loading review directions…</div> : null}
        {!loading && !templates.length ? <div className="study-state">No review direction exists for this card structure yet.</div> : null}
        {!loading && templates.length ? <div className="study-options">
          <label>Direction<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Source<select value={source} onChange={(event) => setSource(event.target.value as ReviewSource)}><option value="all">All sorted cards</option><option value="new">Never encountered</option><option value="favourites">Favourites</option><option value="interesting">Interest 4–5</option><option value="again">Often Again</option></select></label>
          <label>Cards<select value={countChoice} onChange={(event) => setCountChoice(event.target.value as CountChoice)}>{[10,20,50].filter((count) => pool.length >= count).map((count) => <option key={count} value={String(count)}>{count} cards</option>)}<option value="all">All selected · {pool.length}</option></select></label>
          <button className={`study-order ${randomOrder ? "selected" : ""}`} onClick={() => setRandomOrder((value) => !value)}><Shuffle size={15} /> {randomOrder ? "Random order" : "Topic order"}</button>
        </div> : null}
        {error ? <div className="study-error">{error}</div> : null}
        {!readyCards.length ? <div className="study-state">Nothing is ready for Review yet. Close this and run Sort first.</div> : null}
        <button className="study-start" disabled={loading || !template || !pool.length || busy} onClick={() => void start()}>{busy ? "Opening…" : "Open review window"} <ArrowRight size={16} /></button>
      </div>
    </section>
  </div>;
}
