import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { BookOpen, ImagePlus, Pencil, Trash2, X } from "lucide-react";
import type { KnowledgeSubject } from "../../lib/knowledgeWorkspace";
import { friendlyError } from "../../lib/knowledgeWorkspace";
import { useWorkspace } from "./WorkspaceContext";
import { KnowledgeRemovalDialog } from "./KnowledgeRemovalDialog";

// Appearance is a device preference. Notes and subject names remain in Supabase.
// Store photographs in IndexedDB rather than filling localStorage with base64.
const COLORS = ["", "#354b68", "#64404b", "#6a513a", "#35574e", "#504465", "#65465c"];
const STORE = "covers";
const DB = "heuresis-subject-covers-v1";
const colourKey = (userId: string, subjectId: string) => `heuresis.subject-colour.v1:${userId}:${subjectId}`;
const imageKey = (userId: string, subjectId: string) => `${userId}:${subjectId}`;

function openStore(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Image storage is not available on this device.")); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open image storage."));
  });
}
async function readCover(key: string): Promise<Blob | null> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  });
}
async function writeCover(key: string, blob: Blob | null): Promise<void> {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    if (blob) tx.objectStore(STORE).put(blob, key);
    else tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
    tx.onabort = () => { db.close(); reject(tx.error); };
  });
}
async function compressedCover(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size > 12 * 1024 * 1024) {
    throw new Error("Choose a JPG, PNG or WebP image below 12 MB.");
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const scale = Math.min(1, 1200 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Image processing is unavailable.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.78));
    if (!blob) throw new Error("Could not prepare this background image.");
    return blob;
  } finally { URL.revokeObjectURL(url); }
}
function readColour(userId: string, subjectId: string): string {
  try {
    const value = localStorage.getItem(colourKey(userId, subjectId)) ?? "";
    return COLORS.includes(value) ? value : "";
  } catch { return ""; }
}

