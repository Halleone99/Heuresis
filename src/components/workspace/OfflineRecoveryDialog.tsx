import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArchiveRestore, Check, Download, RefreshCw, Trash2, X } from "lucide-react";
import {
  adoptLegacyOfflineWrites, discardLegacyOfflineWrites, exportLegacyOfflineWrites,
  listLegacyOfflineWrites, type LegacyOfflineWrite,
} from "../../lib/offlineFetch";
import { Portal } from "./ui";

type Props = { userId: string; onClose: () => void; onSync: () => Promise<void> };

export function OfflineRecoveryDialog({ userId, onClose, onSync }: Props) {
  const [entries, setEntries] = useState<LegacyOfflineWrite[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [backedUp, setBackedUp] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const rows = await listLegacyOfflineWrites();
    setEntries(rows);
    setSelected((previous) => previous.filter((id) => rows.some((row) => row.id === id)));
  }
  useEffect(() => {
    void refresh().catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);
  const chosen = useMemo(() => entries.filter((row) => selected.includes(row.id)), [entries, selected]);
  const eligible = chosen.length > 0 && chosen.every((row) => row.canReplay);

  function toggle(id: string, checked: boolean) {
    setSelected((current) => checked ? [...current.filter((value) => value !== id), id] : current.filter((value) => value !== id));
  }
  async function perform(action: () => Promise<void>) {
    setBusy(true); setError(""); setNotice("");
    try { await action(); await refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }
  async function exportFile() {
    await perform(async () => {
      const json = await exportLegacyOfflineWrites();
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = `heuresis-legacy-unsynced-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(link);
        try { link.click(); } finally { link.remove(); }
        setBackedUp(true);
        setNotice("Backup download requested. Check that the JSON file was saved safely before removing anything.");
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 20_000); }
    });
  }
  function confirmRestore() {
    if (!backedUp || !eligible || busy) return;
    if (!window.confirm(`Restore ${chosen.length} legacy writes to your current signed-in account? Only new records with stable IDs are eligible. The server's access rules will still apply. Make sure the backup has finished downloading.`)) return;
    void perform(async () => {
      const count = await adoptLegacyOfflineWrites(selected, userId);
      setSelected([]);
      setBackedUp(false);
      setNotice(`${count} record(s) placed in your account's pending queue. Starting synchronisation…`);
      await onSync();
    });
  }
  function confirmDiscard() {
    if (!backedUp || !chosen.length || busy) return;
    if (!window.confirm(`Permanently remove ${chosen.length} selected legacy writes from this device? This cannot be undone. Continue only after checking your exported JSON file.`)) return;
    void perform(async () => {
      const count = await discardLegacyOfflineWrites(selected);
      setSelected([]);
      setBackedUp(false);
      setNotice(`${count} old queue entries removed from this device.`);
    });
  }

  return <Portal><div className="ws-dialog-backdrop" role="presentation">
    <section className="ws-dialog is-wide legacy-recovery" role="dialog" aria-modal="true"
      aria-labelledby="legacy-recovery-title" onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
      }}>
      <header className="ws-dialog-head">
        <h2 id="legacy-recovery-title"><ArchiveRestore size={18} /> Offline recovery</h2>
        <button type="button" className="ws-icon-button" aria-label="Close recovery" disabled={busy} onClick={onClose}><X size={16}/></button>
      </header>
      <div className="legacy-recovery-explain">
        <AlertTriangle size={17} />
        <p>These are writes from an older version of Heuresis, before offline data belonged to a known account. They were <strong>not automatically uploaded</strong> to protect your data. They might belong to a different account on this device.</p>
      </div>
      {loading ? <p role="status">Checking the original offline queue…</p> : entries.length ? <>
        <div className="legacy-recovery-toolbar">
          <span>{entries.length} original {entries.length === 1 ? "write" : "writes"} kept locally · {selected.length} selected</span>
          <button type="button" className="ws-button is-small" disabled={busy}
            onClick={() => setSelected(selected.length === entries.length ? [] : entries.map((row) => row.id))}>
            {selected.length === entries.length ? "Clear selection" : "Select all"}</button>
          <button type="button" className="ws-button is-small" disabled={busy} onClick={() => void perform(refresh)}>
            <RefreshCw size={13}/> Refresh</button>
        </div>
        <div className="legacy-recovery-list">
          {entries.map((row) => <label className="legacy-recovery-entry" key={row.id}>
            <input type="checkbox" disabled={busy} checked={selected.includes(row.id)}
              onChange={(event) => toggle(row.id, event.target.checked)}/>
            <div className="legacy-recovery-entry-body">
              <div className="legacy-recovery-row">
                <strong>{row.target}</strong><span>{row.method} · {new Date(row.createdAt).toLocaleString()}</span>
                <span className={row.canReplay ? "legacy-replay-ok" : "legacy-replay-manual"}>{row.canReplay ? "Eligible to restore" : "Backup / manual review"}</span>
              </div>
              <small>{row.reason}</small>
              <details onClick={(event) => event.stopPropagation()}>
                <summary>Inspect original contents</summary>
                <pre>{row.preview || "No request body"}</pre>
              </details>
            </div>
          </label>)}
        </div>
      </> : <p className="legacy-recovery-empty"><Check size={17}/> No older unowned writes remain on this device.</p>}
      {error ? <p className="ws-field-error" role="alert">{error}</p> : null}
      {notice ? <p className="qc-flash" role="status">{notice}</p> : null}
      <footer className="legacy-recovery-actions">
        <button type="button" className="ws-button" disabled={busy || !entries.length} onClick={() => void exportFile()}>
          <Download size={14}/> Export all as JSON</button>
        <button type="button" className="ws-button" disabled={busy || !backedUp || !eligible}
          title={!eligible ? "Choose eligible inserts only. Other actions need manual review." : !backedUp ? "Export and check your backup first." : undefined}
          onClick={confirmRestore}><ArchiveRestore size={14}/> Restore selected</button>
        <button type="button" className="ws-button is-quiet" disabled={busy || !backedUp || !chosen.length} onClick={confirmDiscard}>
          <Trash2 size={14}/> Discard selected</button>
        <button type="button" className="ws-button" disabled={busy} onClick={onClose}>Keep for later</button>
      </footer>
      <p className="legacy-recovery-note">Export contains your original unsent data. Keep the file private. Restore never bypasses account permissions, and requests that might overwrite or delete records require manual review.</p>
    </section>
  </div></Portal>;
}
