import { ArrowLeft, BookmarkPlus, BookOpen, Brain, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fieldByRole, fieldText, listAllCards, listTags, type CardWithStats, type Collection, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { createCatalogue, deleteCatalogue, listCatalogues, updateCatalogue, type CatalogueCriteria, type CatalogueStatus, type SavedCatalogue } from "../lib/advanced";
import CatalogueSession, { type CatalogueSessionItem } from "./CatalogueSession";

type Item = CatalogueSessionItem;
type Props = { collections: Collection[]; packs: PackWithType[]; onBack: () => void; onOpenPack: (pack: PackWithType) => void };

const DEFAULT_CRITERIA: CatalogueCriteria = { collectionId: "all", packId: "all", tagIds: [], status: "all", query: "" };

export default function CatalogueView({ collections, packs, onBack, onOpenPack }: Props) {
  const [criteria, setCriteria] = useState<CatalogueCriteria>(DEFAULT_CRITERIA);
  const [items, setItems] = useState<Item[]>([]);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [saved, setSaved] = useState<SavedCatalogue[]>([]);
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

  const shown = useMemo(() => {
    const q = criteria.query.trim().toLocaleLowerCase();
    return items.filter(({ card, pack }) => {
      if (criteria.status === "new" && card.stats.encounter_count !== 0) return false;
      if (criteria.status === "favourites" && !card.favourite) return false;
      if (criteria.status === "interesting" && (card.interest_rank ?? 0) < 4 && !card.interesting) return false;
      if (criteria.status === "again" && card.stats.again_count < 2) return false;
      if (criteria.tagIds.length && !criteria.tagIds.every((tagId) => card.tags.some((tag) => tag.id === tagId))) return false;
      if (!q) return true;
      const text = [pack.title, card.note ?? "", ...card.tags.map((tag) => tag.name), ...Object.values(card.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string")].join(" ").toLocaleLowerCase();
      return text.includes(q);
    });
  }, [items, criteria]);

  const orderedTags = useMemo(() => [...tags].sort((a, b) => Number(b.is_badge) - Number(a.is_badge) || a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [tags]);
  const statuses: Array<[CatalogueStatus, string]> = [["all", "Any status"], ["new", "Never encountered"], ["favourites", "Favourites"], ["interesting", "Interest 4–5"], ["again", "Often Again"]];
  const activeSaved = saved.find((catalogue) => catalogue.id === activeSavedId) ?? null;

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

  return (
    <section className="catalogue-page">
      <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> Library</button>
      <header className="catalogue-heading"><div><p className="eyebrow">CATALOGUE</p><h1>Everything you have kept.</h1></div><span>{shown.length.toLocaleString()} cards{progress ? ` · ${progress}` : ""}</span></header>

      {saved.length ? <div className="saved-catalogues"><small>Saved</small>{saved.map((catalogue) => <button key={catalogue.id} aria-pressed={activeSavedId === catalogue.id} onClick={() => { setCriteria(catalogue.criteria); setActiveSavedId(catalogue.id); }}>{catalogue.title}</button>)}</div> : null}

      <div className="catalogue-tools">
        <label><span>Collection</span><select value={criteria.collectionId} onChange={(event) => { setActiveSavedId(null); setCriteria((current) => ({ ...current, collectionId: event.target.value, packId: "all" })); }}><option value="all">All collections</option>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label>
        <label><span>Topic</span><select value={criteria.packId} onChange={(event) => { setActiveSavedId(null); setCriteria((current) => ({ ...current, packId: event.target.value })); }}><option value="all">All topics</option>{collectionPacks.map((pack) => <option key={pack.id} value={pack.id}>{pack.title}</option>)}</select></label>
        <label><span>Status</span><select value={criteria.status} onChange={(event) => { setActiveSavedId(null); setCriteria((current) => ({ ...current, status: event.target.value as CatalogueStatus })); }}>{statuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label className="catalogue-search"><span>Search</span><div><Search size={14} /><input value={criteria.query} onChange={(event) => { setActiveSavedId(null); setCriteria((current) => ({ ...current, query: event.target.value })); }} placeholder="Any field, note or tag" /></div></label>
      </div>

      {orderedTags.length ? <div className="catalogue-tags"><small>Badges & tags</small><div>{orderedTags.map((tag) => { const active = criteria.tagIds.includes(tag.id); return <button key={tag.id} className={tag.is_badge ? "badge" : ""} aria-pressed={active} onClick={() => { setActiveSavedId(null); setCriteria((current) => ({ ...current, tagIds: active ? current.tagIds.filter((id) => id !== tag.id) : [...current.tagIds, tag.id] })); }}>{tag.name}{tag.shortcut ? <em>{tag.shortcut}</em> : null}</button>; })}</div></div> : null}

      <div className="catalogue-actions">
        <button className="secondary-button" disabled={!shown.length || loading} onClick={() => setSessionMode("browse")}><BookOpen size={14} /> Browse shown</button>
        <button className="primary-button" disabled={!shown.length || loading} onClick={() => setSessionMode("review")}><Brain size={14} /> Review shown</button>
        <button className="secondary-button" onClick={() => setSaveOpen(true)}><BookmarkPlus size={14} /> Save catalogue</button>
        {activeSavedId ? <button className="text-button" onClick={() => void updateSaved()}>Update {activeSaved?.title ?? "saved"}</button> : null}
        {activeSavedId ? <button className="text-button" onClick={() => void deleteCatalogue(activeSavedId).then(async () => { setSaved(await listCatalogues()); setActiveSavedId(null); })}><Trash2 size={14} /> Delete saved</button> : null}
      </div>

      {loading && !items.length ? <div className="content-state compact">Loading the catalogue…</div> : error ? <div className="content-state error-state compact">{error}</div> : <div className="catalogue-list">{shown.map(({ card, pack }) => {
        const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
        const reading = fieldByRole(pack.cardType, "reading");
        const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
        return <article className="catalogue-card" key={card.id}><header><button onClick={() => onOpenPack(pack)}>{pack.title}</button><span>{card.stats.encounter_count ? `${card.stats.encounter_count}×` : "new"}</span></header><div className="catalogue-card-main"><div><strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>{reading ? <em>{fieldText(card.data, reading.key)}</em> : null}{card.tags.length ? <div className="catalogue-card-tags">{card.tags.map((tag) => <i key={tag.id} className={tag.is_badge ? "badge" : ""}>{tag.name}</i>)}</div> : null}</div><p>{fieldText(card.data, meaning?.key)}</p></div>{card.note ? <aside>{card.note}</aside> : null}</article>;
      })}{!shown.length && !loading ? <div className="catalogue-empty">No cards match these filters.</div> : null}</div>}

      {saveOpen ? <div className="modal-backdrop inner-modal" onMouseDown={(event) => { if (event.currentTarget === event.target) setSaveOpen(false); }}><section className="small-modal"><p className="eyebrow">SAVE CATALOGUE</p><h2>Keep this view.</h2><label className="field-row"><span>Name</span><input autoFocus value={saveTitle} onChange={(event) => setSaveTitle(event.target.value)} placeholder="Chinese spoken sentences" /></label><div className="modal-actions"><button className="secondary-button" onClick={() => setSaveOpen(false)}>Cancel</button><button className="primary-button" disabled={!saveTitle.trim()} onClick={() => void saveCatalogue()}>Save</button></div></section></div> : null}
      {sessionMode ? <CatalogueSession title={activeSaved?.title ?? "Current catalogue"} items={shown} mode={sessionMode} onClose={() => setSessionMode(null)} /> : null}
    </section>
  );
}
