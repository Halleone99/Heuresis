import { ArrowLeft, BookOpen, Printer, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { signHeuresisCardImages } from "../lib/cardMedia";
import {
  fieldByRole,
  fieldText,
  getCard,
  listCollections,
  setCardRetention,
  type CardRetention,
  type CardWithStats,
  type Collection,
  type FieldDef,
  type PackWithType,
} from "../lib/heuresis";
import { listRelatedCatalogue, relationLabel, type RelatedCatalogueRow } from "../lib/related";
import type { CatalogueSessionItem } from "./CatalogueSession";
import "../catalogue-read-mode.css";

type Props = {
  title: string;
  items: CatalogueSessionItem[];
  packs: PackWithType[];
  onClose: () => void;
  onOpenPack: (pack: PackWithType) => void;
};

type ReadBlock = {
  id: string;
  type: "text" | "image" | "example" | "unknown";
  dim: string;
  text: string;
  translation: string;
  provenance: string;
  path: string;
  caption: string;
  raw: string;
};

type TrailStep = { id: string; fromId: string | null };
type DrawerView = "preview" | "raw";
type ReadScope = "all" | CardRetention;

const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";
const CJK = /[\u3400-\u9FFF\uF900-\uFAFF]/;
const DIMENSIONS = [
  ["components", "Parts"],
  ["neighbours", "Related"],
  ["structure", "How it behaves"],
  ["examples", "In use"],
  ["origin", "Where it comes from"],
  ["facts", "Worth knowing"],
  ["notes", "My note"],
] as const;

function scriptClass(value: string) {
  return CJK.test(value) ? "cjk" : "latin";
}

function normaliseDim(value: unknown) {
  if (value === "contrast") return "neighbours";
  return typeof value === "string" && value.trim() ? value : "notes";
}

function parseBlocks(card: CardWithStats | null | undefined): ReadBlock[] {
  const raw = card?.data[WORKSPACE_BLOCKS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.map((entry, index) => {
    try {
      const value = JSON.parse(entry) as Record<string, unknown>;
      const type = value.type === "image" ? "image" : value.type === "example" ? "example" : value.type === "text" ? "text" : "unknown";
      return {
        id: typeof value.id === "string" ? value.id : `${card?.id ?? "card"}-${index}`,
        type,
        dim: normaliseDim(value.dim),
        text: typeof value.text === "string" ? value.text : "",
        translation: typeof value.translation === "string" ? value.translation : "",
        provenance: typeof value.provenance === "string" ? value.provenance : "",
        path: typeof value.path === "string" ? value.path : "",
        caption: typeof value.caption === "string" ? value.caption : "",
        raw: entry,
      } satisfies ReadBlock;
    } catch {
      return {
        id: `${card?.id ?? "card"}-${index}`,
        type: "unknown",
        dim: "notes",
        text: entry,
        translation: "",
        provenance: "",
        path: "",
        caption: "",
        raw: entry,
      } satisfies ReadBlock;
    }
  });
}

function imagePaths(card: CardWithStats | null | undefined) {
  return parseBlocks(card).filter((block) => block.type === "image" && block.path).map((block) => block.path);
}

function monthsAgo(iso: string | null) {
  if (!iso) return "not yet";
  const days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000));
  if (days <= 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `about ${Math.round(days / 7)} weeks ago`;
  return `about ${Math.round(days / 30)} months ago`;
}

function extraFields(pack: PackWithType) {
  const term = fieldByRole(pack.cardType, "term")?.key;
  const reading = fieldByRole(pack.cardType, "reading")?.key;
  const meaning = fieldByRole(pack.cardType, "meaning")?.key;
  return (pack.cardType?.field_schema ?? []).filter((field) => field.key !== term && field.key !== reading && field.key !== meaning);
}

function fieldDimension(field: FieldDef) {
  const haystack = `${field.key} ${field.label}`.toLocaleLowerCase();
  if (field.role === "example" || field.role === "example_reading" || field.role === "example_translation") return "examples";
  if (/neighbou?r|synonym|antonym|related|similar|contrast|difference|confus|versus|\bvs\b/.test(haystack)) return "neighbours";
  if (/component|radical|character|morph|part/.test(haystack)) return "components";
  if (/etymolog|origin|history|lineage/.test(haystack)) return "origin";
  if (/structure|grammar|pattern|construction|syntax|argument|usage|collocation|register/.test(haystack)) return "structure";
  if (/fact|trivia|cultur/.test(haystack)) return "facts";
  return "notes";
}

function relationSemantic(row: RelatedCatalogueRow, currentId: string) {
  const outgoing = row.source_card_id === currentId;
  if (row.relation_type === "part_of") return outgoing ? "part of" : "contains";
  if (row.relation_type === "depends_on") return outgoing ? "depends on" : "supports";
  if (row.relation_type === "example_of") return outgoing ? "example of" : "has example";
  if (row.relation_type === "contrasts_with" || row.relation_type === "antonym") return "contrast";
  if (row.relation_type === "synonym") return "near meaning";
  return relationLabel(row.relation_type).toLocaleLowerCase();
}

function otherId(row: RelatedCatalogueRow, currentId: string) {
  return row.source_card_id === currentId ? row.target_card_id : row.source_card_id;
}

function relationCopy(row: RelatedCatalogueRow, currentId: string) {
  return row.source_card_id === currentId
    ? { term: row.term || "Untitled", reading: row.reading, meaning: row.meaning }
    : { term: row.source_term || "Untitled", reading: row.source_reading, meaning: row.source_meaning };
}

function formatCompiledDate() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export default function CatalogueReadMode({ title, items, packs, onClose, onOpenPack }: Props) {
  const [reading, setReading] = useState(false);
  const [hideStudyNotes, setHideStudyNotes] = useState(false);
  const [relations, setRelations] = useState<RelatedCatalogueRow[]>([]);
  const [relationsError, setRelationsError] = useState("");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [scope, setScope] = useState<ReadScope>("all");
  const [collectionId, setCollectionId] = useState("all");
  const [topicId, setTopicId] = useState("all");
  const [retentionById, setRetentionById] = useState<Record<string, CardRetention>>(() => Object.fromEntries(items.map(({ card }) => [card.id, card.retention])));
  const [retentionBusy, setRetentionBusy] = useState<string | null>(null);
  const [retentionError, setRetentionError] = useState("");
  const [cardCache, setCardCache] = useState<Record<string, CardWithStats>>(() => Object.fromEntries(items.map(({ card }) => [card.id, card])));
  const [signedImages, setSignedImages] = useState<Record<string, string>>({});
  const [trail, setTrail] = useState<TrailStep[]>([]);
  const [drawerView, setDrawerView] = useState<DrawerView>("preview");
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);
  const itemMap = useMemo(() => new Map(items.map((item) => [item.card.id, item])), [items]);
  const collectionMap = useMemo(() => new Map(collections.map((collection) => [collection.id, collection])), [collections]);
  const itemPackIds = useMemo(() => new Set(items.map((item) => item.pack.id)), [items]);
  const availableCollections = useMemo(() => {
    const ids = new Set(items.map((item) => item.pack.collection_id));
    return collections.filter((collection) => ids.has(collection.id));
  }, [collections, items]);
  const availablePacks = useMemo(() => packs.filter((pack) => itemPackIds.has(pack.id) && (collectionId === "all" || pack.collection_id === collectionId)), [collectionId, itemPackIds, packs]);

  function retentionFor(card: CardWithStats): CardRetention {
    return retentionById[card.id] ?? card.retention;
  }

  const visibleItems = useMemo(() => items.filter(({ card, pack }) => {
    const retention = retentionById[card.id] ?? card.retention;
    if (scope !== "all" && retention !== scope) return false;
    if (collectionId !== "all" && pack.collection_id !== collectionId) return false;
    if (topicId !== "all" && pack.id !== topicId) return false;
    return true;
  }), [collectionId, items, retentionById, scope, topicId]);
  const visibleItemMap = useMemo(() => new Map(visibleItems.map((item) => [item.card.id, item])), [visibleItems]);
  const topicCount = useMemo(() => new Set(visibleItems.map((item) => item.pack.id)).size, [visibleItems]);
  const compiledAt = useMemo(formatCompiledDate, []);
  const currentStep = trail[trail.length - 1] ?? null;
  const currentCard = currentStep ? cardCache[currentStep.id] ?? null : null;
  const currentPack = currentCard ? packMap.get(currentCard.pack_id) ?? null : null;

  useEffect(() => {
    let alive = true;
    setRelationsError("");
    void Promise.all([listRelatedCatalogue(), listCollections()])
      .then(([rows, nextCollections]) => {
        if (!alive) return;
        setRelations(rows);
        setCollections(nextCollections);
      })
      .catch((error) => { if (alive) setRelationsError(error instanceof Error ? error.message : "Connections could not be loaded."); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    setCardCache((current) => ({ ...current, ...Object.fromEntries(items.map(({ card }) => [card.id, card])) }));
    setRetentionById((current) => ({ ...Object.fromEntries(items.map(({ card }) => [card.id, card.retention])), ...current }));
    const paths = items.flatMap(({ card }) => imagePaths(card));
    void signHeuresisCardImages(paths).then((next) => setSignedImages((current) => ({ ...current, ...next }))).catch(() => undefined);
  }, [items]);

  useEffect(() => {
    if (topicId !== "all" && !availablePacks.some((pack) => pack.id === topicId)) setTopicId("all");
  }, [availablePacks, topicId]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !reading) { setProgress(0); return; }
    const update = () => {
      const max = element.scrollHeight - element.clientHeight;
      setProgress(max > 0 ? Math.min(100, Math.max(0, (element.scrollTop / max) * 100)) : 0);
    };
    update();
    element.addEventListener("scroll", update, { passive: true });
    return () => element.removeEventListener("scroll", update);
  }, [reading]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (trail.length) setTrail([]);
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, trail.length]);

  function rowsFor(cardId: string) {
    return relations.filter((row) => row.source_card_id === cardId || row.target_card_id === cardId);
  }

  async function ensureCard(id: string) {
    const cached = cardCache[id];
    if (cached) return cached;
    setDrawerLoading(true);
    try {
      const card = await getCard(id);
      if (!card) return null;
      setCardCache((current) => ({ ...current, [card.id]: card }));
      setRetentionById((current) => ({ ...current, [card.id]: card.retention }));
      const nextSigned = await signHeuresisCardImages(imagePaths(card)).catch(() => ({} as Record<string, string>));
      if (Object.keys(nextSigned).length) setSignedImages((current) => ({ ...current, ...nextSigned }));
      return card;
    } finally {
      setDrawerLoading(false);
    }
  }

  async function toggleRetention(card: CardWithStats) {
    if (!itemMap.has(card.id) || retentionBusy) return;
    const previous = retentionFor(card);
    const next: CardRetention = previous === "learning" ? "reference" : "learning";
    setRetentionBusy(card.id);
    setRetentionError("");
    setRetentionById((current) => ({ ...current, [card.id]: next }));
    setCardCache((current) => current[card.id] ? { ...current, [card.id]: { ...current[card.id], retention: next } } : current);
    try {
      await setCardRetention(card.id, next);
    } catch (error) {
      setRetentionById((current) => ({ ...current, [card.id]: previous }));
      setCardCache((current) => current[card.id] ? { ...current, [card.id]: { ...current[card.id], retention: previous } } : current);
      setRetentionError(error instanceof Error ? error.message : "Could not change review state.");
    } finally {
      setRetentionBusy(null);
    }
  }

  async function openConnection(fromId: string, row: RelatedCatalogueRow) {
    const id = otherId(row, fromId);
    await ensureCard(id);
    setDrawerView("preview");
    setTrail((current) => {
      const base = current.length ? current : [{ id: fromId, fromId: null }];
      const existing = base.findIndex((step) => step.id === id);
      return existing >= 0 ? base.slice(0, existing + 1) : [...base, { id, fromId }];
    });
  }

  function openRaw(cardId: string) {
    setDrawerView("raw");
    setTrail((current) => current.length && current[current.length - 1].id === cardId ? current : [...current, { id: cardId, fromId: null }]);
  }

  function goToDocument(cardId: string) {
    setTrail([]);
    setReading(true);
    window.setTimeout(() => document.getElementById(`read-entry-${cardId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  function beginAt(cardId?: string) {
    if (!visibleItems.length) return;
    setReading(true);
    if (cardId) window.setTimeout(() => document.getElementById(`read-entry-${cardId}`)?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  function renderConnectionGroups(cardId: string, compact = false) {
    const cardRows = rowsFor(cardId);
    if (!cardRows.length) return relationsError && !compact ? <p className="crm-relation-error">{relationsError}</p> : null;
    const outgoing = cardRows.filter((row) => row.source_card_id === cardId);
    const incoming = cardRows.filter((row) => row.target_card_id === cardId);
    const group = (label: string, rows: RelatedCatalogueRow[]) => rows.length ? <div className="crm-link-group"><p>{label}</p><ul>{rows.map((row) => {
      const copy = relationCopy(row, cardId);
      return <li key={`${cardId}-${row.relation_id}`}><button onClick={() => void openConnection(cardId, row)}><span className={scriptClass(copy.term)}>{copy.term}</span><em>· {relationSemantic(row, cardId)}</em></button>{!compact && copy.meaning ? <small>{copy.meaning}</small> : null}</li>;
    })}</ul></div> : null;
    return <>{group("Connected to", outgoing)}{group("Mentioned by", incoming)}</>;
  }

  function renderBlock(block: ReadBlock, compact = false) {
    if (block.type === "image") {
      const src = signedImages[block.path];
      return <figure className="crm-image" key={block.id}>{src ? <img src={src} alt={block.caption || "Card image"} /> : <div className="crm-image-placeholder">Image</div>}{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>;
    }
    if (block.type === "example") {
      return <div className="crm-example" key={block.id}><p className={scriptClass(block.text)}>{block.text}</p>{block.translation ? <em>{block.translation}</em> : null}{!hideStudyNotes && block.provenance ? <small>{block.provenance}</small> : null}</div>;
    }
    if (!block.text) return null;
    return <p className={compact ? "crm-compact-copy" : undefined} key={block.id}>{block.text}</p>;
  }

  function renderSections(card: CardWithStats, pack: PackWithType, compact = false) {
    const blocks = parseBlocks(card);
    const fields = extraFields(pack).flatMap((field) => {
      const value = fieldText(card.data, field.key);
      return value ? [{ field, value, dim: fieldDimension(field) }] : [];
    });
    return <>{DIMENSIONS.map(([dim, label]) => {
      const mine = blocks.filter((block) => block.dim === dim);
      const fieldRows = fields.filter((row) => row.dim === dim);
      if (!mine.length && !fieldRows.length && !(dim === "notes" && card.note)) return null;
      return <section className="crm-section" key={`${card.id}-${dim}`}><p className="crm-section-label">{label}</p>
        {fieldRows.map(({ field, value }) => <p className="crm-field-copy" key={field.key}><em>{field.label}</em><span>{value}</span></p>)}
        {dim === "notes" && card.note ? <div className="crm-own-note"><p>{card.note}</p></div> : null}
        {mine.map((block) => renderBlock(block, compact))}
      </section>;
    })}</>;
  }

  function renderRaw(card: CardWithStats, pack: PackWithType) {
    const blocks = parseBlocks(card);
    const visibleFields = pack.cardType?.field_schema ?? [];
    return <div className="crm-raw">
      <p className="crm-raw-intro">The card itself, in its own order. Read mode only reorganises this material for reading.</p>
      <div className="crm-raw-fields">{visibleFields.map((field) => {
        const value = fieldText(card.data, field.key);
        return value ? <div key={field.key}><em>{field.label}</em><span className={scriptClass(value)}>{value}</span></div> : null;
      })}</div>
      {card.note ? <section><p className="crm-section-label">Card note</p><div className="crm-own-note"><p>{card.note}</p></div></section> : null}
      {card.tags.length ? <section><p className="crm-section-label">Tags</p><p>{card.tags.map((tag) => tag.name).join(" · ")}</p></section> : null}
      {blocks.length ? <section><p className="crm-section-label">Everything you added</p><ol className="crm-raw-blocks">{blocks.map((block) => <li key={block.id}><em>{block.dim}</em>{renderBlock(block, true)}</li>)}</ol></section> : null}
    </div>;
  }

  const drawerRows = currentCard ? rowsFor(currentCard.id) : [];
  const fromRow = currentStep?.fromId ? drawerRows.find((row) => otherId(row, currentCard?.id ?? "") === currentStep.fromId) ?? relations.find((row) => {
    if (!currentCard || !currentStep.fromId) return false;
    return (row.source_card_id === currentCard.id && row.target_card_id === currentStep.fromId) || (row.target_card_id === currentCard.id && row.source_card_id === currentStep.fromId);
  }) : null;

  return <div className={`catalogue-read-mode ${reading ? "is-reading" : "is-index"} ${trail.length ? "drawer-open" : ""} ${hideStudyNotes ? "hide-study-notes" : ""}`} role="dialog" aria-modal="true" aria-label="Catalogue read mode">
    <div className="crm-progress" style={{ width: `${progress}%` }} />

    {!reading ? <div className="crm-index-scroll">
      <main className="crm-index">
        <header className="crm-index-head"><div><h1>{title}</h1><p>{visibleItems.length.toLocaleString()} entries across {topicCount.toLocaleString()} topic{topicCount === 1 ? "" : "s"}</p></div><button className="crm-read-button" disabled={!visibleItems.length} onClick={() => beginAt()}><BookOpen size={16} /> Read mode</button></header>

        <div className="crm-read-filters">
          <div className="crm-scope-tabs" aria-label="Read scope">
            <button aria-pressed={scope === "all"} onClick={() => setScope("all")}>All catalogue</button>
            <button aria-pressed={scope === "learning"} onClick={() => setScope("learning")}>In review</button>
            <button aria-pressed={scope === "reference"} onClick={() => setScope("reference")}>Reference</button>
          </div>
          {availableCollections.length > 1 ? <label><span>Collection</span><select value={collectionId} onChange={(event) => { setCollectionId(event.target.value); setTopicId("all"); }}><option value="all">All collections</option>{availableCollections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label> : null}
          {availablePacks.length > 1 ? <label><span>Topic</span><select value={topicId} onChange={(event) => setTopicId(event.target.value)}><option value="all">All topics</option>{availablePacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.title}</option>)}</select></label> : null}
        </div>
        {retentionError ? <p className="crm-retention-error">{retentionError}</p> : null}

        <div className="crm-index-rows">{visibleItems.map(({ card, pack }) => {
          const termField = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
          const meaningField = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
          const term = fieldText(card.data, termField?.key) || "Untitled";
          const meaning = fieldText(card.data, meaningField?.key);
          const retention = retentionFor(card);
          const context = topicCount > 1 ? `${collectionMap.get(pack.collection_id)?.title ? `${collectionMap.get(pack.collection_id)?.title} · ` : ""}${pack.title} · ` : "";
          return <button className="crm-index-row" key={card.id} onClick={() => beginAt(card.id)}><strong className={scriptClass(term)}>{term}</strong><span>{meaning}</span><small>{context}{retention === "learning" ? "in review" : "reference"}</small></button>;
        })}{!visibleItems.length ? <div className="crm-read-empty">Nothing in this reading set yet.</div> : null}</div>
      </main>
    </div> : <div className="crm-reading-scroll" ref={scrollRef}>
      <div className="crm-reading-controls">
        <button onClick={() => { setReading(false); setTrail([]); }}><ArrowLeft size={14} /> Index</button>
        <button onClick={() => setHideStudyNotes((value) => !value)}>{hideStudyNotes ? "Show study notes" : "Hide study notes"}</button>
        <button onClick={() => window.print()}><Printer size={14} /> Print</button>
        <button onClick={onClose}><X size={15} /> Close</button>
      </div>
      <main className="crm-sheet">
        <section className="crm-title-page"><h1>{title}</h1><p>{visibleItems.length.toLocaleString()} entries selected from {topicCount.toLocaleString()} topic{topicCount === 1 ? "" : "s"}, read as one document rather than a queue.</p><i /><small>{visibleItems.map((item) => item.pack.title).filter((value, index, all) => all.indexOf(value) === index).join(" · ")}<br />Compiled {compiledAt}</small></section>
        {visibleItems.map(({ card, pack }) => {
          const termField = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
          const readingField = fieldByRole(pack.cardType, "reading");
          const meaningField = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
          const term = fieldText(card.data, termField?.key) || "Untitled";
          const readingText = fieldText(card.data, readingField?.key);
          const meaning = fieldText(card.data, meaningField?.key);
          const retention = retentionFor(card);
          return <article className="crm-entry" id={`read-entry-${card.id}`} key={card.id}>
            <header><strong className={`crm-specimen ${scriptClass(term)}`}>{term}</strong>{readingText ? <em>{readingText}</em> : null}{meaning ? <p>{meaning}</p> : null}<div className="crm-apparatus">{retention === "reference" ? <><b>Reference.</b> Kept in the catalogue and never added to the review queue.</> : card.stats.study_count ? <><b>Held in review.</b> Met {card.stats.encounter_count.toLocaleString()} time{card.stats.encounter_count === 1 ? "" : "s"}; last {monthsAgo(card.stats.last_encountered_at)}.{card.stats.again_count ? ` ${card.stats.again_count} Again.` : ""}</> : <><b>In review.</b> This is learning material, but it has not been reviewed yet.</>}</div>{itemMap.has(card.id) ? <button className="crm-retention-toggle" disabled={retentionBusy === card.id} onClick={() => void toggleRetention(card)}>{retention === "learning" ? "Keep as reference" : "Add to review"}</button> : null}</header>
            {renderSections(card, pack)}
            {rowsFor(card.id).length || relationsError ? <section className="crm-section"><p className="crm-section-label">Connections</p>{renderConnectionGroups(card.id)}</section> : null}
            <button className="crm-source-link" onClick={() => openRaw(card.id)}>Your card</button>
          </article>;
        })}
        <p className="crm-colophon">Generated from the live Heuresis catalogue on {compiledAt}. Reference entries create no review debt; connections remain live across the catalogue.</p>
      </main>
    </div>}

    <div className="crm-index-close"><button onClick={onClose} aria-label="Close read mode"><X size={18} /></button></div>

    <div className="crm-drawer-scrim" onMouseDown={() => setTrail([])} />
    <aside className="crm-drawer" aria-hidden={!trail.length}>
      <header><nav>{trail.map((step, index) => {
        const card = cardCache[step.id];
        const pack = card ? packMap.get(card.pack_id) : null;
        const term = card && pack ? fieldText(card.data, fieldByRole(pack.cardType, "term")?.key ?? pack.cardType?.field_schema[0]?.key) || "Untitled" : "…";
        return <span key={`${step.id}-${index}`}>{index ? <i>/</i> : null}{index === trail.length - 1 ? <b className={scriptClass(term)}>{term}</b> : <button className={scriptClass(term)} onClick={() => { setTrail((current) => current.slice(0, index + 1)); setDrawerView("preview"); }}>{term}</button>}</span>;
      })}</nav><button onClick={() => setTrail([])} aria-label="Close connected entry"><X size={18} /></button></header>
      <div className="crm-drawer-body">{drawerLoading && !currentCard ? <p className="crm-drawer-state">Fetching…</p> : currentCard && currentPack ? <>
        <div className="crm-drawer-head">{(() => {
          const term = fieldText(currentCard.data, fieldByRole(currentPack.cardType, "term")?.key ?? currentPack.cardType?.field_schema[0]?.key) || "Untitled";
          const readingText = fieldText(currentCard.data, fieldByRole(currentPack.cardType, "reading")?.key);
          const meaning = fieldText(currentCard.data, fieldByRole(currentPack.cardType, "meaning")?.key ?? currentPack.cardType?.field_schema[1]?.key);
          return <><strong className={scriptClass(term)}>{term}</strong>{readingText ? <em>{readingText}</em> : null}{meaning ? <p>{meaning}</p> : null}<small>{currentPack.title} · {retentionFor(currentCard) === "learning" ? "in review" : "reference"}</small></>;
        })()}</div>
        {fromRow && currentStep?.fromId ? <p className="crm-because">Connected as <b>{relationSemantic(fromRow, currentStep.fromId)}</b>.</p> : null}
        {drawerView === "raw" ? renderRaw(currentCard, currentPack) : <>{renderSections(currentCard, currentPack, true)}{rowsFor(currentCard.id).length ? <section className="crm-drawer-section"><p className="crm-section-label">Connections</p>{renderConnectionGroups(currentCard.id, true)}</section> : null}</>}
        <footer className="crm-drawer-actions"><button onClick={() => setDrawerView((view) => view === "raw" ? "preview" : "raw")}>{drawerView === "raw" ? "Back to reading view" : "Your card"}</button>{itemMap.has(currentCard.id) ? <button disabled={retentionBusy === currentCard.id} onClick={() => void toggleRetention(currentCard)}>{retentionFor(currentCard) === "learning" ? "Keep as reference" : "Add to review"}</button> : null}{visibleItemMap.has(currentCard.id) ? <button onClick={() => goToDocument(currentCard.id)}>Open full entry</button> : null}<button onClick={() => { setTrail([]); onOpenPack(currentPack); }}>Open topic</button></footer>
      </> : <p className="crm-drawer-state">That entry is no longer available.</p>}</div>
    </aside>
  </div>;
}
