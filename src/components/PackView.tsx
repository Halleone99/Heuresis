import { ArrowLeft, ArrowUpDown, BookOpen, Brain, Compass, FileUp, Filter, Link2, Network, Search, Settings2, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  deleteCard,
  fieldByRole,
  fieldText,
  listCards,
  listTags,
  updateCard,
  type CardWithStats,
  type Collection,
  type HeuresisTag,
  type PackWithType,
} from "../lib/heuresis";
import { getLearningCounts, type LearningAction, type LearningCounts } from "../lib/learning";
import { attentionScore, directionTemplates, formatSeen, isKeepMissing, isNotSeenRecently, isWeakProduction, productionPerformance, recognitionPerformance, type DirectionTemplates } from "../lib/learningSignals";
import { cardHasCompletedSort } from "../lib/sort";
import { loadStudySetup, type StudyTemplate } from "../lib/study";
import BrowseModal from "./BrowseModal";
import CardImagesEditor from "./CardImagesEditor";
import CatalogueSession from "./CatalogueSession";
import ConnectionsPanel from "./ConnectionsPanel";
import ImportModal from "./ImportModal";
import RelatedEditor from "./RelatedEditor";
import RelatedView from "./RelatedView";
import SortModal from "./SortModal";
import StudyModal from "./StudyModal";

type Props = {
  pack: PackWithType;
  collection: Collection | null;
  onBack: () => void;
  onCapture: () => void;
  onSettings: () => void;
  onChanged: () => void;
};

type TargetedSession = { title: string; cards: CardWithStats[]; templateId?: string } | null;
type StatusFilter = "all" | "unsorted" | "sorted" | "reviewed";
type InterestFilter = "all" | "none" | "1" | "2" | "3" | "4" | "5";
type DetailFilter = "all" | "never" | "favourite" | "again" | "production" | "stale";
type SortField = "status" | "term" | "interest" | "reviews" | "lastSeen";
type SortDirection = "asc" | "desc";

const LEARNING_SHORT: Array<[LearningAction, string]> = [
  ["handwrite", "Hand"],
  ["type", "Type"],
  ["sentence", "Sentence"],
  ["rephrase", "Rephrase"],
  ["example", "Example"],
  ["say", "Say"],
  ["hear", "Hear"],
];

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

function pct(value: number | null | undefined) { return value == null ? null : Math.round(value * 100); }

function compactLearning(counts: LearningCounts | undefined) {
  if (!counts) return [];
  return LEARNING_SHORT.flatMap(([key, label]) => counts[key] ? [{ key, label, count: counts[key] }] : []);
}

function workflowStatus(card: CardWithStats) {
  if (card.stats.study_count > 0) return "reviewed" as const;
  if (cardHasCompletedSort(card)) return "sorted" as const;
  return "unsorted" as const;
}

function workflowStatusRank(card: CardWithStats) {
  const status = workflowStatus(card);
  return status === "unsorted" ? 0 : status === "sorted" ? 1 : 2;
}

