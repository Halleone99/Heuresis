import { ArrowLeft, ArrowRight, Filter, Shuffle, SlidersHorizontal, Star, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "../lib/heuresis";
import { cardHasCompletedSort } from "../lib/sort";

type Props = { pack: PackWithType; cards: CardWithStats[]; onClose: () => void; onComplete: () => void };
type BrowseStatus = "unsorted" | "ready" | "reviewed" | "favourite";
type BrowseOrder = "current" | "term" | "interest" | "random";
type BrowseLimit = number | "all";

function workflowStatus(card: CardWithStats) {
  if (card.stats.study_count > 0) return "reviewed" as const;
  if (cardHasCompletedSort(card)) return "ready" as const;
  return "unsorted" as const;
}

function toggleValue<T>(items: T[], value: T) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function shuffled<T>(items: T[]) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapWith = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapWith]] = [copy[swapWith], copy[index]];
  }
  return copy;
}

export default function BrowseModal({ pack, cards, onClose, onComplete }: Props) {
  const [phase, setPhase] = useState<"setup" | "browse">("setup");
  const [statuses, setStatuses] = useState<BrowseStatus[]>([]);
  const [interests, setInterests] = useState<number[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [order, setOrder] = useState<BrowseOrder>("current");
  const [limit, setLimit] = useState<BrowseLimit>("all");
  const [browseCards, setBrowseCards] = useState<CardWithStats[]>([]);
  const [index, setIndex] = useState(0);

  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
  const primary = useMemo(() => new Set([term?.key, reading?.key, meaning?.key].filter((key): key is string => Boolean(key))), [term?.key, reading?.key, meaning?.key]);

  const tags = useMemo(() => {
    const map = new Map<string, CardWithStats["tags"][number]>();
    cards.forEach((card) => card.tags.forEach((tag) => map.set(tag.id, tag)));
    return [...map.values()];
  }, [cards]);
  const lessonTags = useMemo(() => tags.filter((tag) => /^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0)), [tags]);
  const otherTags = useMemo(() => tags.filter((tag) => !/^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => a.name.localeCompare(b.name)), [tags]);

  const statusCounts = useMemo(() => ({
    unsorted: cards.filter((card) => workflowStatus(card) === "unsorted").length,
    ready: cards.filter((card) => workflowStatus(card) === "ready").length,
    reviewed: cards.filter((card) => workflowStatus(card) === "reviewed").length,
    favourite: cards.filter((card) => card.favourite).length,
  }), [cards]);

  const filteredCards = useMemo(() => cards.filter((card) => {
    if (statuses.length) {
      const state = workflowStatus(card);
      const matchesStatus = statuses.some((status) => status === "favourite" ? card.favourite : state === status);
      if (!matchesStatus) return false;
    }
    if (interests.length && !interests.includes(card.interest_rank ?? 0)) return false;
    if (tagIds.length && !card.tags.some((tag) => tagIds.includes(tag.id))) return false;
    return true;
  }), [cards, interests, statuses, tagIds]);

  const browseCount = filteredCards.length ? (limit === "all" ? filteredCards.length : Math.min(Math.max(1, limit), filteredCards.length)) : 0;
  const currentCard = browseCards[index] ?? null;

  function close() {
    onComplete();
    onClose();
  }

  function ordered(items: CardWithStats[]) {
    if (order === "random") return shuffled(items);
    if (order === "term") return [...items].sort((a, b) => fieldText(a.data, term?.key).localeCompare(fieldText(b.data, term?.key)));
    if (order === "interest") return [...items].sort((a, b) => (b.interest_rank ?? 0) - (a.interest_rank ?? 0) || fieldText(a.data, term?.key).localeCompare(fieldText(b.data, term?.key)));
    return [...items];
  }

  function startBrowse() {
    if (!filteredCards.length) return;
    setBrowseCards(ordered(filteredCards).slice(0, browseCount));
    setIndex(0);
    setPhase("browse");
  }

  function resetFilters() {
    setStatuses([]);
    setInterests([]);
    setTagIds([]);
    setOrder("current");
    setLimit("all");
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); close(); return; }
      if (phase !== "browse") return;
      if (event.key === "ArrowRight") setIndex((value) => Math.min(browseCards.length - 1, value + 1));
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [browseCards.length, phase]);

  if (phase === "setup") {
    const activeFilterCount = statuses.length + interests.length + tagIds.length + (limit === "all" ? 0 : 1);
    return <div className="browse-setup-layer" role="presentation">
      <section className="browse-setup-shell compact-browse-shell" role="dialog" aria-modal="true" aria-label="Browse setup">
        <header className="browse-setup-head">
          <div>
            <p className="eyebrow">BROWSE</p>
            <h2>Choose what you want to browse</h2>
            <span>Read through selected cards without changing review statistics.</span>
          </div>
          <button className="browse-icon-button" onClick={close} aria-label="Close browse"><X size={17} /></button>
        </header>

        <div className="browse-match-summary compact-browse-summary">
          <span><Filter size={15} /></span>
          <strong>{filteredCards.length.toLocaleString()}</strong>
          <div><b>{filteredCards.length === 1 ? "card matches" : "cards match"}</b><small>{browseCount === filteredCards.length ? `Browsing all ${browseCount}` : `${browseCount} selected to browse`}</small></div>
        </div>

        <div className="browse-filter-sections compact-browse-sections">
          <section className="browse-filter-section browse-status-section">
            <div className="browse-filter-heading"><span>Status</span><small>Select one or several</small></div>
            <div className="browse-choice-grid browse-status-grid">
              <button className={statuses.includes("unsorted") ? "selected" : ""} onClick={() => setStatuses((current) => toggleValue(current, "unsorted"))}><i data-tone="unsorted" /><span>Unsorted</span><b>{statusCounts.unsorted}</b></button>
              <button className={statuses.includes("ready") ? "selected" : ""} onClick={() => setStatuses((current) => toggleValue(current, "ready"))}><i data-tone="ready" /><span>Ready</span><b>{statusCounts.ready}</b></button>
              <button className={statuses.includes("reviewed") ? "selected" : ""} onClick={() => setStatuses((current) => toggleValue(current, "reviewed"))}><i data-tone="reviewed" /><span>Reviewed</span><b>{statusCounts.reviewed}</b></button>
              <button className={statuses.includes("favourite") ? "selected" : ""} onClick={() => setStatuses((current) => toggleValue(current, "favourite"))}><Star size={13} /><span>Favourite</span><b>{statusCounts.favourite}</b></button>
            </div>
          </section>

          <section className="browse-filter-section browse-compact-half">
            <div className="browse-filter-heading"><span>Interest</span><small>Optional</small></div>
            <div className="browse-interest-row">
              {[5,4,3,2,1].map((rank) => <button key={rank} className={`interest-${rank} ${interests.includes(rank) ? "selected" : ""}`} onClick={() => setInterests((current) => toggleValue(current, rank))}>{rank}</button>)}
            </div>
          </section>

          <section className="browse-filter-section browse-compact-half browse-amount-section">
            <div className="browse-filter-heading"><span>Amount</span><strong>{browseCount}</strong></div>
            <input type="range" min={1} max={Math.max(1, filteredCards.length)} value={Math.max(1, browseCount)} disabled={!filteredCards.length} onChange={(event) => setLimit(Number(event.target.value))} />
            <div className="browse-amount-shortcuts">{[10,20,50].filter((count) => count < filteredCards.length).map((count) => <button key={count} className={limit !== "all" && browseCount === count ? "selected" : ""} onClick={() => setLimit(count)}>{count}</button>)}<button className={limit === "all" ? "selected" : ""} disabled={!filteredCards.length} onClick={() => setLimit("all")}>All</button></div>
          </section>

          <section className="browse-filter-section browse-tags-section">
            <div className="browse-filter-heading"><span>Tags</span><small>Any selected tag can match</small></div>
            {lessonTags.length ? <div className="browse-tag-group"><p>HSK2 Lessons</p><div className="browse-lesson-grid">{lessonTags.map((tag) => <button key={tag.id} className={tagIds.includes(tag.id) ? "selected" : ""} onClick={() => setTagIds((current) => toggleValue(current, tag.id))}>{tag.name.match(/\d+/)?.[0] ?? tag.name}</button>)}</div></div> : null}
            {otherTags.length ? <div className="browse-tag-group"><p>Other tags</p><div className="browse-other-tags">{otherTags.map((tag) => <button key={tag.id} className={tagIds.includes(tag.id) ? "selected" : ""} onClick={() => setTagIds((current) => toggleValue(current, tag.id))}>{tag.name}</button>)}</div></div> : null}
          </section>

          <section className="browse-filter-section browse-order-section">
            <div className="browse-filter-heading"><span>Order</span><small>Sequence</small></div>
            <div className="browse-order-row">
              {([['current','Current'],['term','A–Z'],['interest','Interest'],['random','Random']] as Array<[BrowseOrder,string]>).map(([value,label]) => <button key={value} className={order === value ? "selected" : ""} onClick={() => setOrder(value)}>{value === "random" ? <Shuffle size={12} /> : null}{label}</button>)}
            </div>
          </section>
        </div>

        <footer className="browse-setup-footer">
          <button className="browse-reset-button" disabled={!activeFilterCount && order === "current"} onClick={resetFilters}>Reset</button>
          <span>Read-only · {filteredCards.length.toLocaleString()} matching</span>
          <button className="browse-start-button" disabled={!filteredCards.length} onClick={startBrowse}>Browse {browseCount.toLocaleString()} {browseCount === 1 ? "card" : "cards"} <ArrowRight size={15} /></button>
        </footer>
      </section>
    </div>;
  }

  if (!currentCard) return null;
  const extraFields = pack.cardType?.field_schema.filter((field) => !primary.has(field.key) && fieldText(currentCard.data, field.key)) ?? [];
  const progress = browseCards.length ? ((index + 1) / browseCards.length) * 100 : 0;

  return <div className="immersive-layer browse-layer modern-browse-layer">
    <header className="immersive-bar modern-browse-bar">
      <div><b>{pack.title}</b><span>Browse · {index + 1} of {browseCards.length}</span></div>
      <div className="modern-browse-bar-actions"><button onClick={() => setPhase("setup")}><SlidersHorizontal size={14} /> Filters</button><button onClick={close}><X size={15} /> Close</button></div>
    </header>
    <div className="modern-browse-progress"><i style={{ width: `${progress}%` }} /></div>
    <main className="browse-stage modern-browse-stage">
      <article className="browse-card modern-browse-card">
        <div className="browse-main"><p className="eyebrow">CARD {index + 1}</p><h1>{fieldText(currentCard.data, term?.key) || "Untitled"}</h1>{reading ? <h2>{fieldText(currentCard.data, reading.key)}</h2> : null}<div className="browse-meaning">{fieldText(currentCard.data, meaning?.key)}</div></div>
        {currentCard.interest_rank || currentCard.favourite ? <div className="modern-browse-signals">{currentCard.interest_rank ? <span className={`interest-${currentCard.interest_rank}`}>Interest {currentCard.interest_rank}</span> : null}{currentCard.favourite ? <span><Star size={12} fill="currentColor" /> Favourite</span> : null}</div> : null}
        {extraFields.length ? <div className="browse-details">{extraFields.map((field) => <div key={field.key}><span>{field.label}</span><p>{fieldText(currentCard.data, field.key)}</p></div>)}</div> : null}
        {currentCard.tags.length ? <div className="browse-tags">{currentCard.tags.map((tag) => <span className={tag.is_badge ? "badge" : ""} key={tag.id}>{tag.name}</span>)}</div> : null}
        {currentCard.note ? <aside>{currentCard.note}</aside> : null}
      </article>
    </main>
    <footer className="immersive-controls modern-browse-controls"><button className="secondary-button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}><ArrowLeft size={15} /> Previous</button><span>Read-only · no review statistics changed</span><button className="primary-button" onClick={() => { if (index >= browseCards.length - 1) close(); else setIndex((value) => value + 1); }}>{index >= browseCards.length - 1 ? "Finish" : <>Next <ArrowRight size={15} /></>}</button></footer>
  </div>;
}
