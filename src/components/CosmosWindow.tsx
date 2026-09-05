import { Pin, Plus, SkipForward, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fieldByRole,
  fieldText,
  listCards,
  listPacks,
  listTags,
  patchCardData,
  type CardWithStats,
  type FieldDef,
  type HeuresisTag,
  type PackWithType,
} from "../lib/heuresis";
import {
  EMPTY_LEARNING_COUNTS,
  LEARNING_ACTION_LABELS,
  getLearningCounts,
  toggleLearningAction,
  type LearningAction,
  type LearningCounts,
} from "../lib/learning";
import {
  addRelatedWord,
  listRelatedCards,
  listRelatedCatalogue,
  removeRelatedRelation,
  type RelatedCatalogueRow,
  type RelationType,
} from "../lib/related";
import { cardHasCompletedSort, markCardSorted, setSortInterest, setSortTags } from "../lib/sort";
import {
  finishStudySession,
  loadStudySetup,
  recordStudyEvent,
  startHeuresisSession,
  type StudyGrade,
  type StudyTemplate,
} from "../lib/study";
import { supabase } from "../lib/supabase";
import "./cosmos.css";

const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";

type StudyMode = "review" | "sort";
type Side = "l" | "r";
type DimensionId = "neighbours" | "components" | "examples" | "structure" | "origin" | "facts" | "notes";
type DimensionDef = { id: DimensionId; side: Side; label: string; sub: string };
type WorkspaceBlock = { id: string; type: "text"; text: string; dim: DimensionId };
type Source = "all" | "new" | "favourites" | "interesting" | "again" | "unsorted";
type Order = "pack" | "random";

type Config = {
  valid: boolean;
  mode: StudyMode;
  relatedReview: boolean;
  packId: string;
  templateId: string;
  source: Source;
  order: Order;
  count: number | "all";
  tagId: string;
  query: string;
};

const LANGUAGE_DIMS: DimensionDef[] = [
  { id: "components", side: "l", label: "Parts", sub: "characters and pieces" },
  { id: "neighbours", side: "l", label: "Words", sub: "synonyms, antonyms, related" },
  { id: "origin", side: "l", label: "Origin", sub: "history and etymology" },
  { id: "structure", side: "r", label: "Grammar", sub: "patterns and usage" },
  { id: "examples", side: "r", label: "Examples", sub: "in real contexts" },
  { id: "facts", side: "r", label: "Facts", sub: "useful and memorable" },
  { id: "notes", side: "r", label: "Notes", sub: "my own" },
];

const CONCEPT_DIMS: DimensionDef[] = [
  { id: "neighbours", side: "l", label: "Related", sub: "nearby concepts and contrasts" },
  { id: "components", side: "l", label: "Parts", sub: "elements and sub-ideas" },
  { id: "origin", side: "l", label: "Origin", sub: "history and lineage" },
  { id: "structure", side: "r", label: "Structure", sub: "argument and relationships" },
  { id: "examples", side: "r", label: "Instances", sub: "where it appears" },
  { id: "facts", side: "r", label: "Facts", sub: "useful and memorable" },
  { id: "notes", side: "r", label: "Notes", sub: "my own" },
];

const REVIEW_ACTIONS: LearningAction[] = ["handwrite", "say", "hear", "sentence", "rephrase", "example"];
const RELATION_TYPES: RelationType[] = ["synonym", "antonym", "related"];
const DIMENSION_IDS = new Set<DimensionId>(["neighbours", "components", "examples", "structure", "origin", "facts", "notes"]);