function CardEditor({ pack, card, tags, onClose, onSaved, onDeleted, onChanged, onConnections }: {
  pack: PackWithType;
  card: CardWithStats;
  tags: HeuresisTag[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onChanged: () => void;
  onConnections: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((pack.cardType?.field_schema ?? []).map((field) => [field.key, fieldText(card.data, field.key)])));
  const [note, setNote] = useState(card.note ?? "");
  const [favourite, setFavourite] = useState(card.favourite);
  const [interest, setInterest] = useState<number | null>(card.interest_rank);
  const [tagIds, setTagIds] = useState<string[]>(card.tags.map((tag) => tag.id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  async function save() {
    setSaving(true); setMessage("");
    try {
      await updateCard(pack, card.id, values, { note, favourite, interest_rank: interest, tagIds });
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save card.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm("Delete this card permanently?")) return;
    setSaving(true); setMessage("");
    try { await deleteCard(card.id); onDeleted(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete card."); setSaving(false); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="card-editor-modal" role="dialog" aria-modal="true">
        <div className="editor-head"><div><p className="eyebrow">CARD</p><h2>Edit card</h2></div><div className="editor-head-actions"><button className="secondary-button" onClick={onConnections}><Network size={14} /> Connections</button><button className="text-button" onClick={onClose}>Close</button></div></div>
        <div className="editor-fields">
          {(pack.cardType?.field_schema ?? []).map((field) => (
            <label className="field-row" key={field.key}><span>{field.label}{field.required ? <b> *</b> : null}</span>{field.role === "example" || field.role === "extra" ? <textarea rows={3} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}</label>
          ))}
          <label className="field-row"><span>Note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="editor-meta-row"><button className={`toggle-pill ${favourite ? "selected" : ""}`} onClick={() => setFavourite((value) => !value)}><Star size={14} fill={favourite ? "currentColor" : "none"} /> Favourite</button><label className="interest-control">Interest <select value={interest ?? ""} onChange={(event) => setInterest(event.target.value ? Number(event.target.value) : null)}><option value="">—</option>{[1, 2, 3, 4, 5].map((rank) => <option key={rank} value={rank}>{rank} / 5</option>)}</select></label></div>
          {tags.length ? <div className="tag-editor"><span className="eyebrow">TAGS</span><div className="tag-choice-list">{tags.map((tag) => { const selected = tagIds.includes(tag.id); return <button key={tag.id} className={`tag-choice ${selected ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} onClick={() => setTagIds((current) => selected ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>{tag.name}</button>; })}</div></div> : null}
          <CardImagesEditor card={card} onChanged={onChanged} />
          <RelatedEditor pack={pack} card={card} onChanged={onChanged} />
        </div>
        {message ? <div className="editor-message">{message}</div> : null}
        <div className="editor-actions"><button className="danger-button" disabled={saving} onClick={() => void remove()}>Delete</button><span /><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button></div>
      </section>
    </div>
  );
}

export default function PackView({ pack, collection, onBack, onSettings, onChanged }: Props) {
  const [cards, setCards] = useState<CardWithStats[]>([]);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [learningCounts, setLearningCounts] = useState<Record<string, LearningCounts>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [interestFilter, setInterestFilter] = useState<InterestFilter>("all");
  const [tagFilter, setTagFilter] = useState("all");
  const [detailFilter, setDetailFilter] = useState<DetailFilter>("all");
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CardWithStats | null>(null);
  const [connectionsCard, setConnectionsCard] = useState<CardWithStats | null>(null);
  const [studyOpen, setStudyOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [targetedSession, setTargetedSession] = useState<TargetedSession>(null);

  async function reload() {
    setLoading(true); setError("");
    try {
      const [nextCards, nextTags, setup] = await Promise.all([listCards(pack.id), listTags(), loadStudySetup(pack.id, pack.card_type_id)]);
      const nextLearning = await getLearningCounts(nextCards.map((card) => card.id)).catch(() => ({} as Record<string, LearningCounts>));
      setCards(nextCards); setTags(nextTags); setTemplates(setup.templates); setLearningCounts(nextLearning);
      setEditing((current) => current ? nextCards.find((card) => card.id === current.id) ?? current : null);
      setSelectedCardId((current) => current && nextCards.some((card) => card.id === current) ? current : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load cards.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    setSelectedCardId(null);
    setStatusFilter("all");
    setInterestFilter("all");
    setTagFilter("all");
    setDetailFilter("all");
    setSortField("status");
    setSortDirection("asc");
    void reload();
  }, [pack.id]);

  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
  const directions = useMemo<DirectionTemplates>(() => directionTemplates(pack, templates), [pack, templates]);
  const neverCards = useMemo(() => cards.filter((card) => card.stats.encounter_count === 0), [cards]);
  const missingCards = useMemo(() => cards.filter(isKeepMissing).sort((a, b) => attentionScore(b, directions) - attentionScore(a, directions)), [cards, directions]);
  const productionCards = useMemo(() => cards.filter((card) => isWeakProduction(card, directions)).sort((a, b) => (productionPerformance(a, directions)?.score ?? 2) - (productionPerformance(b, directions)?.score ?? 2)), [cards, directions]);
  const staleCards = useMemo(() => cards.filter((card) => isNotSeenRecently(card)).sort((a, b) => Date.parse(a.stats.last_encountered_at ?? "") - Date.parse(b.stats.last_encountered_at ?? "")), [cards]);
  const unsortedCards = useMemo(() => cards.filter((card) => !cardHasCompletedSort(card)), [cards]);
  const reviewedCards = useMemo(() => cards.filter((card) => card.stats.study_count > 0), [cards]);

  const explored = pack.card_count ? Math.round((pack.encountered_cards / pack.card_count) * 100) : 0;
  const richDiagnostics = explored >= 20;
  const totalReviews = useMemo(() => cards.reduce((sum, card) => sum + card.stats.study_count, 0), [cards]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = cards.filter((card) => {
      const status = workflowStatus(card);
      if (statusFilter === "unsorted" && status !== "unsorted") return false;
      if (statusFilter === "sorted" && !cardHasCompletedSort(card)) return false;
      if (statusFilter === "reviewed" && status !== "reviewed") return false;

      if (interestFilter === "none" && card.interest_rank != null) return false;
      if (interestFilter !== "all" && interestFilter !== "none" && card.interest_rank !== Number(interestFilter)) return false;

      if (tagFilter === "none" && card.tags.length) return false;
      if (tagFilter !== "all" && tagFilter !== "none" && !card.tags.some((tag) => tag.id === tagFilter)) return false;

      if (detailFilter === "never" && card.stats.encounter_count !== 0) return false;
      if (detailFilter === "favourite" && !card.favourite) return false;
      if (detailFilter === "again" && !isKeepMissing(card)) return false;
      if (detailFilter === "production" && !isWeakProduction(card, directions)) return false;
      if (detailFilter === "stale" && !isNotSeenRecently(card)) return false;

      if (!needle) return true;
      return Object.values(card.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join(" ").toLowerCase().includes(needle)
        || card.tags.some((tag) => tag.name.toLowerCase().includes(needle));
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let delta = 0;
      if (sortField === "status") delta = workflowStatusRank(a) - workflowStatusRank(b);
      if (sortField === "term") delta = fieldText(a.data, term?.key).localeCompare(fieldText(b.data, term?.key));
      if (sortField === "interest") delta = (a.interest_rank ?? 0) - (b.interest_rank ?? 0);
      if (sortField === "reviews") delta = a.stats.study_count - b.stats.study_count;
      if (sortField === "lastSeen") delta = Date.parse(a.stats.last_encountered_at ?? "1970-01-01") - Date.parse(b.stats.last_encountered_at ?? "1970-01-01");
      if (delta === 0) delta = fieldText(a.data, term?.key).localeCompare(fieldText(b.data, term?.key));
      return delta * direction;
    });
  }, [cards, detailFilter, directions, interestFilter, query, sortDirection, sortField, statusFilter, tagFilter, term?.key]);

  const activeFilterCount = [statusFilter !== "all", interestFilter !== "all", tagFilter !== "all", detailFilter !== "all"].filter(Boolean).length;
  const selectedCard = selectedCardId ? cards.find((card) => card.id === selectedCardId) ?? null : null;

  async function refreshAll(closeEditor = false) {
    if (closeEditor) setEditing(null);
    await reload();
    onChanged();
  }

  function openTargeted(title: string, selected: CardWithStats[], limit?: number, templateId?: string) {
    const next = limit ? selected.slice(0, limit) : selected;
    if (!next.length) return;
    setTargetedSession({ title, cards: next, templateId });
  }

  function changeSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    setSortDirection(field === "status" || field === "term" ? "asc" : "desc");
  }

  function clearFilters() {
    setStatusFilter("all");
    setInterestFilter("all");
    setTagFilter("all");
    setDetailFilter("all");
  }

  if (relatedOpen) return <RelatedView pack={pack} onBack={() => setRelatedOpen(false)} onChanged={() => void refreshAll()} />;

  return (
    <section className="pack-page desktop-pack-page intelligent-topic modern-topic-page" data-accent={collection?.accent ?? "ink"}>
      <button className="text-button back-button modern-topic-back" onClick={onBack}><ArrowLeft size={15} /> {collection?.title || "Library"}</button>

      <header className="modern-topic-head">
        <div className="modern-topic-title"><p className="eyebrow">TOPIC</p><h1>{pack.title}</h1>{pack.description ? <p>{pack.description}</p> : null}<span className="pack-record">{plural(pack.card_count, "card")} · {pack.encountered_cards.toLocaleString()} met · {explored}% explored{pack.last_opened_at ? ` · ${formatSeen(pack.last_opened_at).replace("seen", "last opened")}` : ""}</span></div>
        <div className="modern-topic-head-actions"><button className="secondary-button" onClick={onSettings}><Settings2 size={15} /> Settings</button></div>
      </header>

      <div className="topic-overview-strip">
        <span><strong>{neverCards.length.toLocaleString()}</strong><small>unseen</small></span>
        <span><strong>{reviewedCards.length.toLocaleString()}</strong><small>reviewed cards</small></span>
        <span><strong>{unsortedCards.length.toLocaleString()}</strong><small>to sort</small></span>
        <span><strong>{totalReviews.toLocaleString()}</strong><small>review passes</small></span>
        {neverCards.length ? <button onClick={() => openTargeted("Never met", neverCards, 20)}>Start 20 unseen</button> : <span className="overview-complete">All cards encountered</span>}
      </div>

      {richDiagnostics ? <div className="intelligent-question-band topic-question-band compact-question-band">
        <button data-tone="cinnabar" disabled={!missingCards.length} onClick={() => openTargeted("Keeps missing", missingCards)}><strong>{missingCards.length.toLocaleString()}</strong><b>Keep missing</b><span>Repeated Again grades.</span><em>REVIEW</em></button>
        <button data-tone="amber" disabled={!productionCards.length || !directions.production} onClick={() => openTargeted("Weak production", productionCards, undefined, directions.production?.id)}><strong>{productionCards.length.toLocaleString()}</strong><b>Weak production</b><span>Recognition is stronger.</span><em>DRILL</em></button>
        <button data-tone="sage" disabled={!staleCards.length} onClick={() => openTargeted("Not seen recently", staleCards, 30)}><strong>{staleCards.length.toLocaleString()}</strong><b>30d+ quiet</b><span>Previously met, now stale.</span><em>REFRESH</em></button>
      </div> : null}

      <div className="topic-command-bar">
        <div className="topic-learning-actions">
          <button className="primary-button" disabled={!cards.length} onClick={() => setStudyOpen(true)}><Brain size={15} /> Flashcards</button>
          <button className="sort-command" disabled={!unsortedCards.length} onClick={() => setSortOpen(true)}><SlidersHorizontal size={15} /> Sort <b>{unsortedCards.length}</b></button>
          <button className="secondary-button" disabled={!cards.length} onClick={() => setBrowseOpen(true)}><Compass size={15} /> Browse</button>
        </div>
        <div className="topic-utility-actions">
          <button className="secondary-button" onClick={() => setRelatedOpen(true)}><Link2 size={15} /> Related</button>
          <button className="secondary-button" onClick={() => setImportOpen(true)}><FileUp size={15} /> Import</button>
        </div>
      </div>

      <div className="modern-topic-toolbar excel-topic-toolbar">
        <label className="modern-topic-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search term, meaning or tag" /></label>
        <div className="excel-filter-group"><Filter size={14} />
          <label className="excel-filter"><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}><option value="all">All</option><option value="unsorted">Unsorted</option><option value="sorted">Sorted</option><option value="reviewed">Reviewed</option></select></label>
          <label className="excel-filter"><span>Interest</span><select value={interestFilter} onChange={(event) => setInterestFilter(event.target.value as InterestFilter)}><option value="all">All</option><option value="none">None</option>{[1,2,3,4,5].map((rank) => <option key={rank} value={String(rank)}>{rank} / 5</option>)}</select></label>
          <label className="excel-filter"><span>Tag</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="all">All</option><option value="none">No tags</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label>
          <label className="excel-filter"><span>More</span><select value={detailFilter} onChange={(event) => setDetailFilter(event.target.value as DetailFilter)}><option value="all">All</option><option value="never">Never met</option><option value="favourite">Favourites</option>{richDiagnostics ? <><option value="again">Keep missing</option><option value="production">Weak production</option><option value="stale">30d+ quiet</option></> : null}</select></label>
          <label className="excel-filter sort-filter"><span>Sort</span><select value={sortField} onChange={(event) => changeSort(event.target.value as SortField)}><option value="status">Status</option><option value="term">Term</option><option value="interest">Interest</option><option value="reviews">Reviews</option><option value="lastSeen">Last seen</option></select></label>
          <button className="sort-direction-button" onClick={() => setSortDirection((current) => current === "asc" ? "desc" : "asc")} title="Reverse sort direction">{sortDirection === "asc" ? "↑" : "↓"}</button>
          {activeFilterCount ? <button className="filter-clear-button" onClick={clearFilters}>Clear {activeFilterCount}</button> : null}
        </div>
      </div>

      <div className="topic-selection-hint">{selectedCard ? <><strong>{fieldText(selectedCard.data, term?.key) || "Card"}</strong> selected · double-click or press Enter to edit</> : <>Click once to select · double-click to edit</>}</div>

      {loading ? <div className="content-state">Opening cards…</div> : null}
      {!loading && error ? <div className="content-state error-state"><strong>Could not load this topic.</strong><span>{error}</span></div> : null}
      {!loading && !error ? <div className="modern-topic-table excel-topic-table">
        <div className="modern-topic-thead excel-topic-thead">
          <button className={sortField === "term" ? "active" : ""} onClick={() => changeSort("term")}>CARD <ArrowUpDown size={11} /></button>
          <button className={sortField === "status" ? "active" : ""} onClick={() => changeSort("status")}>STATUS <ArrowUpDown size={11} /></button>
          <button className={sortField === "reviews" ? "active" : ""} onClick={() => changeSort("reviews")}>LEARNING <ArrowUpDown size={11} /></button>
          <button className={sortField === "lastSeen" ? "active" : ""} onClick={() => changeSort("lastSeen")}>RECALL <ArrowUpDown size={11} /></button>
          <span>TAGS & LINKS</span>
        </div>
        {shown.map((card) => {
          const recognition = recognitionPerformance(card, directions);
          const production = productionPerformance(card, directions);
          const rp = pct(recognition?.score); const pp = pct(production?.score);
          const missing = richDiagnostics && isKeepMissing(card);
          const weakProduction = richDiagnostics && isWeakProduction(card, directions);
          const stale = richDiagnostics && isNotSeenRecently(card);
          const learning = compactLearning(learningCounts[card.id]);
          const rank = card.interest_rank;
          const visibleTags = card.tags.slice(0, 3);
          const status = workflowStatus(card);
          const selected = selectedCardId === card.id;
          return <div
            className={`modern-topic-row excel-topic-row ${selected ? "selected" : ""}`}
            key={card.id}
            role="row"
            tabIndex={0}
            aria-selected={selected}
            onClick={() => setSelectedCardId(card.id)}
            onDoubleClick={() => setEditing(card)}
            onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); setEditing(card); }
              if (event.key === " ") { event.preventDefault(); setSelectedCardId(card.id); }
            }}
          >
            <div className="modern-card-cell">
              <span className="modern-card-title"><strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>{card.favourite ? <Star size={13} fill="currentColor" /> : null}{rank ? <i className={`interest-badge interest-${rank}`}>Interest {rank}/5</i> : null}</span>
              {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
              <p>{fieldText(card.data, meaning?.key)}</p>
            </div>

            <div className="topic-status-cell"><span className={`workflow-status status-${status}`}>{status === "unsorted" ? "Unsorted" : status === "sorted" ? "Sorted" : "Reviewed"}</span>{status === "reviewed" ? <small>sorted + reviewed</small> : null}</div>

            <div className="modern-learning-cell">
              <strong>{card.stats.study_count.toLocaleString()} <small>{card.stats.study_count === 1 ? "review" : "reviews"}</small></strong>
              {learning.length ? <div className="learning-mini-chips">{learning.slice(0, 4).map((item) => <span key={item.key}>{item.label} {item.count}</span>)}{learning.length > 4 ? <span>+{learning.length - 4}</span> : null}</div> : <small className="learning-none">—</small>}
            </div>

            <div className="modern-recall-cell">
              {richDiagnostics && (rp !== null || pp !== null) ? <div className="direction-signal compact modern-direction">{rp !== null ? <span><label>RECOG</label><i><em style={{ width: `${rp}%` }} /></i><b>{rp}%</b></span> : null}{pp !== null ? <span><label>PRODUCE</label><i><em style={{ width: `${pp}%` }} /></i><b>{pp}%</b></span> : null}</div> : <strong>{card.stats.encounter_count ? formatSeen(card.stats.last_encountered_at) : "Not met yet"}</strong>}
              <small>{card.stats.again_count ? `${card.stats.again_count} Again` : ""}{card.stats.again_count && card.stats.good_count ? " · " : ""}{card.stats.good_count ? `${card.stats.good_count} Good` : ""}{card.stats.easy_count ? `${card.stats.good_count || card.stats.again_count ? " · " : ""}${card.stats.easy_count} Easy` : ""}</small>
              {missing ? <i className="signal-note danger">Keeps missing</i> : null}{weakProduction ? <i className="signal-note warn">Production</i> : null}{stale && !missing ? <i className="signal-note">Quiet</i> : null}
            </div>

            <div className="modern-meta-cell compact-meta-cell">
              <div className="row-tags">{visibleTags.map((tag) => <span key={tag.id} className={tag.is_badge ? "badge" : ""}>{tag.name}</span>)}{card.tags.length > visibleTags.length ? <span>+{card.tags.length - visibleTags.length}</span> : null}{!card.tags.length ? <small>No tags</small> : null}</div>
              <button className="row-connections-icon" onClick={(event) => { event.stopPropagation(); setConnectionsCard(card); }} onDoubleClick={(event) => event.stopPropagation()} title="Open connections tree" aria-label={`Open connections for ${fieldText(card.data, term?.key) || "card"}`}><Network size={15} /></button>
            </div>
          </div>;
        })}
        {!shown.length ? <div className="pack-empty"><BookOpen size={20} /><strong>No matching cards.</strong><span>Change the filters or search.</span></div> : null}
      </div> : null}

      {editing ? <CardEditor pack={pack} card={editing} tags={tags} onClose={() => setEditing(null)} onSaved={() => void refreshAll(true)} onDeleted={() => void refreshAll(true)} onChanged={() => void refreshAll()} onConnections={() => setConnectionsCard(editing)} /> : null}
      {connectionsCard ? <ConnectionsPanel pack={pack} card={connectionsCard} onClose={() => setConnectionsCard(null)} /> : null}
      {studyOpen ? <StudyModal pack={pack} cards={cards} onClose={() => setStudyOpen(false)} onComplete={() => void refreshAll()} /> : null}
      {sortOpen ? <SortModal pack={pack} cards={cards} tags={tags} onClose={() => setSortOpen(false)} onChanged={() => void refreshAll()} /> : null}
      {browseOpen ? <BrowseModal pack={pack} cards={cards} onClose={() => setBrowseOpen(false)} onComplete={() => void refreshAll()} /> : null}
      {importOpen ? <ImportModal pack={pack} onClose={() => setImportOpen(false)} onDone={() => refreshAll()} /> : null}
      {targetedSession ? <CatalogueSession title={targetedSession.title} items={targetedSession.cards.map((item) => ({ card: item, pack }))} mode="review" templateByPackId={targetedSession.templateId ? { [pack.id]: targetedSession.templateId } : undefined} onClose={() => setTargetedSession(null)} /> : null}
    </section>
  );
}
