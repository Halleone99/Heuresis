import { CircleHelp, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Pin, Plus, SkipForward, X } from "lucide-react";
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
  getLearningCounts,
  toggleLearningAction,
  type LearningAction,
  type LearningCounts,
} from "../lib/learning";
import { reviewGradeCount, templateDirection } from "../lib/learningSignals";
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
import { isWordSized, suggestResult, type AnswerKind, type AnswerSuggestion, type ExpectedAnswer } from "../lib/answerCheck";
import { mistakeDifference } from "../lib/mistakeDiff";
import { assessState, directionEvidence, STATE_LABEL, STATE_PROGRESSION, type GradeEvent, type KnowledgeState } from "../lib/knowledgeState";
import { candidateKey, defaultDirections, legacyTemplateId, recommendSession, spaceSameCards } from "../lib/recommend";
import { loadGradeEvents } from "../lib/reviewEvidence";
import { MORE_SIZE, readReviewMethod, writeReviewMethod, type ReviewMethod } from "../lib/reviewPrefs";
import { isSuccess, RESULT_HINT, RESULT_LABEL, RESULT_ORDER } from "../lib/reviewResults";
import { signHeuresisCardImages } from "../lib/cardMedia";
import { isAndroidRuntime, returnToHeuresisApp } from "../lib/platform";
import { supabase } from "../lib/supabase";
import { readReviewSelection } from "../lib/cosmosWindow";
import { reviewSpeechLanguage, reviewSpokenPrompt, speakReviewText, stopReviewAudio, type ReviewSpeechRole } from "../lib/reviewAudio";
import ConnectionsPanel from "./ConnectionsPanel";
import RetentionPractice from "./RetentionPractice";
import ReviewAnswerPad from "./ReviewAnswerPad";
import "./cosmos.css";

const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";

type StudyMode = "review" | "sort";
type DimensionId = "neighbours" | "components" | "examples" | "structure" | "origin" | "facts" | "notes";
type DimensionDef = { id: DimensionId; label: string; sub: string };
type WorkspaceTextBlock = { id: string; type: "text"; text: string; dim: DimensionId };
type WorkspaceImageBlock = { id: string; type: "image"; path: string; caption: string; dim: DimensionId };
type WorkspaceBlock = WorkspaceTextBlock | WorkspaceImageBlock;
type Source = "recommended" | "all" | "new" | "favourites" | "interesting" | "again" | "unsorted";
type Order = "pack" | "random";
/** One step of a session: a card in one direction, with the reasons it was chosen. */
type QueueItem = { cardId: string; templateId: string | null; reasons: string[]; state: KnowledgeState | null };
type SessionResult = { cardId: string; templateId: string | null; grade: StudyGrade; stateBefore: KnowledgeState | null };

type Config = {
  valid: boolean;
  mode: StudyMode;
  relatedReview: boolean;
  packId: string;
  templateId: string;
  templateIds: string[];
  source: Source;
  order: Order;
  count: number | "all";
  tagIds: string[];
  query: string;
  selectionToken: string;
};


/** Card knowledge, in the order the Details drawer shows it. */
const LANGUAGE_DIMS: DimensionDef[] = [
  { id: "examples", label: "Examples", sub: "in real contexts" },
  { id: "neighbours", label: "Words", sub: "synonyms, antonyms, related" },
  { id: "components", label: "Parts", sub: "characters and pieces" },
  { id: "structure", label: "Grammar", sub: "patterns and usage" },
  { id: "origin", label: "Origin", sub: "history and etymology" },
  { id: "facts", label: "Facts", sub: "useful and memorable" },
  { id: "notes", label: "Notes", sub: "my own" },
];

const CONCEPT_DIMS: DimensionDef[] = [
  { id: "examples", label: "Instances", sub: "where it appears" },
  { id: "neighbours", label: "Related", sub: "nearby concepts and contrasts" },
  { id: "components", label: "Parts", sub: "elements and sub-ideas" },
  { id: "structure", label: "Structure", sub: "argument and relationships" },
  { id: "origin", label: "Origin", sub: "history and lineage" },
  { id: "facts", label: "Facts", sub: "useful and memorable" },
  { id: "notes", label: "Notes", sub: "my own" },
];

const RELATION_TYPES: RelationType[] = ["synonym", "antonym", "related"];
const DIMENSION_IDS = new Set<DimensionId>(["neighbours", "components", "examples", "structure", "origin", "facts", "notes"]);
const DETAILS_PIN_KEY = "heuresis.review.detailsPinned.v1";

