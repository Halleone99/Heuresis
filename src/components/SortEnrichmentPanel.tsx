import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Pencil, Plus, X } from "lucide-react";
import { RichText } from "./workspace/RichText";
import { RichEditor, type RichEditorHandle } from "./workspace/RichEditor";
import { fieldText, patchCardData, type CardWithStats, type FieldDef, type PackWithType } from "../lib/heuresis";
import { addRelatedWord, listRelatedCatalogue, removeRelatedRelation, type RelatedCatalogueRow, type RelationType } from "../lib/related";
import { signHeuresisCardImages } from "../lib/cardMedia";

const BLOCKS_KEY = "_workspace_blocks";
type Dimension = "examples" | "neighbours" | "components" | "structure" | "origin" | "facts" | "notes";
type TextBlock = { id: string; type: "text"; text: string; dim: Dimension };
type ImageBlock = { id: string; type: "image"; path: string; caption: string; dim: Dimension };
type Block = TextBlock | ImageBlock;
const ids = new Set<Dimension>(["examples", "neighbours", "components", "structure", "origin", "facts", "notes"]);
const languageLabels: Record<Dimension, string> = {
  examples: "Examples", neighbours: "Words", components: "Parts", structure: "Grammar",
  origin: "Origin", facts: "Facts", notes: "Notes",
};
const conceptLabels: Record<Dimension, string> = {
  examples: "Instances", neighbours: "Related", components: "Parts", structure: "Structure",
  origin: "Origin", facts: "Facts", notes: "Notes",
};

function dimensionForField(field: FieldDef): Dimension | null {
  const text = (field.key + " " + field.label).toLowerCase();
  if (["example", "example_reading", "example_translation"].includes(field.role ?? "")) return "examples";
  if (/neighbou?r|synonym|antonym|related|similar|alternative word|contrast|difference|confus|versus/.test(text)) return "neighbours";
  if (/component|radical|character|morph|part/.test(text)) return "components";
  if (/etymolog|origin|history|lineage/.test(text)) return "origin";
  if (/structure|grammar|pattern|construction|syntax|argument|usage|collocation|register/.test(text)) return "structure";
  if (/fact|trivia|cultur/.test(text)) return "facts";
  if (field.role === "extra" && !/alt.?meaning|alternative meaning|other meaning/.test(text)) return "notes";
  return null;
}

/** The same on-card storage format used by the earlier Cosmos card editor. */
function parseBlocks(data: CardWithStats["data"]): Block[] {
  const raw = data[BLOCKS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry): Block[] => {
    try {
      const value = JSON.parse(entry) as Record<string, unknown>;
      const dim = value.dim === "contrast" ? "neighbours"
        : typeof value.dim === "string" && ids.has(value.dim as Dimension) ? value.dim as Dimension : "notes";
      if (value.type === "text" && typeof value.id === "string" && typeof value.text === "string")
        return [{ id: value.id, type: "text", text: value.text, dim }];
      if (value.type === "image" && typeof value.id === "string" && typeof value.path === "string")
        return [{ id: value.id, type: "image", path: value.path, caption: typeof value.caption === "string" ? value.caption : "", dim }];
    } catch { /* Unknown blocks stay untouched by patchCardData. */ }
    return [];
  });
}

