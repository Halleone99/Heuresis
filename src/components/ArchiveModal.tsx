import { ArchiveRestore, X } from "lucide-react";
import { useState } from "react";
import { restorePack } from "../lib/advanced";
import type { PackWithType } from "../lib/heuresis";

type Props = { packs: PackWithType[]; onClose: () => void; onChanged: () => Promise<void> | void };

export default function ArchiveModal({ packs, onClose, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  async function restore(pack: PackWithType) {
    setBusyId(pack.id); setMessage("");
    try { await restorePack(pack.id); await onChanged(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not restore the topic."); }
    finally { setBusyId(null); }
  }
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section className="management-modal archive-modal" role="dialog" aria-modal="true"><header className="settings-head"><div><p className="eyebrow">ARCHIVE</p><h2>Archived topics</h2></div><button className="icon-button" onClick={onClose}><X size={17} /></button></header>{packs.length ? <div className="archive-list">{packs.map((pack) => <div className="archive-row" key={pack.id}><span><strong>{pack.title}</strong><small>{pack.card_count} cards · {pack.cardType?.name || "cards"}</small></span><button className="secondary-button" disabled={busyId === pack.id} onClick={() => void restore(pack)}><ArchiveRestore size={14} /> {busyId === pack.id ? "Restoring…" : "Restore"}</button></div>)}</div> : <div className="archive-empty">Nothing is archived.</div>}{message ? <div className="settings-note error">{message}</div> : null}</section></div>;
}
