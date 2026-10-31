import { ArrowLeft, ArrowUpDown, BookOpen, Brain, ChevronDown, Compass, FileUp, GitFork, Link2, Pencil, Plus, Search, Settings2, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  DISCARDED_AT_KEY,
  patchCardData,
  fieldByRole,
  fieldText,
  listTags,
  listTopicCards,
  setCardRetention,
  updateCard,
  type CardWithStats,
  type Collection,
  type HeuresisTag,
  type PackWithType,
} from "../lib/heuresis";
import { attentionScore, directionTemplates, formatSeen, isKeepMissing, isNotSeenRecently, isWeakProduction, productionPerformance, reviewGradeCount, templateDirection, type DirectionTemplates } from "../lib/learningSignals";
import { cardHasCompletedSort, markCardSorted } from "../lib/sort";
import { loadStudySetup, type StudyTemplate } from "../lib/study";
import { openCosmosWindow } from "../lib/cosmosWindow";
import { IMPORTANCE_LABEL, IMPORTANCE_ORDER, IMPORTANCE_RANK, importanceOf, ranksFor, type Importance } from "../lib/importance";
import { assessState, directionEvidence, summaryState, type GradeEvent, type KnowledgeState } from "../lib/knowledgeState";
import { defaultDirections, directionPairs, legacyTemplateId } from "../lib/recommend";
import { loadGradeEvents } from "../lib/reviewEvidence";
import { readReviewPrefs, rememberedTemplateIds } from "../lib/reviewPrefs";
import { cardBarProgress } from "../lib/cardProgress";
import BrowseModal from "./BrowseModal";
import CardImagesEditor from "./CardImagesEditor";
import ConnectionsPanel from "./ConnectionsPanel";
import ImportModal from "./ImportModal";
import RelatedEditor from "./RelatedEditor";
import RelatedView from "./RelatedView";
import SortModal from "./SortModal";
import StudyModal from "./StudyModal";
import { MOD_KEY } from "./workspace/ui";

type Props = {
  pack: PackWithType;
  collection: Collection | null;
  /** A card opened from Search: selected and scrolled into view once the cards load. */
  focusCardId?: string | null;
  onFocusCardShown?: () => void;
  onBack: () => void;
  onCapture: () => void;
  onSettings: () => void;
  onChanged: () => void;
};

/** Unsorted → Learning, or Reference (kept to look up, never reviewed). */
type StatusFilter = "unsorted" | "learning" | "reference";
type InterestFilter = "all" | "none" | Importance;
type DirectionState = { templateId: string; label: string; state: KnowledgeState; agedFrom: KnowledgeState | null };
type ProgressStage = "new" | "review" | "known" | "mastered";
const PROGRESS_STAGES: ProgressStage[] = ["new", "review", "known", "mastered"];
type DetailFilter = "again" | "production" | "stale";
type SortField = "status" | "term" | "interest" | "reviews" | "lastSeen";
type SortDirection = "asc" | "desc";

const CHINESE_SELECTION_THEMES = [
  { name: "Everyday conversation", color: "#4c7a6e" },
  { name: "Time & plans", color: "#7273a4" },
  { name: "Food & restaurants", color: "#a8773d" },
  { name: "Shopping & money", color: "#aa6970" },
  { name: "Transport & directions", color: "#4b8398" },
  { name: "People & social life", color: "#8a68a0" },
  { name: "Home & belongings", color: "#738b53" },
  { name: "Feelings & opinions", color: "#a66588" },
  { name: "Health & basic needs", color: "#528c81" },
  { name: "Work, study & technology", color: "#7970a5" },
] as const;

