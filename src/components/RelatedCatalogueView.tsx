import { ArrowLeft, ExternalLink, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createTopicFromRelatedWords, listRelatedCatalogue, promoteRelatedCard, removeRelatedRelation, type RelatedCatalogueRow, type RelationType } from "../lib/related";
import { patchCardData, type Collection, type PackWithType } from "../lib/heuresis";

type Props = {
  packs: PackWithType[];
  collection?: Collection | null;
  onBack: () => void;
  onOpenPack: (pack: PackWithType) => void;
  onTopicCreated?: (packId: string) => Promise<void> | void;
};

type RelationFilter = "all" | RelationType;
type EditingWord = { id: string; term: string; reading: string; meaning: string };

export default function RelatedCatalogueView({ packs, collection = null, onBack, onOpenPack, onTopicCreated }: Props) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<RelationFilter>("all");
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [editing, setEditing] = useState<EditingWord | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);

  async function reload() {
    setLoading(true); setError("");
    try { setRows(await listRelatedCatalogue()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load related vocabulary."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  const collectionRows = useMemo(() => collection
    ? rows.filter((row) => packMap.get(row.pack_id)?.collection_id === collection.id)
    : rows, [collection, packMap, rows]);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return collectionRows.filter((row) => {
      if (filter !== "all" && row.relation_type !== filter) return false;
      if (!q) return true;
      return [row.pack_title, row.source_term, row.source_reading, row.source_meaning, row.term, row.reading, row.meaning, ...row.source_tags].join(" ").toLocaleLowerCase().includes(q);
    });
  }, [collectionRows, query, filter]);

  const visibleWordIds = useMemo(() => Array.from(new Set(shown.map((row) => row.target_card_id))), [shown]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const uniqueWords = visibleWordIds.length;
  const allVisibleSelected = visibleWordIds.length > 0 && visibleWordIds.every((id) => selectedSet.has(id));

  function toggleSelected(cardId: string) {
    setSelected((current) => current.includes(cardId) ? current.filter((id) => id !== cardId) : [...current, cardId]);
  }

  function toggleVisible() {
    setSelected((current) => {
      const currentSet = new Set(current);
      if (allVisibleSelected) return current.filter((id) => !visibleWordIds.includes(id));
      visibleWordIds.forEach((id) => currentSet.add(id));
      return Array.from(currentSet);
    });
  }

  function beginEdit(row: RelatedCatalogueRow) {
    setEditing({ id: row.target_card_id, term: row.term, reading: row.reading, meaning: row.meaning });
  }

  async function saveEdit() {
    if (!editing?.term.trim() || editBusy) return;
    setEditBusy(true); setError("");
    try {
      await patchCardData(editing.id, {
        term: editing.term.normalize("NFC").trim(),
        reading: editing.reading.normalize("NFKC").trim() || null,
        meaning: editing.meaning.trim() || null,
      });
      setEditing(null);
      await reload();
    } catch (editError) {
      setError(editError instanceof Error ? editError.message : "Could not update the word.");
    } finally { setEditBusy(false); }
  }

  async function createTopic() {
    if (!collection || !selected.length) return;
    setCreateBusy(true); setError("");
    try {
      const packId = await createTopicFromRelatedWords({ collectionId: collection.id, title: topicTitle, cardIds: selected });
      setSelected([]); setTopicTitle(""); setCreating(false);
      await reload();
      await onTopicCreated?.(packId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the topic.");
    } finally { setCreateBusy(false); }
  }

  async function remove(row: RelatedCatalogueRow) {
    if (!window.confirm(`Remove the ${row.relation_type} link to ${row.term}?`)) return;
    try { await removeRelatedRelation(row.relation_id); await reload(); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not remove the relation."); }
  }

  async function promote(row: RelatedCatalogueRow) {
    try { await promoteRelatedCard(row.target_card_id); await reload(); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not promote the related card."); }
  }

  const title = collection ? "New words" : "The vocabulary growing around your cards.";
  const description = collection
    ? `Words discovered while studying ${collection.title}. This is an automatic pack: every word you add from a card appears here without creating a duplicate.`
    : "Every word or expression you add as a synonym, antonym or related item lives here with its source flashcard.";

  return <section className="related-catalogue-page">
    <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> {collection ? collection.title : "Library"}</button>
    <header className="catalogue-heading">
      <div><p className="eyebrow">{collection ? "WORDS" : "RELATED"}</p><h1>{title}</h1><p>{description}</p></div>
      <div className="related-heading-side"><span>{uniqueWords.toLocaleString()} words · {shown.length.toLocaleString()} relations</span>{collection ? <button className="primary-button" disabled={!selected.length} onClick={() => setCreating(true)}><Plus size={14} /> New topic{selected.length ? ` · ${selected.length}` : ""}</button> : null}</div>
    </header>

    {collection && creating ? <div className="related-create-topic">
      <div><span className="eyebrow">WORDS → NEW TOPIC</span><strong>{selected.length} selected {selected.length === 1 ? "word" : "words"}</strong></div>
      <input autoFocus value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} placeholder="Topic name" onKeyDown={(event) => { if (event.key === "Enter" && topicTitle.trim() && !createBusy) void createTopic(); }} />
      <button className="secondary-button" disabled={createBusy} onClick={() => setCreating(false)}>Cancel</button>
      <button className="primary-button" disabled={createBusy || !topicTitle.trim() || !selected.length} onClick={() => void createTopic()}>{createBusy ? "Creating…" : "Create topic"}</button>
    </div> : null}

    {collection && editing ? <div className="related-edit-word">
      <div><span className="eyebrow">EDIT WORD</span><strong>Double-click a row to modify it</strong></div>
      <input autoFocus value={editing.term} onChange={(event) => setEditing((current) => current ? { ...current, term: event.target.value } : current)} placeholder="Word" />
      <input value={editing.reading} onChange={(event) => setEditing((current) => current ? { ...current, reading: event.target.value } : current)} placeholder="Reading / pinyin" />
      <input value={editing.meaning} onChange={(event) => setEditing((current) => current ? { ...current, meaning: event.target.value } : current)} placeholder="Meaning" onKeyDown={(event) => { if (event.key === "Enter" && editing.term.trim() && !editBusy) void saveEdit(); }} />
      <button className="secondary-button" disabled={editBusy} onClick={() => setEditing(null)}>Cancel</button>
      <button className="primary-button" disabled={editBusy || !editing.term.trim()} onClick={() => void saveEdit()}>{editBusy ? "Saving…" : "Save"}</button>
    </div> : null}

    <div className="related-toolbar">
      <label className="pack-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search added vocabulary or source" /></label>
      {collection ? <button className="secondary-button related-select-visible" disabled={!visibleWordIds.length} onClick={toggleVisible}>{allVisibleSelected ? "Clear visible" : "Select visible"}</button> : null}
      <div className="filter-strip">{([['all','All'],['synonym','Synonyms'],['antonym','Antonyms'],['related','Related']] as Array<[RelationFilter,string]>).map(([value,label]) => <button key={value} className={filter === value ? "selected" : ""} onClick={() => setFilter(value)}>{label}</button>)}</div>
    </div>

    {loading ? <div className="content-state compact">Loading new words…</div> : error ? <div className="content-state error-state compact">{error}</div> : <div className="related-table">
      <div className={`related-table-head ${collection ? "selectable" : ""}`}><span>Added vocabulary</span><span>Type</span><span>Source</span><span>Actions</span></div>
      {shown.map((row) => { const pack = packMap.get(row.pack_id); const sourceTitle = [row.pack_title, row.source_term, row.source_reading, row.source_meaning].filter(Boolean).join(" · "); const isSelected = selectedSet.has(row.target_card_id); return <div
        className={`related-table-row ${collection ? "selectable clickable" : ""} ${isSelected ? "selected" : ""}`}
        key={row.relation_id}
        onClick={(event) => { if (collection && event.detail === 1) toggleSelected(row.target_card_id); }}
        onDoubleClick={(event) => { if (!collection) return; event.preventDefault(); beginEdit(row); }}
        title={collection ? "Click to select · double-click to edit" : undefined}
      >
        <div className="related-target"><strong>{row.term || "Untitled"}</strong>{row.reading ? <em>{row.reading}</em> : null}<p>{row.meaning}</p><small>{row.target_role === "main" ? "In a topic" : "New word"}</small></div>
        <span className={`relation-badge relation-${row.relation_type}`}>{row.relation_type}</span>
        <div className="related-source-badge" title={sourceTitle}><small>{row.pack_title}</small><span>{row.source_term || "Untitled"}</span></div>
        <div className="related-actions">{pack ? <button title="Open source topic" onClick={(event) => { event.stopPropagation(); onOpenPack(pack); }}><ExternalLink size={14} /></button> : null}{row.target_role === "related" ? <button title="Promote inside source topic" onClick={(event) => { event.stopPropagation(); void promote(row); }}>↑</button> : null}<button title="Remove relation" onClick={(event) => { event.stopPropagation(); void remove(row); }}><Trash2 size={14} /></button></div>
      </div>; })}
      {!shown.length ? <div className="catalogue-empty">{collectionRows.length ? "No new words match this view." : "No new words in this collection yet."}</div> : null}
    </div>}
  </section>;
}
