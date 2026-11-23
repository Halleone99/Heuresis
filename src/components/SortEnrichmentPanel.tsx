import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent } from "react";
import { Plus, X } from "lucide-react";
import { InlineSortText } from "./InlineSortText";
import { RichText } from "./workspace/RichText";
import { RichEditor, type RichEditorHandle } from "./workspace/RichEditor";
import { fieldText, patchCardData, type CardWithStats, type FieldDef, type PackWithType } from "../lib/heuresis";
import { addRelatedWord, listRelatedCatalogue, removeRelatedRelation, setRelatedRelationType, type RelatedCatalogueRow, type RelationType } from "../lib/related";
import { removeHeuresisCardImage, signHeuresisCardImages, uploadHeuresisCardImage } from "../lib/cardMedia";
import { languageFromName, languageFromScript } from "../lib/languages";
import { AUTO_LAYERS, deleteHighlightRule, listHighlightRules, readAutoLayers, writeAutoLayers, type AutoLayer, type HighlightRule } from "../lib/highlights";

const BLOCKS_KEY = "_workspace_blocks";
export type Dimension = "examples" | "neighbours" | "components" | "structure" | "origin" | "facts" | "hook" | "picture" | "notes";
type TextBlock = { id: string; type: "text"; text: string; dim: Dimension };
type ImageBlock = { id: string; type: "image"; path: string; caption: string; dim: Dimension };
type Block = TextBlock | ImageBlock;
export type DirectionInfo21 = { state: string; lastSeen: string; results: string; otherWay: string };
/** Asks the panel to start adding to a section, or to edit one block, from outside (the card). */
export type DetailsRequest = { dim: Dimension; blockId?: string; nonce: number };
const ids = new Set<Dimension>(["examples", "neighbours", "components", "structure", "origin", "facts", "hook", "picture", "notes"]);
const languageLabels: Record<Dimension, string> = {
  examples: "In context", neighbours: "Nearby words", components: "Parts", structure: "Grammar",
  origin: "Origin", facts: "Worth knowing", hook: "Memory hook", picture: "Picture", notes: "My note",
};
const conceptLabels: Record<Dimension, string> = {
  examples: "Instances", neighbours: "Related", components: "Parts", structure: "Structure",
  origin: "Origin", facts: "Facts", hook: "Memory hook", picture: "Picture", notes: "My note",
};
const LEFT_ORDER: Dimension[] = ["examples", "neighbours", "components", "structure", "origin"];
const RIGHT_ORDER: Dimension[] = ["facts", "hook", "picture", "notes"];
const ORDER: Dimension[] = [...LEFT_ORDER, ...RIGHT_ORDER];
const LEFT_ORDER21: Dimension[] = ["examples", "neighbours", "components", "structure"];
const RIGHT_ORDER21: Dimension[] = ["origin", "facts", "hook", "picture", "notes"];
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
export default function SortEnrichmentPanel({ pack, card, request, side = "all", study21 = false, readOnly = false, directionInfo, quickNote, onQuickNoteChange, onBlockedChange, onChanged, onCountChange, onDataChanged, trackSave }: {
  pack: PackWithType;
  card: CardWithStats;
  request?: DetailsRequest | null;
  side?: "language" | "knowledge" | "all";
  study21?: boolean;
  readOnly?: boolean;
  directionInfo?: DirectionInfo21;
  quickNote?: string;
  onQuickNoteChange?: (value: string) => void;
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
  const activeDims = side === "language" ? (study21 ? LEFT_ORDER21 : LEFT_ORDER) : side === "knowledge" ? (study21 ? RIGHT_ORDER21 : RIGHT_ORDER) : ORDER;
  const inputRef = useRef<HTMLInputElement>(null);
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
  const [formatRules, setFormatRules] = useState<HighlightRule[]>([]);
  const [autoLayers, setAutoLayers] = useState(readAutoLayers);
  const toggleAutoLayer = (id: AutoLayer) => { const next = { ...autoLayers, [id]: !autoLayers[id] }; setAutoLayers(next); writeAutoLayers(next); };
  const selectedLang = languageFromName(pack.title) ?? languageFromName(pack.cardType?.name)
    ?? languageFromScript(fieldText(data, schema.find(f => f.role === "term")?.key)) ?? "en";
  useEffect(() => {
    if (side === "language") return;
    let active = true;
    const load = () => { void listHighlightRules().then(rules => { if (active) setFormatRules(rules); }).catch(() => undefined); };
    load();
    window.addEventListener("heuresis-highlights-updated", load);
    return () => { active = false; window.removeEventListener("heuresis-highlights-updated", load); };
  }, [side]);
  async function removeFormatting(id: string) {
    try {
      await deleteHighlightRule(id);
      setFormatRules(rules => rules.filter(rule => rule.id !== id));
      window.dispatchEvent(new Event("heuresis-highlights-updated"));
    } catch (err) { setError(err instanceof Error ? err.message : "Could not remove formatting."); }
  }
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number>();
  // Keep the session in place while an editor is open, even before the first keystroke.
  const [inlineBusy, setInlineBusy] = useState(false);
  const blocked = busy || inlineBusy || adding !== null;
  useLayoutEffect(() => { onBlockedChange(!readOnly && blocked); }, [blocked, onBlockedChange, readOnly]);
  useEffect(() => () => { onBlockedChange(false); window.clearTimeout(savedTimer.current); }, [onBlockedChange]);

  const filledFields = (dim: Dimension) => schema.filter((field) => dimensionForField(field) === dim && Boolean(fieldText(data, field.key).trim()));
  const emptyFields = (dim: Dimension) => schema.filter((field) => dimensionForField(field) === dim && !fieldText(data, field.key).trim());

  useEffect(() => {
    const visibleFields = schema.filter((field) => {
      const dim = dimensionForField(field);
      return dim !== null && activeDims.includes(dim) && Boolean(fieldText(data, field.key).trim());
    }).length;
    onCountChange?.(visibleFields + blocks.filter(block => activeDims.includes(block.dim)).length
      + (activeDims.includes("neighbours") ? related.length : 0)
      + (study21 && activeDims.includes("notes") && (quickNote ?? "").trim() ? 1 : 0));
  }, [data, blocks, related, schema, onCountChange, side, study21, quickNote, activeDims]);

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
    if (!request || readOnly) return;
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

  async function uploadPicture(file?: File | null) {
    if (!file || busy) return;
    setBusy(true); setError("");
    let path: string | null = null;
    try {
      path = await uploadHeuresisCardImage(card.id, file);
      const next: ImageBlock = { id: crypto.randomUUID(), type: "image", path, caption: "", dim: "picture" };
      await writeBlocks([...blocks, next]);
    } catch (err) {
      if (path) await removeHeuresisCardImage(path).catch(() => undefined);
      setError(err instanceof Error ? err.message : "Could not attach image.");
    } finally { setBusy(false); }
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
        value={draft} compactToolbar={!study21} compactStudy21={study21} ariaLabel={"Write " + labels[dim].toLowerCase()}
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

  const emptyDims = readOnly ? [] : activeDims.filter((dim) => dim !== adding && dim !== revealed && !filledFields(dim).length
    && !blocks.some((block) => block.dim === dim) && !(dim === "neighbours" && structuredWords && related.length));

  return <aside className={"sort-enrichment sort-enrichment--" + side} aria-label={side === "knowledge" ? "Knowledge details" : "Language details"}>
    {side !== "all" ? <h2 className="sort-panel-title">{side === "language" ? (conceptual ? "Concept" : "Language") : "Knowledge"}</h2> : null}
    {side !== "language" ? <input type="file" ref={inputRef} hidden accept="image/*"
      onChange={event => { void uploadPicture(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} /> : null}
    <div className="sort-enrich-list">{activeDims.map((dim) => {
      const fields = schema.filter((field) => dimensionForField(field) === dim
        && (revealed === dim || Boolean(fieldText(data, field.key).trim())));
      const owned = blocks.filter((block) => block.dim === dim);
      const rows = dim === "neighbours" && structuredWords ? related : [];
      const noteExists = study21 && dim === "notes" && Boolean((quickNote ?? "").trim() || (!readOnly && onQuickNoteChange));
      const count = fields.length + owned.length + rows.length + (noteExists ? 1 : 0);
      if (!count && adding !== dim && revealed !== dim) return null;
      const firstEmpty = revealed === dim ? fields.find((field) => !fieldText(data, field.key).trim())?.key : undefined;
      return <section className="sort-enrich-section" key={dim}>
        <div className="sort-enrich-heading"><span>{labels[dim]}</span>
          {!readOnly ? <button type="button" aria-label={"Add to " + labels[dim]} title={"Add to " + labels[dim]}
            disabled={blocked} onClick={() => dim === "picture" ? inputRef.current?.click() : openAdd(dim, dim === "neighbours" && structuredWords ? "word" : "text")}>
            <Plus size={14} />
          </button> : null}
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
              {readOnly ? <p className="study21-field-readonly">{fieldText(data, field.key)}</p> : <InlineSortText value={fieldText(data, field.key)} label={field.label} placeholder={fieldPlaceholder(field)}
                multiline={field.role !== "example_reading"} autoFocus={field.key === firstEmpty}
                disabled={busy || adding !== null} onEditingChange={setInlineBusy}
                onCommit={(value) => track(saveField(field.key, value))} />}
            </div>)}
          </div> : null}
          {owned.map((block) => block.type === "text"
            ? editingId === block.id && adding === dim ? <div key={block.id}>{textEditor(dim)}</div>
            : <div className={"sort-enrich-item" + (readOnly ? " readonly" : " editable")} data-dim={dim} key={block.id}>
              {readOnly ? <RichText text={block.text} className="sort-enrich-rich"/> : <>
                <button type="button" className="sort-enrich-text-open" disabled={blocked} onClick={() => openAdd(dim, "text", block)}
                  aria-label={"Edit " + labels[dim].toLowerCase()}><RichText text={block.text} className="sort-enrich-rich" /></button>
                <div className="sort-enrich-item-tools">
                  <button type="button" disabled={blocked} onClick={() => void track(removeText(block.id))} aria-label="Remove detail" title="Remove"><X size={13}/></button>
                </div></>}
            </div>
            : <figure className="sort-enrich-item sort-enrich-image" key={block.id}>{imageUrls[block.path] ? <img src={imageUrls[block.path]} alt={block.caption || "Card illustration"} /> : <span>Image unavailable</span>}<figcaption>{readOnly ? block.caption : <InlineSortText value={block.caption} label="Image caption" placeholder="Add a caption" disabled={busy || adding !== null} onEditingChange={setInlineBusy} onCommit={(value) => track(saveImageCaption(block.id, value))} />}</figcaption></figure>)}
          {rows.map((row) => <div key={row.relation_id} className="sort-enrich-item sort-enrich-related">
            {readOnly ? <><div className="study21-relation-word"><strong>{row.term}</strong><span className={"sort-enrich-relation relation-" + row.relation_type}>{row.relation_type}</span></div>{row.reading ? <p className="related-reading">{row.reading}</p> : null}{row.meaning ? <p className="related-meaning">{row.meaning}</p> : null}</> : <>
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
            </div></>}
          </div>)}
          {study21 && dim === "notes" && (quickNote !== undefined || onQuickNoteChange) ? (readOnly ? (quickNote?.trim() ? <p className="sort-enrich-item study21-note-value">{quickNote}</p> : null) : <textarea className="study21-note-entry" rows={2} value={quickNote ?? ""} placeholder="My note" aria-label="My note" onChange={event => onQuickNoteChange?.(event.target.value)} />) : null}
          {!readOnly && adding === dim && !editingId ? mode === "word"
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
    {!readOnly && emptyDims.length ? <div className="sort-enrich-add-empty">
      <small>Add</small>
      <div>{emptyDims.map((dim) => <button key={dim} type="button" disabled={blocked}
        onClick={() => dim === "picture" ? inputRef.current?.click() : openAdd(dim, dim === "neighbours" && structuredWords ? "word" : "text")}>+ {labels[dim]}</button>)}</div>
    </div> : null}
    {side === "knowledge" && !readOnly ? <section id="sort-formatting-section" className="sort-enrich-section sort-panel-formatting">
      <div className="sort-enrich-heading"><span>Formatting</span></div>
      {formatRules.filter(rule => rule.lang === selectedLang).length
        ? <ul>{formatRules.filter(rule => rule.lang === selectedLang).map(rule =>
            <li key={rule.id}><span>{rule.text} · {rule.style} · {rule.card_id ? "Card" : "All"}</span>
              <button type="button" aria-label={"Remove formatting for " + rule.text}
                onClick={() => void removeFormatting(rule.id)}>×</button></li>)}</ul>
        : study21 ? null : <p className="sort-enrich-hint">Select text on the card to format it.</p>}
      {study21 ? <div className="study21-auto-layers"><small>Automatic</small>{(AUTO_LAYERS[selectedLang] ?? []).map(layer => <button type="button" key={layer.id} aria-pressed={autoLayers[layer.id]} onClick={() => toggleAutoLayer(layer.id)}>{layer.name}</button>)}</div> : null}
    </section> : null}
    {side === "knowledge" ? <section className="sort-enrich-section sort-panel-source">
      <div className="sort-enrich-heading"><span>Source</span></div>
      <p>Pack: {pack.title}</p>
      {card.tags.filter(tag => /^Lesson\s+\d+/i.test(tag.name)).map(tag =>
        <p key={tag.id}>Lesson: {tag.name}</p>)}
      <p>Captured: {new Date(card.created_at).toLocaleDateString()}</p>
    </section> : null}
    {study21 && directionInfo && readOnly && side === "knowledge" ? <section className="study21-direction-block"><strong>This direction</strong><dl><dt>State</dt><dd>{directionInfo.state}</dd><dt>Last seen</dt><dd>{directionInfo.lastSeen}</dd><dt>Results</dt><dd>{directionInfo.results}</dd><dt>Other way</dt><dd>{directionInfo.otherWay}</dd></dl></section> : null}
    {!study21 ? <p className="sort-enrich-hint">Click any text to change it · Enter keeps it · Esc undoes</p> : null}
    <p className={"sort-enrich-saved" + (saved ? " is-on" : "")} aria-live="polite">{saved ? "✓ Saved" : ""}</p>
    {error ? <p className="sort-enrich-error" role="alert">{error}</p> : null}
  </aside>;
}
