import { ArrowLeft, ArrowRight, Search, Shuffle, SlidersHorizontal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { type CardWithStats, type HeuresisTag, type PackWithType } from "../lib/heuresis";
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

type LauncherMode = "choose" | "review" | "sort";
type CountChoice = "10" | "20" | "50" | "all";
type ReviewSource = Exclude<CosmosSource, "unsorted">;
type SortSource = CosmosSource;

function sourceCards(cards: CardWithStats[], source: ReviewSource) {
  if (source === "new") return cards.filter((card) => card.stats.encounter_count === 0);
  if (source === "favourites") return cards.filter((card) => card.favourite);
  if (source === "interesting") return cards.filter((card) => (card.interest_rank ?? 0) >= 4 || card.interesting);
  if (source === "again") return cards.filter((card) => card.stats.again_count >= 2);
  return cards;
}

function compareFilterTags(a: HeuresisTag, b: HeuresisTag) {
  const lessonA = a.name.match(/^Lesson\s+(\d+)$/i);
  const lessonB = b.name.match(/^Lesson\s+(\d+)$/i);
  if (lessonA && lessonB) return Number(lessonA[1]) - Number(lessonB[1]);
  if (lessonA) return -1;
  if (lessonB) return 1;
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name, undefined, { numeric: true });
}