/** Sort's left rail is editable knowledge, not a second card editor or a review grade. */
export default function SortEnrichmentPanel({ pack, card, onBlockedChange, onChanged }: {
  pack: PackWithType;
  card: CardWithStats;
  onBlockedChange: (blocked: boolean) => void;
  onChanged: () => void;
}) {
  const conceptual = /philosoph|history|psycholog|concept|theor|politic|econom/i.test(pack.title + " " + (pack.cardType?.name ?? ""));
  const labels = conceptual ? conceptLabels : languageLabels;
  const structuredWords = !conceptual;
  // Quick notes live on the right; retain a legacy Notes section only for existing saved blocks.
  const order: Dimension[] = ["examples", "neighbours", "components", "structure", "origin", "facts",
    ...(parseBlocks(card.data).some((block) => block.dim === "notes") ? ["notes" as Dimension] : [])];
  const [data, setData] = useState(card.data);
  const blocks = useMemo(() => parseBlocks(data), [data]);
  const [expanded, setExpanded] = useState<Dimension[]>(["examples", "neighbours"]);
  const detailEditor = useRef<RichEditorHandle>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<Dimension | null>(null);
  const [mode, setMode] = useState<"text" | "word">("text");
  const [draft, setDraft] = useState("");
  const [word, setWord] = useState("");
  const [reading, setReading] = useState("");
  const [meaning, setMeaning] = useState("");
  const [relation, setRelation] = useState<RelationType>("related");
  const [related, setRelated] = useState<RelatedCatalogueRow[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Keep the session in place while an editor is open, even before the first keystroke.
  const blocked = busy || adding !== null;
  useLayoutEffect(() => { onBlockedChange(blocked); }, [blocked, onBlockedChange]);
  useEffect(() => () => onBlockedChange(false), [onBlockedChange]);

  useEffect(() => {
    if (!structuredWords) return;
    let live = true;
    void listRelatedCatalogue(pack.id, card.id).then((items) => {
      if (live) setRelated(items);
    }).catch(() => { if (live) setError("Could not load related words."); });
    return () => { live = false; };
  }, [pack.id, card.id, structuredWords]);

  useEffect(() => {
    const paths = blocks.filter((block): block is ImageBlock => block.type === "image").map((block) => block.path);
    if (!paths.length) { setImageUrls({}); return; }
    let live = true;
    void signHeuresisCardImages(paths).then((urls) => { if (live) setImageUrls(urls); })
      .catch(() => { if (live) setImageUrls({}); });
    return () => { live = false; };
  }, [data]);

  function stopAdding() {
    setAdding(null); setEditingId(null); setDraft(""); setWord(""); setReading(""); setMeaning("");
  }
  function openAdd(dim: Dimension, kind: "text" | "word", existing?: TextBlock) {
    if (blocked) return;
    setExpanded((items) => items.includes(dim) ? items : [...items, dim]);
    setAdding(dim); setMode(kind); setEditingId(existing?.id ?? null);
    setDraft(existing?.text ?? ""); setError("");
  }
  async function writeBlocks(next: Block[]) {
    const saved = await patchCardData(card.id, { [BLOCKS_KEY]: next.map((block) => JSON.stringify(block)) });
    setData(saved);
    onChanged();
  }
  async function saveText() {
    const text = detailEditor.current?.getMarkdown() ?? draft;
    if (!adding || !text.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const next: TextBlock = { id: editingId ?? crypto.randomUUID(), type: "text", text: text.trim(), dim: adding };
      await writeBlocks(editingId ? blocks.map((block) => block.id === editingId ? next : block) : [...blocks, next]);
      stopAdding();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save this detail."); }
    finally { setBusy(false); }
  }
  async function removeText(id: string) {
    if (blocked) return;
    setBusy(true); setError("");
    try { await writeBlocks(blocks.filter((block) => block.id !== id)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not remove this detail."); }
    finally { setBusy(false); }
  }
  async function saveWord() {
    if (busy || !word.trim() || !meaning.trim()) { setError("Add the word and its meaning."); return; }
    setBusy(true); setError("");
    try {
      await addRelatedWord({ sourceCardId: card.id, term: word, reading, meaning, relationType: relation });
      setRelated(await listRelatedCatalogue(pack.id, card.id));
      stopAdding();
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not link this word."); }
    finally { setBusy(false); }
  }
  async function unlink(row: RelatedCatalogueRow) {
    if (blocked) return;
    setBusy(true); setError("");
    try {
      await removeRelatedRelation(row.relation_id);
      setRelated((items) => items.filter((item) => item.relation_id !== row.relation_id));
      onChanged();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove this relation."); }
    finally { setBusy(false); }
  }

  return <aside className="sort-enrichment" aria-label="Enrich this flashcard">
    <header className="sort-enrich-head"><small>1 · CONTEXT (OPTIONAL)</small><strong>Card knowledge</strong><span>Read or add examples, connections and notes before deciding.</span></header>
    <div className="sort-enrich-list">{order.map((dim) => {
      const fields = (pack.cardType?.field_schema ?? []).flatMap((field) => {
        if (dimensionForField(field) !== dim) return [];
        const value = fieldText(data, field.key);
        return value ? [{ label: field.label, value, key: field.key }] : [];
      });
      const owned = blocks.filter((block) => block.dim === dim);
      const rows = dim === "neighbours" && structuredWords ? related : [];
      const note = dim === "notes" && card.note?.trim() ? card.note : null;
      const count = fields.length + owned.length + rows.length + (note ? 1 : 0);
      const open = expanded === dim;
      return <section className="sort-enrich-section" key={dim}>
        <button type="button" className="sort-enrich-heading" aria-expanded={open} onClick={() => setExpanded(open ? null : dim)} disabled={Boolean(adding && blocked)}>
          <span>{labels[dim]}</span>{count > 0 ? <b>{count}</b> : null}<ChevronDown size={14} className={open ? "open" : ""} />
        </button>
        {open ? <div className="sort-enrich-contents">
          {note ? <p className="sort-enrich-item"><small>Card note</small>{note}</p> : null}
          {fields.map((field) => <p key={field.key} className="sort-enrich-item"><small>{field.label}</small>{field.value}</p>)}
          {owned.map((block) => block.type === "text"
            ? <div className="sort-enrich-item editable" key={block.id}><p>{block.text}</p><button type="button" disabled={blocked} onClick={() => void removeText(block.id)} aria-label="Remove detail"><X size={13} /></button></div>
            : <figure className="sort-enrich-item" key={block.id}>{imageUrls[block.path] ? <img src={imageUrls[block.path]} alt={block.caption || "Card illustration"} /> : <p>Image unavailable</p>}{block.caption ? <figcaption>{block.caption}</figcaption> : null}</figure>)}
          {rows.map((row) => <div key={row.relation_id} className="sort-enrich-item editable">
            <p><strong>{row.term}</strong>{row.reading ? " · " + row.reading : ""}<small>{row.relation_type} · {row.meaning}</small></p>
            <button type="button" disabled={blocked} onClick={() => void unlink(row)} aria-label="Remove related word"><X size={13} /></button>
          </div>)}
          {adding === dim ? <div className="sort-enrich-editor">
            {mode === "word" ? <>
              <input autoFocus aria-label="Related word" placeholder="Word or expression" value={word} onChange={(event) => setWord(event.target.value)} />
              <input aria-label="Reading" placeholder="Reading / pinyin (optional)" value={reading} onChange={(event) => setReading(event.target.value)} />
              <textarea aria-label="Meaning" rows={2} placeholder="Meaning" value={meaning} onChange={(event) => setMeaning(event.target.value)} />
              <div className="sort-enrich-relations">{(["related", "synonym", "antonym"] as RelationType[]).map((kind) =>
                <button key={kind} type="button" className={relation === kind ? "selected" : ""} onClick={() => setRelation(kind)}>{kind === "synonym" ? "Synonym" : kind === "antonym" ? "Antonym" : "Related"}</button>)}</div>
            </> : <textarea autoFocus aria-label={"Add to " + labels[dim]} rows={3} placeholder={"Add to " + labels[dim]} value={draft} onChange={(event) => setDraft(event.target.value)} />}
            <div className="sort-enrich-editor-actions"><button type="button" disabled={busy} onClick={stopAdding}>Cancel</button><button type="button" className="primary" disabled={busy || (mode === "word" ? !word.trim() || !meaning.trim() : !draft.trim())} onClick={() => void (mode === "word" ? saveWord() : saveText())}>Save</button></div>
          </div> : <div className="sort-enrich-add-actions">
            <button type="button" onClick={() => openAdd(dim, "text")} disabled={blocked}><Plus size={13} /> Add detail</button>
            {dim === "neighbours" && structuredWords ? <button type="button" onClick={() => openAdd(dim, "word")} disabled={blocked}><Plus size={13} /> Link word</button> : null}
          </div>}
        </div> : null}
      </section>;
    })}</div>
    {error ? <p className="sort-enrich-error" role="alert">{error}</p> : null}
  </aside>;
}
