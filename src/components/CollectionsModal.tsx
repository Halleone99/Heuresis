import { Archive, ArrowDown, ArrowUp, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { archiveCollection, createCollection, reorderCollections, updateCollection } from "../lib/advanced";
import type { AccentKey, Collection, PackWithType } from "../lib/heuresis";

type Props = { collections: Collection[]; packs: PackWithType[]; startNew?: boolean; onClose: () => void; onChanged: () => Promise<void> | void };
const ACCENTS: AccentKey[] = ["cinnabar", "indigo", "amber", "sage", "burgundy", "slate", "ink"];

export default function CollectionsModal({ collections, packs, startNew = false, onClose, onChanged }: Props) {
  const ordered = useMemo(() => [...collections].sort((a, b) => a.sort_order - b.sort_order), [collections]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = ordered.find((item) => item.id === editingId) ?? null;
  const [newOpen, setNewOpen] = useState(startNew);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [glyph, setGlyph] = useState("");
  const [accent, setAccent] = useState<AccentKey>("ink");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function beginEdit(collection: Collection) {
    setEditingId(collection.id); setNewOpen(false); setTitle(collection.title); setDescription(collection.description ?? ""); setGlyph(collection.glyph ?? ""); setAccent(collection.accent); setMessage("");
  }
  function beginNew() { setEditingId(null); setNewOpen(true); setTitle(""); setDescription(""); setGlyph(""); setAccent("ink"); setMessage(""); }
  function cancelEditor() { setEditingId(null); setNewOpen(false); setMessage(""); }

  async function save() {
    if (!title.trim()) return;
    setBusy(true); setMessage("");
    try {
      if (editing) await updateCollection(editing.id, { title, description, glyph, accent });
      else await createCollection({ title, description, glyph, accent });
      cancelEditor(); await onChanged();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the collection."); }
    finally { setBusy(false); }
  }

  async function move(id: string, direction: -1 | 1) {
    const index = ordered.findIndex((item) => item.id === id); const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    const ids = ordered.map((item) => item.id); [ids[index], ids[target]] = [ids[target], ids[index]];
    setBusy(true); try { await reorderCollections(ids); await onChanged(); } finally { setBusy(false); }
  }

  async function archive(collection: Collection) {
    if (!window.confirm(`Archive ${collection.title}?`)) return;
    setBusy(true); setMessage("");
    try { await archiveCollection(collection.id); if (editingId === collection.id) cancelEditor(); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not archive the collection."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="management-modal" role="dialog" aria-modal="true"><header className="settings-head"><div><p className="eyebrow">STRUCTURE</p><h2>Collections</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header><div className="collection-manager-list">{ordered.map((collection, index) => { const topicCount = packs.filter((pack) => pack.collection_id === collection.id).length; return <div key={collection.id} className="collection-manager-row" data-accent={collection.accent}><span className="manager-glyph">{collection.glyph || "·"}</span><button className="manager-copy" onClick={() => beginEdit(collection)}><strong>{collection.title}</strong><span>{collection.description || "No description"}</span><em>{topicCount} topic{topicCount === 1 ? "" : "s"}</em></button><div className="manager-order"><button disabled={busy || index === 0} onClick={() => void move(collection.id, -1)}><ArrowUp size={13} /></button><button disabled={busy || index === ordered.length - 1} onClick={() => void move(collection.id, 1)}><ArrowDown size={13} /></button></div><button className="icon-button subtle" disabled={busy} onClick={() => void archive(collection)} title="Archive collection"><Archive size={14} /></button></div>; })}</div><button className="secondary-button add-collection" onClick={beginNew}><Plus size={14} /> New collection</button>{editing || newOpen ? <div className="collection-editor"><p className="eyebrow">{editing ? "EDIT COLLECTION" : "NEW COLLECTION"}</p><div className="collection-editor-grid"><label className="field-row"><span>Title</span><input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Name this collection" /></label><label className="field-row"><span>Glyph</span><input value={glyph} maxLength={3} onChange={(event) => setGlyph(event.target.value)} placeholder="漢" /></label></div><label className="field-row"><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="field-row"><span>Accent</span><select value={accent} onChange={(event) => setAccent(event.target.value as AccentKey)}>{ACCENTS.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>{message ? <div className="settings-note error">{message}</div> : null}<div className="modal-actions"><button className="secondary-button" onClick={cancelEditor}>Cancel</button><button className="primary-button" disabled={busy || !title.trim()} onClick={() => void save()}>{busy ? "Saving…" : "Create collection"}</button></div></div> : message ? <div className="settings-note error">{message}</div> : null}</section></div>;
}