export function SubjectCard({ subject, topics, notes, detail, editable = true, onOpen }: {
  subject: KnowledgeSubject; topics: number; notes: number; detail?: string; editable?: boolean; onOpen: () => void;
}) {
  const workspace = useWorkspace();
  const { userId } = workspace;
  const defaultAccent = ({ chinese: "#d9828f", german: "#70a8dc", russian: "#82c49a" } as Record<string, string>)[subject.name.trim().toLocaleLowerCase()] ?? "#91a3b5";
  const [colour, setColour] = useState(() => readColour(userId, subject.id));
  const [cover, setCover] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [name, setName] = useState(subject.name);
  const [draftColour, setDraftColour] = useState(colour);
  const [pendingImage, setPendingImage] = useState<Blob | null | undefined>(undefined);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const clickTimer = useRef<number | null>(null);
  const id = useId();

  useEffect(() => {
    let active = true;
    let url: string | null = null;
    void readCover(imageKey(userId, subject.id)).then((blob) => {
      if (!active || !blob) return;
      url = URL.createObjectURL(blob);
      setCover(url);
    }).catch(() => undefined);
    return () => { active = false; if (url) URL.revokeObjectURL(url); };
  }, [subject.id, userId]);
  useEffect(() => () => { if (clickTimer.current !== null) window.clearTimeout(clickTimer.current); }, []);
  useEffect(() => {
    if (!editing) return;
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && !event.defaultPrevented) setEditing(false); };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [editing]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function beginEdit() {
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    clickTimer.current = null;
    setName(subject.name);
    setDraftColour(colour);
    setPendingImage(undefined);
    setPreview(null);
    setEditing(true);
  }
  function clickCard(event: React.MouseEvent<HTMLButtonElement>) {
    if (!editable) { onOpen(); return; }
    if (event.detail === 0) { onOpen(); return; }
    if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
    // Wait for the real double-click event: opening a modal during click #2
    // can interrupt the browser’s double-click sequence.
    if (event.detail >= 2) return;
    clickTimer.current = window.setTimeout(() => { clickTimer.current = null; onOpen(); }, 310);
  }
  async function pickFile(file: File | undefined) {
    if (!file) return;
    try {
      const blob = await compressedCover(file);
      if (preview) URL.revokeObjectURL(preview);
      setPendingImage(blob);
      setPreview(URL.createObjectURL(blob));
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }
  async function save() {
    if (busy || !name.trim()) return;
    setBusy(true);
    try {
      if (name.trim() !== subject.name) await workspace.renameSubjectById(subject.id, name);
      if (pendingImage !== undefined) await writeCover(imageKey(userId, subject.id), pendingImage);
      try { localStorage.setItem(colourKey(userId, subject.id), draftColour); }
      catch { workspace.toast("Colour could not be saved on this device.", { tone: "error" }); }
      setColour(draftColour);
      if (pendingImage !== undefined) {
        if (cover) URL.revokeObjectURL(cover);
        setCover(pendingImage ? URL.createObjectURL(pendingImage) : null);
      }
      setEditing(false);
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
    finally { setBusy(false); }
  }
  return <>
    <div className={`nb-home-subject ${cover ? "has-cover" : ""} ${colour ? "has-colour" : ""}`}
      style={{ "--nb-subject-accent": colour || defaultAccent,
        backgroundImage: cover ? `linear-gradient(90deg, rgba(13,18,27,.86), rgba(13,18,27,.40)), url("${cover}")` : undefined } as CSSProperties}>
      <button type="button" className="nb-subject-open" onClick={clickCard}
        onDoubleClick={editable ? (event) => { event.preventDefault(); beginEdit(); } : undefined}
        title={editable ? `Open ${subject.name}; double-click to customise` : `Open ${subject.name}` }>
        <span className="nb-subject-icon" aria-hidden="true"><BookOpen /></span>
        <span className="nb-subject-copy">
          <strong>{subject.name}</strong>
          <span>{detail ?? `${topics} ${topics === 1 ? "topic" : "topics"} · ${notes} ${notes === 1 ? "note" : "notes"}`}</span>
        </span>
      </button>
      {workspace.writable && editable ? <button type="button" className="nb-subject-edit" onClick={beginEdit}
        aria-label={`Customise ${subject.name}`} title="Customise subject"><Pencil size={14} /></button> : null}
    </div>
    {editing ? <div className="nb-cover-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditing(false); }}>
      <form className="nb-cover-dialog" role="dialog" aria-modal="true" aria-label={`Edit ${subject.name}`}
        onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <div className="nb-cover-head"><strong>Edit subject</strong><button type="button" className="ws-icon-button" aria-label="Close" onClick={() => setEditing(false)}><X size={16}/></button></div>
        <label htmlFor={id}>Subject name</label>
        <input id={id} autoFocus maxLength={120} value={name} onChange={(event) => setName(event.target.value)} required />
        <span className="nb-cover-label">Card colour</span>
        <div className="nb-colour-row" role="group" aria-label="Card colour">
          {COLORS.map((value, index) => <button type="button" key={value || "default"}
            className={`nb-colour-option ${draftColour === value ? "is-selected" : ""}`}
            style={{ backgroundColor: value || "var(--ws-surface-2)" }}
            aria-label={index === 0 ? "Default" : `Colour ${index}`} aria-pressed={draftColour === value}
            onClick={() => setDraftColour(value)} />)}
        </div>
        <span className="nb-cover-label">Background image</span>
        <div className="nb-cover-image-actions">
          <label className="ws-button"><ImagePlus size={15} /> Choose image<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { void pickFile(event.target.files?.[0]); event.target.value = ""; }} /></label>
          {(preview || cover) && pendingImage !== null ? <button type="button" className="ws-button is-quiet"
            onClick={() => { if (preview) URL.revokeObjectURL(preview); setPreview(null); setPendingImage(null); }}><Trash2 size={14}/> Remove image</button> : null}
        </div>
        {(preview || (pendingImage === undefined && cover)) ? <div className="nb-cover-preview" style={{ backgroundImage: `url("${preview || cover}")` }} /> : null}
        <p className="nb-cover-hint">Double-click any subject card to edit it. Images and colours are saved on this device.</p>
        <div className="nb-cover-actions">
          <button type="button" className="ws-button is-quiet" style={{ marginRight: "auto", color: "var(--ws-bad)" }}
            disabled={busy} onClick={() => { setEditing(false); setRemoving(true); }}><Trash2 size={14} /> Delete</button>
          <button type="button" className="ws-button" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          <button type="submit" className="ws-button is-primary" disabled={busy || !name.trim()}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </div> : null}
    {removing ? <KnowledgeRemovalDialog
      target={{ kind: "subject", id: subject.id, name: subject.name }}
      onClose={() => setRemoving(false)}
      onRemoved={() => {
        try { localStorage.removeItem(colourKey(userId, subject.id)); } catch { /* optional device preference */ }
        void writeCover(imageKey(userId, subject.id), null).catch(() => undefined);
      }}
    /> : null}
  </>;
}
