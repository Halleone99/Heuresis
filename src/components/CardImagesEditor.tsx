import { ImagePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { patchCardData, type CardWithStats } from "../lib/heuresis";
import { removeHeuresisCardImage, signHeuresisCardImages, uploadHeuresisCardImage } from "../lib/cardMedia";

const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";
type ImageBlock = { id: string; type: "image"; path: string; caption: string; dim?: string };

function rawBlocks(card: CardWithStats) {
  const raw = card.data[WORKSPACE_BLOCKS_KEY];
  return Array.isArray(raw) ? [...raw] : [];
}

function imageBlocks(raw: string[]): ImageBlock[] {
  return raw.flatMap((entry) => {
    try {
      const value = JSON.parse(entry) as Partial<ImageBlock>;
      return value.type === "image" && typeof value.id === "string" && typeof value.path === "string"
        ? [{ id: value.id, type: "image" as const, path: value.path, caption: typeof value.caption === "string" ? value.caption : "", dim: typeof value.dim === "string" ? value.dim : "notes" }]
        : [];
    } catch { return []; }
  });
}

export default function CardImagesEditor({ card, onChanged }: { card: CardWithStats; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [raw, setRaw] = useState(() => rawBlocks(card));
  const [signed, setSigned] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const images = useMemo(() => imageBlocks(raw), [raw]);

  useEffect(() => { setRaw(rawBlocks(card)); }, [card.id, card.updated_at]);
  useEffect(() => {
    let active = true;
    const paths = images.map((image) => image.path);
    if (!paths.length) { setSigned({}); return; }
    void signHeuresisCardImages(paths).then((urls) => { if (active) setSigned(urls); }).catch(() => { if (active) setSigned({}); });
    return () => { active = false; };
  }, [images.map((image) => image.path).join("|")]);

  async function persist(next: string[]) {
    await patchCardData(card.id, { [WORKSPACE_BLOCKS_KEY]: next });
    setRaw(next);
    onChanged();
  }

  async function add(files: FileList | null) {
    if (!files?.length || busy) return;
    setBusy(true); setMessage("");
    const uploaded: string[] = [];
    try {
      const selected = Array.from(files).slice(0, 8);
      for (const file of selected) uploaded.push(await uploadHeuresisCardImage(card.id, file));
      const entries = uploaded.map((path) => JSON.stringify({ id: crypto.randomUUID(), type: "image", path, caption: "", dim: "notes" }));
      await persist([...raw, ...entries]);
      setMessage(`${uploaded.length} image${uploaded.length === 1 ? "" : "s"} added.`);
    } catch (error) {
      await Promise.all(uploaded.map((path) => removeHeuresisCardImage(path).catch(() => undefined)));
      setMessage(error instanceof Error ? error.message : "Could not add image.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
      setBusy(false);
    }
  }

  async function remove(image: ImageBlock) {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const next = raw.filter((entry) => {
        try { return (JSON.parse(entry) as { id?: string }).id !== image.id; } catch { return true; }
      });
      await persist(next);
      await removeHeuresisCardImage(image.path);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove image."); }
    finally { setBusy(false); }
  }

  async function saveCaption(image: ImageBlock, caption: string) {
    const next = raw.map((entry) => {
      try {
        const value = JSON.parse(entry) as Record<string, unknown>;
        return value.id === image.id ? JSON.stringify({ ...value, caption }) : entry;
      } catch { return entry; }
    });
    try { await persist(next); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save caption."); }
  }

  return <div className="tag-editor">
    <span className="eyebrow">IMAGES</span>
    <input ref={fileRef} className="hidden-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple onChange={(event) => void add(event.target.files)} />
    <button className="secondary-button" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> Add image</button>
    {images.length ? <div className="card-image-grid">{images.map((image) => <figure key={image.id} className="card-image-item">
      {signed[image.path] ? <img src={signed[image.path]} alt={image.caption || "Card reference"} /> : <div className="content-state compact">Loading image…</div>}
      <input defaultValue={image.caption} placeholder="Caption" onBlur={(event) => { if (event.target.value !== image.caption) void saveCaption(image, event.target.value); }} />
      <button className="text-button" disabled={busy} onClick={() => void remove(image)}><Trash2 size={13} /> Remove</button>
    </figure>)}</div> : <p className="settings-note">No images on this card.</p>}
    {message ? <div className="editor-message">{message}</div> : null}
  </div>;
}
