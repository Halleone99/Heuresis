import { useEffect, useState } from "react";
import { ArchiveRestore, Download, RefreshCw, Trash2, X } from "lucide-react";
import { entryPreview, entryTitle, friendlyError } from "../../lib/knowledgeWorkspace";
import { exportKnowledgeJson, listArchivedKnowledge, restoreArchivedKnowledge, type ArchivedKnowledgeRow } from "../../lib/knowledgeBackup";
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
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function refresh() { setRows(await listArchivedKnowledge(workspace.userId)); }
  useEffect(() => {
    void refresh().catch((err) => setError(friendlyError(err))).finally(() => setLoading(false));
  }, [workspace.userId]);

  async function perform(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (err) { setError(friendlyError(err)); }
    finally { setBusy(false); }
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

  return <Portal><div className="ws-dialog-backdrop" role="presentation">
    <section className="ws-dialog is-wide knowledge-trash" role="dialog" aria-modal="true"
      aria-labelledby="knowledge-trash-title" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      }}>
      <header className="ws-dialog-head">
        <h2 id="knowledge-trash-title"><Trash2 size={18}/> Trash & export</h2>
        <button type="button" className="ws-icon-button" aria-label="Close Trash" onClick={onClose} disabled={busy}><X size={16}/></button>
      </header>
      <div className="knowledge-trash-intro">
        <p>Archived notes, lessons and mistakes stay recoverable here. Restoring a mistake also preserves its recall history.</p>
        <button type="button" className="ws-button is-primary" onClick={exportEverything} disabled={busy}>
          <Download size={14}/> Export all knowledge as JSON</button>
      </div>
      <div className="knowledge-trash-toolbar">
        <strong>{loading ? "Loading archived records…" : `${rows.length} archived ${rows.length === 1 ? "record" : "records"}`}</strong>
        <button type="button" className="ws-button is-small" disabled={busy} onClick={() => void perform(refresh)}>
          <RefreshCw size={13}/> Refresh</button>
      </div>
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      {notice ? <p className="qc-flash" role="status">{notice}</p> : null}
      <div className="knowledge-trash-list">
        {!loading && !rows.length ? <p className="knowledge-trash-empty">Nothing in Trash. Deleted Notebook records will appear here until restored.</p> : null}
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
