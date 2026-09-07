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
type ReviewSource = Exclude<CosmosSource, "unsorted">;

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

function clampCount(value: number, available: number) {
  if (!available) return 1;
  return Math.min(Math.max(1, value), available);
}

function CountControl({ value, available, onChange }: { value: number; available: number; onChange: (value: number) => void }) {
  const safe = clampCount(value, available);
  const quick = [10, 20, 50].filter((count) => count < available);
  return <div className="study-count-control">
    <div className="study-control-heading"><span>How many</span><strong>{available ? safe : 0} of {available}</strong></div>
    <input type="range" min={1} max={Math.max(1, available)} value={safe} disabled={!available} onChange={(event) => onChange(Number(event.target.value))} />
    <div className="study-count-shortcuts">
      {quick.map((count) => <button key={count} className={safe === count ? "selected" : ""} onClick={() => onChange(count)}>{count}</button>)}
      <button className={available > 0 && safe === available ? "selected" : ""} disabled={!available} onClick={() => onChange(Math.max(1, available))}>All</button>
    </div>
  </div>;
}

export default function StudyModal({ pack, cards, onClose }: Props) {
  const [mode, setMode] = useState<LauncherMode>("choose");
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [reviewCount, setReviewCount] = useState(Math.max(1, Math.min(20, cards.length)));
  const [randomOrder, setRandomOrder] = useState(false);
  const [source, setSource] = useState<ReviewSource>("all");
  const [sortCount, setSortCount] = useState(Math.max(1, Math.min(20, cards.length)));
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
  const firstReviewCards = useMemo(() => readyCards.filter((card) => card.stats.study_count === 0), [readyCards]);
  const reviewedCards = useMemo(() => readyCards.filter((card) => card.stats.study_count > 0), [readyCards]);

  const filterTags = useMemo(() => {
    const byId = new Map<string, HeuresisTag>();
    cards.forEach((card) => card.tags.forEach((tag) => { if (!tag.is_badge) byId.set(tag.id, tag); }));
    return Array.from(byId.values()).sort(compareFilterTags);
  }, [cards]);
  const lessonTags = useMemo(() => filterTags.filter((tag) => /^Lesson\s+\d+$/i.test(tag.name)), [filterTags]);
  const otherTags = useMemo(() => filterTags.filter((tag) => !/^Lesson\s+\d+$/i.test(tag.name)), [filterTags]);

  const sortPool = useMemo(() => {
    let next = unsortedCards;
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
  }, [sortQuery, sortTagId, unsortedCards]);

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

  useEffect(() => { setReviewCount((current) => clampCount(current, pool.length)); }, [pool.length]);
  useEffect(() => { setSortCount((current) => clampCount(current, sortPool.length)); }, [sortPool.length]);

  async function startReview() {
    if (!template || !pool.length || busy) return;
    setBusy(true); setError("");
    try {
      await openCosmosWindow({ mode: "review", packId: pack.id, templateId: template.id, source, order: randomOrder ? "random" : "pack", count: clampCount(reviewCount, pool.length) });
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Review.");
    } finally { setBusy(false); }
  }

  async function startSort() {
    if (!sortPool.length || busy) return;
    setBusy(true); setError("");
    try {
      await openCosmosWindow({
        mode: "sort",
        packId: pack.id,
        source: "unsorted",
        order: sortRandom ? "random" : "pack",
        count: clampCount(sortCount, sortPool.length),
        tagId: sortTagId || undefined,
        query: sortQuery || undefined,
      });
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Sort.");
    } finally { setBusy(false); }
  }

  const sourceOptions: Array<[ReviewSource, string, number]> = [
    ["all", "All ready", readyCards.length],
    ["new", "New", readyCards.filter((card) => card.stats.encounter_count === 0).length],
    ["favourites", "Favourite", readyCards.filter((card) => card.favourite).length],
    ["interesting", "Interest 4–5", readyCards.filter((card) => (card.interest_rank ?? 0) >= 4 || card.interesting).length],
    ["again", "Often Again", readyCards.filter((card) => card.stats.again_count >= 2).length],
  ];

  return <div className="study-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="study-modal review-launcher modern-study-launcher" role="dialog" aria-modal="true">
      <header className="study-topbar"><div><span className="eyebrow">FLASHCARDS</span><strong>{pack.title}</strong></div><button className="study-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>

      {mode === "choose" ? <div className="study-mode-picker modern-mode-picker">
        <div className="study-mode-intro"><p className="eyebrow">CHOOSE A MODE</p><h2>Sort or review?</h2><p>Sort prepares cards. Review tests memory. Keeping those actions separate keeps the data honest.</p></div>
        <div className="study-mode-grid modern-mode-grid">
          <button className="study-mode-card sort" onClick={() => setMode("sort")}><span className="mode-index">01 · ORGANISE</span><SlidersHorizontal size={22} /><strong>Sort</strong><p>Set interest, organise tags and finish cards before they enter review.</p><em>Prepare cards <ArrowRight size={14} /></em></button>
          <button className="study-mode-card review" onClick={() => setMode("review")}><span className="mode-index">02 · RECALL</span><Sparkles size={22} /><strong>Review</strong><p>Choose a review pool, direction, amount and order before opening the session.</p><em>Review cards <ArrowRight size={14} /></em></button>
        </div>
      </div> : null}

      {mode === "review" ? <div className="study-launch study-launch-modern">
        <div className="study-launch-header">
          <button className="study-back-link" onClick={() => setMode("choose")}><ArrowLeft size={14} /> Modes</button>
          <div><p className="eyebrow">REVIEW</p><h2>Choose a review set</h2><p>Only sorted cards are available. Select the pool and session size you actually want.</p></div>
        </div>

        <div className="study-mini-stats">
          <span><strong>{readyCards.length}</strong><small>available</small></span>
          <span><strong>{firstReviewCards.length}</strong><small>first review</small></span>
          <span><strong>{reviewedCards.length}</strong><small>reviewed before</small></span>
        </div>

        {loading ? <div className="study-state">Loading review directions…</div> : null}
        {!loading && !templates.length ? <div className="study-state">No review direction exists for this card structure yet.</div> : null}
        {!loading && templates.length ? <div className="study-control-surface">
          <section className="study-control-section study-direction-section">
            <div className="study-control-heading"><span>Direction</span><small>What appears first</small></div>
            <select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </section>

          <section className="study-control-section study-source-section">
            <div className="study-control-heading"><span>Cards</span><small>Choose one pool</small></div>
            <div className="study-source-tickers">{sourceOptions.map(([value, label, count]) => <button key={value} className={source === value ? "selected" : ""} disabled={!count && value !== "all"} onClick={() => setSource(value)}><span>{label}</span><b>{count}</b></button>)}</div>
          </section>

          <section className="study-control-section study-count-section"><CountControl value={reviewCount} available={pool.length} onChange={setReviewCount} /></section>

          <section className="study-control-section study-order-section">
            <div className="study-control-heading"><span>Order</span><small>Session sequence</small></div>
            <div className="study-order-toggle"><button className={!randomOrder ? "selected" : ""} onClick={() => setRandomOrder(false)}>Topic order</button><button className={randomOrder ? "selected" : ""} onClick={() => setRandomOrder(true)}><Shuffle size={13} /> Random</button></div>
          </section>
        </div> : null}

        {error ? <div className="study-error">{error}</div> : null}
        {!readyCards.length ? <div className="study-state">Nothing is ready for Review yet. Sort some cards first.</div> : null}
        <div className="study-launch-footer"><span>{pool.length ? `${pool.length} cards match this review pool` : "No cards match"}</span><button className="study-start" disabled={loading || !template || !pool.length || busy} onClick={() => void startReview()}>{busy ? "Opening…" : `Review ${pool.length ? clampCount(reviewCount, pool.length) : 0} cards`} <ArrowRight size={16} /></button></div>
      </div> : null}

      {mode === "sort" ? <div className="study-launch study-launch-modern">
        <div className="study-launch-header">
          <button className="study-back-link" onClick={() => setMode("choose")}><ArrowLeft size={14} /> Modes</button>
          <div><p className="eyebrow">SORT</p><h2>Prepare unsorted cards</h2><p>Filter the unsorted queue, choose how much you want to process, then open the sorting workspace.</p></div>
        </div>

        <div className="study-mini-stats sort-stats">
          <span><strong>{unsortedCards.length}</strong><small>unsorted</small></span>
          <span><strong>{sortPool.length}</strong><small>matching</small></span>
          <span><strong>{cards.length - unsortedCards.length}</strong><small>already prepared</small></span>
        </div>

        <div className="study-control-surface sort-control-surface">
          {filterTags.length ? <section className="study-control-section study-tags-launch-section">
            <div className="study-control-heading"><span>Tags</span><small>Optional filter</small></div>
            {lessonTags.length ? <div className="study-launch-tag-group"><p>HSK2 Lessons</p><div>{lessonTags.map((tag) => <button key={tag.id} className={sortTagId === tag.id ? "selected" : ""} onClick={() => setSortTagId((current) => current === tag.id ? "" : tag.id)}>{tag.name.match(/\d+/)?.[0] ?? tag.name}</button>)}</div></div> : null}
            {otherTags.length ? <div className="study-launch-tag-group"><p>Other tags</p><div>{otherTags.map((tag) => <button key={tag.id} className={sortTagId === tag.id ? "selected" : ""} onClick={() => setSortTagId((current) => current === tag.id ? "" : tag.id)}>{tag.name}</button>)}</div></div> : null}
          </section> : null}

          <section className="study-control-section study-search-launch-section">
            <div className="study-control-heading"><span>Search</span><small>Optional</small></div>
            <label className="study-modern-search"><Search size={14} /><input value={sortQuery} onChange={(event) => setSortQuery(event.target.value)} placeholder="word, meaning, note…" /></label>
          </section>

          <section className="study-control-section study-count-section"><CountControl value={sortCount} available={sortPool.length} onChange={setSortCount} /></section>

          <section className="study-control-section study-order-section">
            <div className="study-control-heading"><span>Order</span><small>Queue sequence</small></div>
            <div className="study-order-toggle"><button className={!sortRandom ? "selected" : ""} onClick={() => setSortRandom(false)}>Topic order</button><button className={sortRandom ? "selected" : ""} onClick={() => setSortRandom(true)}><Shuffle size={13} /> Random</button></div>
          </section>
        </div>

        {error ? <div className="study-error">{error}</div> : null}
        {!sortPool.length ? <div className="study-state">No unsorted cards match this selection.</div> : null}
        <div className="study-launch-footer"><span>Skipped cards stay unsorted and return later.</span><button className="study-start" disabled={!sortPool.length || busy} onClick={() => void startSort()}>{busy ? "Opening…" : `Sort ${sortPool.length ? clampCount(sortCount, sortPool.length) : 0} cards`} <ArrowRight size={16} /></button></div>
      </div> : null}
    </section>
  </div>;
}
