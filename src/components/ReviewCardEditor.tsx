import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fieldText, getCard, updateCard, type CardWithStats, type FieldDef, type PackWithType } from "../lib/heuresis";

type Props = {
  pack: PackWithType;
  card: CardWithStats;
  onClose: () => void;
  onSaved: (card: CardWithStats) => void;
};
type KnowledgeKind = "example" | "grammar" | "parts" | "origin" | "fact" | "note";
type KnowledgeOption = { kind: KnowledgeKind; label: string; dimension: string; hint: string };
type EditableBlock = {
  id: string;
  originalIndex: number | null;
  kind: KnowledgeKind;
  value: string;
  reading: string;
  meaning: string;
  original: Record<string, unknown> | null;
};

const BLOCK_KEY = "_workspace_blocks";
const KNOWLEDGE: KnowledgeOption[] = [
  { kind: "example", label: "Example", dimension: "examples", hint: "Example sentence" },
  { kind: "grammar", label: "Grammar", dimension: "structure", hint: "Usage, pattern or construction" },
  { kind: "parts", label: "Parts", dimension: "components", hint: "Roots, characters or components" },
  { kind: "origin", label: "Origin", dimension: "origin", hint: "Origin or etymology" },
  { kind: "fact", label: "Fact", dimension: "facts", hint: "Useful or memorable detail" },
  { kind: "note", label: "Note", dimension: "notes", hint: "A personal observation" },
];

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2, 10);
}
function originalRows(card: CardWithStats): string[] {
  const data = card.data[BLOCK_KEY];
  return Array.isArray(data) ? data : [];
}
function asObject(raw: string): Record<string, unknown> | null {
  try {
    const result: unknown = JSON.parse(raw);
    return result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  } catch {
    return null;
  }
}
function kindFor(row: Record<string, unknown>): KnowledgeKind | null {
  if (["example", "grammar", "parts", "origin", "fact", "note"].includes(String(row.type))) {
    return row.type as KnowledgeKind;
  }
  if (row.type === "text") {
    const byDimension: Record<string, KnowledgeKind> = {
      examples: "example", structure: "grammar", components: "parts",
      origin: "origin", facts: "fact", notes: "note",
    };
    return byDimension[String(row.dim)] ?? null;
  }
  return null;
}
function editableBlocks(card: CardWithStats): EditableBlock[] {
  return originalRows(card).flatMap((raw, index) => {
    const row = asObject(raw);
    if (!row || typeof row.id !== "string") return [];
    const kind = kindFor(row);
    if (!kind || (typeof row.text !== "string" && typeof row.source !== "string")) return [];
    const source = typeof row.source === "string" ? row.source : String(row.text ?? "").split("\n")[0];
    return [{
      id: row.id,
      originalIndex: index,
      kind,
      value: kind === "example" ? source : String(row.text ?? ""),
      reading: typeof row.reading === "string" ? row.reading : "",
      meaning: typeof row.translation === "string" ? row.translation : "",
      original: row,
    }];
  });
}
function exampleLanguageMeta(pack: PackWithType) {
  const name = pack.cardType?.name.toLowerCase() ?? "";
  if (name.includes("chinese")) return { source_language: "zh", translation_language: "en", reading_system: "pinyin" };
  if (name.includes("cyrillic")) return { source_language: "ru", translation_language: "en" };
  return { source_language: "und", translation_language: "en" };
}
function serializeBlock(block: EditableBlock, pack: PackWithType): string {
  const option = KNOWLEDGE.find((entry) => entry.kind === block.kind)!;
  const base = {
    ...(block.original ?? {}),
    id: block.id,
    type: block.original?.type ?? block.kind,
    schema_version: block.original?.schema_version ?? 2,
    dim: block.original?.dim ?? option.dimension,
  };
  if (block.kind === "example") {
    const source = block.value.trim();
    const reading = block.reading.trim();
    const translation = block.meaning.trim();
    return JSON.stringify({
      ...exampleLanguageMeta(pack), ...base, source, reading, translation,
      text: [source, reading, translation].filter(Boolean).join("\n"),
    });
  }
  return JSON.stringify({ ...base, text: block.value.trim() });
}
function knowledgeRows(card: CardWithStats, edits: EditableBlock[], pack: PackWithType): string[] {
  const originals = editableBlocks(card);
  const editableIndexes = new Set(originals.map((block) => block.originalIndex));
  const editedByIndex = new Map(edits.filter((block) => block.originalIndex !== null)
    .map((block) => [block.originalIndex, block] as const));
  const retained = originalRows(card).flatMap((raw, index) => {
    if (!editableIndexes.has(index)) return [raw]; // Images and unrecognised formats survive untouched.
    const edit = editedByIndex.get(index);
    return edit && edit.value.trim() ? [serializeBlock(edit, pack)] : [];
  });
  return [...retained, ...edits.filter((block) => block.originalIndex === null && block.value.trim())
    .map((block) => serializeBlock(block, pack))];
}
function fieldGroups(fields: FieldDef[]) {
  const prompt = fields.filter((field) => field.role === "term");
  if (!prompt.length && fields[0]) prompt.push(fields[0]);
  const promptKeys = new Set(prompt.map((field) => field.key));
  let answer = fields.filter((field) => !promptKeys.has(field.key) &&
    (field.role === "reading" || field.role === "meaning" || field.required));
  if (!answer.length) {
    const fallback = fields.find((field) => !promptKeys.has(field.key));
    if (fallback) answer = [fallback];
  }
  const coreKeys = new Set([...prompt, ...answer].map((field) => field.key));
  return { prompt, answer, extra: fields.filter((field) => !coreKeys.has(field.key)) };
}

