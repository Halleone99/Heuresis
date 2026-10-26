import { useRef, useState, type PointerEvent } from "react";
import { Eraser, PenLine, Redo2, RotateCcw, Trash2 } from "lucide-react";
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

/** Stroke eraser: remove a line touched by the eraser without changing saved vector format. */
function hitsStroke(path: string, x: number, y: number, radius = 19) {
  const values = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const radiusSquared = radius * radius;
  for (let i = 0; i + 3 < values.length; i += 2) {
    const ax = values[i], ay = values[i + 1], bx = values[i + 2], by = values[i + 3];
    const dx = bx - ax, dy = by - ay;
    const factor = dx * dx + dy * dy ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    const px = ax + factor * dx, py = ay + factor * dy;
    if ((x - px) ** 2 + (y - py) ** 2 <= radiusSquared) return true;
  }
  return false;
}

export function HandNotePad({ strokes, onChange, disabled = false }: {
  strokes: HandStroke[]; onChange: (strokes: HandStroke[]) => void; disabled?: boolean;
}) {
  const [ink, setInk] = useState<string>(HAND_NOTE_COLOURS[0]);
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const [active, setActive] = useState<HandStroke | null>(null);
  const [historyTick, setHistoryTick] = useState(0);
  const current = useRef<{ pointerId: number; path: string; lastX: number; lastY: number } | null>(null);
  const erasing = useRef<number | null>(null);
  const strokesRef = useRef(strokes);
  const undoStack = useRef<HandStroke[][]>([]);
  const redoStack = useRef<HandStroke[][]>([]);
  strokesRef.current = strokes;

  function change(next: HandStroke[]) {
    undoStack.current.push(strokesRef.current);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
    strokesRef.current = next;
    onChange(next);
    setHistoryTick((value) => value + 1);
  }
  function undo() {
    const previous = undoStack.current.pop();
    if (!previous) return;
    redoStack.current.push(strokesRef.current);
    strokesRef.current = previous;
    onChange(previous);
    setHistoryTick((value) => value + 1);
  }
  function redo() {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push(strokesRef.current);
    strokesRef.current = next;
    onChange(next);
    setHistoryTick((value) => value + 1);
  }
  function position(event: PointerEvent<SVGSVGElement>) {
    // Account for SVG letterboxing when the tablet or full-screen window changes shape.
    const canvas = event.currentTarget;
    const matrix = canvas.getScreenCTM();
    if (matrix) {
      const point = canvas.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      const mapped = point.matrixTransform(matrix.inverse());
      return {
        x: Math.round(Math.max(0, Math.min(HAND_NOTE_SIZE.width, mapped.x))),
        y: Math.round(Math.max(0, Math.min(HAND_NOTE_SIZE.height, mapped.y))),
      };
    }
    const bounds = canvas.getBoundingClientRect();
    return {
      x: Math.round(Math.max(0, Math.min(HAND_NOTE_SIZE.width, (event.clientX - bounds.left) / bounds.width * HAND_NOTE_SIZE.width))),
      y: Math.round(Math.max(0, Math.min(HAND_NOTE_SIZE.height, (event.clientY - bounds.top) / bounds.height * HAND_NOTE_SIZE.height))),
    };
  }
  function erase(event: PointerEvent<SVGSVGElement>) {
    const point = position(event);
    const next = strokesRef.current.filter((stroke) => !hitsStroke(stroke.d, point.x, point.y));
    if (next.length !== strokesRef.current.length) change(next);
  }
  function start(event: PointerEvent<SVGSVGElement>) {
    if (disabled || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    // Ignore extra touch contacts rather than drawing or erasing with two fingers.
    if (current.current || erasing.current !== null) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "eraser") {
      erasing.current = event.pointerId;
      erase(event);
      return;
    }
    const p = position(event);
    const path = `M${p.x} ${p.y} L${p.x} ${p.y}`;
    current.current = { pointerId: event.pointerId, path, lastX: p.x, lastY: p.y };
    setActive({ d: path, color: ink });
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    if (erasing.current === event.pointerId) {
      event.preventDefault();
      erase(event);
      return;
    }
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
    if (erasing.current === event.pointerId) erasing.current = null;
    const drawing = current.current;
    if (drawing?.pointerId === event.pointerId) {
      current.current = null;
      change([...strokesRef.current, { d: drawing.path, color: ink }]);
      setActive(null);
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  return <div className="qc-handnote" style={{ display: "grid", gap: 9 }}>
    <div role="toolbar" aria-label="Handwriting tools" className="qc-handnote-tools">
      <button type="button" className={tool === "pen" ? "is-active" : ""} aria-label="Draw with pen"
        aria-pressed={tool === "pen"} title="Pen" disabled={disabled} onClick={() => setTool("pen")}><PenLine size={17}/><span>Pen</span></button>
      <button type="button" className={tool === "eraser" ? "is-active" : ""} aria-label="Erase strokes"
        aria-pressed={tool === "eraser"} title="Eraser (removes a touched stroke)" disabled={disabled}
        onClick={() => setTool("eraser")}><Eraser size={17}/><span>Erase</span></button>
      <div className="qc-handnote-colours" aria-label="Pen colours">
        {HAND_NOTE_COLOURS.map((colour) => <button key={colour} type="button" disabled={disabled}
          aria-label={colour === HAND_NOTE_COLOURS[0] ? "Black ink" : colour === HAND_NOTE_COLOURS[1] ? "Blue ink" : colour === HAND_NOTE_COLOURS[2] ? "Red ink" : colour === HAND_NOTE_COLOURS[3] ? "Green ink" : "Wine ink"}
          aria-pressed={tool === "pen" && ink === colour} title="Pen colour" onClick={() => { setInk(colour); setTool("pen"); }}
          style={{ width: 22, height: 22, borderRadius: "50%", background: colour, cursor: "pointer",
            border: tool === "pen" && ink === colour ? "3px solid #b9c6d8" : "2px solid transparent", boxShadow: tool === "pen" && ink === colour ? "0 0 0 1px #61758b" : "none" }} />)}
      </div>
      <button type="button" title="Undo" aria-label="Undo handwriting" disabled={disabled || !undoStack.current.length}
        className="ws-icon-button" onClick={undo}><RotateCcw size={16}/></button>
      <button type="button" title="Redo" aria-label="Redo handwriting" disabled={disabled || !redoStack.current.length}
        className="ws-icon-button" onClick={redo}><Redo2 size={16}/></button>
      <button type="button" title="Clear all handwriting" aria-label="Clear handwriting" disabled={disabled || !strokes.length}
        className="ws-icon-button" onClick={() => { if (window.confirm("Clear all handwriting from this draft?")) change([]); }}><Trash2 size={16}/></button>
    </div>
    <svg viewBox={`0 0 ${HAND_NOTE_SIZE.width} ${HAND_NOTE_SIZE.height}`}
      aria-label="Handwriting canvas" role="img" onPointerDown={start} onPointerMove={move}
      onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
      data-history-version={historyTick}
      style={{ ...pageStyle, touchAction: "none", cursor: disabled ? "default" : tool === "eraser" ? "cell" : "crosshair", maxHeight: "none" }}>
      {strokes.map((stroke, index) => <path key={index} d={stroke.d} stroke={stroke.color}
        fill="none" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" />)}
      {active ? <path d={active.d} stroke={active.color} strokeWidth={3.5}
        fill="none" strokeLinecap="round" strokeLinejoin="round" /> : null}
    </svg>
  </div>;
}
