import { Archive, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { archivePack, createPack, deletePack, updatePack } from "../lib/advanced";
import { listCardTypes, type CardType, type Collection, type PackWithType } from "../lib/heuresis";

type Props = {
  collections: Collection[];
  pack: PackWithType | null;
  preferredCollectionId?: string | null;
  onClose: () => void;
  onChanged: (createdId?: string) => Promise<void> | void;
};

export default function TopicModal({ collections, pack, preferredCollectionId, onClose, onChanged }: Props) {
  const [types, setTypes] = useState<CardType[]>([]);
  const [collectionId, setCollectionId] = useState(pack?.collection_id ?? preferredCollectionId ?? collections[0]?.id ?? "");
  const [typeId, setTypeId] = useState(pack?.card_type_id ?? "");
  const [title, setTitle] = useState(pack?.title ?? "");
  const [description, setDescription] = useState(pack?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  useEffect(() => { void listCardTypes().then((items) => { setTypes(items); if (!pack && !typeId) setTypeId(items[0]?.id ?? ""); }).catch((error) => setMessage(error instanceof Error ? error.message : "Could not load card types.")); }, [pack, typeId]);

  async function save() {
    if (!title.trim() || !collectionId || (!pack && !typeId)) return;
    setBusy(true); setMessage("");
    try {
      if (pack) { await updatePack(pack.id, { collection_id: collectionId, title, description }); await onChanged(); }
      else { const id = await createPack({ collectionId, cardTypeId: typeId, title, description }); await onChanged(id); }
      onClose();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the topic."); }
    finally { setBusy(false); }
  }

  async function archive() {
    if (!pack) return;
    if (!window.confirm(`Archive ${pack.title}?`)) return;
    setBusy(true); setMessage("");
    try { await archivePack(pack.id); await onChanged(); onClose(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not archive the topic."); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!pack || !deleteConfirm) return;
    setBusy(true); setMessage("");
    try { await deletePack(pack.id); await onChanged(); onClose(); }
    catch (error) { setDeleteConfirm(false); setMessage(error instanceof Error ? error.message : "Could not delete the topic."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="topic-modal" role="dialog" aria-modal="true"><header className="settings-head"><div><p className="eyebrow">{pack ? "TOPIC SETTINGS" : "NEW TOPIC"}</p><h2>{pack ? "Rename or reorganise." : "Create a bounded learning space."}</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header><div className="topic-form"><label className="field-row"><span>Collection</span><select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label>{!pack ? <label className="field-row"><span>Card type</span><select value={typeId} onChange={(event) => setTypeId(event.target.value)}>{types.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}</select></label> : <div className="topic-type-note"><span>Card type</span><strong>{pack.cardType?.name || "Existing type"}</strong><small>Card type stays fixed after creation so existing cards keep their schema.</small></div>}<label className="field-row"><span>Title</span><input autoFocus value={title} onChange={(event) => { setTitle(event.target.value); setDeleteConfirm(false); }} /></label><label className="field-row"><span>Description</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></label>{deleteConfirm && pack ? <div className="settings-note error"><strong>Delete “{pack.title}” permanently?</strong><span>This removes the topic, its cards, study history and related links. This cannot be undone.</span></div> : null}{message ? <div className="settings-note error">{message}</div> : null}</div><div className="topic-modal-footer">{pack ? <><button className="secondary-button danger-text" disabled={busy} onClick={() => void archive()}><Archive size={14} /> Archive</button>{deleteConfirm ? <><button className="secondary-button" disabled={busy} onClick={() => setDeleteConfirm(false)}>Keep topic</button><button className="danger-button" disabled={busy} onClick={() => void remove()}><Trash2 size={14} /> {busy ? "Deleting…" : "Delete permanently"}</button></> : <button className="secondary-button danger-text" disabled={busy} onClick={() => { setMessage(""); setDeleteConfirm(true); }}><Trash2 size={14} /> Delete</button>}</> : null}<span /><button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || deleteConfirm || !title.trim() || !collectionId || (!pack && !typeId)} onClick={() => void save()}>{busy ? "Saving…" : pack ? "Save changes" : "Create topic"}</button></div></section></div>;
}