function parseConfig(): Config {
  const params = new URLSearchParams(window.location.search);
  const packId = params.get("pack") ?? "";
  const rawCount = params.get("count") ?? "all";
  const numeric = Number(rawCount);
  const source = params.get("source");
  const relatedReview = params.get("related") === "1";
  return {
    valid: Boolean(packId),
    mode: relatedReview ? "review" : params.get("mode") === "sort" ? "sort" : "review",
    relatedReview,
    packId,
    templateId: params.get("template") ?? "",
    source: source === "new" || source === "favourites" || source === "interesting" || source === "again" || source === "unsorted" ? source : "all",
    order: params.get("order") === "random" ? "random" : "pack",
    count: rawCount === "all" || !Number.isFinite(numeric) || numeric <= 0 ? "all" : Math.floor(numeric),
    tagId: params.get("tag") ?? "",
    query: params.get("q")?.trim() ?? "",
  };
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function sourceCards(cards: CardWithStats[], source: Source) {
  if (source === "new") return cards.filter((card) => card.stats.encounter_count === 0);
  if (source === "favourites") return cards.filter((card) => card.favourite);
  if (source === "interesting") return cards.filter((card) => (card.interest_rank ?? 0) >= 4 || card.interesting);
  if (source === "again") return cards.filter((card) => card.stats.again_count >= 2);
  return cards;
}

function normaliseDimension(value: unknown): DimensionId {
  if (value === "contrast") return "neighbours";
  return typeof value === "string" && DIMENSION_IDS.has(value as DimensionId) ? value as DimensionId : "notes";
}

function parseBlocks(card: CardWithStats | null): WorkspaceBlock[] {
  const raw = card?.data[WORKSPACE_BLOCKS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    try {
      const value = JSON.parse(entry) as Partial<WorkspaceBlock>;
      if (value.type === "text" && typeof value.id === "string" && typeof value.text === "string") {
        return [{ id: value.id, type: "text", text: value.text, dim: normaliseDimension(value.dim) }];
      }
    } catch {
      // Unsupported or malformed legacy entries are preserved by patchCardData.
    }
    return [];
  });
}

function serialiseBlocks(blocks: WorkspaceBlock[]) {
  return blocks.map((block) => JSON.stringify(block));
}

function fieldDimension(field: FieldDef): DimensionId | null {
  const haystack = `${field.key} ${field.label}`.toLocaleLowerCase();
  if (field.role === "example" || field.role === "example_reading" || field.role === "example_translation") return "examples";
  if (/neighbou?r|synonym|antonym|related|similar|alternative word|contrast|difference|confus|versus|\bvs\b/.test(haystack)) return "neighbours";
  if (/component|radical|character|morph|part/.test(haystack)) return "components";
  if (/etymolog|origin|history|lineage/.test(haystack)) return "origin";
  if (/structure|grammar|pattern|construction|syntax|argument|usage|collocation|register/.test(haystack)) return "structure";
  if (/fact|trivia|cultur/.test(haystack)) return "facts";
  if (field.role === "extra" && !/alt.?meaning|alternative meaning|other meaning/.test(haystack)) return "notes";
  return null;
}

function relationLabel(value: RelationType) {
  return value === "synonym" ? "Synonym" : value === "antonym" ? "Antonym" : "Related";
}

function isConceptualPack(pack: PackWithType) {
  return /philosoph|history|psycholog|concept|theor|politic|econom/i.test(`${pack.title} ${pack.cardType?.name ?? ""}`);
}

