import { ArrowLeft, ExternalLink, PenLine, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { listCaptureInbox, removeCaptureInboxItem, type CaptureInboxItem } from "../lib/captureInbox";
import type { Collection, PackWithType } from "../lib/heuresis";

type Props = {
  packs: PackWithType[];
  collection: Collection | null;
  onBack: () => void;
  onOpenPack: (pack: PackWithType) => void;
  onOpenCapture: (pack: PackWithType) => void;
};

export default function CaptureInboxView({ packs, collection, onBack, onOpenPack, onOpenCapture }: Props) {
  const [rows, setRows] = useState<CaptureInboxItem[]>([]);
  const [query, setQuery] = useState("");
  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);

  function reload() {
    setRows(listCaptureInbox(packs, collection?.id ?? null));
  }

  useEffect(() => {
    reload();
    const refresh = () => reload();
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [packs, collection?.id]);

  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    if (!q) return rows;
    return rows.filter((row) => [row.front, row.back, row.packTitle, row.state].join(" ").toLocaleLowerCase().includes(q));
  }, [query, rows]);

  function remove(row: CaptureInboxItem) {
    if (!window.confirm(`Discard the draft “${row.front || "Untitled"}”? It has not been added to a topic.`)) return;
    removeCaptureInboxItem(row.packId, row.id);
    reload();
  }

  return <section className="related-catalogue-page capture-inbox-page">
    <button className="text-button back-button" onClick={onBack}><ArrowLeft size={15} /> {collection?.title ?? "Library"}</button>
    <header className="catalogue-heading">
      <div><p className="eyebrow">INBOX</p><h1>Card drafts</h1><p>Cards started in Capture but not added to a topic yet.</p></div>
      <span>{rows.length.toLocaleString()} not added</span>
    </header>
    <div className="related-toolbar">
      <label className="pack-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search drafts" /></label>
    </div>
    <div className="related-table capture-inbox-table">
      <div className="related-table-head capture-inbox-head"><span>Card</span><span>Status</span><span>Topic</span><span>Actions</span></div>
      {shown.map((row) => {
        const pack = packMap.get(row.packId);
        return <div className="related-table-row capture-inbox-row" key={`${row.packId}-${row.id}`}>
          <div className="related-target capture-inbox-card"><strong>{row.front}</strong>{row.back ? <p>{row.back}</p> : null}{row.enrichmentCount ? <small>{row.enrichmentCount} enrichment{row.enrichmentCount === 1 ? "" : "s"}</small> : null}</div>
          <span className={`capture-state-badge ${row.state}`}>{row.state === "waiting" ? "Waiting" : "Draft"}</span>
          <div className="related-source-badge"><small>TOPIC</small><span>{row.packTitle}</span></div>
          <div className="related-actions">
            {pack ? <button title="Continue in Capture" aria-label="Continue in Capture" onClick={() => onOpenCapture(pack)}><PenLine size={14} /></button> : null}
            {pack ? <button title="Open topic" aria-label="Open topic" onClick={() => onOpenPack(pack)}><ExternalLink size={14} /></button> : null}
            <button title="Discard draft" aria-label="Discard draft" onClick={() => remove(row)}><Trash2 size={14} /></button>
          </div>
        </div>;
      })}
      {!shown.length ? <div className="catalogue-empty">{rows.length ? "No captures match this search." : "No card drafts. Everything you captured has been added."}</div> : null}
    </div>
  </section>;
}
