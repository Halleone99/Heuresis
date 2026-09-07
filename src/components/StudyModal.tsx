import { ArrowLeft, ArrowRight, Search, Shuffle, SlidersHorizontal, Sparkles, Tag, X } from "lucide-react";
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
type DirectionMode = "both" | "one";
type DirectionPair = { key: string; ids: [string, string]; label: string };

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
    <input type="range" min={1} max={Math.max(1, available)} value={safe} disabled={!available} onChange={(event) => onChange(Number(event.target.value))} />
    <div className="study-count-shortcuts compact-count-shortcuts">
      {[10, 20, 50].filter((count) => count < available).map((count) => <button type="button" key={count} className={safe === count ? "selected" : ""} onClick={() => onChange(count)}>{count}</button>)}
      <button type="button" className={available > 0 && safe === available ? "selected" : ""} disabled={!available} onClick={() => onChange(Math.max(1, available))}>All</button>
    </div>
  </div>;
}

function TagPicker({ tags, selected, onChange }: { tags: HeuresisTag[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const lessons = tags.filter((tag) => /^Lesson\s+\d+$/i.test(tag.name));
  const others = tags.filter((tag) => !/^Lesson\s+\d+$/i.test(tag.name));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  return <details className="study-tags-menu">
    <summary className={selected.length ? "active" : ""}><Tag size={14} /><span>Tags</span>{selected.length ? <b>{selected.length}</b> : null}</summary>
    <div className="study-tags-popover">
      <button type="button" className={!selected.length ? "selected" : ""} onClick={(event) => { event.preventDefault(); onChange([]); }}>All tags</button>
      {lessons.length ? <section><p>HSK2 Lessons</p><div className="study-tag-grid">{lessons.map((tag) => <button type="button" key={tag.id} className={selected.includes(tag.id) ? "selected" : ""} onClick={(event) => { event.preventDefault(); toggle(tag.id); }}>{tag.name.match(/\d+/)?.[0] ?? tag.name}</button>)}</div></section> : null}
      {others.length ? <section><p>Other</p><div className="study-tag-wrap">{others.map((tag) => <button type="button" key={tag.id} className={selected.includes(tag.id) ? "selected" : ""} onClick={(event) => { event.preventDefault(); toggle(tag.id); }}>{tag.name}</button>)}</div></section> : null}
    </div>
  </details>;
}

export default function StudyModal({ pack, cards, onClose }: Props) {
  const [mode, setMode] = useState<LauncherMode>("choose");
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [directionMode, setDirectionMode] = useState<DirectionMode>("one");
  const [directionPairKey, setDirectionPairKey] = useState("");
  const [reviewCount, setReviewCount] = useState(Math.max(1, Math.min(20, cards.length)));
  const [randomOrder, setRandomOrder] = useState(false);
  const [source, setSource] = useState<ReviewSource>("all");
  const [sortCount, setSortCount] = useState(Math.max(1, Math.min(20, cards.length)));
  const [sortRandom, setSortRandom] = useState(false);
  const [sortTagIds, setSortTagIds] = useState<string[]>([]);
  const [sortQuery, setSortQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const readyCards = useMemo(() => cards.filter(cardHasCompletedSort), [cards]);
  const pool = useMemo(() => sourceCards(readyCards, source), [readyCards, source]);
  const template = useMemo(() => templates.find((item) => item.id === templateId) ?? templates[0] ?? null, [templateId, templates]);
  const pairs = useMemo(() => directionPairs(templates), [templates]);
  const activePair = useMemo(() => pairs.find((pair) => pair.key === directionPairKey) ?? pairs[0] ?? null, [directionPairKey, pairs]);
  const selectedTemplateIds = useMemo(() => directionMode === "both" && activePair ? activePair.ids : template ? [template.id] : [], [activePair, directionMode, template]);
  const unsortedCards = useMemo(() => cards.filter((card) => !cardHasCompletedSort(card)), [cards]);
  const firstReviewCards = useMemo(() => readyCards.filter((card) => card.stats.study_count === 0), [readyCards]);
  const reviewedCards = useMemo(() => readyCards.filter((card) => card.stats.study_count > 0), [readyCards]);

  const filterTags = useMemo(() => {
    const byId = new Map<string, HeuresisTag>();
    cards.forEach((card) => card.tags.forEach((tag) => { if (!tag.is_badge) byId.set(tag.id, tag); }));
    return Array.from(byId.values()).sort(compareFilterTags);
  }, [cards]);

  const sortPool = useMemo(() => {
    let next = unsortedCards;
    if (sortTagIds.length) next = next.filter((card) => card.tags.some((tag) => sortTagIds.includes(tag.id)));
    const q = sortQuery.trim().toLocaleLowerCase();
    if (q) {
      next = next.filter((card) => [
        card.note ?? "",
        ...card.tags.map((tag) => tag.name),
        ...Object.values(card.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string"),
      ].join(" ").toLocaleLowerCase().includes(q));
    }
    return next;
  }, [sortQuery, sortTagIds, unsortedCards]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
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
  useEffect(() => { setSortCount((current) => clampCount(current, sortPool.length)); }, [sortPool.length]);

  async function startReview() {
    if (!selectedTemplateIds.length || !pool.length || busy) return;
    setBusy(true); setError("");
    try {
      await openCosmosWindow({ mode: "review", packId: pack.id, templateIds: selectedTemplateIds, source, order: randomOrder ? "random" : "pack", count: clampCount(reviewCount, pool.length) });
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Review.");
    } finally { setBusy(false); }
  }

  async function startSort() {
    if (!sortPool.length || busy) return;
    setBusy(true); setError("");
    try {
      await openCosmosWindow({ mode: "sort", packId: pack.id, source: "unsorted", order: sortRandom ? "random" : "pack", count: clampCount(sortCount, sortPool.length), tagIds: sortTagIds, query: sortQuery || undefined });
      onClose();
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Could not open Sort.");
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
    <section className="study-modal review-launcher modern-study-launcher compact-study-launcher" role="dialog" aria-modal="true">
      <header className="study-topbar"><div><span className="eyebrow">FLASHCARDS</span><strong>{pack.title}</strong></div><button type="button" className="study-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>

      {mode === "choose" ? <div className="study-mode-picker modern-mode-picker compact-mode-picker">
        <div className="study-mode-intro"><p className="eyebrow">MODE</p><h2>Sort or review</h2></div>
        <div className="study-mode-grid modern-mode-grid compact-mode-grid">
          <button type="button" className="study-mode-card sort" onClick={() => setMode("sort")}><SlidersHorizontal size={21} /><strong>Sort</strong><em>Prepare cards <ArrowRight size={14} /></em></button>
          <button type="button" className="study-mode-card review" onClick={() => setMode("review")}><Sparkles size={21} /><strong>Review</strong><em>Review cards <ArrowRight size={14} /></em></button>
        </div>
      </div> : null}

      {mode === "review" ? <div className="study-launch compact-study-screen">
        <div className="compact-study-heading"><button type="button" className="study-back-link" onClick={() => setMode("choose")}><ArrowLeft size={14} /> Modes</button><div><p className="eyebrow">REVIEW</p><h2>Review cards</h2></div><div className="compact-study-meta"><span><b>{readyCards.length}</b> ready</span><span><b>{firstReviewCards.length}</b> first</span><span><b>{reviewedCards.length}</b> reviewed</span></div></div>

        {loading ? <div className="study-state">Loading…</div> : null}
        {!loading && !templates.length ? <div className="study-state">No review direction is configured.</div> : null}
        {!loading && templates.length ? <div className="compact-study-controls review-controls">
          <section className="compact-direction-picker">
            <span>Direction</span>
            <div className="direction-mode-toggle">
              <button type="button" className={directionMode === "both" ? "selected" : ""} disabled={!pairs.length} onClick={() => setDirectionMode("both")}>Both sides</button>
              <button type="button" className={directionMode === "one" ? "selected" : ""} onClick={() => setDirectionMode("one")}>One side</button>
            </div>
            {directionMode === "both" ? <div className="direction-detail">
              {pairs.length > 1 ? <select value={activePair?.key ?? ""} onChange={(event) => setDirectionPairKey(event.target.value)}>{pairs.map((pair) => <option key={pair.key} value={pair.key}>{pair.label}</option>)}</select> : <strong>{activePair?.label ?? "No reversible pair"}</strong>}
            </div> : <div className="direction-detail"><select value={templateId} onChange={(event) => setTemplateId(event.target.value)}>{templates.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>}
          </section>
          <label className="compact-field"><span>Cards</span><select value={source} onChange={(event) => setSource(event.target.value as ReviewSource)}>{reviewSources.map(([value, label, count]) => <option key={value} value={value} disabled={!count && value !== "all"}>{label} · {count}</option>)}</select></label>
          <section className="compact-count-panel"><CountControl value={reviewCount} available={pool.length} onChange={setReviewCount} /></section>
          <section className="compact-order-panel"><span>Order</span><div className="study-order-toggle"><button type="button" className={!randomOrder ? "selected" : ""} onClick={() => setRandomOrder(false)}>Topic</button><button type="button" className={randomOrder ? "selected" : ""} onClick={() => setRandomOrder(true)}><Shuffle size={13} /> Random</button></div></section>
        </div> : null}

        {error ? <div className="study-error">{error}</div> : null}
        <div className="compact-study-footer"><button type="button" className="study-start" disabled={loading || !selectedTemplateIds.length || !pool.length || busy} onClick={() => void startReview()}>{busy ? "Opening…" : `Review ${pool.length ? clampCount(reviewCount, pool.length) : 0}`} <ArrowRight size={16} /></button></div>
      </div> : null}

      {mode === "sort" ? <div className="study-launch compact-study-screen">
        <div className="compact-study-heading"><button type="button" className="study-back-link" onClick={() => setMode("choose")}><ArrowLeft size={14} /> Modes</button><div><p className="eyebrow">SORT</p><h2>Sort cards</h2></div><div className="compact-study-meta"><span><b>{unsortedCards.length}</b> unsorted</span><span><b>{sortPool.length}</b> match</span></div></div>

        <div className="compact-study-controls sort-controls">
          <label className="compact-search"><Search size={14} /><input value={sortQuery} onChange={(event) => setSortQuery(event.target.value)} placeholder="Search" /></label>
          {filterTags.length ? <TagPicker tags={filterTags} selected={sortTagIds} onChange={setSortTagIds} /> : null}
          <section className="compact-count-panel"><CountControl value={sortCount} available={sortPool.length} onChange={setSortCount} /></section>
          <section className="compact-order-panel"><span>Order</span><div className="study-order-toggle"><button type="button" className={!sortRandom ? "selected" : ""} onClick={() => setSortRandom(false)}>Topic</button><button type="button" className={sortRandom ? "selected" : ""} onClick={() => setSortRandom(true)}><Shuffle size={13} /> Random</button></div></section>
        </div>

        {error ? <div className="study-error">{error}</div> : null}
        <div className="compact-study-footer"><button type="button" className="study-start" disabled={!sortPool.length || busy} onClick={() => void startSort()}>{busy ? "Opening…" : `Sort ${sortPool.length ? clampCount(sortCount, sortPool.length) : 0}`} <ArrowRight size={16} /></button></div>
      </div> : null}
    </section>
  </div>;
}
