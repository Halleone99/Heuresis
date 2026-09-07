import { ArrowLeft, ChevronDown, FolderTree, GitFork, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { createTopicFromRelatedWords, listRelatedCatalogue, promoteRelatedCard, removeRelatedRelation, type RelatedCatalogueRow, type RelationType } from "../lib/related";
import { listCardsByIds, patchCardData, type CardWithStats, type Collection, type PackWithType } from "../lib/heuresis";
import ConnectionsPanel from "./ConnectionsPanel";

type Props = {
  packs: PackWithType[];
  collections: Collection[];
  collection?: Collection | null;
  onBack: () => void;
  onOpenPack: (pack: PackWithType) => void;
  onTopicCreated?: (packId: string) => Promise<void> | void;
};

type EditingWord = { id: string; relationId: string; term: string; reading: string; meaning: string };
type WordStatus = "vocabulary" | "flashcard";
type SortKey = "word" | "relation" | "source" | "status";
type SortDirection = "asc" | "desc";
type ConnectionTarget = { pack: PackWithType; card: CardWithStats };

function toggleValue<T>(items: T[], value: T) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function relationLabel(value: RelationType) {
  return value === "synonym" ? "Synonym" : value === "antonym" ? "Antonym" : "Related";
}

function statusOf(row: RelatedCatalogueRow): WordStatus {
  return row.target_role === "main" ? "flashcard" : "vocabulary";
}

function uniqueWordCount(rows: RelatedCatalogueRow[]) {
  return new Set(rows.map((row) => row.target_card_id)).size;
}

export default function RelatedCatalogueView({ packs, collections, collection = null, onBack, onOpenPack, onTopicCreated }: Props) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [relationFilters, setRelationFilters] = useState<RelationType[]>([]);
  const [statusFilters, setStatusFilters] = useState<WordStatus[]>([]);
  const [collectionFilters, setCollectionFilters] = useState<string[]>([]);
  const [packFilters, setPackFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [editing, setEditing] = useState<EditingWord | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("word");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [connections, setConnections] = useState<ConnectionTarget | null>(null);
  const [treeBusyId, setTreeBusyId] = useState<string | null>(null);
  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);
  const collectionMap = useMemo(() => new Map(collections.map((item) => [item.id, item])), [collections]);

  async function reload() {
    setLoading(true); setError("");
    try { setRows(await listRelatedCatalogue()); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load vocabulary."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);

  const collectionRows = useMemo(() => collection
    ? rows.filter((row) => packMap.get(row.pack_id)?.collection_id === collection.id)
    : rows, [collection, packMap, rows]);

  const availablePacks = useMemo(() => {
    const ids = new Set(collectionRows.map((row) => row.pack_id));
    return packs.filter((pack) => ids.has(pack.id)).sort((a, b) => a.title.localeCompare(b.title));
  }, [collectionRows, packs]);

  const availableCollections = useMemo(() => {
    const ids = new Set(availablePacks.map((pack) => pack.collection_id));
    return collections.filter((item) => ids.has(item.id)).sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title));
  }, [availablePacks, collections]);

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    const scopeActive = collectionFilters.length > 0 || packFilters.length > 0;
    return collectionRows.filter((row) => {
      if (relationFilters.length && !relationFilters.includes(row.relation_type)) return false;
      if (statusFilters.length && !statusFilters.includes(statusOf(row))) return false;
      if (scopeActive) {
        const sourcePack = packMap.get(row.pack_id);
        const inCollection = Boolean(sourcePack && collectionFilters.includes(sourcePack.collection_id));
        const inPack = packFilters.includes(row.pack_id);
        if (!inCollection && !inPack) return false;
      }
      if (!q) return true;
      return [row.pack_title, row.source_term, row.source_reading, row.source_meaning, row.term, row.reading, row.meaning, ...row.source_tags].join(" ").toLocaleLowerCase().includes(q);
    });
  }, [collectionFilters, collectionRows, packFilters, packMap, query, relationFilters, statusFilters]);

  const shown = useMemo(() => [...filtered].sort((a, b) => {
    const left = sortKey === "word" ? a.term
      : sortKey === "relation" ? a.relation_type
      : sortKey === "source" ? `${a.pack_title} ${a.source_term}`
      : statusOf(a);
    const right = sortKey === "word" ? b.term
      : sortKey === "relation" ? b.relation_type
      : sortKey === "source" ? `${b.pack_title} ${b.source_term}`
      : statusOf(b);
    const result = left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
    return sortDirection === "asc" ? result : -result;
  }), [filtered, sortDirection, sortKey]);

  const visibleRelationIds = useMemo(() => shown.map((row) => row.relation_id), [shown]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const selectedRows = useMemo(() => collectionRows.filter((row) => selectedSet.has(row.relation_id)), [collectionRows, selectedSet]);
  const selectedCardIds = useMemo(() => Array.from(new Set(selectedRows.map((row) => row.target_card_id))), [selectedRows]);
  const selectedVocabularyCardIds = useMemo(() => Array.from(new Set(selectedRows.filter((row) => row.target_role === "related").map((row) => row.target_card_id))), [selectedRows]);
  const uniqueWords = uniqueWordCount(shown);
  const allVisibleSelected = visibleRelationIds.length > 0 && visibleRelationIds.every((id) => selectedSet.has(id));
  const scopeFilterCount = collectionFilters.length + packFilters.length;
  const activeFilterCount = relationFilters.length + statusFilters.length + scopeFilterCount;

  function toggleSelected(relationId: string) {
    setSelected((current) => current.includes(relationId) ? current.filter((id) => id !== relationId) : [...current, relationId]);
  }

  function toggleVisible() {
    setSelected((current) => {
      const currentSet = new Set(current);
      if (allVisibleSelected) return current.filter((id) => !visibleRelationIds.includes(id));
      visibleRelationIds.forEach((id) => currentSet.add(id));
      return Array.from(currentSet);
    });
  }

  function toggleSort(next: SortKey) {
    if (sortKey === next) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(next); setSortDirection("asc"); }
  }

  function beginEdit(row: RelatedCatalogueRow) {
    setEditing({ id: row.target_card_id, relationId: row.relation_id, term: row.term, reading: row.reading, meaning: row.meaning });
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

  async function deleteEditing() {
    if (!editing || editBusy) return;
    if (!window.confirm(`Delete the connection to ${editing.term}?`)) return;
    setEditBusy(true); setError("");
    try {
      await removeRelatedRelation(editing.relationId);
      setEditing(null);
      setSelected((current) => current.filter((id) => id !== editing.relationId));
      await reload();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Could not delete this connection.");
    } finally { setEditBusy(false); }
  }

  async function createTopic() {
    if (!collection || !selectedCardIds.length) return;
    setCreateBusy(true); setError("");
    try {
      const packId = await createTopicFromRelatedWords({ collectionId: collection.id, title: topicTitle, cardIds: selectedCardIds });
      setSelected([]); setTopicTitle(""); setCreating(false);
      await reload();
      await onTopicCreated?.(packId);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Could not create the topic.");
    } finally { setCreateBusy(false); }
  }

  async function promote(row: RelatedCatalogueRow) {
    try { await promoteRelatedCard(row.target_card_id); await reload(); }
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not make this word a flashcard."); }
  }

  async function promoteSelected() {
    if (!selectedVocabularyCardIds.length || bulkBusy) return;
    setBulkBusy(true); setError("");
    try {
      await Promise.all(selectedVocabularyCardIds.map((cardId) => promoteRelatedCard(cardId)));
      setSelected([]);
      await reload();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Could not make the selected words flashcards.");
    } finally { setBulkBusy(false); }
  }

  async function deleteSelected() {
    if (!selected.length || bulkBusy) return;
    if (!window.confirm(`Remove ${selected.length} selected ${selected.length === 1 ? "connection" : "connections"}?`)) return;
    setBulkBusy(true); setError("");
    try {
      await Promise.all(selected.map((relationId) => removeRelatedRelation(relationId)));
      setSelected([]);
      await reload();
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : "Could not remove the selected connections.");
    } finally { setBulkBusy(false); }
  }

  async function openConnections(row: RelatedCatalogueRow) {
    const pack = packMap.get(row.pack_id);
    if (!pack || treeBusyId) return;
    setTreeBusyId(row.relation_id); setError("");
    try {
      const [card] = await listCardsByIds([row.target_card_id]);
      if (!card) throw new Error("Could not load this vocabulary card.");
      setConnections({ pack, card });
    } catch (treeError) {
      setError(treeError instanceof Error ? treeError.message : "Could not open connections.");
    } finally { setTreeBusyId(null); }
  }

  return <>
    <section className="related-catalogue-page vocabulary-page">
      <button className="text-button back-button vocabulary-back" onClick={onBack}><ArrowLeft size={15} /> {collection ? collection.title : "Library"}</button>

      <header className="vocabulary-heading">
        <div><p className="eyebrow">VOCABULARY</p><h1>{collection ? "New words" : "Vocabulary"}</h1><p>{collection ? collection.title : "Words discovered from your cards."}</p></div>
        {collection ? <div className="vocabulary-heading-side"><button className="primary-button" disabled={!selectedCardIds.length} onClick={() => setCreating(true)}><Plus size={14} /> New topic{selectedCardIds.length ? ` · ${selectedCardIds.length}` : ""}</button></div> : null}
      </header>

      {collection && creating ? <div className="related-create-topic vocabulary-inline-editor vocabulary-create-editor">
        <div><span className="eyebrow">NEW TOPIC</span><strong>{selectedCardIds.length} selected</strong></div>
        <input autoFocus value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} placeholder="Topic name" onKeyDown={(event) => { if (event.key === "Enter" && topicTitle.trim() && !createBusy) void createTopic(); }} />
        <div className="vocabulary-editor-actions"><button className="secondary-button" disabled={createBusy} onClick={() => setCreating(false)}>Cancel</button><button className="primary-button" disabled={createBusy || !topicTitle.trim() || !selectedCardIds.length} onClick={() => void createTopic()}>{createBusy ? "Creating…" : "Create"}</button></div>
      </div> : null}

      {editing ? <div className="related-edit-word vocabulary-inline-editor vocabulary-edit-editor">
        <div><span className="eyebrow">EDIT</span><strong>{editing.term}</strong></div>
        <input autoFocus value={editing.term} onChange={(event) => setEditing((current) => current ? { ...current, term: event.target.value } : current)} placeholder="Word" />
        <input value={editing.reading} onChange={(event) => setEditing((current) => current ? { ...current, reading: event.target.value } : current)} placeholder="Reading / pinyin" />
        <input value={editing.meaning} onChange={(event) => setEditing((current) => current ? { ...current, meaning: event.target.value } : current)} placeholder="Meaning" onKeyDown={(event) => { if (event.key === "Enter" && editing.term.trim() && !editBusy) void saveEdit(); }} />
        <div className="vocabulary-editor-actions"><button className="vocabulary-delete-action" disabled={editBusy} onClick={() => void deleteEditing()}>Delete connection</button><button className="secondary-button" disabled={editBusy} onClick={() => setEditing(null)}>Cancel</button><button className="primary-button" disabled={editBusy || !editing.term.trim()} onClick={() => void saveEdit()}>{editBusy ? "Saving…" : "Save"}</button></div>
      </div> : null}

      <div className="vocabulary-toolbar">
        <label className="vocabulary-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search word, meaning or source" /></label>
        <span className="vocabulary-result-count">{uniqueWords.toLocaleString()} {uniqueWords === 1 ? "entry" : "entries"}</span>

        {!collection && availablePacks.length ? <details className="vocabulary-filter-menu vocabulary-scope-menu">
          <summary className={scopeFilterCount ? "active" : ""}><FolderTree size={14} /> Scope{scopeFilterCount ? <b>{scopeFilterCount}</b> : null}<ChevronDown size={13} /></summary>
          <div className="vocabulary-filter-popover vocabulary-scope-popover">
            <button className={!scopeFilterCount ? "selected" : ""} onClick={(event) => { event.preventDefault(); setCollectionFilters([]); setPackFilters([]); }}><span>All vocabulary</span><small>{uniqueWordCount(collectionRows)}</small></button>
            {availableCollections.length ? <section><p>Collections</p>{availableCollections.map((item) => {
              const count = uniqueWordCount(collectionRows.filter((row) => packMap.get(row.pack_id)?.collection_id === item.id));
              return <button key={item.id} className={collectionFilters.includes(item.id) ? "selected" : ""} onClick={(event) => { event.preventDefault(); setCollectionFilters((current) => toggleValue(current, item.id)); }}><span>{item.title}</span><small>{count}</small></button>;
            })}</section> : null}
            {availablePacks.length ? <section><p>Topics</p>{availablePacks.map((pack) => <button key={pack.id} className={packFilters.includes(pack.id) ? "selected" : ""} onClick={(event) => { event.preventDefault(); setPackFilters((current) => toggleValue(current, pack.id)); }}><span><strong>{pack.title}</strong><em>{collectionMap.get(pack.collection_id)?.title ?? "Collection"}</em></span><small>{uniqueWordCount(collectionRows.filter((row) => row.pack_id === pack.id))}</small></button>)}</section> : null}
          </div>
        </details> : null}

        <details className="vocabulary-filter-menu">
          <summary className={statusFilters.length ? "active" : ""}>Status{statusFilters.length ? <b>{statusFilters.length}</b> : null}<ChevronDown size={13} /></summary>
          <div className="vocabulary-filter-popover">
            <button className={statusFilters.includes("vocabulary") ? "selected" : ""} onClick={(event) => { event.preventDefault(); setStatusFilters((current) => toggleValue(current, "vocabulary")); }}><span>Vocabulary only</span><small>{uniqueWordCount(collectionRows.filter((row) => statusOf(row) === "vocabulary"))}</small></button>
            <button className={statusFilters.includes("flashcard") ? "selected" : ""} onClick={(event) => { event.preventDefault(); setStatusFilters((current) => toggleValue(current, "flashcard")); }}><span>Flashcard</span><small>{uniqueWordCount(collectionRows.filter((row) => statusOf(row) === "flashcard"))}</small></button>
          </div>
        </details>

        <details className="vocabulary-filter-menu">
          <summary className={relationFilters.length ? "active" : ""}>Type{relationFilters.length ? <b>{relationFilters.length}</b> : null}<ChevronDown size={13} /></summary>
          <div className="vocabulary-filter-popover">
            {(["synonym", "antonym", "related"] as RelationType[]).map((value) => <button key={value} className={relationFilters.includes(value) ? "selected" : ""} onClick={(event) => { event.preventDefault(); setRelationFilters((current) => toggleValue(current, value)); }}><span>{relationLabel(value)}</span><small>{uniqueWordCount(collectionRows.filter((row) => row.relation_type === value))}</small></button>)}
          </div>
        </details>

        {activeFilterCount ? <button className="vocabulary-clear" onClick={() => { setRelationFilters([]); setStatusFilters([]); setCollectionFilters([]); setPackFilters([]); }}>Clear {activeFilterCount}</button> : null}
        <button className="vocabulary-select-visible" disabled={!visibleRelationIds.length} onClick={toggleVisible}>{allVisibleSelected ? "Clear visible" : "Select visible"}</button>
      </div>

      {selected.length ? <div className="vocabulary-selection-bar">
        <span><b>{selected.length}</b> selected</span>
        <button className="vocabulary-selection-clear" onClick={() => setSelected([])}>Clear</button>
        {collection ? <button className="vocabulary-selection-topic" onClick={() => setCreating(true)}><Plus size={13} /> New topic</button> : null}
        <details className="vocabulary-selection-menu">
          <summary><MoreHorizontal size={16} /> Actions</summary>
          <div>
            {selectedVocabularyCardIds.length ? <button disabled={bulkBusy} onClick={(event) => { event.preventDefault(); void promoteSelected(); }}><Plus size={14} /><span>Make flashcards</span><small>{selectedVocabularyCardIds.length}</small></button> : null}
            <button className="danger" disabled={bulkBusy} onClick={(event) => { event.preventDefault(); void deleteSelected(); }}><Trash2 size={14} /><span>Remove connections</span><small>{selected.length}</small></button>
          </div>
        </details>
      </div> : null}

      {loading ? <div className="content-state compact">Loading vocabulary…</div> : error ? <div className="content-state error-state compact">{error}</div> : <div className="vocabulary-table">
        <div className="vocabulary-table-head">
          <button onClick={() => toggleSort("word")}>Word {sortKey === "word" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button>
          <button onClick={() => toggleSort("relation")}>Type {sortKey === "relation" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button>
          <button onClick={() => toggleSort("source")}>Source {sortKey === "source" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button>
          <button onClick={() => toggleSort("status")}>Status {sortKey === "status" ? (sortDirection === "asc" ? "↑" : "↓") : ""}</button>
          <span />
        </div>
        {shown.map((row) => {
          const pack = packMap.get(row.pack_id);
          const sourceTitle = [row.pack_title, row.source_term, row.source_reading, row.source_meaning].filter(Boolean).join(" · ");
          const isSelected = selectedSet.has(row.relation_id);
          return <div
            className={`vocabulary-row ${isSelected ? "selected" : ""}`}
            key={row.relation_id}
            onClick={() => toggleSelected(row.relation_id)}
            onDoubleClick={(event) => { event.preventDefault(); beginEdit(row); }}
            title="Click to select · double-click to edit"
          >
            <div className="vocabulary-word"><strong>{row.term || "Untitled"}</strong>{row.reading ? <em>{row.reading}</em> : null}<p>{row.meaning}</p></div>
            <span className={`relation-badge relation-${row.relation_type}`}>{relationLabel(row.relation_type)}</span>
            {pack ? <button className="vocabulary-source vocabulary-source-button" title={sourceTitle} onClick={(event) => { event.stopPropagation(); onOpenPack(pack); }}><small>{collectionMap.get(pack.collection_id)?.title ?? row.pack_title}</small><span>{row.pack_title}</span><em>{row.source_term || "Untitled"}{row.source_reading ? ` · ${row.source_reading}` : ""}</em></button> : <div className="vocabulary-source" title={sourceTitle}><small>{row.pack_title}</small><span>{row.source_term || "Untitled"}</span></div>}
            <span className={`vocabulary-status ${statusOf(row)}`}>{statusOf(row) === "flashcard" ? "Flashcard" : "Vocabulary"}</span>
            <div className="vocabulary-actions">
              {row.target_role === "related" ? <button className="vocabulary-promote" title="Make this a flashcard" onClick={(event) => { event.stopPropagation(); void promote(row); }}><Plus size={12} /><span>Flashcard</span></button> : null}
              <button className="vocabulary-tree-action" title="Open connections" disabled={treeBusyId === row.relation_id} onClick={(event) => { event.stopPropagation(); void openConnections(row); }}><GitFork size={15} /></button>
            </div>
          </div>;
        })}
        {!shown.length ? <div className="catalogue-empty">{collectionRows.length ? "No vocabulary matches these filters." : "No vocabulary here yet."}</div> : null}
      </div>}
    </section>
    {connections ? <ConnectionsPanel pack={connections.pack} card={connections.card} onClose={() => setConnections(null)} /> : null}
  </>;
}