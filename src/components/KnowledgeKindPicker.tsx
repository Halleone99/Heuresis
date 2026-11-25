import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown } from "lucide-react";
import { KIND_INFO, KNOWLEDGE_KIND_ORDER, type KnowledgeKind } from "../lib/knowledgeKinds";
import "./knowledge-kind.css";

/**
 * What kind of applied knowledge a card is (definition, rule, procedure, figure, question).
 * Two forms of the same choice: a quiet chip with a menu on the card itself (New), and a row of
 * segments in editors (Capture, Edit card). Changing it changes the card's details and exercises.
 */
export function KnowledgeKindChip({ kind, suggested = false, disabled = false, onChange }: {
  kind: KnowledgeKind;
  /** True when nobody chose it yet: it was read from what the card contains. */
  suggested?: boolean;
  disabled?: boolean;
  onChange: (kind: KnowledgeKind) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const info = KIND_INFO[kind];
  return <div ref={root} className="kind-chip" data-open={open || undefined}
    onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); } }}>
    <button type="button" className={`kind-chip-trigger${suggested ? " is-suggested" : ""}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open}
      aria-label={`Kind of knowledge: ${info.label}${suggested ? " (suggested)" : ""}. Change`} title={suggested ? "Suggested from the card · choose to confirm" : info.short}
      onClick={() => setOpen((value) => !value)}>
      <span className="kind-chip-mark" aria-hidden="true">{info.mark}</span>{info.label}
      <ChevronDown size={12} aria-hidden="true" />
    </button>
    {open ? <div className="kind-chip-menu" role="menu" aria-label="Kind of knowledge">
      <p>What kind of knowledge is this?</p>
      {KNOWLEDGE_KIND_ORDER.map((id) => <button type="button" role="menuitemradio" key={id} aria-checked={id === kind}
        onClick={() => { setOpen(false); if (id !== kind || suggested) onChange(id); }}>
        <span className="kind-chip-mark" aria-hidden="true">{KIND_INFO[id].mark}</span>
        <span className="kind-chip-copy"><strong>{KIND_INFO[id].label}</strong><small>{KIND_INFO[id].short}</small><em>{KIND_INFO[id].trains}</em></span>
      </button>)}
    </div> : null}
  </div>;
}

export function KnowledgeKindSegments({ value, onChange, disabled = false }: {
  value: KnowledgeKind;
  onChange: (kind: KnowledgeKind) => void;
  disabled?: boolean;
}) {
  return <div className="kind-segments">
    <div role="radiogroup" aria-label="Kind of knowledge">
      {KNOWLEDGE_KIND_ORDER.map((id) => <button type="button" role="radio" key={id} aria-checked={id === value} disabled={disabled}
        className={id === value ? "selected" : ""} onClick={() => onChange(id)} title={KIND_INFO[id].short}>
        <span aria-hidden="true">{KIND_INFO[id].mark}</span>{KIND_INFO[id].label}
      </button>)}
    </div>
    <small>{KIND_INFO[value].short} · Learn: {KIND_INFO[value].trains.toLowerCase()}</small>
  </div>;
}