function themeTagStyle(name: string): CSSProperties | undefined {
  const theme = CHINESE_SELECTION_THEMES.find((item) => item.name === name);
  return theme ? ({ "--theme-accent": theme.color } as CSSProperties) : undefined;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`) {
  return `${count.toLocaleString()} ${count === 1 ? singular : pluralForm}`;
}

/** Where a card is in the workflow. Review results never move a card between these. */
function workflowStatus(card: CardWithStats): StatusFilter {
  if (card.retention === "reference") return "reference";
  return cardHasCompletedSort(card) ? "learning" : "unsorted";
}

function directionLabel(pack: PackWithType, template: StudyTemplate) {
  const kind = templateDirection(pack, template);
  const chinese = /Chinese|HSK|中文|汉语|漢語/i.test(pack.title);
  return kind === "recognition" ? (chinese ? "中 → EN" : "Term → meaning") : kind === "production" ? (chinese ? "EN → 中" : "Meaning → term") : template.name;
}

function CardEditor({ pack, card, tags, onClose, onSaved, onDeleted, onChanged, onConnections, onRetention }: {
  pack: PackWithType;
  card: CardWithStats;
  tags: HeuresisTag[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onChanged: () => void;
  onConnections: () => void;
  /** Move between Learning and Reference (reference cards are never reviewed). */
  onRetention: (retention: "learning" | "reference") => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries((pack.cardType?.field_schema ?? []).map((field) => [field.key, fieldText(card.data, field.key)])));
  const [note, setNote] = useState(card.note ?? "");
  const [favourite, setFavourite] = useState(card.favourite);
  const [reviewImportant, setReviewImportant] = useState(card.data["_review_important"] === "true");
  const [interest, setInterest] = useState<number | null>(card.interest_rank);
  const [tagIds, setTagIds] = useState<string[]>(card.tags.map((tag) => tag.id));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const dialogRef = useRef<HTMLElement>(null);
  // Focus the dialog so Escape and Ctrl+Enter work at once; return focus to the table row afterwards.
  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, []);

  async function save() {
    if (saving) return;
    setSaving(true); setMessage("");
    try {
      await updateCard(pack, card.id, values, { note, favourite, interest_rank: interest, tagIds, expectedUpdatedAt: card.updated_at });
      await patchCardData(card.id, { "_review_important": reviewImportant ? "true" : null });
      onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save card.");
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm("Move this card to Trash? You can restore it later.")) return;
    setSaving(true); setMessage("");
    try { await patchCardData(card.id, { [DISCARDED_AT_KEY]: new Date().toISOString() }); onDeleted(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not move card to Trash."); setSaving(false); }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={dialogRef} tabIndex={-1} className="card-editor-modal" role="dialog" aria-modal="true" aria-label="Edit card"
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); onClose(); }
          if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); void save(); }
        }}>
        <div className="editor-head"><div><p className="eyebrow">CARD</p><h2>Edit card</h2></div><div className="editor-head-actions"><button className="secondary-button" onClick={onConnections}><GitFork size={14} /> Connections</button><button className="text-button" onClick={onClose}>Close</button></div></div>
        <div className="editor-fields">
          {(pack.cardType?.field_schema ?? []).map((field) => (
            <label className="field-row" key={field.key}><span>{field.label}{field.required ? <b> *</b> : null}</span>{field.role === "example" || field.role === "extra" ? <textarea rows={3} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}</label>
          ))}
          <label className="field-row"><span>Note</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <div className="editor-meta-row"><button className={`toggle-pill ${favourite ? "selected" : ""}`} onClick={() => setFavourite((value) => !value)}><Star size={14} fill={favourite ? "currentColor" : "none"} /> Favourite</button><button type="button" className={`toggle-pill ${reviewImportant ? "selected" : ""}`} onClick={() => setReviewImportant((value) => !value)} aria-pressed={reviewImportant}>Important (review)</button><label className="interest-control">Importance <select value={interest ?? ""} onChange={(event) => setInterest(event.target.value ? Number(event.target.value) : null)}><option value="">—</option>{IMPORTANCE_ORDER.map((level) => <option key={level} value={IMPORTANCE_RANK[level]}>{IMPORTANCE_LABEL[level]}</option>)}{interest != null && !IMPORTANCE_ORDER.some((level) => IMPORTANCE_RANK[level] === interest) ? <option value={interest}>{IMPORTANCE_LABEL[importanceOf(interest) ?? "useful"]} (kept as {interest} / 5)</option> : null}</select></label>
            <button type="button" className="toggle-pill" disabled={saving} onClick={() => { setSaving(true); void onRetention(card.retention === "reference" ? "learning" : "reference").catch((error) => setMessage(error instanceof Error ? error.message : "Could not change this card.")).finally(() => setSaving(false)); }}
              title={card.retention === "reference" ? "Bring it back into Learning (it will be reviewed)" : "Keep it to look up only; it leaves Review"}>
              <BookOpen size={14} /> {card.retention === "reference" ? "Move to Learning" : "Keep as reference"}</button></div>
          {tags.length ? <div className="tag-editor"><span className="eyebrow">TAGS</span><div className="tag-choice-list">{tags.map((tag) => { const selected = tagIds.includes(tag.id); return <button key={tag.id} className={`tag-choice ${selected ? "selected" : ""} ${tag.is_badge ? "badge" : ""} ${themeTagStyle(tag.name) ? "theme-tag" : ""}`} style={themeTagStyle(tag.name)} onClick={() => setTagIds((current) => selected ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>{tag.name}</button>; })}</div></div> : null}
          <CardImagesEditor card={card} onChanged={onChanged} />
          <RelatedEditor pack={pack} card={card} onChanged={onChanged} />
        </div>
        {message ? <div className="editor-message">{message}</div> : null}
        <div className="editor-actions"><button className="danger-button" disabled={saving} onClick={() => void remove()}>Move to Trash</button><span className="editor-shortcut-hint">{MOD_KEY}+Enter save · Esc close</span><button className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save changes"}</button></div>
      </section>
    </div>
  );
}

export default function PackView({ pack, collection, focusCardId = null, onFocusCardShown, onBack, onCapture, onSettings, onChanged }: Props) {
  const [cards, setCards] = useState<CardWithStats[]>([]);
  const [referenceCards, setReferenceCards] = useState<CardWithStats[]>([]);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [defaultTemplateId, setDefaultTemplateId] = useState<string | null>(null);
  const [events, setEvents] = useState<GradeEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [statusFilters, setStatusFilters] = useState<StatusFilter[]>([]);
  const [stateFilter, setStateFilter] = useState<ProgressStage | null>(null);
  const [favouriteOnly, setFavouriteOnly] = useState(false);
  const [interestFilter, setInterestFilter] = useState<InterestFilter>("all");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [includeUntagged, setIncludeUntagged] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const [allCardsExpanded, setAllCardsExpanded] = useState(false);
  const [detailFilters, setDetailFilters] = useState<DetailFilter[]>([]);
  const [sortField, setSortField] = useState<SortField>("status");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [editing, setEditing] = useState<CardWithStats | null>(null);
  const [connectionsCard, setConnectionsCard] = useState<CardWithStats | null>(null);
  const [studyOpen, setStudyOpen] = useState(false);
  const reviewOpened = useRef(false);
  const reviewStarting = useRef(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [focusNotice, setFocusNotice] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const [loadedPackId, setLoadedPackId] = useState<string | null>(null);

  async function reload() {
    setLoading(true); setError("");
    try {
      const [topicCards, nextTags, setup, history] = await Promise.all([listTopicCards(pack.id), listTags(), loadStudySetup(pack.id, pack.card_type_id), loadGradeEvents(pack.id).catch(() => null)]);
      const nextCards = topicCards.learning;
      setCards(nextCards); setReferenceCards(topicCards.reference); setTags(nextTags); setTemplates(setup.templates); setDefaultTemplateId(setup.defaultTemplateId); setEvents(history);
      setLoadedPackId(pack.id);
      const all = [...nextCards, ...topicCards.reference];
      setEditing((current) => current ? all.find((card) => card.id === current.id) ?? current : null);
      setSelectedCardId((current) => current && all.some((card) => card.id === current) ? current : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load cards.");
    } finally { setLoading(false); }
  }

  useEffect(() => {
    setSelectedCardId(null);
    setFocusNotice("");
    setReviewNotice("");
    setStatusFilters([]);
    setStateFilter(null);
    setFavouriteOnly(false);
    setInterestFilter("all");
    setSelectedTagIds([]);
    setIncludeUntagged(false);
    setTagSearch("");
    setAllCardsExpanded(false);
    setDetailFilters([]);
    setSortField("status");
    setSortDirection("asc");
    void reload();
  }, [pack.id]);

  useEffect(() => {
    reviewOpened.current = false;
    const refreshAfterReview = () => {
      // Results flush as the Review window closes; reload when Heuresis regains focus.
      if (reviewOpened.current) void reload();
    };
    // Cards restored from Trash (or made from a note) appear without leaving the topic.
    const studyChanged = () => { void reload(); };
    window.addEventListener("focus", refreshAfterReview);
    window.addEventListener("heuresis:study-changed", studyChanged);
    return () => {
      window.removeEventListener("focus", refreshAfterReview);
      window.removeEventListener("heuresis:study-changed", studyChanged);
    };
  }, [pack.id]);

  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
  const directions = useMemo<DirectionTemplates>(() => directionTemplates(pack, templates), [pack, templates]);
  const stateTemplates = useMemo(() => defaultDirections(templates, defaultTemplateId), [defaultTemplateId, templates]);
  const legacyId = useMemo(() => legacyTemplateId(templates, defaultTemplateId), [defaultTemplateId, templates]);
  // Direction-specific knowledge states, from results only (events indexed per card once).
  const cardStates = useMemo(() => {
    const byCard = new Map<string, GradeEvent[]>();
    for (const event of events ?? []) { const list = byCard.get(event.cardId); if (list) list.push(event); else byCard.set(event.cardId, [event]); }
    const result = new Map<string, DirectionState[]>();
    for (const card of cards) {
      if (!cardHasCompletedSort(card)) continue;
      const own = events ? byCard.get(card.id) ?? [] : null;
      result.set(card.id, stateTemplates.map((template) => {
        const assessment = assessState(directionEvidence(card, template.id, own, { includeUnattributed: template.id === legacyId }));
        return { templateId: template.id, label: directionLabel(pack, template), state: assessment.state, agedFrom: assessment.agedFrom };
      }));
    }
    return result;
  }, [cards, events, legacyId, pack, stateTemplates]);
  const cardSummary = (card: CardWithStats) => {
    const states = cardStates.get(card.id);
    return states?.length ? summaryState(states.map((entry) => entry.state)) : null;
  };
  // Unified per-card bars, backed by graded history where available.
  const cardBars = useMemo(() => {
    const gradesByCard = new Map<string, GradeEvent[]>();
    for (const grade of events ?? []) {
      const list = gradesByCard.get(grade.cardId);
      if (list) list.push(grade);
      else gradesByCard.set(grade.cardId, [grade]);
    }
    return new Map([...cards, ...referenceCards].map((card) => {
      const previous = cardStates.get(card.id);
      const old = previous?.length ? summaryState(previous.map((entry) => entry.agedFrom ?? entry.state)) : null;
      return [card.id, cardBarProgress(card, events ? gradesByCard.get(card.id) ?? [] : null, old)] as const;
    }));
  }, [cards, referenceCards, cardStates, events]);
  const missingCards = useMemo(() => cards.filter(isKeepMissing).sort((a, b) => attentionScore(b, directions) - attentionScore(a, directions)), [cards, directions]);
  const productionCards = useMemo(() => cards.filter((card) => isWeakProduction(card, directions)).sort((a, b) => (productionPerformance(a, directions)?.score ?? 2) - (productionPerformance(b, directions)?.score ?? 2)), [cards, directions]);
  const staleCards = useMemo(() => cards.filter((card) => isNotSeenRecently(card)).sort((a, b) => Date.parse(a.stats.last_encountered_at ?? "") - Date.parse(b.stats.last_encountered_at ?? "")), [cards]);
  const unsortedCards = useMemo(() => cards.filter((card) => workflowStatus(card) === "unsorted"), [cards]);
  const learningCards = useMemo(() => cards.filter((card) => workflowStatus(card) === "learning"), [cards]);
  const stageOf = (card: CardWithStats): ProgressStage => {
    const progress = cardBars.get(card.id);
    return progress?.mastered ? "mastered" : progress?.bars === 4 ? "known" : reviewGradeCount(card) ? "review" : "new";
  };
  const stateCounts = useMemo(() => {
    const counts: Record<ProgressStage, number> = { new: 0, review: 0, known: 0, mastered: 0 };
    for (const card of learningCards) {
      const progress = cardBars.get(card.id);
      const stage = progress?.mastered ? "mastered" : progress?.bars === 4 ? "known" : reviewGradeCount(card) ? "review" : "new";
      counts[stage] += 1;
    }
    return counts;
  }, [cardBars, learningCards]);
  const favouriteCards = useMemo(() => cards.filter((card) => card.favourite), [cards]);
  // Offer only tags used by this topic; the card editor retains the global tag catalogue.
  const tagFacets = useMemo(() => {
    const counts = new Map<string, { tag: HeuresisTag; count: number }>();
    for (const card of [...cards, ...referenceCards]) {
      for (const tag of card.tags) {
        const found = counts.get(tag.id);
        if (found) found.count += 1;
        else counts.set(tag.id, { tag, count: 1 });
      }
    }
    return [...counts.values()].sort((a, b) => {
      if (pack.title === "中文 Selection") {
        const indexA = CHINESE_SELECTION_THEMES.findIndex((theme) => theme.name === a.tag.name);
        const indexB = CHINESE_SELECTION_THEMES.findIndex((theme) => theme.name === b.tag.name);
        if ((indexA >= 0) !== (indexB >= 0)) return indexA >= 0 ? -1 : 1;
        if (indexA >= 0 && indexB >= 0) return indexA - indexB;
      }
      return b.count - a.count || a.tag.name.localeCompare(b.tag.name);
    });
  }, [cards, referenceCards, pack.title]);
  const tagCountById = useMemo(() => new Map(tagFacets.map(({ tag, count }) => [tag.id, count])), [tagFacets]);
  const lessonTags = useMemo(() => tagFacets.map(({ tag }) => tag).filter((tag) => /^Lesson\s+\d+$/i.test(tag.name)).sort((a, b) => Number(a.name.match(/\d+/)?.[0] ?? 0) - Number(b.name.match(/\d+/)?.[0] ?? 0)), [tagFacets]);
  const otherTags = useMemo(() => tagFacets.map(({ tag }) => tag).filter((tag) => !/^Lesson\s+\d+$/i.test(tag.name)), [tagFacets]);
  const untaggedCount = useMemo(() => [...cards, ...referenceCards].filter((card) => !card.tags.length).length, [cards, referenceCards]);
  const tagSelectionActive = selectedTagIds.length > 0 || includeUntagged;
  const tagMatchesSearch = (tag: HeuresisTag) => tag.name.toLocaleLowerCase().includes(tagSearch.trim().toLocaleLowerCase());
  function toggleTag(tagId: string) {
    setAllCardsExpanded(false);
    setSelectedTagIds((current) => current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]);
  }

  const visibleTotal = loadedPackId === pack.id ? cards.length + referenceCards.length : pack.card_count;
  const explored = pack.card_count ? Math.round((pack.encountered_cards / pack.card_count) * 100) : 0;
  const richDiagnostics = explored >= 20;

  const statusRank = (card: CardWithStats) => {
    const status = workflowStatus(card);
    if (status === "unsorted") return 0;
    if (status === "reference") return 10;
    const progress = cardBars.get(card.id);
    return 1 + (progress?.mastered ? 5 : progress?.bars ?? 0);
  };

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const source = [...cards, ...referenceCards];
    const filtered = source.filter((card) => {
      const status = workflowStatus(card);
      if (statusFilters.length && !statusFilters.includes(status)) return false;
      if (stateFilter && stageOf(card) !== stateFilter) return false;

      if (favouriteOnly && !card.favourite) return false;
      if (interestFilter === "none" && card.interest_rank != null) return false;
      if (interestFilter !== "all" && interestFilter !== "none" && !ranksFor(interestFilter).includes(card.interest_rank ?? -1)) return false;

      if (tagSelectionActive && !(includeUntagged && card.tags.length === 0) && !card.tags.some((tag) => selectedTagIds.includes(tag.id))) return false;

      if (detailFilters.length) {
        const matchesSignal = detailFilters.some((detail) => {
          if (detail === "again") return isKeepMissing(card);
          if (detail === "production") return isWeakProduction(card, directions);
          return isNotSeenRecently(card);
        });
        if (!matchesSignal) return false;
      }

      if (!needle) return true;
      return Object.entries(card.data).filter(([key]) => !key.startsWith("_")).flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter(Boolean).join(" ").toLowerCase().includes(needle)
        || card.tags.some((tag) => tag.name.toLowerCase().includes(needle));
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let delta = 0;
      if (sortField === "status") delta = statusRank(a) - statusRank(b);
      if (sortField === "term") delta = fieldText(a.data, term?.key).localeCompare(fieldText(b.data, term?.key));
      if (sortField === "interest") delta = (a.interest_rank ?? 0) - (b.interest_rank ?? 0);
      if (sortField === "reviews") delta = reviewGradeCount(a) - reviewGradeCount(b);
      if (sortField === "lastSeen") delta = Date.parse(a.stats.last_encountered_at ?? "1970-01-01") - Date.parse(b.stats.last_encountered_at ?? "1970-01-01");
      if (delta === 0) delta = fieldText(a.data, term?.key).localeCompare(fieldText(b.data, term?.key));
      return delta * direction;
    });
    // statusRank and cardSummary read cardStates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cards, cardStates, cardBars, detailFilters, directions, favouriteOnly, interestFilter, query, referenceCards, sortDirection, sortField, stateFilter, statusFilters, tagSelectionActive, includeUntagged, selectedTagIds, term?.key]);

  // Show the card chosen in Search: clear anything that could hide it, select it, scroll to it.
  useEffect(() => {
    // Wait for this topic's own cards; the previous topic's list may still be on screen.
    if (!focusCardId || loading || loadedPackId !== pack.id) return;
    const isReference = referenceCards.some((card) => card.id === focusCardId);
    if (isReference || cards.some((card) => card.id === focusCardId)) {
      setAllCardsExpanded(true);
      setQuery(""); setStatusFilters(isReference ? ["reference"] : []); setStateFilter(null); setFavouriteOnly(false); setInterestFilter("all"); setSelectedTagIds([]); setIncludeUntagged(false); setDetailFilters([]);
      setSelectedCardId(focusCardId);
      setFocusNotice("");
      window.requestAnimationFrame(() => {
        const row = document.querySelector<HTMLElement>(`[data-card-id="${focusCardId}"]`);
        row?.scrollIntoView({ block: "center" });
        row?.focus({ preventScroll: true });
      });
    } else {
      setFocusNotice("That card is not in this topic's list any more (it may have been discarded; see Trash).");
    }
    onFocusCardShown?.();
  }, [cards, focusCardId, loadedPackId, loading, onFocusCardShown, pack.id, referenceCards]);

  const activeFilterCount = statusFilters.length + (stateFilter ? 1 : 0) + (favouriteOnly ? 1 : 0) + detailFilters.length + (interestFilter !== "all" ? 1 : 0) + (tagSelectionActive ? 1 : 0) + (query.trim() ? 1 : 0);
  const showCardList = allCardsExpanded || activeFilterCount > 0;
  const selectedCard = selectedCardId ? [...cards, ...referenceCards].find((card) => card.id === selectedCardId) ?? null : null;

  async function refreshAll(closeEditor = false) {
    if (closeEditor) setEditing(null);
    await reload();
    onChanged();
  }

  /** Review always opens the user's simple selection screen. */
  function startReview() { setStudyOpen(true); }

  async function openTargeted(_title: string, selected: CardWithStats[], limit?: number, templateId?: string) {
    const next = limit ? selected.slice(0, limit) : selected;
    if (!next.length || reviewStarting.current) return;
    reviewStarting.current = true;
    setReviewNotice("");
    try {
      await openCosmosWindow({
        mode: "review",
        packId: pack.id,
        source: "all",
        order: "pack",
        count: "all",
        cardIds: next.map((card) => card.id),
        ...(templateId ? { templateId } : {}),
      });
      reviewOpened.current = true;
    } catch (launchError) {
      setReviewNotice(launchError instanceof Error ? launchError.message : "Could not start filtered Review.");
    } finally {
      // Protect against a double-click opening two sessions.
      window.setTimeout(() => { reviewStarting.current = false; }, 800);
    }
  }

  function changeSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((current) => current === "asc" ? "desc" : "asc");
      return;
    }
    setSortField(field);
    setSortDirection(field === "status" || field === "term" ? "asc" : "desc");
  }

  function toggleDetail(detail: DetailFilter) {
    setDetailFilters((current) => current.includes(detail) ? current.filter((item) => item !== detail) : [...current, detail]);
  }

  function chooseStage(stage: StatusFilter) {
    setAllCardsExpanded(false);
    setStateFilter(null);
    setStatusFilters(statusFilters.length === 1 && statusFilters[0] === stage ? [] : [stage]);
  }

  function chooseState(state: ProgressStage) {
    setAllCardsExpanded(false);
    if (stateFilter === state) { setStateFilter(null); return; }
    setStatusFilters(["learning"]);
    setStateFilter(state);
  }

  function clearFilters() {
    setAllCardsExpanded(false);
    setQuery("");
    setStatusFilters([]);
    setStateFilter(null);
    setFavouriteOnly(false);
    setInterestFilter("all");
    setSelectedTagIds([]);
    setIncludeUntagged(false);
    setTagSearch("");
    setDetailFilters([]);
  }

  async function changeRetention(card: CardWithStats, retention: "learning" | "reference") {
    await setCardRetention(card.id, retention);
    // "Move to Learning" is a sorting decision: the card goes to Learning (and Review),
    // not back into the Unsorted queue.
    if (retention === "learning") await markCardSorted(card);
    await refreshAll(true);
  }

  if (relatedOpen) return <RelatedView pack={pack} onBack={() => setRelatedOpen(false)} onChanged={() => void refreshAll()} />;

  return (
    <section className="pack-page desktop-pack-page intelligent-topic modern-topic-page" data-accent={collection?.accent ?? "ink"}>
      <button className="text-button back-button modern-topic-back" onClick={onBack}><ArrowLeft size={15} /> {collection?.title || "Library"}</button>

      <header className="modern-topic-head">
        <div className="modern-topic-title"><p className="eyebrow">TOPIC</p><h1>{pack.title}</h1>{pack.description ? <p>{pack.description}</p> : null}<span className="pack-record">{plural(visibleTotal, "card")} · {pack.encountered_cards.toLocaleString()} met · {explored}% explored{pack.last_opened_at ? ` · ${formatSeen(pack.last_opened_at).replace("seen", "last opened")}` : ""}</span></div>
        <div className="modern-topic-head-actions">
          <details className="topic-more-menu topic-settings-menu">
            <summary className="secondary-button"><Settings2 size={15} /> Settings <ChevronDown size={13} /></summary>
            <div className="topic-more-popover">
              <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); onSettings(); }}><Settings2 size={15} /> Topic settings</button>
              <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setRelatedOpen(true); }}><Link2 size={15} /> Connections</button>
              <button type="button" onClick={(event) => { event.currentTarget.closest("details")?.removeAttribute("open"); setImportOpen(true); }}><FileUp size={15} /> Import cards</button>
            </div>
          </details>
        </div>
      </header>

      <section className="topic-workflow-overview" aria-label="Card workflow and status filter">
        <div className="workflow-overview-label">
          <span>Card journey</span>
          <small>{statusFilters.length || stateFilter ? "Filtered · click again for overview" : "Choose a group to view its cards"}</small>
        </div>
        <div className="workflow-overview-stages">
          <button className={statusFilters.includes("unsorted") ? "active" : ""} data-stage="unsorted" onClick={() => chooseStage("unsorted")}>
            <span className="workflow-stage-dot" />
            <strong>{unsortedCards.length.toLocaleString()}</strong>
            <span className="workflow-stage-copy"><b>To classify</b><small>Not yet placed in Review</small></span>
          </button>
          <span className="workflow-stage-arrow" aria-hidden="true">→</span>
          <button className={statusFilters.includes("learning") && !stateFilter ? "active" : ""} data-stage="learning" onClick={() => chooseStage("learning")}>
            <span className="workflow-stage-dot" />
            <strong>{learningCards.length.toLocaleString()}</strong>
            <span className="workflow-stage-copy"><b>In Review</b><small>Core · Active · Passive</small></span>
          </button>
          <span className="workflow-stage-arrow is-quiet" aria-hidden="true">·</span>
          <button className={statusFilters.includes("reference") ? "active" : ""} data-stage="reference" onClick={() => chooseStage("reference")}>
            <span className="workflow-stage-dot" />
            <strong>{referenceCards.length.toLocaleString()}</strong>
            <span className="workflow-stage-copy"><b>Reference</b><small>Lookup only · not reviewed</small></span>
          </button>
        </div>
        <div className="workflow-state-line" role="group" aria-label="Review progress">
          <span>Review progress · {learningCards.length} cards</span>
          {PROGRESS_STAGES.map((state) => <button key={state} type="button" data-state={state} aria-pressed={stateFilter === state} onClick={() => chooseState(state)}
            title={state === "new" ? "In Review but never practised" : state === "review" ? "Practised at least once; still learning" : state === "known" ? "Strong progress, but not yet mastered" : "Mastered according to review evidence"}>
            <strong>{stateCounts[state]}</strong> {state === "new" ? "Never reviewed" : state === "review" ? "Reviewed" : state === "known" ? "Familiar" : "Mastered"}</button>)}
        </div>
      </section>

      {richDiagnostics ? <div className="intelligent-question-band topic-question-band compact-question-band">
        <button data-tone="cinnabar" disabled={!missingCards.length} onClick={() => openTargeted("Keeps missing", missingCards)}><strong>{missingCards.length.toLocaleString()}</strong><b>Keep missing</b><span>Missed again and again.</span><em>REVIEW</em></button>
        <button data-tone="amber" disabled={!productionCards.length || !directions.production} onClick={() => openTargeted("Weak production", productionCards, undefined, directions.production?.id)}><strong>{productionCards.length.toLocaleString()}</strong><b>Weak production</b><span>Recognition is stronger.</span><em>DRILL</em></button>
        <button data-tone="sage" disabled={!staleCards.length} onClick={() => openTargeted("Not seen recently", staleCards, 30)}><strong>{staleCards.length.toLocaleString()}</strong><b>30d+ quiet</b><span>Previously reviewed, now quiet.</span><em>REFRESH</em></button>
      </div> : null}

      <div className="topic-command-bar">
        <div className="topic-learning-actions">
          <div className="topic-session-control" role="group" aria-label="Card sessions: New or Review">
            <button className="sort-command new-session-command" disabled={!unsortedCards.length} onClick={() => setSortOpen(true)}
              title="Classify new cards as Core, Active or Passive"><BookOpen size={15} /> New <small>{unsortedCards.length}</small></button>
            <button className="review-command" disabled={!learningCards.length} onClick={() => setStudyOpen(true)}
              title="Practise cards you have already classified"><Brain size={15} /> Review</button>
          </div>
          {tagSelectionActive && shown.some((card) => workflowStatus(card) === "learning") ? <button className="secondary-button" onClick={() => {
            const selected = shown.filter((card) => workflowStatus(card) === "learning");
            openTargeted("Review filtered cards", selected);
          }}><Brain size={15} /> Review these {shown.filter((card) => workflowStatus(card) === "learning").length}</button> : null}
          <button className="secondary-button" disabled={!cards.length} onClick={() => setBrowseOpen(true)}><Compass size={15} /> Browse</button>
          <button className="secondary-button" onClick={onCapture}><Plus size={15} /> Add</button>
        </div>
      </div>
      {reviewNotice ? <div className="topic-selection-hint" role="alert">{reviewNotice}</div> : null}

      <div className="modern-topic-toolbar compact-filter-toolbar">
        <label className="modern-topic-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search term, meaning or tag" /></label>
        <div className="compact-filter-actions">
          <button type="button" className={`compact-favourite-filter ${favouriteOnly ? "selected" : ""}`}
            aria-pressed={favouriteOnly} title="Show only favourite cards; combines with the selected workflow stage"
            onClick={() => setFavouriteOnly((current) => !current)}>
            <Star size={14} fill={favouriteOnly ? "currentColor" : "none"} />
            Favourites <small>{favouriteCards.length}</small>
          </button>

          <details className="filter-menu topic-filter-picker">
            <summary className={activeFilterCount ? "active" : ""}><SlidersHorizontal size={15} /><span>Filters</span>{activeFilterCount ? <b>{activeFilterCount}</b> : null}<ChevronDown size={14} /></summary>
            <div className="filter-menu-popover topic-filter-panel">
              <div className="topic-filter-panel-head"><strong>Filter cards</strong><span>Selections combine across sections</span></div>
              <section className="topic-filter-section" aria-label="Filter by tags">
                <div className="topic-filter-section-title"><strong>Tags</strong><small>Choose several · match any</small></div>
                <label className="topic-filter-tag-search"><Search size={14} /><input value={tagSearch} onChange={(event) => setTagSearch(event.target.value)} placeholder="Find a tag…" aria-label="Search available tags" /></label>
                <div className="topic-filter-tag-list">
                  {lessonTags.filter(tagMatchesSearch).length ? <p className="topic-filter-group-title">Lessons</p> : null}
                  {lessonTags.filter(tagMatchesSearch).map((tag) => <label key={tag.id} className="topic-filter-check"><input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} /><span>{tag.name}</span><small>{tagCountById.get(tag.id) ?? 0}</small></label>)}
                  {otherTags.filter(tagMatchesSearch).length ? <p className="topic-filter-group-title">Other tags</p> : null}
                  {otherTags.filter(tagMatchesSearch).map((tag) => <label key={tag.id} className="topic-filter-check" style={themeTagStyle(tag.name)}><input type="checkbox" checked={selectedTagIds.includes(tag.id)} onChange={() => toggleTag(tag.id)} /><span>{tag.name}</span><small>{tagCountById.get(tag.id) ?? 0}</small></label>)}
                  {!tagFacets.some(({tag}) => tagMatchesSearch(tag)) ? <p className="topic-filter-no-tags">No matching tags</p> : null}
                  {!tagSearch.trim() ? <label className="topic-filter-check"><input type="checkbox" checked={includeUntagged} onChange={(event) => { setAllCardsExpanded(false); setIncludeUntagged(event.target.checked); }} /><span>Untagged <small>{untaggedCount}</small></span></label> : null}
                </div>
                {tagSelectionActive ? <button className="topic-filter-section-reset" onClick={() => { setSelectedTagIds([]); setIncludeUntagged(false); }}>Clear tags</button> : null}
              </section>
              <section className="topic-filter-section" aria-label="Filter by importance">
                <div className="topic-filter-section-title"><strong>Importance</strong><small>How actively to use the knowledge</small></div>
                <div className="topic-filter-options">
                  <button className={interestFilter === "all" ? "selected" : ""} aria-pressed={interestFilter === "all"} onClick={() => setInterestFilter("all")}>Any</button>
                  {IMPORTANCE_ORDER.map((level) => <button key={level} className={interestFilter === level ? "selected" : ""} aria-pressed={interestFilter === level} onClick={() => { setAllCardsExpanded(false); setInterestFilter(level); }}>{IMPORTANCE_LABEL[level]}</button>)}
                  <button className={interestFilter === "none" ? "selected" : ""} aria-pressed={interestFilter === "none"} onClick={() => { setAllCardsExpanded(false); setInterestFilter("none"); }}>Not set</button>
                </div>
              </section>
              <section className="topic-filter-section" aria-label="Filter by review state">
                <div className="topic-filter-section-title"><strong>Card state</strong><small>Separate from importance</small></div>
                <div className="topic-filter-options topic-filter-states">
                  <button className={!statusFilters.length && !stateFilter ? "selected" : ""} aria-pressed={!statusFilters.length && !stateFilter} onClick={() => { setAllCardsExpanded(false); setStatusFilters([]); setStateFilter(null); }}>Any</button>
                  <button className={statusFilters.includes("unsorted") ? "selected" : ""} aria-pressed={statusFilters.includes("unsorted")} onClick={() => chooseStage("unsorted")}>To classify</button>
                  <button className={statusFilters.includes("reference") ? "selected" : ""} aria-pressed={statusFilters.includes("reference")} onClick={() => chooseStage("reference")}>Reference</button>
                  {PROGRESS_STAGES.map((stage) => <button key={stage} className={stateFilter === stage ? "selected" : ""} aria-pressed={stateFilter === stage} onClick={() => chooseState(stage)}>
                    {stage === "new" ? "Never reviewed" : stage === "review" ? "Reviewed" : stage === "known" ? "Familiar" : "Mastered"}</button>)}
                </div>
              </section>
              <div className="topic-filter-panel-footer"><button onClick={clearFilters}>Clear all filters</button><span>{shown.length} matching cards</span></div>
            </div>
          </details>

          {richDiagnostics ? <details className="filter-menu">
            <summary className={detailFilters.length ? "active" : ""}><span>Signals</span>{detailFilters.length ? <b>{detailFilters.length}</b> : null}<ChevronDown size={14} /></summary>
            <div className="filter-menu-popover signal-menu-popover"><p>Learning signals</p><div className="filter-chip-grid">
              <button className={detailFilters.includes("again") ? "selected" : ""} onClick={() => toggleDetail("again")}>Missing</button>
              <button className={detailFilters.includes("production") ? "selected" : ""} onClick={() => toggleDetail("production")}>Production</button>
              <button className={detailFilters.includes("stale") ? "selected" : ""} onClick={() => toggleDetail("stale")}>30d+</button>
            </div></div>
          </details> : null}

          {activeFilterCount ? <button className="compact-clear-filter" onClick={clearFilters}>Clear {activeFilterCount}</button> : null}
        </div>
      </div>

      {!loading && !error && visibleTotal > 0 ? <section className="topic-browse-hub topic-browse-compact" aria-label="Card list selection">
          <div className="topic-browse-heading">
            <div>
              <strong>{showCardList ? shown.length.toLocaleString() + " of " + visibleTotal.toLocaleString() + " cards" : "Card browser"}</strong>
              <small>{showCardList ? "Results reflect your selected filters" : "Use Filters above to choose tags, importance or review state; or open the complete list."}</small>
            </div>
            <div className="topic-browse-actions">
              {showCardList ? <button type="button" className="secondary-button" onClick={clearFilters}>Overview</button> : null}
              {!allCardsExpanded || activeFilterCount > 0 ? <button type="button" className="secondary-button" onClick={() => { clearFilters(); setAllCardsExpanded(true); }}>Show all {visibleTotal.toLocaleString()}</button> : null}
            </div>
          </div>
        </section> : null}

       {focusNotice ? <div className="topic-selection-hint" role="status">{focusNotice}</div> : null}
      {selectedCard ? <div className="topic-selection-hint" role="status"><strong>{fieldText(selectedCard.data, term?.key) || "Card"}</strong> selected · Edit below or press Enter</div> : null}

      {loading ? <div className="content-state" role="status">Opening cards…</div> : null}
      {!loading && error ? <div className="content-state error-state" role="alert"><strong>Could not load this topic.</strong><span>{error}</span><button type="button" className="secondary-button" onClick={() => void reload()}>Retry</button></div> : null}
      {!loading && !error && !showCardList && visibleTotal > 0 ? <div className="topic-browse-idle"><BookOpen size={17} /><span>Choose Filters above or Show all to see individual cards.</span></div> : null}
       {!loading && !error && (showCardList || visibleTotal === 0) ? <div className="modern-topic-table excel-topic-table ticker-topic-table">
        <div className="modern-topic-thead excel-topic-thead ticker-topic-thead">
          <button className={sortField === "term" ? "active" : ""} onClick={() => changeSort("term")}>CARD <ArrowUpDown size={11} /></button>
          <button className={sortField === "status" ? "active" : ""} onClick={() => changeSort("status")}>STATE <ArrowUpDown size={11} /></button>
          <button className={sortField === "interest" ? "active" : ""} onClick={() => changeSort("interest")}>IMPORTANCE <ArrowUpDown size={11} /></button>
          <button className={sortField === "reviews" ? "active" : ""} onClick={() => changeSort("reviews")}>REVIEWS <ArrowUpDown size={11} /></button>
          <button className={sortField === "lastSeen" ? "active" : ""} onClick={() => changeSort("lastSeen")}>LAST SEEN <ArrowUpDown size={11} /></button>
          <span>TAGS & LINKS</span>
        </div>
        {shown.map((card) => {
          const reviewCount = reviewGradeCount(card);
          const level = importanceOf(card.interest_rank);
          const visibleTags = card.tags.slice(0, 3);
          const status = workflowStatus(card);
          const progress = cardBars.get(card.id) ?? { bars: 0, mastered: false, estimated: false };
          const progressLabel = status === "unsorted" ? "To classify" : status === "reference" ? "Reference" : progress.mastered ? "Mastered" : progress.bars === 4 ? "Known" : reviewCount ? "Review" : "New";
          const selected = selectedCardId === card.id;
          return <div
            className={`modern-topic-row excel-topic-row ticker-topic-row ${selected ? "selected" : ""} ${status === "reference" ? "is-reference" : ""}`}
            key={card.id}
            data-card-id={card.id}
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
              <span className="modern-card-title"><strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>{card.favourite ? <Star size={13} fill="currentColor" /> : null}</span>
              {reading ? <em>{fieldText(card.data, reading.key)}</em> : null}
              <p>{fieldText(card.data, meaning?.key)}</p>
            </div>

            <div className="topic-status-cell">
              <div className={`card-progress ${progress.mastered ? "is-mastered" : ""}`}
                title={progress.estimated ? "Progress estimated from older review history" : `${progressLabel}: ${progress.bars}/4 bars`}
                role="img" aria-label={`${progressLabel}, ${progress.bars} of 4 bars`}>
                <div className="card-progress-bars">{[0, 1, 2, 3].map((step) =>
                  <span key={step} className={step < progress.bars ? "filled" : ""} />)}</div>
                <small>{progressLabel}</small>
              </div>
            </div>

            <div className="topic-interest-cell">{level ? <i className={`importance-badge importance-${level}`}>{IMPORTANCE_LABEL[level]}</i> : <span>—</span>}</div>

            <div className="modern-learning-cell">
              <strong>{reviewCount ? reviewCount.toLocaleString() : "No"} <small>{reviewCount === 1 ? "review" : "reviews"}</small></strong>
              
            </div>

            <div className="modern-recall-cell">
              <strong>{card.stats.last_encountered_at ? formatSeen(card.stats.last_encountered_at) : "Not seen yet"}</strong>
            </div>

            <div className="modern-meta-cell compact-meta-cell">
              <div className="row-tags">{visibleTags.map((tag) => <span key={tag.id} className={`${tag.is_badge ? "badge" : ""} ${themeTagStyle(tag.name) ? "theme-tag" : ""}`} style={themeTagStyle(tag.name)}>{tag.name}</span>)}{card.tags.length > visibleTags.length ? <span>+{card.tags.length - visibleTags.length}</span> : null}{!card.tags.length ? <small>No tags</small> : null}</div>
              <div className="row-mini-actions">
                {selected ? <button onClick={(event) => { event.stopPropagation(); setEditing(card); }} onDoubleClick={(event) => event.stopPropagation()} title="Edit card"><Pencil size={13} /> Edit</button> : null}
                <button className="row-connections-icon" onClick={(event) => { event.stopPropagation(); setConnectionsCard(card); }} onDoubleClick={(event) => event.stopPropagation()} title="Open connections tree" aria-label={`Open connections for ${fieldText(card.data, term?.key) || "card"}`}><GitFork size={15} /></button>
              </div>
            </div>
          </div>;
        })}
        {!shown.length ? <div className="pack-empty"><BookOpen size={20} /><strong>{cards.length || referenceCards.length ? "No matching cards." : "No cards yet."}</strong><span>{cards.length || referenceCards.length ? "Change the filters or search." : "Use + Add to create your first flashcard."}</span></div> : null}
      </div> : null}

      {editing ? <CardEditor pack={pack} card={editing} tags={tags} onClose={() => setEditing(null)} onSaved={() => void refreshAll(true)} onDeleted={() => void refreshAll(true)} onChanged={() => void refreshAll()} onConnections={() => setConnectionsCard(editing)} onRetention={(retention) => changeRetention(editing, retention)} /> : null}
      {connectionsCard ? <ConnectionsPanel pack={pack} card={connectionsCard} onClose={() => setConnectionsCard(null)} /> : null}
      {studyOpen ? <StudyModal pack={pack} cards={cards} onClose={() => setStudyOpen(false)} onComplete={() => { reviewOpened.current = true; }} /> : null}
      {sortOpen ? <SortModal pack={pack} cards={cards} tags={tags} onClose={() => setSortOpen(false)} onChanged={() => void refreshAll()} onReview={() => void startReview()} /> : null}
      {browseOpen ? <BrowseModal pack={pack} cards={cards} onClose={() => setBrowseOpen(false)} onComplete={() => void refreshAll()} /> : null}
      {importOpen ? <ImportModal pack={pack} onClose={() => setImportOpen(false)} onDone={() => refreshAll()} /> : null}
    </section>
  );
}
