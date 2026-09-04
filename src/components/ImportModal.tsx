import { FileUp, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { importCards } from "../lib/advanced";
import type { PackWithType } from "../lib/heuresis";

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

export default function ImportModal({ pack, onClose, onDone }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const parsed = useMemo(() => parse(text), [text]);
  const schema = pack.cardType?.field_schema ?? [];

  const mapping = useMemo(() => schema.map((field) => {
    const candidates = [field.key, field.label].map(normalise);
    const index = parsed.headers.findIndex((header) => candidates.includes(normalise(header)));
    return { field, index };
  }), [schema, parsed.headers]);

  const usableRows = useMemo(() => parsed.rows.map((cells) => Object.fromEntries(mapping.flatMap(({ field, index }) => index >= 0 && cells[index]?.trim() ? [[field.key, cells[index].trim()]] : []))).filter((row) => Object.keys(row).length), [parsed.rows, mapping]);
  const missingRequired = mapping.filter(({ field, index }) => field.required && index < 0).map(({ field }) => field.label);

  async function readFile(file: File | undefined) {
    if (!file) return;
    try { setText(await file.text()); setMessage(""); }
    catch { setMessage("Could not read that file."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  async function runImport() {
    if (!usableRows.length || missingRequired.length) return;
    setBusy(true); setMessage("");
    try {
      const count = await importCards(pack.id, usableRows);
      setMessage(`${count} card${count === 1 ? "" : "s"} imported.`);
      await onDone();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Import failed."); }
    finally { setBusy(false); }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="import-modal" role="dialog" aria-modal="true"><header className="settings-head"><div><p className="eyebrow">IMPORT</p><h2>{pack.title}</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header><p className="import-intro">Import CSV, TSV or semicolon-separated text. The first row must contain field names. Heuresis matches either the field key or its visible label.</p><input ref={fileRef} className="hidden-file" type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" onChange={(event) => void readFile(event.target.files?.[0])} /><div className="settings-actions"><button className="secondary-button" onClick={() => fileRef.current?.click()}><FileUp size={14} /> Choose file</button></div><label className="field-row"><span>Or paste data</span><textarea rows={9} value={text} onChange={(event) => setText(event.target.value)} placeholder="word,pinyin,meaning\n学习,xuéxí,to study" /></label>{parsed.headers.length ? <div className="import-mapping"><strong>Detected mapping</strong>{mapping.map(({ field, index }) => <span key={field.key} className={index >= 0 ? "mapped" : field.required ? "missing" : ""}><b>{field.label}</b><i>→</i><em>{index >= 0 ? parsed.headers[index] : "not found"}</em></span>)}</div> : null}{missingRequired.length ? <div className="settings-note error">Missing required column{missingRequired.length === 1 ? "" : "s"}: {missingRequired.join(", ")}.</div> : null}{message ? <div className={message.includes("imported") ? "settings-note success" : "settings-note error"}>{message}</div> : null}<div className="topic-modal-footer"><span>{usableRows.length ? `${usableRows.length} rows ready` : "No rows ready"}</span><button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" disabled={busy || !usableRows.length || Boolean(missingRequired.length)} onClick={() => void runImport()}>{busy ? "Importing…" : `Import ${usableRows.length || ""}`}</button></div></section></div>;
}
