import { ArrowLeft, BookOpen, Brain, Compass, FileUp, Filter, Link2, Plus, Search, Settings2, Star } from "lucide-react";
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
import BrowseModal from "./BrowseModal";
import CardImagesEditor from "./CardImagesEditor";
import ImportModal from "./ImportModal";
import RelatedEditor from "./RelatedEditor";
import RelatedView from "./RelatedView";
import StudyModal from "./StudyModal";

type FilterKey = "all" | "new" | "favourite" | "interesting" | "again";
type Props = {
  pack: PackWithType;
  collection: Collection | null;
  onBack: () => void;
  onCapture: () => void;
  onSettings: () => void;
  onChanged: () => void;
};

function CardEditor({ pack, card, tags, onClose, onSaved, onDeleted, onChanged }: {
  pack: PackWithType;
  card: CardWithStats;
  tags: HeuresisTag[];
  onClose: () => void;
  onSaved: () => void;
  onDeleted: () => void;
  onChanged: () => void;
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
        <div className="editor-head"><div><p className="eyebrow">CARD</p><h2>Edit card</h2></div><button className="text-button" onClick={onClose}>Close</button></div>
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

export default function PackView({ pack, collection, onBack, onCapture, onSettings, onChanged }: Props) {
  const [cards, setCards] = useState<CardWithStats[]>([]);
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [editing, setEditing] = useState<CardWithStats | null>(null);
  const [studyOpen, setStudyOpen] = useState(false);
  const [relatedOpen, setRelatedOpen] = useState(false);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  async function reload() {
    setLoading(true); setError("");
    try {
      const [nextCards, nextTags] = await Promise.all([listCards(pack.id), listTags()]);
      setCards(nextCards); setTags(nextTags);
      setEditing((current) => current ? nextCards.find((card) => card.id === current.id) ?? current : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load cards.");
    } finally { setLoading(false); }
  }

  useEffect(() => { void reload(); }, [pack.id]);

  const term = fieldByRole(pack.cardType, "term") ?? pack.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack.cardType, "reading");
  const meaning = fieldByRole(pack.cardType, "meaning") ?? pack.cardType?.field_schema[1] ?? null;
  const shown = useMemo(() => cards.filter((card) => {
    if (filter === "new" && card.stats.encounter_count !== 0) return false;
    if (filter === "favourite" && !card.favourite) return false;
    if (filter === "interesting" && (card.interest_rank ?? 0) < 4) return false;
    if (filter === "again" && card.stats.again_count < 2) return false;
    const needle = query.trim().toLowerCase();
    if (!needle) return true;
    return Object.values(card.data).flatMap((value) => Array.isArray(value) ? value : [value]).filter(Boolean).join(" ").toLowerCase().includes(needle)
      || card.tags.some((tag) => tag.name.toLowerCase().includes(needle));
  }), [cards, filter, query]);
  const explored = pack.card_count ? Math.round((pack.encountered_cards / pack.card_count) * 100) : 0;

  async function refreshAll(closeEditor = false) {
    if (closeEditor) setEditing(null);
    await reload();
    onChanged();
  }

  if (relatedOpen) return <RelatedView pack={pack} onBack={() => setRelatedOpen(false)} onChanged={() => void refreshAll()} />;

  return (
    <section className="pack-page desktop-pack-page" data-accent={collection?.accent ?? "ink"}>
      <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> {collection?.title || "Library"}</button>
      <header className="pack-page-head">
        <div><p className="eyebrow">TOPIC</p><h1>{pack.title}</h1>{pack.description ? <p>{pack.description}</p> : null}<span className="pack-record">{pack.card_count} cards · {pack.encountered_cards} encountered · {explored}% explored · opened {pack.open_count}×</span></div>
        <button className="text-button" onClick={onSettings}><Settings2 size={15} /> Rename / settings</button>
      </header>

      <div className="topic-action-bar">
        <button className="primary-button" disabled={!cards.length} onClick={() => setStudyOpen(true)}><Brain size={15} /> Flashcards</button>
        <button className="secondary-button" onClick={() => setRelatedOpen(true)}><Link2 size={15} /> Related</button>
        <button className="secondary-button" disabled={!cards.length} onClick={() => setBrowseOpen(true)}><Compass size={15} /> Browse</button>
        <button className="secondary-button" onClick={() => setImportOpen(true)}><FileUp size={15} /> Import</button>
        <button className="secondary-button" onClick={onCapture}><Plus size={15} /> Add card</button>
      </div>

      <div className="pack-toolbar"><label className="pack-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this topic" /></label><div className="filter-strip"><Filter size={14} />{([['all', 'All'], ['new', 'Never encountered'], ['favourite', 'Favourites'], ['interesting', 'Interest 4–5'], ['again', 'Often Again']] as Array<[FilterKey, string]>).map(([key, label]) => <button key={key} className={filter === key ? "selected" : ""} onClick={() => setFilter(key)}>{label}</button>)}</div></div>

      {loading ? <div className="content-state">Opening cards…</div> : null}
      {!loading && error ? <div className="content-state error-state"><strong>Could not load this topic.</strong><span>{error}</span></div> : null}
      {!loading && !error ? <div className="card-table"><div className="card-table-head"><span>{shown.length} shown</span><span>{cards.length.toLocaleString()} loaded</span></div>{shown.map((card) => <button className="card-data-row" key={card.id} onClick={() => setEditing(card)}><span className="card-term"><strong>{fieldText(card.data, term?.key) || "Untitled"}</strong>{reading ? <em>{fieldText(card.data, reading.key)}</em> : null}</span><span className="card-meaning"><span>{fieldText(card.data, meaning?.key)}</span>{card.tags.length ? <span className="row-tags">{card.tags.slice(0, 4).map((tag) => <i key={tag.id} className={tag.is_badge ? "badge" : ""}>{tag.name}</i>)}{card.tags.length > 4 ? <i>+{card.tags.length - 4}</i> : null}</span> : null}</span><span className="card-tally">{card.interest_rank ? <b>{card.interest_rank}</b> : null}{card.stats.encounter_count ? `${card.stats.encounter_count}×` : "—"}{card.favourite ? <Star size={12} fill="currentColor" /> : null}{card.note ? <span title="Has note">✎</span> : null}</span></button>)}{!shown.length ? <div className="pack-empty"><BookOpen size={20} /><strong>No matching cards.</strong><span>Change the filter or add a new card.</span></div> : null}</div> : null}

      {editing ? <CardEditor pack={pack} card={editing} tags={tags} onClose={() => setEditing(null)} onSaved={() => void refreshAll(true)} onDeleted={() => void refreshAll(true)} onChanged={() => void refreshAll()} /> : null}
      {studyOpen ? <StudyModal pack={pack} cards={cards} onClose={() => setStudyOpen(false)} onComplete={() => void refreshAll()} /> : null}
      {browseOpen ? <BrowseModal pack={pack} cards={cards} onClose={() => setBrowseOpen(false)} onComplete={() => void refreshAll()} /> : null}
      {importOpen ? <ImportModal pack={pack} onClose={() => setImportOpen(false)} onDone={() => refreshAll()} /> : null}
    </section>
  );
}
