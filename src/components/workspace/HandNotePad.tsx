import { useRef, useState, type PointerEvent } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { HAND_NOTE_COLOURS, HAND_NOTE_SIZE, type HandStroke } from "../../lib/handNote";

const pageStyle = {
  display: "block", width: "100%", height: "auto", maxHeight: 350,
  background: "#fff", borderRadius: 12, border: "1px solid rgba(105,118,136,.25)",
} as const;

/** SVG strokes are saved as vectors, not a bitmap or a device-specific attachment. */
export function HandNoteDrawing({ strokes, labelled = true }: { strokes: HandStroke[]; labelled?: boolean }) {
  return <svg viewBox={`0 0 ${HAND_NOTE_SIZE.width} ${HAND_NOTE_SIZE.height}`} preserveAspectRatio="xMidYMid meet"
    role="img" aria-label={labelled ? "Handwritten note" : undefined}
    style={pageStyle}>
    {strokes.map((stroke, index) => <path key={index} d={stroke.d} stroke={stroke.color}
      fill="none" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />)}
  </svg>;
}

export function HandNotePad({ strokes, onChange, disabled = false }: {
  strokes: HandStroke[]; onChange: (strokes: HandStroke[]) => void; disabled?: boolean;
}) {
  const [ink, setInk] = useState<string>(HAND_NOTE_COLOURS[0]);
  const [active, setActive] = useState<HandStroke | null>(null);
  const current = useRef<{ pointerId: number; path: string; lastX: number; lastY: number } | null>(null);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  function position(event: PointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(Math.max(0, Math.min(HAND_NOTE_SIZE.width, (event.clientX - bounds.left) / bounds.width * HAND_NOTE_SIZE.width))),
      y: Math.round(Math.max(0, Math.min(HAND_NOTE_SIZE.height, (event.clientY - bounds.top) / bounds.height * HAND_NOTE_SIZE.height))),
    };
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const p = position(event);
    const path = `M${p.x} ${p.y} L${p.x} ${p.y}`;
    current.current = { pointerId: event.pointerId, path, lastX: p.x, lastY: p.y };
    setActive({ d: path, color: ink });
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const drawing = current.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    event.preventDefault();
    const p = position(event);
    if (Math.hypot(p.x - drawing.lastX, p.y - drawing.lastY) < 3) return;
    drawing.path += ` L${p.x} ${p.y}`;
    drawing.lastX = p.x; drawing.lastY = p.y;
    setActive({ d: drawing.path, color: ink });
  }
  function finish(event: PointerEvent<SVGSVGElement>) {
    const drawing = current.current;
    if (!drawing || drawing.pointerId !== event.pointerId) return;
    current.current = null;
    onChange([...strokesRef.current, { d: drawing.path, color: ink }]);
    setActive(null);
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
  }

  return <div className="qc-handnote" style={{ display: "grid", gap: 9 }}>
    <div role="toolbar" aria-label="Handwriting tools" style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ marginRight: "auto", fontSize: 12, opacity: .76 }}>Draw with finger, mouse or stylus</span>
      {HAND_NOTE_COLOURS.map((colour) => <button key={colour} type="button" disabled={disabled}
        aria-label={colour === HAND_NOTE_COLOURS[0] ? "Black ink" : colour === HAND_NOTE_COLOURS[1] ? "Blue ink" : "Red ink"}
        aria-pressed={ink === colour} title="Pen colour" onClick={() => setInk(colour)}
        style={{ width: 22, height: 22, borderRadius: "50%", background: colour, cursor: "pointer",
          border: ink === colour ? "3px solid #b9c6d8" : "2px solid transparent", boxShadow: ink === colour ? "0 0 0 1px #61758b" : "none" }} />)}
      <button type="button" title="Undo last stroke" aria-label="Undo last stroke" disabled={disabled || !strokes.length}
        className="ws-icon-button" onClick={() => onChange(strokes.slice(0, -1))}><RotateCcw size={15}/></button>
      <button type="button" title="Clear handwriting" aria-label="Clear handwriting" disabled={disabled || !strokes.length}
        className="ws-icon-button" onClick={() => { if (window.confirm("Clear all handwriting from this draft?")) onChange([]); }}><Trash2 size={15}/></button>
    </div>
    <svg viewBox={`0 0 ${HAND_NOTE_SIZE.width} ${HAND_NOTE_SIZE.height}`}
      aria-label="Handwriting canvas" role="img" onPointerDown={start} onPointerMove={move}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      style={{ ...pageStyle, touchAction: "none", cursor: disabled ? "default" : "crosshair", maxHeight: "none" }}>
      {strokes.map((stroke, index) => <path key={index} d={stroke.d} stroke={stroke.color}
        fill="none" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />)}
      {active ? <path d={active.d} stroke={active.color} strokeWidth={3.5}
        fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  </div>;
}
