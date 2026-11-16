import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { Plus, X } from "lucide-react";
import { InlineSortText } from "./InlineSortText";
import { RichText } from "./workspace/RichText";
import { RichEditor, type RichEditorHandle } from "./workspace/RichEditor";
import { fieldText, patchCardData, type CardWithStats, type FieldDef, type PackWithType } from "../lib/heuresis";
import { addRelatedWord, listRelatedCatalogue, removeRelatedRelation, setRelatedRelationType, type RelatedCatalogueRow, type RelationType } from "../lib/related";
import { signHeuresisCardImages } from "../lib/cardMedia";

const BLOCKS_KEY = "_workspace_blocks";
export type Dimension = "examples" | "neighbours" | "components" | "structure" | "origin" | "facts" | "notes";
type TextBlock = { id: string; type: "text"; text: string; dim: Dimension };
type ImageBlock = { id: string; type: "image"; path: string; caption: string; dim: Dimension };
type Block = TextBlock | ImageBlock;
/** Asks the panel to start adding to a section, or to edit one block, from outside (the card). */
export type DetailsRequest = { dim: Dimension; blockId?: string; nonce: number };
const ids = new Set<Dimension>(["examples", "neighbours", "components", "structure", "origin", "facts", "notes"]);
const languageLabels: Record<Dimension, string> = {
  examples: "In context", neighbours: "Nearby words", components: "Parts", structure: "Grammar",
  origin: "Origin", facts: "Worth knowing", notes: "My note",
};
const conceptLabels: Record<Dimension, string> = {
  examples: "Instances", neighbours: "Related", components: "Parts", structure: "Structure",
  origin: "Origin", facts: "Facts", notes: "Notes",
};
const ORDER: Dimension[] = ["examples", "neighbours", "components", "structure", "origin", "facts", "notes"];
const EXAMPLE_ROLES = ["example", "example_reading", "example_translation"];

