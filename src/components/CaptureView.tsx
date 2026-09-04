import { FormEvent, useEffect, useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { createCard, listTags, type Collection, type HeuresisTag, type PackWithType } from "../lib/heuresis";

type Props = {
  collections: Collection[];
  packs: PackWithType[];
  initialPack: PackWithType | null;
  onBack: () => void;
  onSaved?: () => void;
};

export default function CaptureView({ collections, packs, initialPack, onBack, onSaved }: Props) {
  const [collectionId, setCollectionId] = useState(initialPack?.collection_id ?? collections[0]?.id ?? "");
  const availablePacks = useMemo(() => packs.filter((pack) => pack.collection_id === collectionId), [collectionId, packs]);
  const [packId, setPackId] = useState(initialPack?.id ?? availablePacks[0]?.id ?? "");
  const pack = packs.find((item) => item.id === packId) ?? null;
  const [values, setValues] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { void listTags().then(setTags).catch(() => setTags([])); }, []);
  useEffect(() => { if (initialPack) { setCollectionId(initialPack.collection_id); setPackId(initialPack.id); } }, [initialPack]);
  useEffect(() => { if (!availablePacks.some((item) => item.id === packId)) setPackId(availablePacks[0]?.id ?? ""); }, [availablePacks, packId]);
  useEffect(() => { setValues({}); setNote(""); setTagIds([]); setStatus(""); }, [packId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onBack(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  const fields = pack?.cardType?.field_schema ?? [];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!pack) return;
    setSaving(true); setStatus("");
    try {
      await createCard(pack, values, note, tagIds);
      setValues({}); setNote(""); setTagIds([]); setStatus("Saved to Heuresis"); onSaved?.();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Could not save card"); }
    finally { setSaving(false); }
  }

  return (
    <div className="capture-popup-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onBack(); }}>
      <section className="capture-popup" role="dialog" aria-modal="true" aria-label="Capture a Heuresis card">
        <header className="capture-popup-head"><div><p className="eyebrow">CAPTURE</p><h2>Add card</h2></div><button onClick={onBack} aria-label="Close capture"><X size={17} /></button></header>
        <div className="capture-popup-body">
          <aside className="capture-context">
            <h1>Capture without leaving where you are.</h1><p>Choose a destination, add the card, save, and keep going. The current Heuresis page stays underneath.</p>
            <label>Collection<select value={collectionId} onChange={(event) => setCollectionId(event.target.value)}>{collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.title}</option>)}</select></label>
            <label>Topic<select value={packId} onChange={(event) => setPackId(event.target.value)}>{availablePacks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
            {pack?.cardType ? <div className="type-chip">{pack.cardType.name}</div> : null}
          </aside>

          <form className="capture-card" onSubmit={save}>
            <div className="capture-card-head"><div><p className="eyebrow">NEW CARD</p><h2>{pack?.title || "Choose a topic"}</h2></div><Plus size={21} /></div>
            {!pack ? <div className="capture-empty">Create or select a topic before capturing a card.</div> : null}
            {pack && !fields.length ? <div className="capture-empty">This topic has no readable field schema yet.</div> : null}
            {fields.map((field, index) => <label className="field-row" key={field.key}><span>{field.label}{field.required ? <b> *</b> : null}</span>{field.role === "example" || field.role === "extra" ? <textarea rows={3} autoFocus={index === 0} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} /> : <input autoFocus={index === 0} value={values[field.key] ?? ""} onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))} />}</label>)}
            {pack ? <label className="field-row"><span>Note <small>optional</small></span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} /></label> : null}
            {pack && tags.length ? <div className="capture-tags"><span className="eyebrow">TAGS</span><div className="tag-choice-list">{tags.map((tag) => { const selected = tagIds.includes(tag.id); return <button type="button" key={tag.id} className={`tag-choice ${selected ? "selected" : ""} ${tag.is_badge ? "badge" : ""}`} onClick={() => setTagIds((current) => selected ? current.filter((id) => id !== tag.id) : [...current, tag.id])}>{tag.name}</button>; })}</div></div> : null}
            <div className="capture-actions"><span className={status.toLowerCase().includes("saved") ? "save-status success" : "save-status"}>{status}</span><button className="primary-button" disabled={!pack || !fields.length || saving} type="submit"><Check size={16} />{saving ? "Saving…" : "Save card"}</button></div>
          </form>
        </div>
      </section>
    </div>
  );
}