export default function StudyModal({ pack, cards, onClose }: Props) {
  const [mode, setMode] = useState<LauncherMode>("choose");
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [countChoice, setCountChoice] = useState<CountChoice>(cards.length <= 10 ? "all" : "20");
  const [randomOrder, setRandomOrder] = useState(false);
  const [source, setSource] = useState<ReviewSource>("all");
  const [sortSource, setSortSource] = useState<SortSource>("unsorted");
  const [sortCount, setSortCount] = useState<CountChoice>(cards.length <= 10 ? "all" : "20");
  const [sortRandom, setSortRandom] = useState(false);
  const [sortTagId, setSortTagId] = useState("");
  const [sortQuery, setSortQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const readyCards = useMemo(() => cards.filter(cardHasCompletedSort), [cards]);
  const pool = useMemo(() => sourceCards(readyCards, source), [readyCards, source]);
  const template = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0] ?? null, [templateId, templates]);
  const unsortedCards = useMemo(() => cards.filter((card) => !cardHasCompletedSort(card)), [cards]);
  const filterTags = useMemo(() => {
    const byId = new Map<string, HeuresisTag>();
    cards.forEach((card) => card.tags.forEach((tag) => { if (!tag.is_badge) byId.set(tag.id, tag); }));
    return Array.from(byId.values()).sort(compareFilterTags);
  }, [cards]);
  const sortPool = useMemo(() => {
    let next = sortSource === "unsorted" ? unsortedCards : sourceCards(cards, sortSource as ReviewSource);
    if (sortTagId) next = next.filter((card) => card.tags.some((tag) => tag.id === sortTagId));
    const q = sortQuery.trim().toLocaleLowerCase();
    if (q) {
      next = next.filter((card) => [
        card.note ?? "",
        ...card.tags.map((tag) => tag.name),
        ...Object.values(card.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string"),
      ].join(" ").toLocaleLowerCase().includes(q));
    }
    return next;
  }, [cards, sortQuery, sortSource, sortTagId, unsortedCards]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void loadStudySetup(pack.id, pack.card_type_id)
      .then(({ templates: next, defaultTemplateId }) => {
        if (cancelled) return;
        setTemplates(next);
        setTemplateId(defaultTemplateId && next.some((item) => item.id === defaultTemplateId) ? defaultTemplateId : next[0]?.id ?? "");
      })
      .catch((loadError) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load study setup."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [pack.id, pack.card_type_id]);

  async function startReview() {
    if (!template || !pool.length || busy) return;
    setBusy(true); setError("");
    try {
      const count = countChoice === "all" ? "all" : Math.min(Number(countChoice), pool.length);
      await openCosmosWindow({ mode: "review", packId: pack.id, templateId: template.id, source, order: randomOrder ? "random" : "pack", count });
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Review.");
    } finally { setBusy(false); }
  }

  async function startSort() {
    if (!sortPool.length || busy) return;
    setBusy(true); setError("");
    try {
      const count = sortCount === "all" ? "all" : Math.min(Number(sortCount), sortPool.length);
      await openCosmosWindow({
        mode: "sort",
        packId: pack.id,
        source: sortSource,
        order: sortRandom ? "random" : "pack",
        count,
        tagId: sortTagId || undefined,
        query: sortQuery || undefined,
      });
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Sort.");
    } finally { setBusy(false); }
  }

  return <div className="study-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="study-modal review-launcher" role="dialog" aria-modal="true">
      <header className="study-topbar"><div><span className="eyebrow">FLASHCARDS</span><strong>{pack.title}</strong></div><button className="study-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>

      {mode === "choose" ? <div className="study-mode-picker">
        <div className="study-mode-intro"><p className="eyebrow">CHOOSE A MODE</p><h2>What do you want to do with these cards?</h2><p>Sort builds and organises the card universe. Review tests what you can recall. They deliberately stay separate.</p></div>
        <div className="study-mode-grid">
          <button className="study-mode-card sort" onClick={() => setMode("sort")}><span className="mode-index">01 · ORGANISE</span><SlidersHorizontal size={24} /><strong>Sort</strong><p>Add knowledge, set interest, assign badges and leave unfinished cards for later.</p><em>Sort cards <ArrowRight size={14} /></em></button>
          <button className="study-mode-card review" onClick={() => setMode("review")}><span className="mode-index">02 · RECALL</span><Sparkles size={24} /><strong>Review</strong><p>Recall first, reveal the answer, open the card's knowledge and then grade memory.</p><em>Review cards <ArrowRight size={14} /></em></button>
        </div>
      </div> : null}

      {mode === "review" ? <div className="study-launch">
        <button className="study-back-link" onClick={() => setMode("choose")}><ArrowLeft size={14} /> Modes</button>
        <div><p className="eyebrow">REVIEW</p><h2>Review is memory work.</h2><p>Only cards that have passed through Sort enter the normal review pool.</p></div>
        <div className="study-review-readiness"><strong>{readyCards.length}</strong><span>of {cards.length} cards ready for review</span><small>Sort remains separate: it never creates Again / Hard / Good / Easy grades.</small></div>
        {loading ? <div className="study-state">Loading review directions…</div> : null}
        {!loading && !templates.length ? <div className="study-state">No review direction exists for this card structure yet.</div> : null}
        {!loading && templates.length ? <div className="study-options">
          <label>Direction<select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label>Cards<select value={source} onChange={(event) => setSource(event.target.value as ReviewSource)}><option value="all">All sorted cards</option><option value="new">Never encountered</option><option value="favourites">Favourites</option><option value="interesting">Interest 4–5</option><option value="again">Often Again</option></select></label>
          <label>How many<select value={countChoice} onChange={(event) => setCountChoice(event.target.value as CountChoice)}>{[10,20,50].filter((count) => pool.length >= count).map((count) => <option key={count} value={String(count)}>{count} cards</option>)}<option value="all">All selected · {pool.length}</option></select></label>
          <button className={`study-order ${randomOrder ? "selected" : ""}`} onClick={() => setRandomOrder((value) => !value)}><Shuffle size={15} /> {randomOrder ? "Random order" : "Topic order"}</button>
        </div> : null}
        {error ? <div className="study-error">{error}</div> : null}
        {!readyCards.length ? <div className="study-state">Nothing is ready for Review yet. Go back and run Sort first.</div> : null}
        <button className="study-start" disabled={loading || !template || !pool.length || busy} onClick={() => void startReview()}>{busy ? "Opening…" : "Open review window"} <ArrowRight size={16} /></button>
      </div> : null}

      {mode === "sort" ? <div className="study-launch">
        <button className="study-back-link" onClick={() => setMode("choose")}><ArrowLeft size={14} /> Modes</button>
        <div><p className="eyebrow">SORT</p><h2>Build the card universe first.</h2><p>Sort is where you classify cards, set interest, and add Words / Grammar / Examples / Notes without pretending you reviewed them.</p></div>
        <div className="study-review-readiness"><strong>{unsortedCards.length}</strong><span>unsorted cards</span><small>Skip leaves a card unsorted so it comes back later.</small></div>
        <div className="study-sort-options">
          <label>Cards<select value={sortSource} onChange={(event) => setSortSource(event.target.value as SortSource)}><option value="unsorted">Unsorted · {unsortedCards.length}</option><option value="all">All cards</option><option value="new">Never encountered</option><option value="favourites">Favourites</option><option value="interesting">Interest 4–5</option><option value="again">Often Again</option></select></label>
          {filterTags.length ? <label>Filter<select value={sortTagId} onChange={(event) => setSortTagId(event.target.value)}><option value="">All tags</option>{filterTags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label> : null}
          <label className="study-search-field">Search<span><Search size={14} /><input value={sortQuery} onChange={(event) => setSortQuery(event.target.value)} placeholder="word, meaning, note…" /></span></label>
          <label>How many<select value={sortCount} onChange={(event) => setSortCount(event.target.value as CountChoice)}>{[10,20,50].filter((count) => sortPool.length >= count).map((count) => <option key={count} value={String(count)}>{count} cards</option>)}<option value="all">All selected · {sortPool.length}</option></select></label>
          <button className={`study-order ${sortRandom ? "selected" : ""}`} onClick={() => setSortRandom((value) => !value)}><Shuffle size={15} /> {sortRandom ? "Random order" : "Topic order"}</button>
        </div>
        {error ? <div className="study-error">{error}</div> : null}
        {!sortPool.length ? <div className="study-state">No cards match this Sort selection.</div> : null}
        <button className="study-start" disabled={!sortPool.length || busy} onClick={() => void startSort()}>{busy ? "Opening…" : "Open sort window"} <ArrowRight size={16} /></button>
      </div> : null}
    </section>
  </div>;
}
