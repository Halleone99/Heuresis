import { ArrowLeft, ChevronDown, ExternalLink, Plus, Search, Trash2 } from "lucide-react";
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

type EditingWord = { id: string; term: string; reading: string; meaning: string };
type WordStatus = "new" | "topic";
type SortKey = "word" | "relation" | "source" | "status";
type SortDirection = "asc" | "desc";

function toggleValue<T>(items: T[], value: T) {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function relationLabel(value: RelationType) {
  return value === "synonym" ? "Synonym" : value === "antonym" ? "Antonym" : "Related";
}

function statusOf(row: RelatedCatalogueRow): WordStatus {
  return row.target_role === "main" ? "topic" : "new";
}

export default function RelatedCatalogueView({ packs, collection = null, onBack, onOpenPack, onTopicCreated }: Props) {
  const [rows, setRows] = useState<RelatedCatalogueRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [relationFilters, setRelationFilters] = useState<RelationType[]>([]);
  const [statusFilters, setStatusFilters] = useState<WordStatus[]>([]);
  const [packFilters, setPackFilters] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [activeRow, setActiveRow] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [topicTitle, setTopicTitle] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [editing, setEditing] = useState<EditingWord | null>(null);
  const [editBusy, setEditBusy] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("word");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);

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

  const filtered = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return collectionRows.filter((row) => {
      if (relationFilters.length && !relationFilters.includes(row.relation_type)) return false;
      if (statusFilters.length && !statusFilters.includes(statusOf(row))) return false;
      if (packFilters.length && !packFilters.includes(row.pack_id)) return false;
      if (!q) return true;
      return [row.pack_title, row.source_term, row.source_reading, row.source_meaning, row.term, row.reading, row.meaning, ...row.source_tags].join(" ").toLocaleLowerCase().includes(q);
    });
  }, [collectionRows, packFilters, query, relationFilters, statusFilters]);

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

  const visibleWordIds = useMemo(() => Array.from(new Set(shown.map((row) => row.target_card_id))), [shown]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const uniqueWords = visibleWordIds.length;
  const allVisibleSelected = visibleWordIds.length > 0 && visibleWordIds.every((id) => selectedSet.has(id));
  const activeFilterCount = relationFilters.length + statusFilters.length + packFilters.length;

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

  function toggleSort(next: SortKey) {
    if (sortKey === next) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSortKey(next); setSortDirection("asc"); }
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
    catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not move this word into the source topic."); }
  }

  return <section className="related-catalogue-page vocabulary-page">
    <button className="text-button back-button vocabulary-back" onClick={onBack}><ArrowLeft size={15} /> {collection ? collection.title : "Library"}</button>

    <header className="vocabulary-heading">
      <div><p className="eyebrow">VOCABULARY</p><h1>{collection ? "New words" : "Vocabulary"}</h1><p>{collection ? collection.title : "Words discovered from your cards."}</p></div>
      <div className="vocabulary-heading-side"><span><b>{uniqueWords.toLocaleString()}</b> words</span><span><b>{shown.length.toLocaleString()}</b> connections</span>{collection ? <button className="primary-button" disabled={!selected.length} onClick={() => setCreating(true)}><Plus size={14} /> New topic{selected.length ? ` · ${selected.length}` : ""}</button> : null}</div>
    </header>

    {collection && creating ? <div className="related-create-topic vocabulary-inline-editor">
      <div><span className="eyebrow">NEW TOPIC</span><strong>{selected.length} selected</strong></div>
      <input autoFocus value={topicTitle} onChange={(event) => setTopicTitle(event.target.value)} placeholder="Topic name" onKeyDown={(event) => { if (event.key === "Enter" && topicTitle.trim() && !createBusy) void createTopic(); }} />
      <button className="secondary-button" disabled={createBusy} onClick={() => setCreating(false)}>Cancel</button>
      <button className="primary-button" disabled={createBusy || !topicTitle.trim() || !selected.length} onClick={() => void createTopic()}>{createBusy ? "Creating…" : "Create"}</button>
    </div> : null}

    {editing ? <div className="related-edit-word vocabulary-inline-editor">
      <div><span className="eyebrow">EDIT</span><strong>{editing.term}</strong></div>
      <input autoFocus value={editing.term} onChange={(event) => setEditing((current) => current ? { ...current, term: event.target.value } : current)} placeholder="Word" />
      <input value={editing.reading} onChange={(event) => setEditing((current) => current ? { ...current, reading: event.target.value } : current)} placeholder="Reading / pinyin" />
      <input value={editing.meaning} onChange={(event) => setEditing((current) => current ? { ...current, meaning: event.target.value } : current)} placeholder="Meaning" onKeyDown={(event) => { if (event.key === "Enter" && editing.term.trim() && !editBusy) void saveEdit(); }} />
      <button className="secondary-button" disabled={editBusy} onClick={() => setEditing(null)}>Cancel</button>
      <button className="primary-button" disabled={editBusy || !editing.term.trim()} onClick={() => void saveEdit()}>{editBusy ? "Saving…" : "Save"}</button>
    </div> : null}

    <div className="vocabulary-toolbar">
      <label className="vocabulary-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search word, meaning or source" /></label>

      <details className="vocabulary-filter-menu">
        <summary className={statusFilters.length ? "active" : ""}>Status{statusFilters.length ? <b>{statusFilters.length}</b> : null}<ChevronDown size={13} /></summary>
        <div className="vocabulary-filter-popover">
          <button className={statusFilters.includes("new") ? "selected" : ""} onClick={(event) => { event.preventDefault(); setStatusFilters((current) => toggleValue(current, "new")); }}><span>New word</span><small>{collectionRows.filter((row) => statusOf(row) === "new").length}</small></button>
          <button className={statusFilters.includes("topic") ? "selected" : ""} onClick={(event) => { event.preventDefault(); setStatusFilters((current) => toggleValue(current, "topic")); }}><span>In a topic</span><small>{collectionRows.filter((row) => statusOf(row) === "topic").length}</small></button>
        </div>
      </details>

      <details className="vocabulary-filter-menu">
        <summary className={relationFilters.length ? "active" : ""}>Type{relationFilters.length ? <b>{relationFilters.length}</b> : null}<ChevronDown size={13} /></summary>
        <div className="vocabulary-filter-popover">
          {(["synonym", "antonym", "related"] as RelationType[]).map((value) => <button key={value} className={relationFilters.includes(value) ? "selected" : ""} onClick={(event) => { event.preventDefault(); setRelationFilters((current) => toggleValue(current, value)); }}><span>{relationLabel(value)}</span><small>{collectionRows.filter((row) => row.relation_type === value).length}</small></button>)}
        </div>
      </details>

      {availablePacks.length > 1 ? <details className="vocabulary-filter-menu source-menu">
        <summary className={packFilters.length ? "active" : ""}>Source{packFilters.length ? <b>{packFilters.length}</b> : null}<ChevronDown size={13} /></summary>
        <div className="vocabulary-filter-popover vocabulary-source-popover">
          {availablePacks.map((pack) => <button key={pack.id} className={packFilters.includes(pack.id) ? "selected" : ""} onClick={(event) => { event.preventDefault(); setPackFilters((current) => toggleValue(current, pack.id)); }}><span>{pack.title}</span><small>{collectionRows.filter((row) => row.pack_id === pack.id).length}</small></button>)}
        </div>
      </details> : null}

      {activeFilterCount ? <button className="vocabulary-clear" onClick={() => { setRelationFilters([]); setStatusFilters([]); setPackFilters([]); }}>Clear {activeFilterCount}</button> : null}
      {collection ? <button className="vocabulary-select-visible" disabled={!visibleWordIds.length} onClick={toggleVisible}>{allVisibleSelected ? "Clear visible" : "Select visible"}</button> : null}
    </div>

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
        const isSelected = collection ? selectedSet.has(row.target_card_id) : activeRow === row.relation_id;
        return <div
          className={`vocabulary-row ${isSelected ? "selected" : ""}`}
          key={row.relation_id}
          onClick={() => { if (collection) toggleSelected(row.target_card_id); else setActiveRow(row.relation_id); }}
          onDoubleClick={(event) => { event.preventDefault(); beginEdit(row); }}
          title="Click to select · double-click to edit"
        >
          <div className="vocabulary-word"><strong>{row.term || "Untitled"}</strong>{row.reading ? <em>{row.reading}</em> : null}<p>{row.meaning}</p></div>
          <span className={`relation-badge relation-${row.relation_type}`}>{relationLabel(row.relation_type)}</span>
          <div className="vocabulary-source" title={sourceTitle}><small>{row.pack_title}</small><span>{row.source_term || "Untitled"}</span>{row.source_reading ? <em>{row.source_reading}</em> : null}</div>
          <span className={`vocabulary-status ${statusOf(row)}`}>{statusOf(row) === "topic" ? "In topic" : "New"}</span>
          <div className="vocabulary-actions">{pack ? <button title="Open source topic" onClick={(event) => { event.stopPropagation(); onOpenPack(pack); }}><ExternalLink size={14} /></button> : null}{row.target_role === "related" ? <button title="Move into source topic" onClick={(event) => { event.stopPropagation(); void promote(row); }}>↑</button> : null}<button title="Remove connection" onClick={(event) => { event.stopPropagation(); void remove(row); }}><Trash2 size={14} /></button></div>
        </div>;
      })}
      {!shown.length ? <div className="catalogue-empty">{collectionRows.length ? "No vocabulary matches these filters." : "No vocabulary here yet."}</div> : null}
    </div>}
  </section>;
}