/** Edit the complete card during review, using Capture's knowledge-block storage format. */
export default function ReviewCardEditor({ pack, card, onClose, onSaved }: Props) {
  const schema = pack.cardType?.field_schema ?? [];
  const groups = fieldGroups(schema);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(schema.map((field) => [field.key, fieldText(card.data, field.key)])));
  const [note, setNote] = useState(card.note ?? "");
  const [blocks, setBlocks] = useState<EditableBlock[]>(() => editableBlocks(card));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLElement>("input, textarea")?.focus({ preventScroll: true });
    return () => previouslyFocused?.focus({ preventScroll: true });
  }, []);

  const setValue = (key: string, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));
  const changeBlock = (id: string, patch: Partial<EditableBlock>) =>
    setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...patch } : block));
  const addBlock = (kind: KnowledgeKind) =>
    setBlocks((current) => [...current, {
      id: newId(), originalIndex: null, kind,
      value: "", reading: "", meaning: "", original: null,
    }]);

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const latest = await getCard(card.id);
      if (!latest) throw new Error("This card no longer exists.");
      if (
        schema.some((field) => fieldText(latest.data, field.key) !== fieldText(card.data, field.key)) ||
        (latest.note ?? "") !== (card.note ?? "") ||
        JSON.stringify(originalRows(latest)) !== JSON.stringify(originalRows(card))
      ) throw new Error("This card was changed elsewhere. Close and reopen Modify to avoid overwriting it.");

      const workspaceBlocks = knowledgeRows(card, blocks, pack);
      await updateCard(pack, card.id, values, {
        note,
        favourite: latest.favourite,
        interest_rank: latest.interest_rank,
        expectedUpdatedAt: latest.updated_at,
        workspaceBlocks,
      });
      const refreshed = await getCard(card.id).catch(() => null);
      const nextData = { ...card.data, [BLOCK_KEY]: workspaceBlocks };
      for (const field of schema) {
        const value = (values[field.key] ?? "").trim();
        if (value) nextData[field.key] = value;
        else delete nextData[field.key];
      }
      onSaved(refreshed ?? {
        ...latest,
        data: nextData,
        note: note.trim() || null,
        updated_at: new Date().toISOString(),
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save this card.");
    } finally {
      setSaving(false);
    }
  }

  const renderField = (field: FieldDef) => (
    <label key={field.key} className="cosmos-edit-field">
      <span>{field.label}{field.required ? " *" : ""}</span>
      {["example", "extra", "example_translation"].includes(field.role ?? "")
        ? <textarea rows={2} value={values[field.key] ?? ""} onChange={(event) => setValue(field.key, event.target.value)} />
        : <input type="text" value={values[field.key] ?? ""} onChange={(event) => setValue(field.key, event.target.value)} />}
    </label>
  );

  return <div className="cosmos-edit-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
    <section ref={dialogRef} className="cosmos-edit-dialog" role="dialog" aria-modal="true" aria-label="Modify card"
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape" && !saving) { event.preventDefault(); event.stopPropagation(); onClose(); }
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); }
      }}>
      <header className="cosmos-edit-head">
        <div><span>CARD</span><h2>Modify card</h2></div>
        <button type="button" onClick={onClose} disabled={saving} aria-label="Close card editor"><X size={18} /></button>
      </header>
      <div className="cosmos-edit-fields">
        <div className="cosmos-edit-section-label"><span>FRONT</span><small>Recall prompt</small></div>
        {groups.prompt.map(renderField)}
        <div className="cosmos-edit-section-label cosmos-edit-back-label"><span>BACK</span><small>Reference answer</small></div>
        {groups.answer.map(renderField)}
        {groups.extra.length ? <details className="cosmos-edit-more">
          <summary>More card fields <span>+ {groups.extra.length}</span></summary>
          <div className="cosmos-edit-more-body">{groups.extra.map(renderField)}</div>
        </details> : null}
        <div className="cosmos-edit-enrichment-head">
          <div><strong>Card knowledge</strong><small>Examples, context and useful details</small></div>
        </div>
        {blocks.map((block) => {
          const def = KNOWLEDGE.find((option) => option.kind === block.kind)!;
          return <div className="cosmos-edit-enrichment" key={block.id}>
            <div className="cosmos-edit-enrichment-label">
              <strong>{def.label}</strong>
              <button type="button" disabled={saving} onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))}
                aria-label={"Remove " + def.label}><X size={14} /></button>
            </div>
            <textarea rows={2} value={block.value} placeholder={def.hint}
              onChange={(event) => changeBlock(block.id, { value: event.target.value })} />
            {block.kind === "example" ? <div className="cosmos-edit-example-row">
              <input type="text" placeholder="Reading / pinyin (optional)" value={block.reading}
                onChange={(event) => changeBlock(block.id, { reading: event.target.value })} />
              <input type="text" placeholder="Translation (optional)" value={block.meaning}
                onChange={(event) => changeBlock(block.id, { meaning: event.target.value })} />
            </div> : null}
          </div>;
        })}
        <div className="cosmos-edit-add-menu" aria-label="Add knowledge to this card">
          {KNOWLEDGE.map((option) => <button type="button" key={option.kind} disabled={saving}
            onClick={() => addBlock(option.kind)}><Plus size={12} aria-hidden="true" /> {option.label}</button>)}
        </div>
        <label className="cosmos-edit-field cosmos-edit-primary-note">
          <span>General note</span>
          <textarea rows={2} placeholder="Optional" value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </div>
      {error ? <p className="cosmos-edit-error" role="alert">{error}</p> : null}
      <footer className="cosmos-edit-foot">
        <span><Pencil size={12} aria-hidden="true" /> Changes do not affect your review grade.</span>
        <div><button type="button" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="cosmos-edit-save" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save changes"}</button></div>
      </footer>
    </section>
  </div>;
}