async function closeDesktopWindow() {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

export default function CosmosWindow() {
  const config = useMemo(parseConfig, []);
  const [pack, setPack] = useState<PackWithType | null>(null);
  const [cards, setCards] = useState<CardWithStats[]>([]);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [templateId, setTemplateId] = useState(config.templateId);
  const [order, setOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [openLeaf, setOpenLeaf] = useState<Record<Side, DimensionId | null>>({ l: null, r: null });
  const [pinned, setPinned] = useState<Record<Side, boolean>>({ l: false, r: false });
  const [addingDim, setAddingDim] = useState<DimensionId | null>(null);
  const [addingText, setAddingText] = useState("");
  const [relatedRows, setRelatedRows] = useState<RelatedCatalogueRow[]>([]);
  const [relatedContext, setRelatedContext] = useState<RelatedCatalogueRow[]>([]);
  const [relatedTerm, setRelatedTerm] = useState("");
  const [relatedReading, setRelatedReading] = useState("");
  const [relatedMeaning, setRelatedMeaning] = useState("");
  const [relationType, setRelationType] = useState<RelationType>("related");
  const [learningCounts, setLearningCounts] = useState<Record<string, LearningCounts>>({});
  const [selectedActions, setSelectedActions] = useState<Record<string, LearningAction[]>>({});
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<string | null>(null);

  const mode = config.mode;
  const relatedReview = config.relatedReview;
  const currentId = order[index];
  const card = cards.find((item) => item.id === currentId) ?? null;
  const template = templates.find((item) => item.id === templateId) ?? templates[0] ?? null;
  const done = Boolean(order.length && index >= order.length);
  const dimensions = pack && isConceptualPack(pack) ? CONCEPT_DIMS : LANGUAGE_DIMS;
  const structuredWords = Boolean(pack && !isConceptualPack(pack));
  const blocks = parseBlocks(card);

  const patchLocalCard = useCallback((cardId: string, updater: (card: CardWithStats) => CardWithStats) => {
    setCards((current) => current.map((item) => item.id === cardId ? updater(item) : item));
  }, []);

  const closeSession = useCallback(async () => {
    const id = sessionRef.current;
    if (!id) return;
    sessionRef.current = null;
    await finishStudySession(id).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!config.valid) {
      setError("This Heuresis popup is missing its topic.");
      setLoading(false);
      return;
    }
    let cancelled = false;

    async function open() {
      setLoading(true);
      setError("");
      try {
        if (!supabase) throw new Error("Supabase is not configured.");
        const auth = await supabase.auth.getSession();
        if (!auth.data.session) throw new Error("Sign in to the main Heuresis window first.");

        const packs = await listPacks();
        const nextPack = packs.find((item) => item.id === config.packId) ?? null;
        if (!nextPack) throw new Error("This Heuresis topic no longer exists.");

        const [allCards, allTags, setup, contextRows] = await Promise.all([
          relatedReview ? listRelatedCards(nextPack.id) : listCards(nextPack.id),
          listTags(),
          loadStudySetup(nextPack.id, nextPack.card_type_id),
          relatedReview ? listRelatedCatalogue(nextPack.id) : Promise.resolve([]),
        ]);
        if (cancelled) return;

        const nextTemplates = setup.templates;
        const chosenTemplate = nextTemplates.find((item) => item.id === config.templateId)
          ?? nextTemplates.find((item) => item.id === setup.defaultTemplateId)
          ?? nextTemplates[0]
          ?? null;
        if (config.mode === "review" && !chosenTemplate) throw new Error("This topic has no review direction yet.");

        let pool = relatedReview
          ? [...allCards]
          : config.mode === "sort"
            ? (config.source === "unsorted" ? allCards.filter((item) => !cardHasCompletedSort(item)) : sourceCards(allCards, config.source))
            : sourceCards(allCards.filter(cardHasCompletedSort), config.source === "unsorted" ? "all" : config.source);

        if (!relatedReview && config.mode === "sort" && config.tagId) pool = pool.filter((item) => item.tags.some((tag) => tag.id === config.tagId));
        if (!relatedReview && config.mode === "sort" && config.query) {
          const q = config.query.toLocaleLowerCase();
          pool = pool.filter((item) => [
            item.note ?? "",
            ...item.tags.map((tag) => tag.name),
            ...Object.values(item.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string"),
          ].join(" ").toLocaleLowerCase().includes(q));
        }
        if (config.order === "random") pool = shuffle(pool);
        if (config.count !== "all") pool = pool.slice(0, Math.min(config.count, pool.length));
        if (!pool.length) {
          throw new Error(relatedReview
            ? "There are no related words to review yet."
            : config.mode === "sort"
              ? "There are no cards in this sorting selection."
              : "There are no sorted cards in this review selection. Use Sort first, or change the review filter.");
        }

        const sessionId = await startHeuresisSession(nextPack.id, relatedReview ? "related" : config.mode === "sort" ? "sort" : "flashcards", chosenTemplate?.id ?? null);
        if (cancelled) {
          await finishStudySession(sessionId).catch(() => undefined);
          return;
        }
        sessionRef.current = sessionId;

        if (config.mode === "review") {
          await recordStudyEvent({
            cardId: pool[0].id,
            packId: nextPack.id,
            sessionId,
            templateId: chosenTemplate?.id ?? null,
            eventType: "encountered",
          });
        }

        const counts = config.mode === "review" ? await getLearningCounts(pool.map((item) => item.id)).catch(() => ({})) : {};
        setPack(nextPack);
        setCards(allCards);
        setTags(allTags);
        setTemplates(nextTemplates);
        setTemplateId(chosenTemplate?.id ?? "");
        setOrder(pool.map((item) => item.id));
        setIndex(0);
        setRevealed(config.mode === "sort");
        setLearningCounts(counts);
        setRelatedContext(contextRows);
        document.title = `${relatedReview ? "Related" : config.mode === "sort" ? "Sort" : "Flashcards"} · ${nextPack.title} · Heuresis`;
      } catch (openError) {
        setError(openError instanceof Error ? openError.message : "Could not open Heuresis.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void open();
    const onPageHide = () => { void closeSession(); };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onPageHide);
      void closeSession();
    };
  }, [config, closeSession, relatedReview]);

  useEffect(() => {
    if (!card || !pack || !structuredWords || relatedReview) {
      setRelatedRows([]);
      return;
    }
    let alive = true;
    void listRelatedCatalogue(pack.id, card.id)
      .then((rows) => { if (alive) setRelatedRows(rows); })
      .catch(() => { if (alive) setRelatedRows([]); });
    return () => { alive = false; };
  }, [card?.id, pack?.id, structuredWords, relatedReview]);

  useEffect(() => {
    if (!pinned.l) setOpenLeaf((current) => ({ ...current, l: null }));
    if (!pinned.r) setOpenLeaf((current) => ({ ...current, r: null }));
    setAddingDim(null);
    setAddingText("");
    setRelatedTerm("");
    setRelatedReading("");
    setRelatedMeaning("");
    setRelationType("related");
    setNotice("");
  }, [card?.id]);

  const unsavedDraft = Boolean(addingDim && (addingText.trim() || relatedTerm.trim() || relatedReading.trim() || relatedMeaning.trim()));

  function toggleLeaf(dimension: DimensionId, side: Side) {
    if (mode === "review" && !revealed) return;
    if (unsavedDraft) { setNotice("Save or cancel what you are adding before changing panels."); return; }
    setOpenLeaf((current) => ({ ...current, [side]: current[side] === dimension ? null : dimension }));
    setPinned((current) => ({ ...current, [side]: false }));
    setAddingDim(null);
  }

  async function saveTextBlock(dimension: DimensionId) {
    if (!card || !addingText.trim() || busy) return;
    setBusy(true); setNotice("");
    try {
      const next: WorkspaceBlock[] = [...blocks, { id: crypto.randomUUID(), type: "text", text: addingText.trim(), dim: dimension }];
      const data = await patchCardData(card.id, { [WORKSPACE_BLOCKS_KEY]: serialiseBlocks(next) });
      patchLocalCard(card.id, (item) => ({ ...item, data, updated_at: new Date().toISOString() }));
      setAddingText(""); setAddingDim(null); setNotice("Saved to this card.");
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Could not save this card knowledge.");
    } finally { setBusy(false); }
  }

  async function removeTextBlock(blockId: string) {
    if (!card || busy) return;
    setBusy(true); setNotice("");
    try {
      const next = blocks.filter((block) => block.id !== blockId);
      const data = await patchCardData(card.id, { [WORKSPACE_BLOCKS_KEY]: serialiseBlocks(next) });
      patchLocalCard(card.id, (item) => ({ ...item, data, updated_at: new Date().toISOString() }));
    } catch (removeError) {
      setNotice(removeError instanceof Error ? removeError.message : "Could not remove this note.");
    } finally { setBusy(false); }
  }

  async function saveRelated() {
    if (!card || !pack || busy) return;
    const term = relatedTerm.trim();
    const meaning = relatedMeaning.trim();
    if (!term) { setNotice("Add the related word or expression."); return; }
    if (!meaning) { setNotice("Add a meaning so this word is usable later."); return; }
    setBusy(true); setNotice("");
    try {
      await addRelatedWord({ sourceCardId: card.id, term, reading: relatedReading, meaning, relationType });
      setRelatedRows(await listRelatedCatalogue(pack.id, card.id));
      setRelatedTerm(""); setRelatedReading(""); setRelatedMeaning(""); setRelationType("related"); setAddingDim(null);
      setNotice("Saved to Words.");
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Could not save the related word.");
    } finally { setBusy(false); }
  }

  async function removeRelation(row: RelatedCatalogueRow) {
    if (busy) return;
    setBusy(true); setNotice("");
    try {
      await removeRelatedRelation(row.relation_id);
      setRelatedRows((current) => current.filter((item) => item.relation_id !== row.relation_id));
    } catch (removeError) {
      setNotice(removeError instanceof Error ? removeError.message : "Could not remove this relation.");
    } finally { setBusy(false); }
  }

  async function reveal() {
    if (!card || !pack || !template || !sessionRef.current || revealed || busy) return;
    setBusy(true); setNotice("");
    try {
      await recordStudyEvent({ cardId: card.id, packId: pack.id, sessionId: sessionRef.current, templateId: template.id, eventType: "revealed" });
      setRevealed(true);
    } catch (revealError) {
      setNotice(revealError instanceof Error ? revealError.message : "Could not record reveal.");
    } finally { setBusy(false); }
  }

  async function answer(grade: StudyGrade) {
    if (!card || !pack || !template || !sessionRef.current || !revealed || busy || unsavedDraft) return;
    setBusy(true); setNotice("");
    try {
      await recordStudyEvent({ cardId: card.id, packId: pack.id, sessionId: sessionRef.current, templateId: template.id, eventType: grade });
      const nextIndex = index + 1;
      const nextId = order[nextIndex];
      if (nextId) {
        await recordStudyEvent({ cardId: nextId, packId: pack.id, sessionId: sessionRef.current, templateId: template.id, eventType: "encountered" });
      }
      setIndex(nextIndex);
      setRevealed(false);
    } catch (answerError) {
      setNotice(answerError instanceof Error ? answerError.message : "Could not save the review grade.");
    } finally { setBusy(false); }
  }

  async function toggleLearning(action: LearningAction) {
    if (!card || !pack || !sessionRef.current || busy) return;
    setBusy(true); setNotice("");
    try {
      const result = await toggleLearningAction({ cardId: card.id, packId: pack.id, sessionId: sessionRef.current, action });
      setSelectedActions((current) => {
        const previous = current[card.id] ?? [];
        const next = result.selected ? (previous.includes(action) ? previous : [...previous, action]) : previous.filter((item) => item !== action);
        return { ...current, [card.id]: next };
      });
      setLearningCounts((current) => ({
        ...current,
        [card.id]: { ...(current[card.id] ?? EMPTY_LEARNING_COUNTS), [action]: result.count },
      }));
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : "Could not save the learning action.");
    } finally { setBusy(false); }
  }

  async function setInterest(rank: number | null) {
    if (!card || busy) return;
    const previous = card.interest_rank;
    patchLocalCard(card.id, (item) => ({ ...item, interest_rank: rank, interesting: Boolean(rank && rank >= 4) }));
    setBusy(true); setNotice("");
    try { await setSortInterest(card.id, rank); }
    catch (saveError) {
      patchLocalCard(card.id, (item) => ({ ...item, interest_rank: previous, interesting: Boolean(previous && previous >= 4) }));
      setNotice(saveError instanceof Error ? saveError.message : "Could not save interest.");
    } finally { setBusy(false); }
  }

  async function toggleBadge(tag: HeuresisTag) {
    if (!card || busy) return;
    const badgeIds = new Set(card.tags.filter((item) => item.is_badge).map((item) => item.id));
    if (badgeIds.has(tag.id)) badgeIds.delete(tag.id); else badgeIds.add(tag.id);
    const preserved = card.tags.filter((item) => !item.is_badge);
    const selected = tags.filter((item) => item.is_badge && badgeIds.has(item.id));
    const nextTags = [...preserved, ...selected];
    const previous = card.tags;
    patchLocalCard(card.id, (item) => ({ ...item, tags: nextTags }));
    setBusy(true); setNotice("");
    try { await setSortTags(card.id, nextTags.map((item) => item.id)); }
    catch (saveError) {
      patchLocalCard(card.id, (item) => ({ ...item, tags: previous }));
      setNotice(saveError instanceof Error ? saveError.message : "Could not save badges.");
    } finally { setBusy(false); }
  }

  async function nextSort() {
    if (!card || busy || unsavedDraft) return;
    setBusy(true); setNotice("");
    try {
      const data = await markCardSorted(card);
      patchLocalCard(card.id, (item) => ({ ...item, data, updated_at: new Date().toISOString() }));
      setIndex((value) => value + 1);
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Could not mark this card as sorted.");
    } finally { setBusy(false); }
  }

  function skipSort() {
    if (busy || unsavedDraft) return;
    setIndex((value) => value + 1);
  }

  async function switchMode(next: StudyMode) {
    if (relatedReview || next === mode || unsavedDraft) return;
    await closeSession();
    const params = new URLSearchParams(window.location.search);
    params.delete("related");
    params.set("mode", next);
    params.set("source", next === "sort" ? "unsorted" : "all");
    params.set("order", "pack");
    params.set("count", "all");
    params.delete("tag");
    params.delete("q");
    window.location.search = params.toString();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.matches("input,textarea,select,[contenteditable=true]"));
      if (event.key === "Escape" && !typing) {
        event.preventDefault();
        void closeSession().then(() => closeDesktopWindow());
        return;
      }
      if (typing || !card || busy || done) return;
      if (mode === "review") {
        if (!revealed && (event.key === " " || event.key === "Enter")) { event.preventDefault(); void reveal(); return; }
        const grades: Record<string, StudyGrade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
        const grade = grades[event.key];
        if (revealed && grade) { event.preventDefault(); void answer(grade); }
      } else {
        if (/^[1-5]$/.test(event.key)) { event.preventDefault(); void setInterest(Number(event.key)); }
        else if (event.key === "ArrowRight" || event.key === "Enter") { event.preventDefault(); void nextSort(); }
        else if (event.key.toLowerCase() === "s") { event.preventDefault(); skipSort(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (loading) return <div className="cosmos-state">Opening Heuresis…</div>;
  if (error || !pack) return <div className="cosmos-state error"><strong>Heuresis could not open.</strong><p>{error || "Missing topic data."}</p><button onClick={() => void closeDesktopWindow()}>Close</button></div>;
  if (done || !card) return <div className="cosmos-state done"><strong>{relatedReview ? "Related review complete." : mode === "sort" ? "Sort pass complete." : "Review complete."}</strong><p>{order.length} cards in this session.</p><button onClick={() => void closeSession().then(() => closeDesktopWindow())}>Return to Heuresis</button></div>;

  const type = pack.cardType;
  const term = fieldByRole(type, "term") ?? type?.field_schema[0] ?? null;
  const reading = fieldByRole(type, "reading");
  const meaning = fieldByRole(type, "meaning") ?? type?.field_schema[1] ?? null;
  const frontKeys = mode === "review" ? (template?.front ?? []) : [];
  const backKeys = mode === "review" ? (template?.back ?? []) : [];
  const detailKeys = mode === "review" ? (template?.details ?? []) : [];
  const activeLearning = new Set(selectedActions[card.id] ?? []);
  const counts = learningCounts[card.id] ?? EMPTY_LEARNING_COUNTS;
  const badges = tags.filter((tag) => tag.is_badge).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const context = relatedReview ? relatedContext.find((row) => row.target_card_id === card.id) ?? null : null;

  const fieldEntriesFor = (dimension: DimensionId) => (type?.field_schema ?? []).flatMap((field) => {
    if (fieldDimension(field) !== dimension) return [];
    const value = fieldText(card.data, field.key);
    return value ? [{ key: field.key, label: field.label, value }] : [];
  });
  const blocksFor = (dimension: DimensionId) => blocks.filter((block) => block.dim === dimension);
  const countFor = (dimension: DimensionId) => fieldEntriesFor(dimension).length + blocksFor(dimension).length + (dimension === "neighbours" && structuredWords ? relatedRows.length : 0) + (dimension === "notes" && card.note?.trim() ? 1 : 0);

  const renderLeaf = (side: Side) => {
    const dimensionId = openLeaf[side];
    const def = dimensionId ? dimensions.find((item) => item.id === dimensionId) : null;
    if (!dimensionId || !def) return <aside className={`cosmos-leaf ${side}`} aria-hidden="true" />;
    const entries = fieldEntriesFor(dimensionId);
    const dimensionBlocks = blocksFor(dimensionId);
    const showRelated = dimensionId === "neighbours" && structuredWords && !relatedReview;
    return <aside className={`cosmos-leaf ${side} open`}>
      <div className="cosmos-leaf-inner">
        <header><div><h2>{def.label}</h2><span>{def.sub}</span></div><div><button aria-pressed={pinned[side]} title="Keep open" onClick={() => setPinned((current) => ({ ...current, [side]: !current[side] }))}><Pin size={14} /></button><button aria-label={`Close ${def.label}`} onClick={() => { setOpenLeaf((current) => ({ ...current, [side]: null })); setPinned((current) => ({ ...current, [side]: false })); }}><X size={14} /></button></div></header>
        <div className="cosmos-leaf-body">
          {dimensionId === "notes" && card.note?.trim() ? <article className="cosmos-field"><small>Card note</small><p>{card.note}</p></article> : null}
          {entries.map((entry) => <article className="cosmos-field" key={entry.key}><small>{entry.label}</small><p>{entry.value}</p></article>)}
          {showRelated ? relatedRows.map((row) => <article className="cosmos-related" key={row.relation_id}><div><strong>{row.term}</strong>{row.reading ? <em>{row.reading}</em> : null}</div><span className={`relation-${row.relation_type}`}>{relationLabel(row.relation_type)}</span>{row.meaning ? <p>{row.meaning}</p> : null}<button title="Remove relation" onClick={() => void removeRelation(row)}><X size={11} /></button></article>) : null}
          {dimensionBlocks.map((block) => <article className="cosmos-text-block" key={block.id}><p>{block.text}</p><button title="Remove" onClick={() => void removeTextBlock(block.id)}><X size={11} /></button></article>)}
          {!entries.length && !dimensionBlocks.length && !showRelated && !(dimensionId === "notes" && card.note?.trim()) ? <p className="cosmos-empty">Nothing here yet. Add whatever makes this card easier to understand or remember.</p> : null}
        </div>
        <footer>
          {addingDim === dimensionId ? showRelated ? <div className="cosmos-word-editor"><input autoFocus placeholder="Word or expression" value={relatedTerm} onChange={(event) => setRelatedTerm(event.target.value)} /><input placeholder="Reading / pinyin" value={relatedReading} onChange={(event) => setRelatedReading(event.target.value)} /><textarea placeholder="Meaning" rows={3} value={relatedMeaning} onChange={(event) => setRelatedMeaning(event.target.value)} /><div className="cosmos-relation-types">{RELATION_TYPES.map((value) => <button key={value} className={relationType === value ? "selected" : ""} onClick={() => setRelationType(value)}>{relationLabel(value)}</button>)}</div><div className="cosmos-editor-actions"><button onClick={() => { setAddingDim(null); setRelatedTerm(""); setRelatedReading(""); setRelatedMeaning(""); }}>Cancel</button><button className="primary" disabled={busy} onClick={() => void saveRelated()}>Save</button></div></div> : <div className="cosmos-add-editor"><textarea autoFocus rows={5} value={addingText} onChange={(event) => setAddingText(event.target.value)} placeholder={`Add to ${def.label}`} /><div><button onClick={() => { setAddingDim(null); setAddingText(""); }}>Cancel</button><button className="primary" disabled={busy || !addingText.trim()} onClick={() => void saveTextBlock(dimensionId)}>Save</button></div></div> : <button className="cosmos-add" onClick={() => setAddingDim(dimensionId)}><Plus size={13} /> Add to {def.label}</button>}
        </footer>
      </div>
    </aside>;
  };

  const renderReviewCore = () => {
    const keys = revealed ? [...new Set([...backKeys, ...detailKeys])] : frontKeys;
    const fallbackKeys = revealed ? [meaning?.key].filter(Boolean) as string[] : [term?.key, reading?.key].filter(Boolean) as string[];
    const used = keys.length ? keys : fallbackKeys;
    return <div className={revealed ? "cosmos-card-copy revealed" : "cosmos-card-copy"}>{used.map((key, position) => {
      const value = fieldText(card.data, key);
      if (!value) return null;
      const field = type?.field_schema.find((item) => item.key === key);
      return <div className={`cosmos-core-field role-${field?.role ?? "extra"}`} key={key}>{position > 0 && field?.role === "meaning" ? <i className="cosmos-rule" /> : null}<span>{value}</span></div>;
    })}{revealed && context ? <div className="cosmos-related-context"><small>From</small><span>{context.source_term || "source card"}{context.source_reading ? ` · ${context.source_reading}` : ""} · {relationLabel(context.relation_type)}</span></div> : null}{!revealed ? <button className="cosmos-inline-reveal" disabled={busy} onClick={() => void reveal()}>Reveal</button> : null}</div>;
  };

  return <main className="cosmos-shell">
    <header className="cosmos-topbar"><div className="cosmos-title"><strong>Heuresis</strong><span>· {pack.title}</span></div><div className="cosmos-modes">{relatedReview ? <span>Related review</span> : <><button aria-pressed={mode === "review"} onClick={() => void switchMode("review")}>Review</button><button aria-pressed={mode === "sort"} onClick={() => void switchMode("sort")}>Sort</button></>}</div><span className="cosmos-mode-note">{relatedReview ? "related vocabulary · reveal · grade" : mode === "review" ? "memory · reveal · grade" : "organisation · priority · badges"}</span><span className="cosmos-spacer" /><span className="cosmos-count">{index + 1} / {order.length}</span><button className="cosmos-close" aria-label="Close" onClick={() => void closeSession().then(() => closeDesktopWindow())}><X size={18} /></button></header>
    <div className="cosmos-progress"><i style={{ width: `${Math.min(100, ((index + (revealed || mode === "sort" ? 1 : 0)) / order.length) * 100)}%` }} /></div>
    <section className="cosmos-stage"><div className="cosmos-work" data-l={openLeaf.l ? "open" : "closed"} data-r={openLeaf.r ? "open" : "closed"}>
      {renderLeaf("l")}
      <article className="cosmos-card">
        <nav className="cosmos-tabs left">{dimensions.filter((item) => item.side === "l").map((dimension) => <button key={dimension.id} disabled={mode === "review" && !revealed} aria-expanded={openLeaf.l === dimension.id} data-empty={countFor(dimension.id) ? "0" : "1"} onClick={() => toggleLeaf(dimension.id, "l")}><span>{countFor(dimension.id) || "+"}</span><b>{dimension.label}</b></button>)}</nav>
        <nav className="cosmos-tabs right">{dimensions.filter((item) => item.side === "r").map((dimension) => <button key={dimension.id} disabled={mode === "review" && !revealed} aria-expanded={openLeaf.r === dimension.id} data-empty={countFor(dimension.id) ? "0" : "1"} onClick={() => toggleLeaf(dimension.id, "r")}><span>{countFor(dimension.id) || "+"}</span><b>{dimension.label}</b></button>)}</nav>
        <div className="cosmos-nucleus">{mode === "review" ? renderReviewCore() : <div className="cosmos-card-copy revealed"><div className="cosmos-core-field role-term"><span>{fieldText(card.data, term?.key) || "Untitled"}</span></div>{reading ? <div className="cosmos-core-field role-reading"><span>{fieldText(card.data, reading.key)}</span></div> : null}<i className="cosmos-rule" />{meaning ? <div className="cosmos-core-field role-meaning"><span>{fieldText(card.data, meaning.key)}</span></div> : null}</div>}</div>
        {mode === "review" && revealed ? <div className="cosmos-practice"><span>RETENTION</span>{REVIEW_ACTIONS.map((action) => <button key={action} aria-pressed={activeLearning.has(action)} disabled={busy} onClick={() => void toggleLearning(action)}>{LEARNING_ACTION_LABELS[action]}{counts[action] ? <small>×{counts[action]}</small> : null}</button>)}</div> : null}
        {mode === "review" ? <footer className="cosmos-review-foot">{revealed ? <><button disabled={busy} onClick={() => void answer("again")}>Again <small>1</small></button><button disabled={busy} onClick={() => void answer("hard")}>Hard <small>2</small></button><button className="primary" disabled={busy} onClick={() => void answer("good")}>Good <small>3</small></button><button disabled={busy} onClick={() => void answer("easy")}>Easy <small>4</small></button></> : <span>Reveal the card before opening its knowledge panels.</span>}</footer> : <footer className="cosmos-sort-foot"><div className="cosmos-interest"><span>INTEREST</span>{[1,2,3,4,5].map((rank) => <button key={rank} aria-pressed={card.interest_rank === rank} disabled={busy} onClick={() => void setInterest(card.interest_rank === rank ? null : rank)}>{rank}</button>)}</div><div className="cosmos-badges"><span>BADGES</span>{badges.map((tag) => <button key={tag.id} aria-pressed={card.tags.some((item) => item.id === tag.id)} disabled={busy} onClick={() => void toggleBadge(tag)}>{tag.name}{tag.shortcut ? <small>{tag.shortcut}</small> : null}</button>)}</div><div className="cosmos-sort-actions"><button disabled={busy} onClick={skipSort}><SkipForward size={14} /> Skip <small>S</small></button><button className="primary" disabled={busy} onClick={() => void nextSort()}>Apply + next <small>→</small></button></div></footer>}
      </article>
      {renderLeaf("r")}
    </div>{notice ? <div className="cosmos-notice">{notice}</div> : null}</section>
  </main>;
}
