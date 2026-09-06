import { ArrowLeft, BookmarkPlus, BookOpen, Brain, Search, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, listAllCards, listTags, type CardWithStats, type Collection, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { createCatalogue, deleteCatalogue, listCatalogues, updateCatalogue, type CatalogueCriteria, type CatalogueStatus, type SavedCatalogue } from "../lib/advanced";
import { attentionScore, directionTemplates, formatSeen, isKeepMissing, isNotSeenRecently, isWeakProduction, productionPerformance, recognitionPerformance, type DirectionTemplates } from "../lib/learningSignals";
import { loadStudySetup } from "../lib/study";
import CatalogueSession, { type CatalogueSessionItem } from "./CatalogueSession";

type Item = CatalogueSessionItem;
type Props = { collections: Collection[]; packs: PackWithType[]; onBack: () => void; onOpenPack: (pack: PackWithType) => void };
type SmartPreset = "none" | "missing" | "production" | "stale";
type SortKey = "attention" | "recent" | "production" | "alphabetical";

const DEFAULT_CRITERIA: CatalogueCriteria = { collectionId: "all", packId: "all", tagIds: [], status: "all", query: "" };

function percentage(value: number | null | undefined) {
  return value == null ? null : Math.round(value * 100);
}

function statusLabel(status: CatalogueStatus) {
  return status === "new" ? "Never met" : status === "favourites" ? "Favourites" : status === "interesting" ? "High interest" : status === "again" ? "Often Again" : "";
}

export default function CatalogueView({ collections, packs, onBack, onOpenPack }: Props) {
  const [criteria, setCriteria] = useState<CatalogueCriteria>(DEFAULT_CRITERIA);
  const [smartPreset, setSmartPreset] = useState<SmartPreset>("none");
  const [sortKey, setSortKey] = useState<SortKey>("attention");
  const [items, setItems] = useState<Item[]>([]);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [saved, setSaved] = useState<SavedCatalogue[]>([]);
  const [directionsByPack, setDirectionsByPack] = useState<Record<string, DirectionTemplates>>({});
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveTitle, setSaveTitle] = useState("");
  const [sessionMode, setSessionMode] = useState<"browse" | "review" | null>(null);

  const collectionPacks = useMemo(() => criteria.collectionId === "all" ? packs : packs.filter((pack) => pack.collection_id === criteria.collectionId), [criteria.collectionId, packs]);
  const selectedPacks = useMemo(() => criteria.packId === "all" ? collectionPacks : collectionPacks.filter((pack) => pack.id === criteria.packId), [criteria.packId, collectionPacks]);

  useEffect(() => {
    void Promise.all([listTags(), listCatalogues()]).then(([nextTags, nextSaved]) => { setTags(nextTags); setSaved(nextSaved); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (criteria.packId !== "all" && !collectionPacks.some((pack) => pack.id === criteria.packId)) setCriteria((current) => ({ ...current, packId: "all" }));
  }, [criteria.packId, collectionPacks]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all(selectedPacks.map(async (pack) => {
      const setup = await loadStudySetup(pack.id, pack.card_type_id);
      return [pack.id, directionTemplates(pack, setup.templates)] as const;
    })).then((rows) => { if (!cancelled) setDirectionsByPack(Object.fromEntries(rows)); }).catch(() => { if (!cancelled) setDirectionsByPack({}); });
    return () => { cancelled = true; };
  }, [selectedPacks]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true); setError(""); setItems([]);
      const next: Item[] = [];
      try {
        for (let index = 0; index < selectedPacks.length; index += 1) {
          const pack = selectedPacks[index];
          const cards = await listAllCards(pack.id, (loaded, total) => {
            if (!cancelled) setProgress(`${index} / ${selectedPacks.length} topics · ${loaded.toLocaleString()} / ${total.toLocaleString()} cards`);
          });
          if (cancelled) return;
          next.push(...cards.map((card) => ({ card, pack })));
          setItems([...next]);
        }
        setProgress(selectedPacks.length ? `${selectedPacks.length} / ${selectedPacks.length} topics` : "");
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load the catalogue.");
      } finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [selectedPacks]);

  const questionCounts = useMemo(() => {
    let never = 0; let missing = 0; let production = 0; let stale = 0;
    items.forEach(({ card, pack }) => {
      const directions = directionsByPack[pack.id] ?? { recognition: null, production: null };
      if (card.stats.encounter_count === 0) never += 1;
      if (isKeepMissing(card)) missing += 1;
      if (isWeakProduction(card, directions)) production += 1;
      if (isNotSeenRecently(card)) stale += 1;
    });
    return { never, missing, production, stale };
  }, [directionsByPack, items]);

  const shown = useMemo(() => {
    const q = criteria.query.trim().toLocaleLowerCase();
    const filtered = items.filter(({ card, pack }) => {
      if (criteria.status === "new" && card.stats.encounter_count !== 0) return false;
      if (criteria.status === "favourites" && !card.favourite) return false;
      if (criteria.status === "interesting" && (card.interest_rank ?? 0) < 4 && !card.interesting) return false;
      if (criteria.status === "again" && card.stats.again_count < 2) return false;
      if (criteria.tagIds.length && !criteria.tagIds.every((tagId) => card.tags.some((tag) => tag.id === tagId))) return false;
      if (smartPreset === "missing" && !isKeepMissing(card)) return false;
      if (smartPreset === "stale" && !isNotSeenRecently(card)) return false;
      if (smartPreset === "production" && !isWeakProduction(card, directionsByPack[pack.id] ?? { recognition: null, production: null })) return false;
      if (!q) return true;
      const text = [pack.title, card.note ?? "", ...card.tags.map((tag) => tag.name), ...Object.values(card.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string")].join(" ").toLocaleLowerCase();
      return text.includes(q);
    });
    return [...filtered].sort((a, b) => {
      if (sortKey === "recent") return Date.parse(b.card.created_at) - Date.parse(a.card.created_at);
      if (sortKey === "production") {
        const ap = productionPerformance(a.card, directionsByPack[a.pack.id] ?? { recognition: null, production: null })?.score ?? 2;
        const bp = productionPerformance(b.card, directionsByPack[b.pack.id] ?? { recognition: null, production: null })?.score ?? 2;
        return ap - bp;
      }
      if (sortKey === "alphabetical") {
        const at = fieldText(a.card.data, fieldByRole(a.pack.cardType, "term")?.key ?? a.pack.cardType?.field_schema[0]?.key);
        const bt = fieldText(b.card.data, fieldByRole(b.pack.cardType, "term")?.key ?? b.pack.cardType?.field_schema[0]?.key);
        return at.localeCompare(bt, undefined, { numeric: true });
      }
      return attentionScore(b.card, directionsByPack[b.pack.id] ?? { recognition: null, production: null }) - attentionScore(a.card, directionsByPack[a.pack.id] ?? { recognition: null, production: null });
    });
  }, [criteria, directionsByPack, items, smartPreset, sortKey]);

  const orderedTags = useMemo(() => [...tags].sort((a, b) => Number(b.is_badge) - Number(a.is_badge) || a.sort_order - b.sort_order || a.name.localeCompare(b.name, undefined, { numeric: true })), [tags]);
  const statuses: Array<[CatalogueStatus, string]> = [["all", "Any status"], ["new", "Never met"], ["favourites", "Favourites"], ["interesting", "Interest 4–5"], ["again", "Often Again"]];
  const activeSaved = saved.find((catalogue) => catalogue.id === activeSavedId) ?? null;
  const spansMultiplePacks = new Set(shown.map((item) => item.pack.id)).size > 1;

  const productionTemplates = useMemo(() => Object.fromEntries(Object.entries(directionsByPack).flatMap(([packId, directions]) => directions.production ? [[packId, directions.production.id]] : [])), [directionsByPack]);

  async function saveCatalogue() {
    const title = saveTitle.trim();
    if (!title) return;
    const created = await createCatalogue({ title, criteria });
    setSaved(await listCatalogues()); setActiveSavedId(created.id); setSaveOpen(false); setSaveTitle("");
  }

  async function updateSaved() {
    if (!activeSavedId) return;
    await updateCatalogue(activeSavedId, { criteria });
    setSaved(await listCatalogues());
  }

  function chooseQuestion(key: "never" | SmartPreset) {
    setActiveSavedId(null);
    if (key === "never") {
      setSmartPreset("none");
      setCriteria((current) => ({ ...current, status: "new" }));
    } else {
      setCriteria((current) => ({ ...current, status: "all" }));
      setSmartPreset(key);
      if (key === "production") setSortKey("production");
      else setSortKey("attention");
    }
  }

  const activeTokens = [
    criteria.collectionId !== "all" ? { key: "collection", label: collections.find((item) => item.id === criteria.collectionId)?.title ?? "Collection", clear: () => setCriteria((current) => ({ ...current, collectionId: "all", packId: "all" })) } : null,
    criteria.packId !== "all" ? { key: "pack", label: packs.find((item) => item.id === criteria.packId)?.title ?? "Topic", clear: () => setCriteria((current) => ({ ...current, packId: "all" })) } : null,
    criteria.status !== "all" ? { key: "status", label: statusLabel(criteria.status), clear: () => setCriteria((current) => ({ ...current, status: "all" })) } : null,
    smartPreset !== "none" ? { key: "smart", label: smartPreset === "missing" ? "Keeps missing" : smartPreset === "production" ? "Weak production" : "Not seen in 30d", clear: () => setSmartPreset("none") } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; clear: () => void }>;

  return (
    <section className="catalogue-page intelligent-catalogue">
      <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> Library</button>
      <header className="catalogue-heading intelligent-heading"><div><p className="eyebrow">CATALOGUE</p><h1>Everything you have kept.</h1></div><span>{items.length.toLocaleString()} cards · {selectedPacks.length.toLocaleString()} topics · {collections.length.toLocaleString()} collections</span></header>

      <div className="intelligent-row-label">QUESTIONS WORTH ASKING</div>
      <div className="intelligent-question-band">
        <button data-tone="indigo" onClick={() => chooseQuestion("never")}><strong>{questionCounts.never.toLocaleString()}</strong><b>Never met</b><span>Cards with no encounter yet.</span></button>
        <button data-tone="cinnabar" onClick={() => chooseQuestion("missing")}><strong>{questionCounts.missing.toLocaleString()}</strong><b>You keep missing</b><span>Repeated Again grades outweigh successful recalls.</span></button>
        <button data-tone="amber" onClick={() => chooseQuestion("production")}><strong>{questionCounts.production.toLocaleString()}</strong><b>Weak in production</b><span>Production trails recognition in your real direction history.</span></button>
        <button data-tone="sage" onClick={() => chooseQuestion("stale")}><strong>{questionCounts.stale.toLocaleString()}</strong><b>Not seen in a month</b><span>Encountered before, but quiet for at least 30 days.</span></button>
      </div>

      {saved.length ? <><div className="intelligent-row-label">YOUR SAVED CATALOGUES</div><div className="saved-catalogues intelligent-saved">{saved.map((catalogue) => <button key={catalogue.id} aria-pressed={activeSavedId === catalogue.id} onClick={() => { setCriteria(catalogue.criteria); setSmartPreset("none"); setActiveSavedId(catalogue.id); }}>{catalogue.title}</button>)}</div></> : null}

      <div className="intelligent-row-label">ASK YOUR OWN</div>
      <div className="catalogue-tools intelligent-tools">
        <label><span>Collection</span><select value={criteria.collectionId} onChange={(event) => { setActiveSavedId(null); setSmartPreset("none"); setCriteria((current) => ({ ...current, collectionId: event.target.value, packId: "all" })); }}><option value="all">All collections</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label>
        <label><span>Topic</span><select value={criteria.packId} onChange={(event) => { setActiveSavedId(null); setSmartPreset("none"); setCriteria((current) => ({ ...current, packId: event.target.value })); }}><option value="all">All topics</option>{collectionPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.title}</option>)}</select></label>
        <label><span>Status</span><select value={criteria.status} onChange={(event) => { setActiveSavedId(null); setSmartPreset("none"); setCriteria((current) => ({ ...current, status: event.target.value as CatalogueStatus })); }}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="catalogue-search"><span>Search</span><div><Search size={14} /><input value={criteria.query} onChange={(event) => { setActiveSavedId(null); setCriteria((current) => ({ ...current, query: event.target.value })); }} placeholder="Any field, note or tag" /></div></label>
      </div>

      {activeTokens.length ? <div className="intelligent-query-strip">{activeTokens.map((token) => <button key={token.key} onClick={token.clear}>{token.label}<X size={11} /></button>)}<span>MATCHING <b>{shown.length.toLocaleString()}</b> OF {items.length.toLocaleString()} CARDS</span></div> : <div className="intelligent-query-strip"><span>MATCHING <b>{shown.length.toLocaleString()}</b> OF {items.length.toLocaleString()} CARDS</span></div>}

      {orderedTags.length ? <div className="catalogue-tags intelligent-tags"><small>Badges & tags</small><div>{orderedTags.map((tag) => { const active = criteria.tagIds.includes(tag.id); return <button key={tag.id} className={tag.is_badge ? "badge" : ""} aria-pressed={active} onClick={() => { setActiveSavedId(null); setCriteria((current) => ({ ...current, tagIds: active ? current.tagIds.filter((id) => id !== tag.id) : [...current.tagIds, tag.id] })); }}>{tag.name}{tag.shortcut ? <em>{tag.shortcut}</em> : null}</button>; })}</div></div> : null}

      <div className="intelligent-action-row">
        <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}><option value="attention">Needs attention first</option><option value="recent">Recently added</option><option value="production">Weakest production first</option><option value="alphabetical">Alphabetical</option></select>
        <button className="secondary-button" disabled={!shown.length || loading} onClick={() => setSessionMode("browse")}><BookOpen size={14} /> Browse these {shown.length.toLocaleString()}</button>
        <button className="primary-button" disabled={!shown.length || loading} onClick={() => setSessionMode("review")}><Brain size={14} /> Review these {shown.length.toLocaleString()}</button>
        <button className="secondary-button" disabled={smartPreset !== "none"} title={smartPreset !== "none" ? "Save the underlying filters after clearing the smart question." : undefined} onClick={() => setSaveOpen(true)}><BookmarkPlus size={14} /> Save as a catalogue</button>
        {activeSavedId ? <button className="text-button" onClick={() => void updateSaved()}>Update {activeSaved?.title ?? "saved"}</button> : null}
        {activeSavedId ? <button className="text-button" onClick={() => void deleteCatalogue(activeSavedId).then(async () => { setSaved(await listCatalogues()); setActiveSavedId(null); })}><Trash2 size={14} /> Delete saved</button> : null}
      </div>

      {loading && !items.length ? <div className="content-state compact">Loading the catalogue…</div> : error ? <div className="content-state error-state compact">{error}</div> : <div className="intelligent-result-grid">{shown.map(({ card, pack }) => {
        const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
        const reading = fieldByRole(pack.cardType, "reading");
        const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
        const directions = directionsByPack[pack.id] ?? { recognition: null, production: null };
        const recognition = recognitionPerformance(card, directions);
        const production = productionPerformance(card, directions);
        const recognitionPct = percentage(recognition?.score);
        const productionPct = percentage(production?.score);
        const missing = isKeepMissing(card);
        const weakProduction = isWeakProduction(card, directions);
        const stale = isNotSeenRecently(card);
        return <article className="intelligent-result-card" key={card.id}>
          <div className="result-term"><strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>{reading ? <em>{fieldText(card.data, reading.key)}</em> : null}{spansMultiplePacks ? <button onClick={() => onOpenPack(pack)}>{pack.title}</button> : null}</div>
          <div className="result-meaning">{fieldText(card.data, meaning?.key)}</div>
          <div className="direction-signal">
            {recognitionPct !== null ? <div><span>RECOG</span><i><em style={{ width: `${recognitionPct}%` }} /></i><b>{recognitionPct}%</b></div> : null}
            {productionPct !== null ? <div><span>PRODUCE</span><i><em style={{ width: `${productionPct}%` }} /></i><b>{productionPct}%</b></div> : null}
            {!recognition && !production ? <small>{card.stats.encounter_count ? formatSeen(card.stats.last_encountered_at) : "NOT MET YET"}</small> : <small>{formatSeen(card.stats.last_encountered_at)}{card.stats.again_count ? ` · ${card.stats.again_count} Again` : ""}</small>}
          </div>
          <div className="result-flags">{missing ? <span className="danger">KEEPS MISSING</span> : null}{weakProduction ? <span className="warn">PRODUCTION</span> : null}{stale && !missing ? <span>QUIET 30D+</span> : null}</div>
        </article>;
      })}{!shown.length && !loading ? <div className="catalogue-empty">No cards match these filters.</div> : null}</div>}

      {saveOpen ? <div className="modal-backdrop inner-modal" onMouseDown={(event) => { if (event.currentTarget === event.target) setSaveOpen(false); }}><section className="small-modal"><p className="eyebrow">SAVE CATALOGUE</p><h2>Keep this view.</h2><label className="field-row"><span>Name</span><input autoFocus value={saveTitle} onChange={(event) => setSaveTitle(event.target.value)} placeholder="Chinese spoken sentences" /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setSaveOpen(false)}>Cancel</button><button className="primary-button" disabled={!saveTitle.trim()} onClick={() => void saveCatalogue()}>Save</button></div></section></div> : null}
      {sessionMode ? <CatalogueSession title={smartPreset === "production" ? "Weak production" : activeSaved?.title ?? "Current catalogue"} items={shown} mode={sessionMode} templateByPackId={smartPreset === "production" ? productionTemplates : undefined} onClose={() => setSessionMode(null)} /> : null}
    </section>
  );
}
