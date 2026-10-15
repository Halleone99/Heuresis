import { AlertTriangle, ArchiveRestore, CheckCircle2, CloudOff, RefreshCw, X } from "lucide-react";
import type { OfflineSyncState } from "../../lib/offlineFetch";
import { Portal } from "./ui";

type Props = {
  state: OfflineSyncState;
  onClose: () => void;
  onSync: () => void;
  onRecovery: () => void;
};

export function SyncStatusDialog({ state, onClose, onSync, onRecovery }: Props) {
  const status = state.legacyPending
    ? "Older changes need attention"
    : state.error
      ? "Synchronisation failed"
      : state.syncing
        ? "Synchronising"
        : !state.online
          ? "Working offline"
          : state.pending
            ? "Changes waiting to upload"
            : state.lastSyncedAt
              ? "Up to date"
              : "Not yet synchronised";

  return <Portal><div className="ws-dialog-backdrop" role="presentation"
    onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ws-dialog hw-sync-dialog" role="dialog" aria-modal="true"
      aria-labelledby="hw-sync-title" onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
      }}>
      <header className="ws-dialog-head">
        <h2 id="hw-sync-title">Synchronisation</h2>
        <button type="button" className="ws-icon-button" aria-label="Close synchronisation details"
          autoFocus onClick={onClose}><X size={16}/></button>
      </header>
      <div className="hw-sync-dialog-status">
        {state.error || state.legacyPending ? <AlertTriangle size={21}/> : !state.online ? <CloudOff size={21}/> : state.syncing ? <RefreshCw size={21}/> : <CheckCircle2 size={21}/>}
        <strong>{status}</strong>
      </div>
      <dl className="hw-sync-details">
        <div><dt>Connection</dt><dd>{state.online ? "Online" : "Offline"}</dd></div>
        <div><dt>Pending current-account changes</dt><dd>{state.pending}</dd></div>
        <div><dt>Older unassigned changes</dt><dd>{state.legacyPending}</dd></div>
        <div><dt>Last completed sync</dt><dd>{state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleString() : "None recorded"}</dd></div>
      </dl>
      {state.error ? <p className="hw-sync-error" role="alert">{state.error}</p> : null}
      {state.legacyPending ? <p className="hw-sync-explainer">Older changes are kept on this device, separately from your current account. They cannot be uploaded automatically. Export a backup and review them before restoring anything.</p> : null}
      {!state.online && state.pending ? <p className="hw-sync-explainer">Your pending changes remain on this device. They can synchronise when you reconnect.</p> : null}
      {state.held ? <p className="hw-sync-explainer">{state.held} of your offline {state.held === 1 ? "edit was" : "edits were"} refused because the same record changed elsewhere first. Nothing was overwritten; review {state.held === 1 ? "it" : "them"} in Offline recovery.</p> : null}
      <footer className="ws-dialog-actions hw-sync-actions">
        {state.legacyPending || state.held ? <button type="button" className="ws-button" onClick={onRecovery}>
          <ArchiveRestore size={14}/> Review changes ({state.legacyPending + state.held})</button> : null}
        <button type="button" className="ws-button is-primary" disabled={state.syncing || !state.online}
          onClick={onSync}><RefreshCw size={14}/>{state.syncing ? "Syncing…" : "Synchronise now"}</button>
      </footer>
    </section>
  </div></Portal>;
}
