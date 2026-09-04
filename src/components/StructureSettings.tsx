import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Collection, PackWithType } from "../lib/heuresis";
import {
  createStudyTemplate,
  customisePackStructure,
  deleteStudyTemplate,
  listStructureTemplates,
  loadCardTypeStructure,
  updateStudyTemplate,
  type StructureField,
  type StructureTemplate,
} from "../lib/settingsData";

type DirectionDraft = { name: string; front: string[]; back: string[]; details: string[] };
type Props = { packs: PackWithType[]; collections: Collection[]; onChanged: () => Promise<void> | void };

function makeKey(label: string, fields: StructureField[]) {
  const base = label.toLocaleLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "field";
  const used = new Set(fields.map((field) => field.key.toLocaleLowerCase()));
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

function draft(template: StructureTemplate): DirectionDraft {
  return { name: template.name, front: [...template.front], back: [...template.back], details: [...template.details] };
}

function toggle(values: string[], key: string) { return values.includes(key) ? values.filter((item) => item !== key) : [...values, key]; }

function suggested(fields: StructureField[]): DirectionDraft {
  const term = fields.find((field) => field.role === "term")?.key ?? fields[0]?.key ?? "";
  const meaning = fields.find((field) => field.role === "meaning")?.key ?? fields[1]?.key ?? "";
  return { name: "New direction", front: term ? [term] : [], back: meaning ? [meaning] : [], details: fields.filter((field) => ![term, meaning].includes(field.key)).map((field) => field.key) };
}

export default function StructureSettings({ packs, collections, onChanged }: Props) {
  const [packId, setPackId] = useState(packs[0]?.id ?? "");
  const [fields, setFields] = useState<StructureField[]>([]);
  const [templates, setTemplates] = useState<StructureTemplate[]>([]);
  const [directions, setDirections] = useState<Record<string, DirectionDraft>>({});
  const [newField, setNewField] = useState("");
  const [newDirection, setNewDirection] = useState<DirectionDraft | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [directionNotice, setDirectionNotice] = useState("");
  const selectedPack = useMemo(() => packs.find((pack) => pack.id === packId) ?? packs[0] ?? null, [packs, packId]);
  const collectionMap = useMemo(() => new Map(collections.map((collection) => [collection.id, collection.title])), [collections]);

  useEffect(() => {
    if (!packs.some((pack) => pack.id === packId)) setPackId(packs[0]?.id ?? "");
  }, [packs, packId]);

  async function loadForPack(pack: PackWithType) {
    const [structure, nextTemplates] = await Promise.all([loadCardTypeStructure(pack.card_type_id), listStructureTemplates(pack.card_type_id)]);
    setFields(structure.fields.map((field) => ({ ...field })));
    setTemplates(nextTemplates);
    setDirections(Object.fromEntries(nextTemplates.filter((template) => Boolean(template.user_id)).map((template) => [template.id, draft(template)])));
  }

  useEffect(() => {
    if (!selectedPack) { setFields([]); setTemplates([]); return; }
    setNotice(""); setDirectionNotice(""); setNewDirection(null);
    void loadForPack(selectedPack).catch((error) => setNotice(error instanceof Error ? error.message : "Could not load card structure."));
  }, [selectedPack?.id, selectedPack?.card_type_id]);

  if (!selectedPack) return <div className="settings-note">Create a topic before editing card structures.</div>;

  function addField() {
    const label = newField.trim(); if (!label) return;
    setFields((current) => [...current, { key: makeKey(label, current), label, role: "extra", script: "latn" }]);
    setNewField("");
  }

  function fieldChoices(direction: DirectionDraft, side: "front" | "back" | "details", onChange: (next: DirectionDraft) => void) {
    return <div className="direction-fields">{fields.map((field) => { const active = direction[side].includes(field.key); return <button type="button" key={field.key} aria-pressed={active} onClick={() => onChange({ ...direction, [side]: toggle(direction[side], field.key) })}>{field.label}</button>; })}</div>;
  }

  async function reloadDirections() {
    const next = await listStructureTemplates(selectedPack.card_type_id);
    setTemplates(next);
    setDirections(Object.fromEntries(next.filter((template) => Boolean(template.user_id)).map((template) => [template.id, draft(template)])));
  }

  return <section className="structure-settings"><div className="settings-section-heading"><strong>Card fields</strong><span>Choose what information cards in a topic can hold. Customising a built-in structure creates the safe topic-specific version through the same Supabase RPC as Personal OS.</span></div><label className="structure-pack"><span>Topic</span><select value={selectedPack.id} onChange={(event) => setPackId(event.target.value)}>{packs.map((pack) => <option key={pack.id} value={pack.id}>{collectionMap.get(pack.collection_id) || "Collection"} · {pack.title}</option>)}</select></label><div className="structure-fields">{fields.map((field, index) => <div className="structure-field" key={`${field.key}-${index}`}><input aria-label="Field label" value={field.label} onChange={(event) => setFields((current) => current.map((item, position) => position === index ? { ...item, label: event.target.value } : item))} /><select aria-label="Field role" value={field.role ?? "extra"} onChange={(event) => setFields((current) => current.map((item, position) => position === index ? { ...item, role: event.target.value as StructureField["role"] } : item))}><option value="term">Term</option><option value="reading">Reading</option><option value="meaning">Meaning</option><option value="extra">Extra</option><option value="example">Example</option><option value="example_reading">Example reading</option><option value="example_translation">Example translation</option></select><select aria-label="Script" value={field.script ?? "latn"} onChange={(event) => setFields((current) => current.map((item, position) => position === index ? { ...item, script: event.target.value as StructureField["script"] } : item))}><option value="latn">Latin</option><option value="han">Chinese</option><option value="cyrl">Cyrillic</option></select><button type="button" disabled={fields.length <= 2} title={`Remove ${field.label}`} onClick={() => setFields((current) => current.filter((_, position) => position !== index))}><Trash2 size={13} /></button></div>)}</div><div className="structure-add"><input value={newField} onChange={(event) => setNewField(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addField(); } }} placeholder="New field · e.g. Grammar note" /><button className="secondary-button" disabled={!newField.trim()} onClick={addField}><Plus size={13} /> Add field</button></div><p className="structure-note">Removing a field from the structure hides it; existing card data is not erased.</p>{notice ? <div className="settings-note">{notice}</div> : null}<div className="settings-save-row"><button className="primary-button" disabled={busy === "fields" || fields.length < 2 || fields.some((field) => !field.label.trim())} onClick={async () => { setBusy("fields"); setNotice(""); try { await customisePackStructure(selectedPack.id, fields); await onChanged(); setNotice("Card fields saved."); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not save card fields."); } finally { setBusy(""); } }}>{busy === "fields" ? "Saving…" : "Save card fields"}</button></div><div className="settings-rule" /><div className="settings-section-heading"><strong>Study directions</strong><span>Choose exactly what appears before reveal, after reveal, and as supporting detail.</span></div><div className="direction-list">{templates.map((template) => { const editable = Boolean(template.user_id); const current = editable ? directions[template.id] : draft(template); if (!current) return null; return <article className="direction-card" key={template.id} data-built-in={!editable || undefined}><header>{editable ? <input value={current.name} onChange={(event) => setDirections((value) => ({ ...value, [template.id]: { ...current, name: event.target.value } }))} /> : <strong>{template.name}</strong>}<span>{editable ? "Custom" : "Built-in"}</span></header>{editable ? <><label><span>Side 1</span>{fieldChoices(current, "front", (next) => setDirections((value) => ({ ...value, [template.id]: next })))}</label><label><span>Side 2</span>{fieldChoices(current, "back", (next) => setDirections((value) => ({ ...value, [template.id]: next })))}</label><label><span>After reveal</span>{fieldChoices(current, "details", (next) => setDirections((value) => ({ ...value, [template.id]: next })))}</label><footer><button className="secondary-button danger-text" disabled={Boolean(busy)} onClick={async () => { setBusy(template.id); setDirectionNotice(""); try { await deleteStudyTemplate(template.id); await reloadDirections(); } catch (error) { setDirectionNotice(error instanceof Error ? error.message : "Could not remove direction."); } finally { setBusy(""); } }}><Trash2 size={13} /> Remove</button><button className="primary-button" disabled={Boolean(busy) || !current.name.trim() || !current.front.length || !current.back.length} onClick={async () => { setBusy(template.id); setDirectionNotice(""); try { await updateStudyTemplate(template.id, { ...current, sortOrder: template.sort_order }); await reloadDirections(); setDirectionNotice("Study direction saved."); } catch (error) { setDirectionNotice(error instanceof Error ? error.message : "Could not save direction."); } finally { setBusy(""); } }}>{busy === template.id ? "Saving…" : "Save"}</button></footer></> : <div className="direction-summary"><span><b>1</b>{template.front.map((key) => fields.find((field) => field.key === key)?.label ?? key).join(" + ")}</span><i>→</i><span><b>2</b>{template.back.map((key) => fields.find((field) => field.key === key)?.label ?? key).join(" + ")}</span></div>}</article>; })}{newDirection ? <article className="direction-card direction-new"><header><input autoFocus value={newDirection.name} onChange={(event) => setNewDirection({ ...newDirection, name: event.target.value })} /><span>New</span></header><label><span>Side 1</span>{fieldChoices(newDirection, "front", setNewDirection)}</label><label><span>Side 2</span>{fieldChoices(newDirection, "back", setNewDirection)}</label><label><span>After reveal</span>{fieldChoices(newDirection, "details", setNewDirection)}</label><footer><button className="secondary-button" onClick={() => setNewDirection(null)}>Cancel</button><button className="primary-button" disabled={Boolean(busy) || !newDirection.name.trim() || !newDirection.front.length || !newDirection.back.length} onClick={async () => { setBusy("new-direction"); setDirectionNotice(""); try { await createStudyTemplate({ cardTypeId: selectedPack.card_type_id, ...newDirection, sortOrder: templates.length }); setNewDirection(null); await reloadDirections(); setDirectionNotice("Study direction added."); } catch (error) { setDirectionNotice(error instanceof Error ? error.message : "Could not add direction."); } finally { setBusy(""); } }}>{busy === "new-direction" ? "Adding…" : "Add direction"}</button></footer></article> : <button className="direction-add" onClick={() => setNewDirection(suggested(fields))}><Plus size={14} /> New study direction</button>}</div>{directionNotice ? <div className="settings-note">{directionNotice}</div> : null}</section>;
}