function dimensionForField(field: FieldDef): Dimension | null {
  const text = (field.key + " " + field.label).toLowerCase();
  if (EXAMPLE_ROLES.includes(field.role ?? "")) return "examples";
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

/** Reads a stored example block as sentence / translation lines, for the card face. */
export function firstExampleBlock(data: CardWithStats["data"]): { id: string; sentence: string; translation: string } | null {
  const block = parseBlocks(data).find((item): item is TextBlock => item.type === "text" && item.dim === "examples");
  if (!block) return null;
  // RichEditor separates paragraphs with blank lines; Shift+Enter gives a single newline. Accept both.
  const lines = block.text.split(/\n+/).map((line) => line
    .replace(/^\s*(?:>|[-*+]|\d+\.|#{1,6})\s+/, "")
    .replace(/(\*\*|__|==|`)/g, "").replace(/(^|\s)[*_](\S[^*_]*\S|\S)[*_](?=\s|$|[.,;:!?])/g, "$1$2")
    .trim()).filter(Boolean);
  if (!lines.length) return null;
  // Three lines are sentence, reading, translation; two lines are sentence and translation.
  return { id: block.id, sentence: lines[0], translation: lines.length > 1 ? lines[lines.length - 1] : "" };
}

/** Sort's left rail is editable knowledge, not a second card editor or a review grade. */
export default function SortEnrichmentPanel({ pack, card, request, onBlockedChange, onChanged, onCountChange, onDataChanged, trackSave }: {
  pack: PackWithType;
  card: CardWithStats;
  request?: DetailsRequest | null;
  onBlockedChange: (blocked: boolean) => void;
  onChanged: () => void;
  onCountChange?: (count: number) => void;
  onDataChanged?: (data: CardWithStats["data"]) => void;
  /** Lets the session wait for saves started by a blur before it moves to the next card. */
  trackSave?: (save: Promise<unknown>) => void;
}) {
  const conceptual = /philosoph|history|psycholog|concept|theor|politic|econom/i.test(pack.title + " " + (pack.cardType?.name ?? ""));
  const labels = conceptual ? conceptLabels : languageLabels;
  const structuredWords = !conceptual;
  const schema = pack.cardType?.field_schema ?? [];
  const [data, setData] = useState(card.data);
  // The card face edits the same fields (term, example…): follow its saves instead of keeping a stale copy.
  useEffect(() => { setData(card.data); }, [card.data]);
  const blocks = useMemo(() => parseBlocks(data), [data]);
  const detailEditor = useRef<RichEditorHandle>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adding, setAdding] = useState<Dimension | null>(null);
  // A section whose card fields are empty shows them as blank lines to type into, instead of a new block.
  const [revealed, setRevealed] = useState<Dimension | null>(null);
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
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number>();
  // Keep the session in place while an editor is open, even before the first keystroke.
  const [inlineBusy, setInlineBusy] = useState(false);
  const blocked = busy || inlineBusy || adding !== null;
  useLayoutEffect(() => { onBlockedChange(blocked); }, [blocked, onBlockedChange]);
  useEffect(() => () => { onBlockedChange(false); window.clearTimeout(savedTimer.current); }, [onBlockedChange]);

  const filledFields = (dim: Dimension) => schema.filter((field) => dimensionForField(field) === dim && Boolean(fieldText(data, field.key).trim()));
  const emptyFields = (dim: Dimension) => schema.filter((field) => dimensionForField(field) === dim && !fieldText(data, field.key).trim());

  useEffect(() => {
    const visibleFields = schema.filter((field) => dimensionForField(field) !== null && Boolean(fieldText(data, field.key).trim())).length;
    onCountChange?.(visibleFields + blocks.length + related.length);
  }, [data, blocks, related, schema, onCountChange]);

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
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // "+ Example sentence" and a tap on the card's example open the matching editor here.
  useEffect(() => {
    if (!request) return;
    const block = request.blockId ? blocks.find((item): item is TextBlock => item.id === request.blockId && item.type === "text") : undefined;
    openAdd(request.dim, request.dim === "neighbours" && structuredWords ? "word" : "text", block, true);
  }, [request?.nonce]); // eslint-disable-line react-hooks/exhaustive-deps

  function track<T>(save: Promise<T>): Promise<T> {
    trackSave?.(save);
    return save;
  }
  function flashSaved() {
    setSaved(true);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(false), 1400);
  }

  function stopAdding() {
    setAdding(null); setEditingId(null); setDraft(""); setWord(""); setReading(""); setMeaning("");
  }
  function openAdd(dim: Dimension, kind: "text" | "word", existing?: TextBlock, force = false) {
    if (blocked && !force) return;
    if (busy) return;
    setError("");
    // Fill the card's own fields first (e.g. the Example field), so the card face shows them too.
    if (!existing && kind === "text" && revealed !== dim && emptyFields(dim).length && !filledFields(dim).length) {
      stopAdding(); setRevealed(dim); return;
    }
    setRevealed(null);
    setAdding(dim); setMode(kind); setEditingId(existing?.id ?? null);
    setDraft(existing?.text ?? "");
  }
  async function writeBlocks(next: Block[]) {
    const saved = await patchCardData(card.id, { [BLOCKS_KEY]: next.map((block) => JSON.stringify(block)) });
    setData(saved);
    onDataChanged?.(saved);
    onChanged();
    flashSaved();
  }
  async function saveText() {
    const text = detailEditor.current?.getMarkdown() || draft;
    if (!adding || busy) return;
    if (!text.trim()) {
      // Clearing an existing block removes it; an empty new block is simply dropped.
      if (editingId) { setBusy(true); try { await writeBlocks(blocks.filter((block) => block.id !== editingId)); stopAdding(); } catch (err) { setError(err instanceof Error ? err.message : "Could not remove this detail."); } finally { setBusy(false); } }
      else stopAdding();
      return;
    }
    const unchanged = editingId && blocks.some((block) => block.id === editingId && block.type === "text" && block.text.trim() === text.trim());
    if (unchanged) { stopAdding(); return; }
    setBusy(true); setError("");
    try {
      const next: TextBlock = { id: editingId ?? crypto.randomUUID(), type: "text", text: text.trim(), dim: adding };
      await writeBlocks(editingId ? blocks.map((block) => block.id === editingId ? next : block) : [...blocks, next]);
      stopAdding();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save this detail."); throw err; }
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
    if (busy) return;
    if (!word.trim() || !meaning.trim()) { setError("Add the word and its meaning."); return; }
    setBusy(true); setError("");
    try {
      await addRelatedWord({ sourceCardId: card.id, term: word, reading, meaning, relationType: relation });
      setRelated(await listRelatedCatalogue(pack.id, card.id));
      stopAdding();
      onChanged(); flashSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not link this word."); throw err; }
    finally { setBusy(false); }
  }
  async function saveField(fieldKey: string, value: string) {
    setInlineBusy(true); setError("");
    try { const next = await patchCardData(card.id, { [fieldKey]: value }); setData(next); onDataChanged?.(next); onChanged(); flashSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not update the detail."); throw err; }
    finally { setInlineBusy(false); }
  }

  async function saveRelatedField(row: RelatedCatalogueRow, fieldKey: "term" | "reading" | "meaning", value: string) {
    setInlineBusy(true); setError("");
    try {
      await patchCardData(row.target_card_id, { [fieldKey]: value });
      setRelated(await listRelatedCatalogue(pack.id, card.id)); onChanged(); flashSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not update the related card."); throw err; }
    finally { setInlineBusy(false); }
  }

  async function cycleRelation(row: RelatedCatalogueRow) {
    if (blocked) return;
    const choices = ["related", "synonym", "antonym"] as const;
    const next = choices[(choices.indexOf(row.relation_type as typeof choices[number]) + 1) % choices.length];
    setInlineBusy(true); setError("");
    try { await setRelatedRelationType(row.relation_id, next); setRelated(await listRelatedCatalogue(pack.id, card.id)); onChanged(); flashSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not change the relation."); }
    finally { setInlineBusy(false); }
  }

  async function saveImageCaption(id: string, caption: string) {
    setInlineBusy(true); setError("");
    try { await writeBlocks(blocks.map((block) => block.id === id && block.type === "image" ? { ...block, caption } : block)); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not save the caption."); throw err; }
    finally { setInlineBusy(false); }
  }

  async function unlink(row: RelatedCatalogueRow) {
    if (blocked) return;
    setBusy(true); setError("");
    try {
      await removeRelatedRelation(row.relation_id);
      setRelated((items) => items.filter((item) => item.relation_id !== row.relation_id));
      onChanged(); flashSaved();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove this relation."); }
    finally { setBusy(false); }
  }

  function commitEditor(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget;
    if (next && event.currentTarget.contains(next as Node)) return;
    if (busy) return;
    if (mode === "word") {
      if (word.trim() && meaning.trim()) void track(saveWord()).catch(() => undefined);
      else if (!word.trim() && !meaning.trim()) stopAdding();
      return;
    }
    void track(saveText()).catch(() => undefined);
  }

  function textEditor(dim: Dimension) {
    return <div className="sort-enrich-editor" onBlurCapture={commitEditor}>
      <RichEditor ref={detailEditor} resetKey={(editingId ?? "new") + ":" + card.id + ":" + dim}
        value={draft} compactToolbar ariaLabel={"Write " + labels[dim].toLowerCase()}
        placeholder={dim === "examples" ? "Sentence, then reading, then translation…" : "Add a useful detail…"}
        onChange={setDraft} onSave={() => void track(saveText()).catch(() => undefined)} onDone={() => void track(saveText()).catch(() => undefined)}
        onEscape={stopAdding} autoFocus />
    </div>;
  }

  function fieldPlaceholder(field: FieldDef) {
    if (field.role === "example") return "Sentence";
    if (field.role === "example_reading") return "Reading";
    if (field.role === "example_translation") return "Translation";
    return field.label;
  }

  const emptyDims = ORDER.filter((dim) => dim !== adding && dim !== revealed && !filledFields(dim).length
    && !blocks.some((block) => block.dim === dim) && !(dim === "neighbours" && structuredWords && related.length));

  return <aside className="sort-enrichment" aria-label="Card details">
    <div className="sort-enrich-list">{ORDER.map((dim) => {
      const fields = schema.filter((field) => dimensionForField(field) === dim
        && (revealed === dim || Boolean(fieldText(data, field.key).trim())));
      const owned = blocks.filter((block) => block.dim === dim);
      const rows = dim === "neighbours" && structuredWords ? related : [];
      const count = fields.length + owned.length + rows.length;
      if (!count && adding !== dim && revealed !== dim) return null;
      const firstEmpty = revealed === dim ? fields.find((field) => !fieldText(data, field.key).trim())?.key : undefined;
      return <section className="sort-enrich-section" key={dim}>
        <div className="sort-enrich-heading"><span>{labels[dim]}</span>
          <button type="button" aria-label={"Add to " + labels[dim]} title={"Add to " + labels[dim]}
            disabled={blocked} onClick={() => openAdd(dim, dim === "neighbours" && structuredWords ? "word" : "text")}>
            <Plus size={14} />
          </button>
        </div>
        <div className="sort-enrich-contents">
          {fields.length ? <div className={"sort-enrich-item sort-enrich-field" + (dim === "examples" ? " is-example" : "")}
            onBlurCapture={(event) => {
              if (revealed !== dim) return;
              const next = event.relatedTarget;
              if (next && event.currentTarget.contains(next as Node)) return;
              const typed = Array.from(event.currentTarget.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).some((node) => node.value.trim());
              if (!typed) setRevealed(null);
            }}>
            {fields.map((field) => <div key={field.key} className={"sort-enrich-line role-" + (field.role || "field")}>
              {dim === "examples" || fields.length === 1 ? null : <small>{field.label}</small>}
              <InlineSortText value={fieldText(data, field.key)} label={field.label} placeholder={fieldPlaceholder(field)}
                multiline={field.role !== "example_reading"} autoFocus={field.key === firstEmpty}
                disabled={busy || adding !== null} onEditingChange={setInlineBusy}
                onCommit={(value) => track(saveField(field.key, value))} />
            </div>)}
          </div> : null}
          {owned.map((block) => block.type === "text"
            ? editingId === block.id && adding === dim ? <div key={block.id}>{textEditor(dim)}</div>
            : <div className="sort-enrich-item editable" data-dim={dim} key={block.id}>
              <button type="button" className="sort-enrich-text-open" disabled={blocked} onClick={() => openAdd(dim, "text", block)}
                aria-label={"Edit " + labels[dim].toLowerCase()}><RichText text={block.text} className="sort-enrich-rich" /></button>
              <div className="sort-enrich-item-tools">
                <button type="button" disabled={blocked} onClick={() => void track(removeText(block.id))} aria-label="Remove detail" title="Remove"><X size={13}/></button>
              </div>
            </div>
            : <figure className="sort-enrich-item sort-enrich-image" key={block.id}>{imageUrls[block.path] ? <img src={imageUrls[block.path]} alt={block.caption || "Card illustration"} /> : <span>Image unavailable</span>}<figcaption><InlineSortText value={block.caption} label="Image caption" placeholder="Add a caption" disabled={busy || adding !== null} onEditingChange={setInlineBusy} onCommit={(value) => track(saveImageCaption(block.id, value))} /></figcaption></figure>)}
          {rows.map((row) => <div key={row.relation_id} className="sort-enrich-item sort-enrich-related">
            <InlineSortText value={row.term} label="Related word" required disabled={busy || adding !== null} className="related-term"
              onEditingChange={setInlineBusy} onCommit={(value) => track(saveRelatedField(row, "term", value))} />
            {row.reading ? <InlineSortText value={row.reading} label="Related reading" placeholder="reading" disabled={busy || adding !== null} className="related-reading"
              onEditingChange={setInlineBusy} onCommit={(value) => track(saveRelatedField(row, "reading", value))} /> : null}
            <InlineSortText value={row.meaning} label="Related meaning" placeholder="meaning" disabled={busy || adding !== null} className="related-meaning"
              onEditingChange={setInlineBusy} onCommit={(value) => track(saveRelatedField(row, "meaning", value))} />
            <button type="button" className={"sort-enrich-relation relation-" + row.relation_type}
              title="Change relation type" disabled={blocked} onClick={() => void track(cycleRelation(row))}>{row.relation_type}</button>
            <div className="sort-enrich-item-tools">
              <button type="button" disabled={blocked} onClick={() => void track(unlink(row))} aria-label="Remove related word" title="Remove"><X size={13} /></button>
            </div>
          </div>)}
          {adding === dim && !editingId ? mode === "word"
            ? <div className="sort-enrich-editor sort-enrich-word-editor" onBlurCapture={commitEditor}>
              <input autoFocus aria-label="Related word" placeholder="Word or expression" value={word} onChange={(event) => setWord(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stopAdding(); } }} />
              <input aria-label="Reading" placeholder="Reading (optional)" value={reading} onChange={(event) => setReading(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stopAdding(); } }} />
              <textarea aria-label="Meaning" rows={1} placeholder="Meaning" value={meaning} onChange={(event) => setMeaning(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); stopAdding(); }
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void track(saveWord()).catch(() => undefined); }
                }} />
              <div className="sort-enrich-relations">{(["related", "synonym", "antonym"] as RelationType[]).map((kind) =>
                <button key={kind} type="button" className={"relation-" + kind + (relation === kind ? " selected" : "")} onClick={() => setRelation(kind)}>{kind}</button>)}</div>
            </div>
            : textEditor(dim) : null}
        </div>
      </section>;
    })}</div>
    {emptyDims.length ? <div className="sort-enrich-add-empty">
      <small>Add</small>
      <div>{emptyDims.map((dim) => <button key={dim} type="button" disabled={blocked}
        onClick={() => openAdd(dim, dim === "neighbours" && structuredWords ? "word" : "text")}>+ {labels[dim]}</button>)}</div>
    </div> : null}
    <p className="sort-enrich-hint">Click any text to change it · Enter keeps it · Esc undoes</p>
    <p className={"sort-enrich-saved" + (saved ? " is-on" : "")} aria-live="polite">{saved ? "✓ Saved" : ""}</p>
    {error ? <p className="sort-enrich-error" role="alert">{error}</p> : null}
  </aside>;
}