function parseConfig(): Config {
  const params = new URLSearchParams(window.location.search);
  const packId = params.get("pack") ?? "";
  const rawCount = params.get("count") ?? "all";
  const numeric = Number(rawCount);
  const source = params.get("source");
  const relatedReview = params.get("related") === "1";
  const templateIds = (params.get("templates") ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return {
    valid: Boolean(packId),
    mode: relatedReview ? "review" : params.get("mode") === "sort" ? "sort" : "review",
    relatedReview,
    packId,
    templateId: params.get("template") ?? "",
    templateIds,
    source: source === "recommended" || source === "new" || source === "favourites" || source === "interesting" || source === "again" || source === "unsorted" ? source : "all",
    order: params.get("order") === "random" ? "random" : "pack",
    count: rawCount === "all" || !Number.isFinite(numeric) || numeric <= 0 ? "all" : Math.floor(numeric),
    tagIds: params.getAll("tag").filter(Boolean),
    query: params.get("q")?.trim() ?? "",
    selectionToken: params.get("selection") ?? "",
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
  if (source === "new") return cards.filter((card) => reviewGradeCount(card) === 0);
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
  return raw.flatMap<WorkspaceBlock>((entry) => {
    try {
      const value = JSON.parse(entry) as Record<string, unknown>;
      if (value.type === "text" && typeof value.id === "string" && typeof value.text === "string") {
        return [{ id: value.id, type: "text", text: value.text, dim: normaliseDimension(value.dim) } satisfies WorkspaceTextBlock];
      }
      if (value.type === "image" && typeof value.id === "string" && typeof value.path === "string") {
        return [{
          id: value.id,
          type: "image",
          path: value.path,
          caption: typeof value.caption === "string" ? value.caption : "",
          dim: normaliseDimension(value.dim),
        } satisfies WorkspaceImageBlock];
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

/** An empty selection is not a failure: the window explains it calmly. */
class EmptySelection extends Error {}

/** Android (MagicPad APK): Review is a page inside the app's only WebView, opened from Study. */
const ANDROID = isAndroidRuntime();

async function closeDesktopWindow() {
  // Closing the window on Android would close the whole app (it has one window and one
  // WebView). Go back to the Study page Review was opened from instead.
  if (ANDROID) {
    returnToHeuresisApp();
    return;
  }
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

function plural(count: number, word: string) { return `${count} ${count === 1 ? word : `${word}s`}`; }

export default function CosmosWindow() {
  const config = useMemo(parseConfig, []);
  const [pack, setPack] = useState<PackWithType | null>(null);
  const [cards, setCards] = useState<CardWithStats[]>([]);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [templates, setTemplates] = useState<StudyTemplate[]>([]);
  const [sessionTemplates, setSessionTemplates] = useState<StudyTemplate[]>([]);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  /** Manual sessions: the rest of the chosen order, for "10 more". */
  const [manualRest, setManualRest] = useState<QueueItem[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [emptySelection, setEmptySelection] = useState(false);
  const [notice, setNotice] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [leftContextOpen, setLeftContextOpen] = useState(false);
  const [detailsPinned, setDetailsPinned] = useState(() => { try { return localStorage.getItem(DETAILS_PIN_KEY) === "1"; } catch { return false; } });
  const [whyOpen, setWhyOpen] = useState(false);
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
  const [signedImages, setSignedImages] = useState<Record<string, string>>({});
  const [events, setEvents] = useState<GradeEvent[] | null>(null);
  /** The pack's default direction, which also carries results recorded without a direction. */
  const [legacyId, setLegacyId] = useState<string | null>(null);
  const [results, setResults] = useState<SessionResult[]>([]);
  const [roundStart, setRoundStart] = useState(0);
  const [method, setMethodState] = useState<ReviewMethod>(() => { const saved = readReviewMethod(); return saved === "hear" ? "think" : saved; });
  const [audioPrompt, setAudioPrompt] = useState(() => { try { return localStorage.getItem("heuresis.review.audioPrompt.v1") === "1"; } catch { return false; } });
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [hasWriting, setHasWriting] = useState(false);
  const [saidAnswer, setSaidAnswer] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [suggestion, setSuggestion] = useState<AnswerSuggestion | null>(null);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const lastAutoAudioRef = useRef("");
  const learningInFlightRef = useRef(new Set<string>());

  const mode = config.mode;
  const relatedReview = config.relatedReview;
  const recommended = mode === "review" && !relatedReview && config.source === "recommended";
  const item = queue[index] ?? null;
  const card = item ? cards.find((entry) => entry.id === item.cardId) ?? null : null;
  const templateFor = useCallback((entry: QueueItem | null) => {
    if (!entry) return null;
    return templates.find((template) => template.id === entry.templateId) ?? sessionTemplates[0] ?? templates[0] ?? null;
  }, [sessionTemplates, templates]);
  const template = templateFor(item);
  const done = Boolean(queue.length && index >= queue.length);
  const dimensions = pack && isConceptualPack(pack) ? CONCEPT_DIMS : LANGUAGE_DIMS;
  const structuredWords = Boolean(pack && !isConceptualPack(pack));
  const blocks = parseBlocks(card);

  const setMethod = (next: ReviewMethod) => {
    setMethodState(next); writeReviewMethod(next);
    if (template?.id) {
      try { localStorage.setItem("heuresis.review.method.direction:" + template.id, next); } catch { /* preference only */ }
    }
  };
  // Recognition and production have different sensible defaults and remember overrides separately.
  useEffect(() => {
    if (mode !== "review" || !pack || !template) return;
    let saved: string | null = null;
    try { saved = localStorage.getItem("heuresis.review.method.direction:" + template.id); } catch { /* preference only */ }
    const valid = saved === "think" || saved === "type" || saved === "handwrite" || saved === "say";
    setMethodState(valid ? saved as ReviewMethod : templateDirection(pack, template) === "production" ? "type" : "think");
  }, [mode, pack?.id, template?.id]);

  const patchLocalCard = useCallback((cardId: string, updater: (card: CardWithStats) => CardWithStats) => {
    setCards((current) => current.map((entry) => entry.id === cardId ? updater(entry) : entry));
  }, []);

  const closeSession = useCallback(async () => {
    stopReviewAudio();
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
        const nextPack = packs.find((entry) => entry.id === config.packId) ?? null;
        if (!nextPack) throw new Error("This Heuresis topic no longer exists.");

        const wantsHistory = config.mode === "review" && !relatedReview;
        const [allCards, allTags, setup, contextRows, history] = await Promise.all([
          relatedReview ? listRelatedCards(nextPack.id) : listCards(nextPack.id),
          listTags(),
          loadStudySetup(nextPack.id, nextPack.card_type_id),
          relatedReview ? listRelatedCatalogue(nextPack.id) : Promise.resolve([]),
          wantsHistory ? loadGradeEvents(nextPack.id).catch(() => null) : Promise.resolve(null),
        ]);
        if (cancelled) return;

        const nextTemplates = setup.templates;
        const requestedIds = config.templateIds.length ? config.templateIds : config.templateId ? [config.templateId] : [];
        const requested = requestedIds.map((id) => nextTemplates.find((entry) => entry.id === id)).filter((entry): entry is StudyTemplate => Boolean(entry));
        const chosenTemplate = nextTemplates.find((entry) => entry.id === setup.defaultTemplateId) ?? nextTemplates[0] ?? null;
        const isRecommended = config.mode === "review" && !relatedReview && config.source === "recommended";
        const activeTemplates = requested.length
          ? requested
          : isRecommended ? defaultDirections(nextTemplates, setup.defaultTemplateId) : chosenTemplate ? [chosenTemplate] : [];
        if (config.mode === "review" && !activeTemplates.length) throw new Error("This topic has no review direction yet.");

        let nextQueue: QueueItem[] = [];
        let rest: QueueItem[] = [];
        const ready = allCards.filter(cardHasCompletedSort);
        // A filtered or targeted review must never quietly fall back to every card.
        const selection = config.selectionToken ? readReviewSelection(config.packId, config.selectionToken) : [];
        if (config.selectionToken && !selection.length) throw new EmptySelection("This review selection has no cards.");
        if (isRecommended) {
          const legacy = legacyTemplateId(nextTemplates, setup.defaultTemplateId);
          const directions = activeTemplates.map((entry) => ({ templateId: entry.id, label: entry.name, front: entry.front, legacy: entry.id === legacy }));
          const size = config.count === "all" ? ready.length * directions.length : config.count;
          nextQueue = recommendSession({ cards: ready, directions, events: history, size })
            .map((rec) => ({ cardId: rec.cardId, templateId: rec.templateId, reasons: rec.reasons, state: rec.state }));
        } else {
          let pool = relatedReview
            ? [...allCards]
            : config.mode === "sort"
              ? (config.source === "unsorted" ? allCards.filter((entry) => !cardHasCompletedSort(entry)) : sourceCards(allCards, config.source))
              : sourceCards(ready, config.source === "unsorted" ? "all" : config.source);
          if (selection.length && config.mode === "review") {
            const positions = new Map(selection.map((id, i) => [id, i]));
            pool = pool.filter((entry) => positions.has(entry.id))
              .sort((a, b) => (positions.get(a.id) ?? 0) - (positions.get(b.id) ?? 0));
          }
          if (!relatedReview && config.tagIds.length) pool = pool.filter((entry) => entry.tags.some((tag) => config.tagIds.includes(tag.id)));
          if (!relatedReview && config.query) {
            const q = config.query.toLocaleLowerCase();
            pool = pool.filter((entry) => [
              entry.note ?? "",
              ...entry.tags.map((tag) => tag.name),
              ...Object.values(entry.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string"),
            ].join(" ").toLocaleLowerCase().includes(q));
          }
          if (config.order === "random") pool = shuffle(pool);
          // Manual sessions alternate the chosen directions, as before.
          const all = pool.map((entry, position) => ({
            cardId: entry.id,
            templateId: config.mode === "review" && activeTemplates.length ? activeTemplates[position % activeTemplates.length].id : null,
            reasons: [], state: null,
          } satisfies QueueItem));
          const limit = config.count === "all" ? all.length : Math.min(config.count, all.length);
          nextQueue = all.slice(0, limit);
          rest = all.slice(limit);
        }
        if (!nextQueue.length) {
          throw new EmptySelection(relatedReview
            ? "There are no related words to review yet."
            : config.mode === "sort"
              ? "There are no cards in this sorting selection."
              : "There are no sorted cards in this review selection. Use Sort first, or change the selection in Adjust.");
        }

        const sessionTemplateId = activeTemplates.length === 1 ? activeTemplates[0].id : null;
        const sessionId = await startHeuresisSession(nextPack.id, relatedReview ? "related" : config.mode === "sort" ? "sort" : "flashcards", sessionTemplateId);
        if (cancelled) {
          await finishStudySession(sessionId).catch(() => undefined);
          return;
        }
        sessionRef.current = sessionId;

        if (config.mode === "review") {
          await recordStudyEvent({ cardId: nextQueue[0].cardId, packId: nextPack.id, sessionId, templateId: nextQueue[0].templateId, eventType: "encountered" });
        }

        const counts = config.mode === "review" ? await getLearningCounts(nextQueue.map((entry) => entry.cardId)).catch(() => ({})) : {};
        setPack(nextPack);
        setCards(allCards);
        setTags(allTags);
        setTemplates(nextTemplates);
        setSessionTemplates(activeTemplates);
        setQueue(nextQueue);
        setManualRest(rest);
        setIndex(0);
        setRevealed(config.mode === "sort");
        setLearningCounts(counts);
        setRelatedContext(contextRows);
        setEvents(history);
        setLegacyId(legacyTemplateId(nextTemplates, setup.defaultTemplateId));
        setResults([]);
        setRoundStart(0);
        document.title = `${relatedReview ? "Related" : config.mode === "sort" ? "Sort" : "Review"} · ${nextPack.title} · Heuresis`;
      } catch (openError) {
        setEmptySelection(openError instanceof EmptySelection);
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
    const paths = blocks.filter((block): block is WorkspaceImageBlock => block.type === "image").map((block) => block.path);
    let alive = true;
    if (!paths.length) {
      setSignedImages({});
      return;
    }
    void signHeuresisCardImages(paths)
      .then((urls) => { if (alive) setSignedImages(urls); })
      .catch(() => { if (alive) setSignedImages({}); });
    return () => { alive = false; };
  }, [card?.id, card?.updated_at]);

  // An audio-first question is spoken on each new card. Keep the user's Listen
  // choice between cards; never pronounce a hidden answer.
  useEffect(() => {
    if (!audioPrompt) { lastAutoAudioRef.current = ""; return; }
    if (mode !== "review" || revealed || !card || !pack || !template) return;
    const front = template.front.length ? template.front : [fieldByRole(pack.cardType, "term")?.key].filter((key): key is string => Boolean(key));
    const readingKey = fieldByRole(pack.cardType, "reading")?.key;
    const spoken = reviewSpokenPrompt(front, card.data, readingKey);
    if (!spoken) return;
    const marker = `${card.id}:${template.id}:${index}`;
    if (lastAutoAudioRef.current === marker) return;
    const termKey = fieldByRole(pack.cardType, "term")?.key;
    const meaningKey = fieldByRole(pack.cardType, "meaning")?.key;
    const role: ReviewSpeechRole = spoken.key === termKey ? "term" : spoken.key === meaningKey ? "meaning" : "other";
    if (speakReviewText(spoken.text, reviewSpeechLanguage(spoken.text, pack.title + " " + template.name, pack.cardType?.name ?? "", role))) {
      lastAutoAudioRef.current = marker;
      void markLearning(["hear"]);
    }
  }, [audioPrompt, mode, revealed, card?.id, pack?.id, template?.id, index]);

  // Keep both Review side panels visible as the session progresses; only legacy Sort uses the pinned drawer.
  useEffect(() => {
    if (mode === "sort" && !detailsPinned) setDetailsOpen(false);
    setWhyOpen(false);
    setAddingDim(null);
    setAddingText("");
    setRelatedTerm("");
    setRelatedReading("");
    setRelatedMeaning("");
    setRelationType("related");
    setNotice("");
    setTyped("");
    setSuggestion(null);
  }, [index, queue]);

  const unsavedDraft = Boolean(addingDim && (addingText.trim() || relatedTerm.trim() || relatedReading.trim() || relatedMeaning.trim()));

  async function saveTextBlock(dimension: DimensionId) {
    if (!card || !addingText.trim() || busy) return;
    setBusy(true); setNotice("");
    try {
      const next: WorkspaceBlock[] = [...blocks, { id: crypto.randomUUID(), type: "text", text: addingText.trim(), dim: dimension }];
      const data = await patchCardData(card.id, { [WORKSPACE_BLOCKS_KEY]: serialiseBlocks(next) });
      patchLocalCard(card.id, (entry) => ({ ...entry, data, updated_at: new Date().toISOString() }));
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
      patchLocalCard(card.id, (entry) => ({ ...entry, data, updated_at: new Date().toISOString() }));
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
      setRelatedRows((current) => current.filter((entry) => entry.relation_id !== row.relation_id));
    } catch (removeError) {
      setNotice(removeError instanceof Error ? removeError.message : "Could not remove this relation.");
    } finally { setBusy(false); }
  }

  async function markLearning(actions: LearningAction[]) {
    if (!card || !pack || !sessionRef.current) return;
    const cardId = card.id;
    const alreadySelected = new Set(selectedActions[cardId] ?? []);
    const pending = Array.from(new Set(actions)).filter((action) => !alreadySelected.has(action) && !learningInFlightRef.current.has(cardId + ":" + action));
    if (!pending.length) return;
    for (const action of pending) learningInFlightRef.current.add(cardId + ":" + action);
    try {
      for (const action of pending) {
        const result = await toggleLearningAction({ cardId, packId: pack.id, sessionId: sessionRef.current, action });
        setSelectedActions((current) => {
          const previous = current[cardId] ?? [];
          const next = result.selected ? (previous.includes(action) ? previous : [...previous, action]) : previous.filter((entry) => entry !== action);
          return { ...current, [cardId]: next };
        });
        setLearningCounts((current) => ({
          ...current,
          [cardId]: { ...(current[cardId] ?? EMPTY_LEARNING_COUNTS), [action]: result.count },
        }));
      }
    } catch (actionError) {
      setNotice(actionError instanceof Error ? actionError.message : "Could not save the practice action.");
    } finally {
      for (const action of pending) learningInFlightRef.current.delete(cardId + ":" + action);
    }
  }

  /** Values the typed answer is compared with: this direction's answer fields. */
  function answerValues(): ExpectedAnswer[] {
    if (!card) return [];
    const type = pack?.cardType;
    const keys = template?.back.length ? template.back : [fieldByRole(type, "meaning")?.key ?? type?.field_schema[1]?.key].filter((key): key is string => Boolean(key));
    // The meaning of a word is a gloss (it may list alternatives with commas); terms,
    // readings and the translation of a sentence are compared as written.
    const termKey = fieldByRole(type, "term")?.key ?? type?.field_schema[0]?.key;
    const wordCard = isWordSized(fieldText(card.data, termKey));
    const meaningKey = fieldByRole(type, "meaning")?.key;
    return keys.map((key) => ({
      value: fieldText(card.data, key),
      kind: (wordCard && key === meaningKey ? "gloss" : "exact") as AnswerKind,
    })).filter((entry) => entry.value);
  }

  async function reveal() {
    if (!card || !pack || !template || !sessionRef.current || revealed || busy) return;
    setBusy(true); setNotice("");
    try {
      await recordStudyEvent({ cardId: card.id, packId: pack.id, sessionId: sessionRef.current, templateId: template.id, eventType: "revealed" });
      if (method === "type" && typed.trim()) {
        const values = answerValues();
        const suggested = suggestResult(typed, values);
        const chineseExpected = values.some((entry) => /\p{Script=Han}/u.test(typeof entry === "string" ? entry : entry.value));
        if (suggested?.grade === "good" && chineseExpected && templateDirection(pack, template) === "production" && !/\p{Script=Han}/u.test(typed)) {
          setSuggestion({ ...suggested, grade: "hard", reason: "Reading matches, but the Chinese characters were not entered." });
        } else setSuggestion(suggested);
      }
      setRevealed(true);
      // Record observed practice, not merely the selected input mode.
      if ((method === "handwrite" && hasWriting) || (method === "say" && saidAnswer) || (method === "type" && typed.trim())) void markLearning([method]);
    } catch (revealError) {
      setNotice(revealError instanceof Error ? revealError.message : "Could not record reveal.");
    } finally { setBusy(false); }
  }

  /** Records the next step's encounter (as Review always has) and moves on. */
  async function advance(nextQueue: QueueItem[], nextIndex: number) {
    if (!pack || !sessionRef.current) return;
    const nextItem = nextQueue[nextIndex];
    if (nextItem) {
      await recordStudyEvent({ cardId: nextItem.cardId, packId: pack.id, sessionId: sessionRef.current, templateId: nextItem.templateId, eventType: "encountered" });
    }
    setIndex(nextIndex);
    setRevealed(false);
    setTyped(""); setSuggestion(null); setHasWriting(false); setSaidAnswer(false); setPracticeOpen(false); setConnectionsOpen(false);
    stopReviewAudio();
  }

  async function answer(grade: StudyGrade) {
    if (!card || !pack || !template || !item || !sessionRef.current || !revealed || busy || unsavedDraft) return;
    setBusy(true); setNotice("");
    try {
      await recordStudyEvent({ cardId: card.id, packId: pack.id, sessionId: sessionRef.current, templateId: template.id, eventType: grade });
      const stateBefore = item.state ?? (events ? assessState(directionEvidence(card, template.id, events, { includeUnattributed: template.id === legacyId })).state : null);
      setResults((current) => [...current, { cardId: card.id, templateId: template.id, grade, stateBefore }]);
      // Local evidence, so "10 more" and the summary see this answer at once.
      setEvents((current) => current ? [...current, { cardId: card.id, templateId: template.id, grade, at: Date.now() }] : current);
      await advance(queue, index + 1);
    } catch (answerError) {
      setNotice(answerError instanceof Error ? answerError.message : "Could not save the result.");
    } finally { setBusy(false); }
  }

  const roundResults = results.slice(roundStart);
  const retryableThisRound = Array.from(new Map(roundResults.filter((entry) => entry.grade === "again" || entry.grade === "hard").map((entry) => [candidateKey(entry.cardId, entry.templateId ?? ""), entry])).values());

  async function retryMissed() {
    if (!pack || !retryableThisRound.length || busy || mode !== "review") return;
    setBusy(true); setNotice("");
    try {
      // Same session: practice marks already made for a card stay (the practice RPC toggles
      // per session and card, so marking again would remove them). Both directions of one
      // card are kept apart, and never right after the card just answered.
      const lastCard = results[results.length - 1]?.cardId;
      const nextQueue = spaceSameCards(retryableThisRound.map((entry) => ({ cardId: entry.cardId, templateId: entry.templateId, reasons: ["Missed or partial earlier in this session."], state: "needs-work" as KnowledgeState })), lastCard ? [lastCard] : []);
      setQueue(nextQueue);
      setRoundStart(results.length);
      await advance(nextQueue, 0);
    } catch (retryError) {
      setNotice(retryError instanceof Error ? retryError.message : "Could not start the retry.");
    } finally { setBusy(false); }
  }

  /** Ten more cards: the next recommendations (never this session's cards), or the next in the chosen order. */
  function moreItems(): QueueItem[] {
    if (recommended) {
      const exclude = new Set(results.map((entry) => candidateKey(entry.cardId, entry.templateId ?? "")));
      const directions = sessionTemplates.map((entry) => ({ templateId: entry.id, label: entry.name, front: entry.front, legacy: entry.id === legacyId }));
      const lastCard = results[results.length - 1]?.cardId;
      return recommendSession({ cards: cards.filter(cardHasCompletedSort), directions, events, size: MORE_SIZE, exclude, recent: lastCard ? [lastCard] : [] })
        .map((rec) => ({ cardId: rec.cardId, templateId: rec.templateId, reasons: rec.reasons, state: rec.state }));
    }
    return manualRest.slice(0, MORE_SIZE);
  }
  // Scored only at the end of a round: scoring every card on every keystroke would be wasteful.
  const moreQueue = useMemo(() => done && mode === "review" && !relatedReview ? moreItems() : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [done, results.length, manualRest, events, cards, mode, relatedReview, legacyId]);
  const moreAvailable = moreQueue.length > 0;

  async function continueWithMore() {
    if (!pack || busy) return;
    const next = moreQueue;
    if (!next.length) return;
    setBusy(true); setNotice("");
    try {
      setQueue(next);
      if (!recommended) setManualRest((current) => current.slice(next.length));
      setRoundStart(results.length);
      await advance(next, 0);
    } catch (moreError) {
      setNotice(moreError instanceof Error ? moreError.message : "Could not continue.");
    } finally { setBusy(false); }
  }

  async function setInterest(rank: number | null) {
    if (!card || busy) return;
    const previous = card.interest_rank;
    patchLocalCard(card.id, (entry) => ({ ...entry, interest_rank: rank, interesting: Boolean(rank && rank >= 4) }));
    setBusy(true); setNotice("");
    try { await setSortInterest(card.id, rank); }
    catch (saveError) {
      patchLocalCard(card.id, (entry) => ({ ...entry, interest_rank: previous, interesting: Boolean(previous && previous >= 4) }));
      setNotice(saveError instanceof Error ? saveError.message : "Could not save interest.");
    } finally { setBusy(false); }
  }

  async function toggleBadge(tag: HeuresisTag) {
    if (!card || busy) return;
    const badgeIds = new Set(card.tags.filter((entry) => entry.is_badge).map((entry) => entry.id));
    if (badgeIds.has(tag.id)) badgeIds.delete(tag.id); else badgeIds.add(tag.id);
    const preserved = card.tags.filter((entry) => !entry.is_badge);
    const selected = tags.filter((entry) => entry.is_badge && badgeIds.has(entry.id));
    const nextTags = [...preserved, ...selected];
    const previous = card.tags;
    patchLocalCard(card.id, (entry) => ({ ...entry, tags: nextTags }));
    setBusy(true); setNotice("");
    try { await setSortTags(card.id, nextTags.map((entry) => entry.id)); }
    catch (saveError) {
      patchLocalCard(card.id, (entry) => ({ ...entry, tags: previous }));
      setNotice(saveError instanceof Error ? saveError.message : "Could not save badges.");
    } finally { setBusy(false); }
  }

  async function nextSort() {
    if (!card || busy || unsavedDraft) return;
    setBusy(true); setNotice("");
    try {
      const data = await markCardSorted(card);
      patchLocalCard(card.id, (entry) => ({ ...entry, data, updated_at: new Date().toISOString() }));
      setIndex((value) => value + 1);
    } catch (saveError) {
      setNotice(saveError instanceof Error ? saveError.message : "Could not mark this card as sorted.");
    } finally { setBusy(false); }
  }

  function skipSort() {
    if (busy || unsavedDraft) return;
    setIndex((value) => value + 1);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target?.matches("input,textarea,select,[contenteditable=true]"));
      if (event.key === "Escape" && !typing) {
        event.preventDefault();
        if (whyOpen) { setWhyOpen(false); return; }
        if (mode === "sort" && detailsOpen && !detailsPinned) { setDetailsOpen(false); return; }
        void closeSession().then(() => closeDesktopWindow());
        return;
      }
      if (typing || !card || busy || done) return;
      if (mode === "review") {
        if (!revealed && (event.key === " " || event.key === "Enter")) { event.preventDefault(); void reveal(); return; }
        const grades: Record<string, StudyGrade> = { "1": "again", "2": "hard", "3": "good", "4": "easy" };
        const grade = grades[event.key];
        if (revealed && grade) { event.preventDefault(); void answer(grade); return; }
        if (revealed && event.key === "Enter" && suggestion) { event.preventDefault(); void answer(suggestion.grade); return; }
        if (event.key.toLowerCase() === "d") { event.preventDefault(); setDetailsOpen((value) => !value); }
        if (event.key.toLowerCase() === "e") { event.preventDefault(); setLeftContextOpen((value) => !value); }
      } else {
        if (/^[1-5]$/.test(event.key)) { event.preventDefault(); void setInterest(Number(event.key)); }
        else if (event.key === "ArrowRight" || event.key === "Enter") { event.preventDefault(); void nextSort(); }
        else if (event.key.toLowerCase() === "s") { event.preventDefault(); skipSort(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------------------------------------------------------------------------
  // Summary in words
  // ---------------------------------------------------------------------------
  const summary = useMemo(() => {
    if (!done || !pack || !results.length) return null;
    // The session's results are the first answer for each card and direction; a retry
    // of a missed card is reported separately instead of counting it twice.
    const firstKeys = new Set<string>();
    const first: SessionResult[] = [];
    const retries: SessionResult[] = [];
    for (const entry of results) {
      const key = candidateKey(entry.cardId, entry.templateId ?? "");
      if (firstKeys.has(key)) retries.push(entry);
      else { firstKeys.add(key); first.push(entry); }
    }
    const count = (grade: StudyGrade) => first.filter((entry) => entry.grade === grade).length;
    const successes = first.filter((entry) => isSuccess(entry.grade)).length;
    const lines: string[] = [];
    lines.push(`You reviewed ${plural(first.length, "card")}: ${successes} recalled or secure, ${count("hard")} partial, ${count("again")} missed.`);
    if (retries.length) {
      const lastRetry = new Map<string, SessionResult>();
      for (const entry of retries) lastRetry.set(candidateKey(entry.cardId, entry.templateId ?? ""), entry);
      const recovered = Array.from(lastRetry.values()).filter((entry) => isSuccess(entry.grade)).length;
      lines.push(`On retry, ${recovered} of ${lastRetry.size} ${lastRetry.size === 1 ? "was" : "were"} recalled.`);
    }

    const byKind = { recognition: { total: 0, ok: 0, name: "" }, production: { total: 0, ok: 0, name: "" } };
    for (const entry of first) {
      const entryTemplate = templates.find((candidate) => candidate.id === entry.templateId);
      if (!entryTemplate) continue;
      const kind = templateDirection(pack, entryTemplate);
      if (kind === "other") continue;
      byKind[kind].total += 1;
      byKind[kind].name = entryTemplate.name;
      if (isSuccess(entry.grade)) byKind[kind].ok += 1;
    }
    const rec = byKind.recognition; const pro = byKind.production;
    if (rec.total && pro.total) {
      const recRate = rec.ok / rec.total; const proRate = pro.ok / pro.total;
      const detail = `${rec.ok} of ${rec.total} recognising (${rec.name}), ${pro.ok} of ${pro.total} producing (${pro.name})`;
      if (recRate - proRate >= 0.15) lines.push(`Recognition went better than production: ${detail}. Producing the word is the part to practise.`);
      else if (proRate - recRate >= 0.15) lines.push(`Production went better than recognition: ${detail}.`);
      else lines.push(`Recognition and production were about even: ${detail}.`);
    } else if (pro.total && !rec.total) lines.push(`This was production practice (${pro.name}): ${pro.ok} of ${pro.total} recalled.`);

    const termKey = (fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null)?.key;
    const missedTerms = Array.from(new Set(first.filter((entry) => entry.grade === "again")
      .map((entry) => fieldText(cards.find((candidate) => candidate.id === entry.cardId)?.data ?? {}, termKey)).filter(Boolean)));
    if (missedTerms.length) lines.push(`Missed: ${missedTerms.slice(0, 6).join(", ")}${missedTerms.length > 6 ? ` and ${missedTerms.length - 6} more` : ""}.`);

    // Evidence-based movement: states before this session against states with today's answers.
    if (events) {
      let improved = 0; let lowered = 0; let firstEvidence = 0;
      const seen = new Set<string>();
      for (const entry of first) {
        const key = candidateKey(entry.cardId, entry.templateId ?? "");
        if (seen.has(key) || !entry.stateBefore) continue;
        seen.add(key);
        const target = cards.find((candidate) => candidate.id === entry.cardId);
        if (!target) continue;
        const after = assessState(directionEvidence(target, entry.templateId, events, { includeUnattributed: entry.templateId === legacyId })).state;
        const before = STATE_PROGRESSION.indexOf(entry.stateBefore);
        const now = STATE_PROGRESSION.indexOf(after);
        if (entry.stateBefore === "not-tried") firstEvidence += 1;
        else if (now > before) improved += 1;
        else if (now < before) lowered += 1;
      }
      const parts = [improved ? `${plural(improved, "card")} moved up a state` : "", lowered ? `${lowered} moved down` : "", firstEvidence ? `${plural(firstEvidence, "card")} tried for the first time` : ""].filter(Boolean);
      if (parts.length) lines.push(`${parts.join(", ")}. Successes on the same day count once towards Holding and Strong.`);
    }
    return lines;
  }, [cards, done, events, legacyId, pack, results, templates]);

  if (loading) return <div className="cosmos-state">Opening Heuresis…</div>;
  if (error || !pack) return <div className={`cosmos-state ${emptySelection ? "done" : "error"}`}><strong>{emptySelection ? (relatedReview ? "No related words to review." : mode === "sort" ? "Nothing to sort here." : "Nothing to review here.") : "Heuresis could not open."}</strong><p>{error || "Missing topic data."}</p><button onClick={() => void closeDesktopWindow()}>Close</button></div>;
  if (done || !card) {
    if (mode === "review") {
      return <div className="cosmos-state done cosmos-summary">
        <strong>{relatedReview ? "Related review complete." : "Session complete."}</strong>
        {summary ? <div className="cosmos-summary-lines">{summary.map((line) => <p key={line}>{line}</p>)}</div> : <p>No cards were answered.</p>}
        <div className="cosmos-summary-actions">
          {retryableThisRound.length ? <button className="primary" disabled={busy} onClick={() => void retryMissed()}>{busy ? "Opening…" : `Retry ${plural(retryableThisRound.length, "missed or partial card")}`}</button> : null}
          {moreAvailable ? <button className={retryableThisRound.length ? "" : "primary"} disabled={busy} onClick={() => void continueWithMore()}>{MORE_SIZE} more</button> : null}
          <button disabled={busy} onClick={() => void closeSession().then(() => closeDesktopWindow())}>Done</button>
        </div>
      </div>;
    }
    return <div className="cosmos-state done"><strong>Sort pass complete.</strong><p>{queue.length} {queue.length === 1 ? "card" : "cards"} in this session.</p><button onClick={() => void closeSession().then(() => closeDesktopWindow())}>Return to Heuresis</button></div>;
  }

  const type = pack.cardType;
  const term = fieldByRole(type, "term") ?? type?.field_schema[0] ?? null;
  const reading = fieldByRole(type, "reading");
  const meaning = fieldByRole(type, "meaning") ?? type?.field_schema[1] ?? null;
  const frontKeys = mode === "review" ? (template?.front ?? []) : [];
  const backKeys = mode === "review" ? (template?.back ?? []) : [];
  const detailKeys = mode === "review" ? (template?.details ?? []) : [];
  const activeLearning = new Set(selectedActions[card.id] ?? []);
  const badges = tags.filter((tag) => tag.is_badge).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const context = relatedReview ? relatedContext.find((row) => row.target_card_id === card.id) ?? null : null;
  const currentState = mode === "review" && !relatedReview && template ? assessState(directionEvidence(card, template.id, events, { includeUnattributed: template.id === legacyId })).state : null;

  const fieldEntriesFor = (dimension: DimensionId) => (type?.field_schema ?? []).flatMap((field) => {
    if (fieldDimension(field) !== dimension) return [];
    const value = fieldText(card.data, field.key);
    return value ? [{ key: field.key, label: field.label, value }] : [];
  });
  const blocksFor = (dimension: DimensionId) => blocks.filter((block) => block.dim === dimension);
  const countFor = (dimension: DimensionId) => fieldEntriesFor(dimension).length + blocksFor(dimension).length + (dimension === "neighbours" && structuredWords ? relatedRows.length : 0) + (dimension === "notes" && card.note?.trim() ? 1 : 0);
  const detailsTotal = dimensions.reduce((sum, dimension) => sum + countFor(dimension.id), 0);
  const detailsAvailable = mode === "sort" || revealed;

  const renderAddForm = (dimensionId: DimensionId, def: DimensionDef) => {
    const showRelated = dimensionId === "neighbours" && structuredWords && !relatedReview;
    if (addingDim !== dimensionId) return <button className="cosmos-add" onClick={() => { if (unsavedDraft) { setNotice("Save or cancel what you are adding first."); return; } setAddingDim(dimensionId); }}><Plus size={13} /> Add to {def.label}</button>;
    return showRelated
      ? <div className="cosmos-word-editor"><input autoFocus placeholder="Word or expression" value={relatedTerm} onChange={(event) => setRelatedTerm(event.target.value)} /><input placeholder="Reading / pinyin" value={relatedReading} onChange={(event) => setRelatedReading(event.target.value)} /><textarea placeholder="Meaning" rows={3} value={relatedMeaning} onChange={(event) => setRelatedMeaning(event.target.value)} /><div className="cosmos-relation-types">{RELATION_TYPES.map((value) => <button key={value} className={relationType === value ? "selected" : ""} onClick={() => setRelationType(value)}>{relationLabel(value)}</button>)}</div><div className="cosmos-editor-actions"><button onClick={() => { setAddingDim(null); setRelatedTerm(""); setRelatedReading(""); setRelatedMeaning(""); }}>Cancel</button><button className="primary" disabled={busy} onClick={() => void saveRelated()}>Save</button></div></div>
      : <div className="cosmos-add-editor"><textarea autoFocus rows={4} value={addingText} onChange={(event) => setAddingText(event.target.value)} placeholder={`Add to ${def.label}`} /><div><button onClick={() => { setAddingDim(null); setAddingText(""); }}>Cancel</button><button className="primary" disabled={busy || !addingText.trim()} onClick={() => void saveTextBlock(dimensionId)}>Save</button></div></div>;
  };

  const renderDimension = (def: DimensionDef) => {
    const dimensionId = def.id;
    const entries = fieldEntriesFor(dimensionId);
    const dimensionBlocks = blocksFor(dimensionId);
    const showRelated = dimensionId === "neighbours" && structuredWords && !relatedReview;
    return <section className="cosmos-details-section" key={dimensionId} aria-label={def.label}>
      <header><h3>{def.label}</h3><span>{def.sub}</span><b>{countFor(dimensionId) || ""}</b></header>
      {dimensionId === "notes" && card.note?.trim() ? <article className="cosmos-field"><small>Card note</small><p>{card.note}</p></article> : null}
      {entries.map((entry) => <article className="cosmos-field" key={entry.key}><small>{entry.label}</small><p>{entry.value}</p></article>)}
      {showRelated ? relatedRows.map((row) => <article className="cosmos-related" key={row.relation_id}><div><strong>{row.term}</strong>{row.reading ? <em>{row.reading}</em> : null}</div><span className={`relation-${row.relation_type}`}>{relationLabel(row.relation_type)}</span>{row.meaning ? <p>{row.meaning}</p> : null}<button title="Remove relation" onClick={() => void removeRelation(row)}><X size={11} /></button></article>) : null}
      {dimensionBlocks.map((block) => block.type === "text"
        ? <article className="cosmos-text-block" key={block.id}><p>{block.text}</p><button title="Remove" onClick={() => void removeTextBlock(block.id)}><X size={11} /></button></article>
        : <figure className="cosmos-image-block" key={block.id}>
            {signedImages[block.path] ? <img src={signedImages[block.path]} alt={block.caption || "Card reference"} /> : <div className="cosmos-image-loading">Loading image…</div>}
            {block.caption ? <figcaption>{block.caption}</figcaption> : null}
          </figure>)}
      {renderAddForm(dimensionId, def)}
    </section>;
  };

  // Review uses both sides of the card again. Keep the material hidden until reveal,
  // but keep the panel shells visible so the layout never jumps between questions.
  const renderDetails = (side: "left" | "right" = "right") => {
    const split = mode === "review";
    const open = side === "left" ? leftContextOpen : detailsOpen;
    if (!open || (split && !revealed) || (!split && !detailsAvailable)) return null;
    const chosen = split
      ? dimensions.filter((def) => side === "left"
        ? ["examples", "neighbours", "components", "structure"].includes(def.id)
        : ["origin", "facts", "notes"].includes(def.id))
      : dimensions;
    const filled = chosen.filter((def) => countFor(def.id) > 0 || addingDim === def.id);
    const empty = chosen.filter((def) => countFor(def.id) === 0 && addingDim !== def.id);
    return <aside className={`cosmos-details cosmos-details-${side}`} aria-label={split ? (side === "left" ? "Examples and connections" : "Facts and notes") : "Card details"}>
      <header className="cosmos-details-head">
        <strong>{!split ? "Details" : side === "left" ? "Examples & connections" : "Facts & notes"}</strong>
        {!split ? <button type="button" aria-pressed={detailsPinned} title={detailsPinned ? "Stays open for every card" : "Keep open for every card"}
          onClick={() => { const next = !detailsPinned; setDetailsPinned(next); try { localStorage.setItem(DETAILS_PIN_KEY, next ? "1" : "0"); } catch { /* preference only */ } }}><Pin size={14} fill={detailsPinned ? "currentColor" : "none"} /></button> : null}
        <button type="button" aria-label={side === "left" ? "Close examples and connections" : "Close facts and notes"}
          onClick={() => { if (side === "left") setLeftContextOpen(false); else setDetailsOpen(false); }}><PanelRightClose size={15} /></button>
      </header>
      <div className="cosmos-details-body">
        {split && !revealed
          ? <div className="cosmos-context-wait"><strong>After the answer</strong><p>Your examples, connections and notes appear here once you reveal the card.</p></div>
          : <>
            {filled.map(renderDimension)}
            {!filled.length ? <p className="cosmos-empty">Nothing recorded yet. Add what helps you remember this card.</p> : null}
            {empty.length ? <div className="cosmos-details-empty"><span>Add</span>{empty.map((def) => <button key={def.id} type="button" onClick={() => { if (unsavedDraft) { setNotice("Save or cancel what you are adding first."); return; } setAddingDim(def.id); }}><Plus size={11} /> {def.label}</button>)}</div> : null}
          </>}
      </div>
    </aside>;
  };


  async function saveSentenceExample(text: string) {
    if (!card) return;
    try {
      const next: WorkspaceBlock[] = [...parseBlocks(card), { id: crypto.randomUUID(), type: "text", dim: "examples", text }];
      const data = await patchCardData(card.id, { [WORKSPACE_BLOCKS_KEY]: serialiseBlocks(next) });
      patchLocalCard(card.id, (current) => ({ ...current, data }));
      await markLearning(["sentence"]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save this example."); throw error; }
  }

  function playAudio(text: string, fieldKey?: string) {
    if (!pack) return;
    const spokenRole: ReviewSpeechRole = fieldKey === term?.key ? "term" : fieldKey === meaning?.key ? "meaning" : "other";
    const locale = reviewSpeechLanguage(text, pack.title + " " + (template?.name ?? ""), pack.cardType?.name ?? "", spokenRole);
    if (!speakReviewText(text, locale)) { setNotice("Audio playback is not available on this device."); return; }
    void markLearning(["hear"]);
  }

  const renderReviewCore = () => {
    const configuredPromptKeys = frontKeys.length ? frontKeys : [term?.key, reading?.key].filter(Boolean) as string[];
    const chineseRecognition = template && pack && templateDirection(pack, template) === "recognition"
      && /\p{Script=Han}/u.test(fieldText(card.data, term?.key));
    // A Chinese character-recognition prompt must not leak its pronunciation.
    const promptKeys = chineseRecognition ? configuredPromptKeys.filter((key) => key !== reading?.key) : configuredPromptKeys;
    const recap = revealed ? [...promptKeys, ...(chineseRecognition && reading?.key ? [reading.key] : [])]
      .filter((key) => fieldText(card.data, key)) : [];
    const keys = revealed ? [...new Set([...backKeys, ...detailKeys])] : promptKeys;
    const fallbackKeys = revealed ? [meaning?.key].filter(Boolean) as string[] : [term?.key, reading?.key].filter(Boolean) as string[];
    const used = (keys.length ? keys : fallbackKeys).filter((key) => !revealed || !recap.includes(key));
    const spokenPrompt = reviewSpokenPrompt(promptKeys, card.data, reading?.key);
    const canListen = Boolean(spokenPrompt);
    const chineseTerm = fieldText(card.data, term?.key);
    const expected = answerValues().map((item) => typeof item === "string" ? item : item.value);
    const enteredHan = /\p{Script=Han}/u.test(typed);
    const comparison = suggestion?.matched ?? (
      enteredHan ? expected.find((value) => /\p{Script=Han}/u.test(value))
        : expected.find((value) => !/\p{Script=Han}/u.test(value))
    ) ?? expected[0] ?? "";
    const difference = typed.trim() && comparison ? mistakeDifference(typed.trim(), comparison) : null;

    const renderField = (key: string, position: number, recapField: boolean) => {
      const value = fieldText(card.data, key);
      if (!value) return null;
      const field = type?.field_schema.find((entry) => entry.key === key);
      const rule = !recapField && !recap.length && position > 0 && field?.role === "meaning";
      return <div className={`cosmos-core-field role-${field?.role ?? "extra"}${recapField ? " is-recap" : ""}`} key={`${recapField ? "q" : "a"}-${key}`}>{rule ? <i className="cosmos-rule" /> : null}<span>{value}</span></div>;
    };

    return <div className={revealed ? "cosmos-card-copy revealed" : "cosmos-card-copy"}>
      {!revealed && audioPrompt && canListen ? <div className="cosmos-audio-question">
        <strong>Listening question</strong><p>Listen first; the written prompt appears after reveal.</p>
        <button type="button" onClick={() => spokenPrompt && playAudio(spokenPrompt.text, spokenPrompt.key)} aria-label="Play question">▶ Play / replay</button>
      </div> : <>
        {recap.map((key, position) => renderField(key, position, true))}
        {recap.length && used.some((key) => fieldText(card.data, key)) ? <i className="cosmos-rule cosmos-answer-rule" aria-hidden="true" /> : null}
        {used.map((key, position) => renderField(key, position, false))}
      </>}
      {revealed && chineseTerm ? <button type="button" className="cosmos-audio-answer" onClick={() => playAudio(chineseTerm, term?.key)}>▶ Hear term</button> : null}
      {revealed && context ? <div className="cosmos-related-context"><small>From</small><span>{context.source_term || "source card"}{context.source_reading ? ` · ${context.source_reading}` : ""} · {relationLabel(context.relation_type)}</span></div> : null}
      {!revealed ? <div className="cosmos-recall-methods" role="group" aria-label="Answer by">
        <span>Answer by</span>
        {([["think","Think"],["type","Type"],["handwrite","Write"],["say","Say"]] as const).map(([value,label]) =>
          <button key={value} type="button" aria-pressed={method === value} onClick={() => setMethod(value)}>{label}</button>)}
        {canListen ? <button type="button" className="cosmos-audio-switch" aria-pressed={audioPrompt} onClick={() => setAudioPrompt((value) => {
          try { localStorage.setItem("heuresis.review.audioPrompt.v1", value ? "0" : "1"); } catch { /* preference only */ }
          return !value;
        })}>♪ Listen</button> : null}
      </div> : null}
      {!revealed && method === "type" ? <textarea autoFocus className="cosmos-inline-typing" value={typed} onChange={(event) => setTyped(event.target.value)}
        placeholder="Type your answer here…" aria-label="Your typed answer" rows={2}
        onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) { event.preventDefault(); void reveal(); } }} /> : null}
      {!revealed && method === "say" ? <label className="cosmos-say-check"><input type="checkbox" checked={saidAnswer} onChange={(event) => setSaidAnswer(event.target.checked)} /> I said the answer aloud</label> : null}
      {method === "handwrite" ? <div className={revealed ? "cosmos-handwrite-compare" : "cosmos-handwrite-entry"}>
        <ReviewAnswerPad key={`${card.id}:${template?.id ?? ""}:${index}`} revealed={revealed} onHasWritingChange={setHasWriting} />
        {revealed ? <div className="cosmos-handwrite-reference"><strong>Answer</strong><div>{backKeys.map((key) => fieldText(card.data,key)).filter(Boolean).join(" · ") || fieldText(card.data,meaning?.key)}</div></div> : null}
      </div> : null}
      {revealed && method === "type" && typed.trim() && difference ? <div className="cosmos-typed-compare">
        <div><strong>Yours</strong><p>{difference.before.map((part,i) => <mark key={i} data-kind={part.kind}>{part.text}</mark>)}</p></div>
        <div><strong>Reference answer</strong><p>{difference.after.map((part,i) => <mark key={i} data-kind={part.kind}>{part.text}</mark>)}</p></div>
        <small>Differences are visual only; valid alternatives may differ.</small>
      </div> : null}
      {!revealed ? <button className="cosmos-inline-reveal" disabled={busy} onClick={() => void reveal()}>Reveal answer <kbd>Space</kbd></button> : null}
    </div>;
  };

  const sentenceCard = !isWordSized(fieldText(card.data, term?.key));
  const sentenceRatings: Record<StudyGrade, string> = { again: "Meaning lost or incorrect", hard: "Partly right; major slips", good: "Meaning and grammar correct", easy: "Accurate and natural, immediately" };
  const directionName = template?.name ?? "";
  return <main className="cosmos-shell">
    <header className="cosmos-topbar"><div className="cosmos-title"><strong>Heuresis</strong><span>· {pack.title}</span></div>
      <div className="cosmos-modes"><span>{relatedReview ? "Related review" : mode === "sort" ? "Legacy Sort" : "Review"}</span></div>
      {mode === "review" && directionName ? <span className="cosmos-mode-note">{directionName}{currentState ? ` · ${STATE_LABEL[currentState]}` : ""}</span> : <span className="cosmos-mode-note">{mode === "sort" ? "organisation · priority · badges" : ""}</span>}
      <span className="cosmos-spacer" />
      {mode === "review" && revealed ? <div className="cosmos-panel-toggles" role="group" aria-label="Review side panels">
        <button type="button" aria-pressed={leftContextOpen} disabled={!revealed} onClick={() => setLeftContextOpen((value) => !value)} title={revealed ? "Show or hide examples and connections (E)" : "Available after reveal"}>
          {leftContextOpen ? <PanelLeftClose size={14} /> : <PanelLeftOpen size={14} />} Context</button>
        <button type="button" aria-pressed={detailsOpen} disabled={!revealed} onClick={() => setDetailsOpen((value) => !value)} title={revealed ? "Show or hide facts and notes (D)" : "Available after reveal"}>
          {detailsOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />} Notes</button>
      </div> : null}

      {item?.reasons.length ? <button type="button" className="cosmos-why" aria-expanded={whyOpen} onClick={() => setWhyOpen((value) => !value)} title="Why this card?"><CircleHelp size={15} /> Why?</button> : null}
      <span className="cosmos-count">{index + 1} / {queue.length}</span>
      <button className="cosmos-close" aria-label="Close" onClick={() => void closeSession().then(() => closeDesktopWindow())}><X size={18} /></button>
    </header>
    {whyOpen && item?.reasons.length ? <div className="cosmos-why-panel" role="dialog" aria-label="Why this card was recommended">
      <strong>Why this card</strong>
      <ul>{item.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
      <small>Recommendations weigh results in this direction, whether it has been tried, time since it was last seen, and importance (gently). Nothing is ever due.</small>
    </div> : null}
    <div className="cosmos-progress"><i style={{ width: `${Math.min(100, ((index + (revealed || mode === "sort" ? 1 : 0)) / queue.length) * 100)}%` }} /></div>
    <section className="cosmos-stage"><div className={`cosmos-work ${mode === "review" ? "cosmos-review-columns" : ""}`} data-left={leftContextOpen && revealed ? "open" : "closed"} data-right={detailsOpen && revealed ? "open" : "closed"} data-details={detailsOpen && detailsAvailable ? "open" : "closed"}>
      {mode === "review" ? renderDetails("left") : null}
      <article className="cosmos-card" data-card-id={card.id} data-template-id={template?.id ?? ""}>
        {mode === "sort" ? <button type="button" className="cosmos-details-toggle" disabled={!detailsAvailable} aria-expanded={detailsOpen && detailsAvailable}
          title={detailsAvailable ? "Examples, related words, parts, grammar, origin, facts and notes (D)" : "Available after you show the answer"}
          onClick={() => setDetailsOpen((value) => !value)}>{detailsOpen && detailsAvailable ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />} Details{detailsTotal ? <b>{detailsTotal}</b> : null}</button> : null}
        <div className="cosmos-nucleus">{mode === "review" ? renderReviewCore() : <div className="cosmos-card-copy revealed"><div className="cosmos-core-field role-term"><span>{fieldText(card.data, term?.key) || "Untitled"}</span></div>{reading ? <div className="cosmos-core-field role-reading"><span>{fieldText(card.data, reading.key)}</span></div> : null}<i className="cosmos-rule" />{meaning ? <div className="cosmos-core-field role-meaning"><span>{fieldText(card.data, meaning.key)}</span></div> : null}</div>}</div>
        {mode === "review" ? <footer className="cosmos-review-foot">{revealed ? <>
          {suggestion ? <p className="cosmos-suggestion" role="status">Suggested: <b>{RESULT_LABEL[suggestion.grade]}</b> — {suggestion.reason} You decide.</p> : null}
          {sentenceCard ? <p className="cosmos-suggestion">For sentences, judge meaning and grammar, not just exact wording.</p> : null}
          <div className="cosmos-results" role="group" aria-label="How well did you recall it?">{RESULT_ORDER.map((grade, position) => <button key={grade} disabled={busy}
            className={suggestion?.grade === grade ? "is-suggested" : ""}
            title={RESULT_HINT[grade]} onClick={() => void answer(grade)}>
            <b>{RESULT_LABEL[grade]}</b><small>{position + 1}</small><span>{sentenceCard ? sentenceRatings[grade] : RESULT_HINT[grade]}</span></button>)}</div>
          <div className="cosmos-secondary-actions"><button type="button" className="cosmos-extra-toggle" aria-expanded={practiceOpen} onClick={() => setPracticeOpen((value) => !value)}>＋ Practise more</button><button type="button" className="cosmos-extra-toggle" onClick={() => setConnectionsOpen(true)}>Connections</button></div>
          {connectionsOpen ? <ConnectionsPanel pack={pack} card={card} onClose={() => setConnectionsOpen(false)} /> : null}
          {practiceOpen ? <RetentionPractice key={card.id} card={card} pack={pack} busy={busy} selectedActions={activeLearning}
            onMark={markLearning} onSaveSentence={saveSentenceExample} onNotice={setNotice} /> : null}
        </> : <span>Attempt the answer before revealing it. {ANDROID ? "" : "Use Space to reveal; 1–4 to rate."}</span>}</footer> : <footer className="cosmos-sort-foot"><div className="cosmos-interest"><span>INTEREST</span>{[1,2,3,4,5].map((rank) => <button key={rank} aria-pressed={card.interest_rank === rank} disabled={busy} onClick={() => void setInterest(card.interest_rank === rank ? null : rank)}>{rank}</button>)}</div><div className="cosmos-badges"><span>BADGES</span>{badges.map((tag) => <button key={tag.id} aria-pressed={card.tags.some((entry) => entry.id === tag.id)} disabled={busy} onClick={() => void toggleBadge(tag)}>{tag.name}{tag.shortcut ? <small>{tag.shortcut}</small> : null}</button>)}</div><div className="cosmos-sort-actions"><button disabled={busy} onClick={skipSort}><SkipForward size={14} /> Skip <small>S</small></button><button className="primary" disabled={busy} onClick={() => void nextSort()}>Apply + next <small>→</small></button></div></footer>}
      </article>
      {mode === "review" ? renderDetails("right") : renderDetails()}
    </div>{notice ? <div className="cosmos-notice">{notice}</div> : null}</section>
  </main>;
}
