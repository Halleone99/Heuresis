import { FileUp, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ensureTag, importCardsWithTagsProgress } from "../lib/advanced";
import { listTags, type HeuresisTag, type PackWithType } from "../lib/heuresis";
import { saveImportStudyLayout } from "../lib/importLayout";

type Props = { pack: PackWithType; onClose: () => void; onDone: () => Promise<void> | void };
type Parsed = { headers: string[]; rows: string[][] };

function splitLine(line: string, delimiter: string) {
  const cells: string[] = [];
  let value = ""; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { cells.push(value); value = ""; }
    else value += char;
  }
  cells.push(value);
  return cells.map((cell) => cell.trim());
}

function parse(text: string): Parsed {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim().length);
  if (!lines.length) return { headers: [], rows: [] };
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const headers = splitLine(lines[0], delimiter);
  return { headers, rows: lines.slice(1).map((line) => splitLine(line, delimiter)) };
}

function normalise(value: string) { return value.trim().toLocaleLowerCase().replace(/[\s_-]+/g, ""); }
function splitTags(value: string) { return value.split(/[|,]/).map((item) => item.trim()).filter(Boolean); }

export default function ImportModal({ pack, onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [tags, setTags] = useState<HeuresisTag[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [saveLayout, setSaveLayout] = useState(true);
  const parsed = useMemo(() => parse(text), [text]);
  const schema = pack.cardType?.field_schema ?? [];

  useEffect(() => { void listTags().then(setTags).catch(() => setTags([])); }, []);

  const mapping = useMemo(() => schema.map((field) => {
    const candidates = [field.key, field.label].map(normalise);
    const index = parsed.headers.findIndex((header) => candidates.includes(normalise(header)));
    return { field, index };
  }), [schema, parsed.headers]);

  const tagColumnIndex = useMemo(() => parsed.headers.findIndex((header) => ["tag", "tags", "lesson"].includes(normalise(header))), [parsed.headers]);
  const usableRows = useMemo(() => parsed.rows.map((cells) => ({
    cells,
    data: Object.fromEntries(mapping.flatMap(({ field, index }) => index >= 0 && cells[index]?.trim() ? [[field.key, cells[index].trim()]] : [])),
  })).filter((row) => Object.keys(row.data).length), [parsed.rows, mapping]);
  const missingRequired = mapping.filter(({ field, index }) => field.required && index < 0).map(({ field }) => field.label);

  const layout = useMemo(() => {
    const mapped = mapping.filter(({ index }) => index >= 0).map(({ field }) => field);
    const term = mapped.find((field) => field.role === "term");
    const reading = mapped.find((field) => field.role === "reading");
    const meaning = mapped.find((field) => field.role === "meaning");
    const front = [term?.key, reading?.key].filter((key): key is string => Boolean(key));
    const back = [meaning?.key].filter((key): key is string => Boolean(key));
    const used = new Set([...front, ...back]);
    const details = mapped.map((field) => field.key).filter((key) => !used.has(key));
    return { front, back, details };
  }, [mapping]);

  async function readFile(file: File | undefined) {
    if (!file) return;
    try { setText(await file.text()); setMessage(""); setProgress({ done: 0, total: 0 }); }
    catch { setMessage("Could not read that file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  function toggleTag(id: string) {
    setSelectedTagIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function runImport() {
    if (!usableRows.length || missingRequired.length) return;
    setBusy(true); setMessage(""); setProgress({ done: 0, total: usableRows.length });
    try {
      const tagCache = new Map(tags.map((tag) => [tag.name.toLocaleLowerCase(), tag]));
      const rowTagNames = Array.from(new Set(usableRows.flatMap(({ cells }) => tagColumnIndex >= 0 ? splitTags(cells[tagColumnIndex] ?? "") : [])));
      for (const name of rowTagNames) {
        const key = name.toLocaleLowerCase();
        if (!tagCache.has(key)) {
          const tag = await ensureTag(name);
          tagCache.set(key, tag);
          setTags((current) => current.some((item) => item.id === tag.id) ? current : [...current, tag]);
        }
      }

      const rows = usableRows.map(({ cells, data }) => {
        const rowIds = tagColumnIndex >= 0
          ? splitTags(cells[tagColumnIndex] ?? "").flatMap((name) => tagCache.get(name.toLocaleLowerCase())?.id ?? [])
          : [];
        return { data, tagIds: Array.from(new Set([...selectedTagIds, ...rowIds])) };
      });

      const count = await importCardsWithTagsProgress(pack.id, rows, (done, total) => setProgress({ done, total }));
      if (saveLayout && layout.front.length && layout.back.length) {
        await saveImportStudyLayout({
          packId: pack.id,
          cardTypeId: pack.card_type_id,
          name: `${pack.title} import`,
          front: layout.front,
          back: layout.back,
          details: layout.details,
        });
      }
      setMessage(`${count} card${count === 1 ? "" : "s"} imported${saveLayout && layout.front.length && layout.back.length ? " · review layout saved" : ""}.`);
      await onDone();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="import-modal" role="dialog" aria-modal="true">
    <header className="settings-head"><div><p className="eyebrow">IMPORT</p><h2>{pack.title}</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header>
    <p className="import-intro">Import CSV, TSV or semicolon-separated text. Field keys or visible labels are matched automatically. A column named Lesson, Tag or Tags is imported as card tags.</p>
    <input ref={fileRef} className="hidden-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={(event) => void readFile(event.target.files?.[0])} />
    <div className="settings-actions"><button className="secondary-button" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Choose file</button></div>
    <label className="field-row"><span>Or paste data</span><textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder="Chinese,Pinyin,English,Lesson\n学习,xuéxí,to study,Lesson 1" /></label>
    {parsed.headers.length ? <div className="import-mapping"><strong>Detected mapping</strong>{mapping.map(({ field, index }) => <span key={field.key} className={index >= 0 ? "mapped" : field.required ? "missing" : ""}><b>{field.label}</b><i>→</i><em>{index >= 0 ? parsed.headers[index] : "not found"}</em></span>)}{tagColumnIndex >= 0 ? <span className="mapped"><b>Tags</b><i>→</i><em>{parsed.headers[tagColumnIndex]}</em></span> : null}</div> : null}
    {tags.length ? <div className="field-row"><span>Apply tags to every imported card</span><div className="filter-strip">{tags.map((tag) => <button type="button" key={tag.id} className={selectedTagIds.includes(tag.id) ? "selected" : ""} onClick={() => toggleTag(tag.id)}>{tag.name}</button>)}</div></div> : null}
    <label className="field-row"><span>Review direction</span><span><input type="checkbox" checked={saveLayout} onChange={(event) => setSaveLayout(event.target.checked)} /> Save detected front/back as this topic's default review layout</span></label>
    {missingRequired.length ? <div className="settings-note error">Missing required column{missingRequired.length === 1 ? "" : "s"}: {missingRequired.join(", ")}.</div> : null}
    {busy && progress.total ? <div className="settings-note">Importing {progress.done.toLocaleString()} / {progress.total.toLocaleString()}…</div> : null}
    {message ? <div className={message.includes("imported") ? "settings-note success" : "settings-note error"}>{message}</div> : null}
    <div className="topic-modal-footer"><span>{usableRows.length ? `${usableRows.length} rows ready` : "No rows ready"}</span><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" disabled={busy || !usableRows.length || Boolean(missingRequired.length)} onClick={() => void runImport()}>{busy ? "Importing…" : `Import ${usableRows.length || ""}`}</button></div>
  </section></div>;
}
