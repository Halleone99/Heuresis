import { useEffect, useRef, useState } from "react";
import { ArchiveRestore, Download, RefreshCw, Trash2, X } from "lucide-react";
import { entryPreview, entryTitle, friendlyError } from "../../lib/knowledgeWorkspace";
import { exportKnowledgeJson, listArchivedKnowledge, restoreArchivedKnowledge, type ArchivedKnowledgeRow } from "../../lib/knowledgeBackup";
import { DISCARDED_AT_KEY, fieldByRole, fieldText, listDiscardedCards, listPacks, type CardWithStats, type PackWithType } from "../../lib/heuresis";
import { deleteDiscardedCard, restoreDiscardedCard } from "../../lib/sort";
import { Portal } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

function downloadJson(contents: string, filename: string) {
  const blob = new Blob([contents], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = filename;
    document.body.append(anchor);
    try { anchor.click(); } finally { anchor.remove(); }
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 20_000);
  }
}

export function KnowledgeTrashDialog({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspace();
  const [rows, setRows] = useState<ArchivedKnowledgeRow[]>([]);
  const [cards, setCards] = useState<CardWithStats[]>([]);
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const dialogRef = useRef<HTMLElement>(null);

  async function refreshCards() {
    const nextPacks = await listPacks();
    setPacks(nextPacks);
    // Every topic, including archived ones (the card returns to its topic either way).
    setCards(await listDiscardedCards());
  }
  async function refresh() {
    setRows(await listArchivedKnowledge(workspace.userId));
    await refreshCards().catch((err) => { setCards([]); setError(`Discarded Study cards could not be loaded: ${friendlyError(err)}`); });
  }
  useEffect(() => {
    void refresh().catch((err) => setError(friendlyError(err))).finally(() => setLoading(false));
  }, [workspace.userId]);
  useEffect(() => {
    if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus({ preventScroll: true });
  }, []);

  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (err) { setError(friendlyError(err)); }
    finally {
      setBusy(false);
      // A restored or deleted row takes its focused button with it; keep focus (and
      // Escape) inside the dialog.
      window.setTimeout(() => {
        if (!dialogRef.current?.contains(document.activeElement)) dialogRef.current?.focus({ preventScroll: true });
      }, 0);
    }
  }

  function exportEverything() {
    void perform(async () => {
      const payload = await exportKnowledgeJson(workspace.userId);
      downloadJson(payload, `heuresis-knowledge-${new Date().toISOString().slice(0, 10)}.json`);
      setNotice("Knowledge export requested. Check the downloaded file and keep it securely.");
    });
  }
  function restore(row: ArchivedKnowledgeRow) {
    void perform(async () => {
      await restoreArchivedKnowledge(workspace.userId, row.id, row.deleted_at);
      await workspace.reload(true);
      await refresh();
      setNotice(`“${entryTitle(row)}” was restored with its previous practice history.`);
    });
  }

  function cardLabel(card: CardWithStats) {
    const pack = packs.find((item) => item.id === card.pack_id);
    const term = fieldByRole(pack?.cardType, "term") ?? pack?.cardType?.field_schema[0] ?? null;
    const meaning = fieldByRole(pack?.cardType, "meaning") ?? pack?.cardType?.field_schema[1] ?? null;
    // A card from an archived topic has no loaded card type: show its first written field.
    const firstText = () => Object.entries(card.data).find(([key, value]) => !key.startsWith("_") && typeof value === "string" && value.trim())?.[1] as string | undefined;
    return { pack, term: fieldText(card.data, term?.key) || firstText() || "Untitled card", meaning: pack ? fieldText(card.data, meaning?.key) : "" };
  }
  function restoreCard(card: CardWithStats) {
    void perform(async () => {
      await restoreDiscardedCard(card.id);
      await refreshCards();
      window.dispatchEvent(new CustomEvent("heuresis:study-changed"));
      setNotice(`“${cardLabel(card).term}” is back in ${cardLabel(card).pack?.title ?? "its archived topic"}, unsorted, with its history.`);
    });
  }
  function deleteForever(card: CardWithStats) {
    const { term } = cardLabel(card);
    if (!window.confirm(`Delete “${term}” permanently? Its review history is deleted too. This cannot be undone.`)) return;
    void perform(async () => {
      await deleteDiscardedCard(card.id);
      await refreshCards();
      setNotice(`“${term}” was deleted permanently.`);
    });
  }

  return <Portal><div className="ws-dialog-backdrop" role="presentation">
    <section ref={dialogRef} tabIndex={-1} className="ws-dialog is-wide knowledge-trash" role="dialog" aria-modal="true"
      aria-labelledby="knowledge-trash-title" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      }}>
      <header className="ws-dialog-head">
        <h2 id="knowledge-trash-title"><Trash2 size={18}/> Trash & export</h2>
        <button type="button" className="ws-icon-button" aria-label="Close Trash" onClick={onClose} disabled={busy}><X size={16}/></button>
      </header>
      <div className="knowledge-trash-intro">
        <p>Archived notes, lessons and mistakes, and Study cards discarded in Sort, stay recoverable here. Restoring keeps their history.</p>
        <button type="button" className="ws-button is-primary" onClick={exportEverything} disabled={busy}>
          <Download size={14}/> Export all knowledge as JSON</button>
      </div>
      <div className="knowledge-trash-toolbar">
        <strong>{loading ? "Loading archived records…" : `${rows.length} archived ${rows.length === 1 ? "record" : "records"} · ${cards.length} discarded ${cards.length === 1 ? "card" : "cards"}`}</strong>
        <button type="button" className="ws-button is-small" disabled={busy} onClick={() => void perform(refresh)}>
          <RefreshCw size={13}/> Refresh</button>
      </div>
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      {notice ? <p className="qc-flash" role="status">{notice}</p> : null}
      <div className="knowledge-trash-list">
        {!loading && !rows.length && !cards.length ? <p className="knowledge-trash-empty">Nothing in Trash. Deleted Notebook records and cards discarded in Sort appear here until restored.</p> : null}
        {cards.length ? <h3 className="knowledge-trash-heading">Study cards discarded in Sort</h3> : null}
        {cards.map((card) => { const label = cardLabel(card); const at = String(card.data[DISCARDED_AT_KEY] ?? ""); return <article className="knowledge-trash-row" key={card.id} data-card-id={card.id}>
          <div className="knowledge-trash-row-main">
            <div className="knowledge-trash-row-meta">card · {label.pack?.title ?? "archived topic"} · discarded {at ? new Date(at).toLocaleDateString() : ""}</div>
            <strong>{label.term}</strong>
            {label.meaning ? <p>{label.meaning}</p> : null}
          </div>
          <div className="knowledge-trash-row-actions">
            <button type="button" className="ws-button is-small" disabled={busy} onClick={() => restoreCard(card)}><ArchiveRestore size={14}/> Restore</button>
            <button type="button" className="ws-button is-small is-quiet" disabled={busy} onClick={() => deleteForever(card)}><Trash2 size={14}/> Delete permanently</button>
          </div>
        </article>; })}
        {rows.length && cards.length ? <h3 className="knowledge-trash-heading">Notebook</h3> : null}
        {rows.map((row) => <article className="knowledge-trash-row" key={row.id}>
          <div className="knowledge-trash-row-main">
            <div className="knowledge-trash-row-meta">{row.kind} · {workspace.pathLabel(row.topic_id)} · deleted {new Date(row.deleted_at).toLocaleDateString()}</div>
            <strong>{entryTitle(row)}</strong>
            {entryPreview(row) ? <p>{entryPreview(row, 200)}</p> : null}
          </div>
          <button type="button" className="ws-button is-small" disabled={busy} onClick={() => restore(row)}>
            <ArchiveRestore size={14}/> Restore</button>
        </article>)}
      </div>
      <footer className="knowledge-trash-footer">
        <span>The export includes subjects, topics, notes, lessons, mistakes, archived records, categories and recall events. Study cards and unsynchronised local writes are handled separately.</span>
        <button type="button" className="ws-button" disabled={busy} onClick={onClose}>Close</button>
      </footer>
    </section>
  </div></Portal>;
}
