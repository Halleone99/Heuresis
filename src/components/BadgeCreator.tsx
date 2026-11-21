import { useState, type KeyboardEvent } from "react";
import { createBadge, deleteBadge } from "../lib/settingsData";
import type { HeuresisTag } from "../lib/heuresis";

const SWATCHES = ["#86b2ff","#86d49a","#f1c56c","#ab9ef2","#f2907f","#f29ac1","#62c4b8","#d2a26e"];
const RESERVED = new Set(["c","u","p","r","e","l","s","d","t","n","y","b","h","i","v"," "]);
export default function BadgeCreator({
  badges, onClose, onCreated, onDeleted,
}: {
  badges: HeuresisTag[]; onClose: () => void;
  onCreated: (badge: HeuresisTag) => Promise<void>; onDeleted: (id: string) => Promise<void>;
}) {
  const [name,setName] = useState("");
  const [color,setColor] = useState(SWATCHES[0]);
  const [shortcut,setShortcut] = useState<string | null>(null);
  const [error,setError] = useState("");
  const [busy,setBusy] = useState(false);
  function assignKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab") return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === "Backspace" || e.key === "Delete" || e.key === "Escape") { setShortcut(null); return; }
    const key = e.key.toLowerCase();
    if (key.length !== 1 || !/^[a-z]$/.test(key) || RESERVED.has(key)) {
      setError("Reserved key. 1–4, C/U/P, R, E, L, S, D, T, N, Y, B, H, I, V, ?, Space and [ ] are used by the card.");
      return;
    }
    if (badges.some(tag => tag.shortcut?.toLowerCase() === key)) {
      setError("That shortcut already belongs to another badge."); return;
    }
    setShortcut(key); setError("");
  }
  async function create() {
    const clean = name.trim().replace(/\s+/g," ");
    if (!clean || clean.length > 48) { setError("Enter a badge name of up to 48 characters."); return; }
    if (badges.some(tag => tag.name.toLowerCase() === clean.toLowerCase())) { setError("A badge with this name already exists."); return; }
    setBusy(true); setError("");
    try {
      const id = await createBadge({ name:clean,color,shortcut });
      await onCreated({ id, name:clean,color,shortcut,is_badge:true,sort_order:badges.length });
      setName(""); setShortcut(null); onClose();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not create badge."); }
    finally { setBusy(false); }
  }
  async function remove(tag: HeuresisTag) {
    setBusy(true); setError("");
    try { await deleteBadge(tag.id); await onDeleted(tag.id); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not delete badge."); }
    finally { setBusy(false); }
  }
  return <div className="sort-badge-popover" role="dialog" aria-label="New badge"
    onKeyDown={e => e.stopPropagation()}>
    <div className="sort-badge-popover-title"><strong>Badges</strong><button type="button" onClick={onClose} aria-label="Close badge creator">×</button></div>
    <label>Name<input autoFocus maxLength={48} value={name} placeholder="e.g. Tricky" onChange={e => setName(e.target.value)}
      onKeyDown={e => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); void create(); } }} /></label>
    <span className="sort-badge-subtitle">Colour</span>
    <div className="sort-badge-swatches">{SWATCHES.map(s => <button type="button" key={s} className={color === s ? "selected" : ""}
      title={s} aria-label={"Colour "+s} aria-pressed={color === s} onClick={() => setColor(s)}><i style={{background:s}}/></button>)}
      <input type="color" aria-label="Custom badge colour" value={color} onChange={e => setColor(e.target.value)} /></div>
    <label>Shortcut<input aria-label="Shortcut key" readOnly value={shortcut?.toUpperCase() || ""} placeholder="Press a letter"
      onKeyDown={assignKey}/></label>
    <button className="sort-create-badge" disabled={busy || !name.trim()} type="button" onClick={() => void create()}>Save and add to card</button>
    {badges.length ? <div className="sort-badge-existing"><span>Existing badges</span>{badges.map(tag =>
      <div key={tag.id}><i style={{background:tag.color || "var(--ws-accent)"}}/>
        <span>{tag.name}</span><small>{tag.shortcut?.toUpperCase()}</small>
        <button type="button" disabled={busy} title={"Delete "+tag.name} onClick={() => void remove(tag)}>×</button>
      </div>)}</div> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
