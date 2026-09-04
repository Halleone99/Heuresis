import { ArrowDown, ArrowUp, Plus, Tag, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listTags, type HeuresisTag } from "../lib/heuresis";
import { createBadge, demoteBadge, promoteTagToBadge, updateBadge } from "../lib/settingsData";

export const BADGE_EVENT = "heuresis:badges-changed";
type Draft = { name: string; shortcut: string };

function emitChanged() { window.dispatchEvent(new CustomEvent(BADGE_EVENT)); }

export default function SortingSettings() {
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newName, setNewName] = useState("");
  const [newShortcut, setNewShortcut] = useState("");
  const [promoteId, setPromoteId] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    const next = await listTags();
    setTags(next);
    setDrafts(Object.fromEntries(next.filter((tag) => tag.is_badge).map((tag) => [tag.id, { name: tag.name, shortcut: tag.shortcut ?? "" }])));
    const ordinary = next.filter((tag) => !tag.is_badge);
    setPromoteId((current) => ordinary.some((tag) => tag.id === current) ? current : ordinary[0]?.id ?? "");
  }

  useEffect(() => { void load().catch(() => setNotice("Could not load sorting badges.")); }, []);
  const badges = useMemo(() => tags.filter((tag) => tag.is_badge).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name)), [tags]);
  const ordinary = useMemo(() => tags.filter((tag) => !tag.is_badge), [tags]);

  async function addBadge() {
    if (!newName.trim()) return;
    setBusy("new"); setNotice("");
    try { await createBadge({ name: newName, shortcut: newShortcut }); setNewName(""); setNewShortcut(""); await load(); emitChanged(); setNotice("Badge added."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not add the badge."); }
    finally { setBusy(""); }
  }

  async function saveBadge(tag: HeuresisTag) {
    const draft = drafts[tag.id]; if (!draft) return;
    setBusy(tag.id); setNotice("");
    try { await updateBadge(tag.id, { name: draft.name, shortcut: draft.shortcut || null }); await load(); emitChanged(); setNotice("Badge saved."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save the badge."); }
    finally { setBusy(""); }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction; if (target < 0 || target >= badges.length) return;
    const current = badges[index]; const other = badges[target];
    setBusy(current.id); setNotice("");
    try { await updateBadge(current.id, { sort_order: other.sort_order }); await updateBadge(other.id, { sort_order: current.sort_order }); await load(); emitChanged(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not reorder badges."); }
    finally { setBusy(""); }
  }

  return <section className="sorting-settings"><div className="settings-section-heading"><strong>Sorting badges</strong><span>These are the fast tags shown while you decide card priority.</span></div><div className="interest-preview"><span>Interest</span><div>{[1,2,3,4,5].map((rank) => <b key={rank}>{rank}</b>)}</div><small>1 = little interest · 5 = exceptionally interesting · blank = not sorted yet</small></div><div className="badge-settings-list">{badges.map((tag, index) => { const draft = drafts[tag.id] ?? { name: tag.name, shortcut: tag.shortcut ?? "" }; return <div className="badge-settings-row" key={tag.id}><span className="badge-mark"><Tag size={13} /></span><input value={draft.name} aria-label="Badge name" onChange={(event) => setDrafts((current) => ({ ...current, [tag.id]: { ...draft, name: event.target.value } }))} /><label><span>code</span><input value={draft.shortcut} maxLength={12} onChange={(event) => setDrafts((current) => ({ ...current, [tag.id]: { ...draft, shortcut: event.target.value.toLocaleLowerCase().replace(/\s+/g, "") } }))} /></label><div className="badge-order"><button disabled={index === 0 || Boolean(busy)} onClick={() => void move(index, -1)}><ArrowUp size={12} /></button><button disabled={index === badges.length - 1 || Boolean(busy)} onClick={() => void move(index, 1)}><ArrowDown size={12} /></button></div><button className="mini-save" disabled={Boolean(busy) || !draft.name.trim()} onClick={() => void saveBadge(tag)}>{busy === tag.id ? "…" : "Save"}</button><button className="badge-remove" disabled={Boolean(busy)} title="Remove from Sort" onClick={async () => { setBusy(tag.id); setNotice(""); try { await demoteBadge(tag.id); await load(); emitChanged(); setNotice("Removed from Sort; the tag remains on cards."); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not remove the badge."); } finally { setBusy(""); } }}><X size={12} /></button></div>; })}</div><div className="badge-new"><input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Badge name · e.g. Spoken" /><input value={newShortcut} onChange={(event) => setNewShortcut(event.target.value.toLocaleLowerCase().replace(/\s+/g, ""))} maxLength={12} placeholder="code · sp" /><button className="primary-button" disabled={busy === "new" || !newName.trim()} onClick={() => void addBadge()}><Plus size={13} /> Add badge</button></div>{ordinary.length ? <div className="badge-promote"><span>Use an existing normal tag in Sort</span><select value={promoteId} onChange={(event) => setPromoteId(event.target.value)}>{ordinary.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button className="secondary-button" disabled={!promoteId || Boolean(busy)} onClick={async () => { setBusy("promote"); setNotice(""); try { await promoteTagToBadge(promoteId); await load(); emitChanged(); setNotice("Tag promoted to a sorting badge."); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not promote the tag."); } finally { setBusy(""); } }}>Use as badge</button></div> : null}<div className="sort-command-example"><strong>Quick command</strong><code>5 sp us</code><span>Interest 5 + badge codes sp and us. Prefix a code with - to remove it.</span></div>{notice ? <div className="settings-note">{notice}</div> : null}</section>;
}
