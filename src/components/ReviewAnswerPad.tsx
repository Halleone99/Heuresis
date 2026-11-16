import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { Eraser, Undo2 } from "lucide-react";
import "./review-answer-pad.css";

/** x and y are normalised to the pad (0–1); p is pen pressure (0–1). */
type Point = { x: number; y: number; p: number };
type Stroke = Point[];
type Props = {
  revealed: boolean;
  onHasWritingChange: (value: boolean) => void;
  /** Number of 田字格 squares. Fixed per platform, never tied to the answer (that would reveal its length). */
  cells?: number;
};

const TOUCH_PRESSURE = 0.5;
/** Pen eraser end, or the pen's eraser button (Pointer Events "buttons" bit 32). */
const PEN_ERASER = 32;

/**
 * An inline writing pad with square 田字格 cells.
 * Strokes are drawn directly onto the canvas as the pointer moves; React state only records
 * how many strokes exist (for Undo / Clear and for the parent), so writing stays smooth with a pen.
 * Once a pen has touched the pad, finger and palm contacts are ignored (palm rejection).
 */
export default function ReviewAnswerPad({ revealed, onHasWritingChange, cells = 3 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const activePointer = useRef<number | null>(null);
  const activeType = useRef<string>("");
  const erasingNow = useRef(false);
  const penSeen = useRef(false);
  const [strokeCount, setStrokeCount] = useState(0);
  const [eraser, setEraser] = useState(false);

  useEffect(() => { onHasWritingChange(strokeCount > 0); }, [strokeCount, onHasWritingChange]);
  const sync = () => setStrokeCount(strokes.current.length);

  const context = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return null;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return null;
    return { ctx, width: bounds.width, height: bounds.height };
  }, []);

  /** Line width follows the cell size, so writing looks the same at every pad size. */
  const widthFor = (height: number, pressure: number) => height * (0.022 + 0.02 * pressure);

  const segment = (ctx: CanvasRenderingContext2D, width: number, height: number, a: Point, b: Point) => {
    ctx.lineWidth = widthFor(height, (a.p + b.p) / 2);
    ctx.beginPath();
    ctx.moveTo(a.x * width, a.y * height);
    ctx.lineTo(b.x * width, b.y * height);
    ctx.stroke();
  };
  const dot = (ctx: CanvasRenderingContext2D, width: number, height: number, a: Point) => {
    ctx.beginPath();
    ctx.arc(a.x * width, a.y * height, Math.max(1.5, widthFor(height, a.p) / 2), 0, Math.PI * 2);
    ctx.fill();
  };

  const repaint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    if (!bounds.width || !bounds.height) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const pixelWidth = Math.round(bounds.width * dpr);
    const pixelHeight = Math.round(bounds.height * dpr);
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    const ink = getComputedStyle(canvas).color || "#302c29";
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes.current) {
      if (stroke.length === 1) dot(ctx, bounds.width, bounds.height, stroke[0]);
      for (let i = 1; i < stroke.length; i += 1) segment(ctx, bounds.width, bounds.height, stroke[i - 1], stroke[i]);
    }
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(repaint);
    observer.observe(canvas);
    repaint();
    return () => observer.disconnect();
  }, [repaint]);

  const pointFrom = (event: { clientX: number; clientY: number; pressure: number; pointerType: string }, rect: DOMRect): Point => ({
    x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    p: event.pointerType === "pen" ? Math.max(0.15, Math.min(1, event.pressure || TOUCH_PRESSURE)) : TOUCH_PRESSURE,
  });

  /** Removes every stroke that passes near the point (distance measured in cell heights). */
  const eraseAt = (point: Point) => {
    const before = strokes.current.length;
    strokes.current = strokes.current.filter((stroke) =>
      !stroke.some((q) => Math.hypot((q.x - point.x) * cells, q.y - point.y) < 0.09));
    if (strokes.current.length !== before) { repaint(); sync(); }
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (revealed) return;
    const type = event.pointerType;
    if (type === "pen") penSeen.current = true;
    // Palm rejection: with a pen in use, a resting hand must neither draw nor block the pen.
    if (type === "touch" && penSeen.current) return;
    if (activePointer.current !== null) {
      // A pen arriving while a finger/palm stroke is open replaces that stroke.
      if (type === "pen" && activeType.current !== "pen") {
        if (!erasingNow.current) strokes.current.pop();
        repaint();
      } else return;
    }
    event.preventDefault();
    // Capture keeps the stroke when the pen leaves the pad; never let it stop the stroke itself.
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
    activePointer.current = event.pointerId;
    activeType.current = type;
    const point = pointFrom(event, event.currentTarget.getBoundingClientRect());
    erasingNow.current = eraser || (type === "pen" && (event.buttons & PEN_ERASER) !== 0);
    if (erasingNow.current) { eraseAt(point); return; }
    strokes.current.push([point]);
    const drawing = context();
    if (drawing) dot(drawing.ctx, drawing.width, drawing.height, point);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (revealed || activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const native = event.nativeEvent;
    const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const points = (samples.length ? samples : [native]).map((sample) => pointFrom(sample, rect));
    if (erasingNow.current) { points.forEach(eraseAt); return; }
    const stroke = strokes.current[strokes.current.length - 1];
    const drawing = context();
    if (!stroke || !drawing) return;
    for (const point of points) {
      const last = stroke[stroke.length - 1];
      stroke.push(point);
      segment(drawing.ctx, drawing.width, drawing.height, last, point);
    }
  };

  const stop = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== event.pointerId) return;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    activePointer.current = null;
    activeType.current = "";
    if (!erasingNow.current) sync();
    erasingNow.current = false;
  };

  const undo = () => { strokes.current = strokes.current.slice(0, -1); repaint(); sync(); };
  const clear = () => { strokes.current = []; repaint(); sync(); };

  return <div className={`review-answer-pad${revealed ? " is-revealed" : ""}`} style={{ "--pad-cells": cells } as CSSProperties}>
    {revealed ? <span className="review-answer-pad-label">Yours</span> : null}
    <div className="review-answer-pad-grid">
      <div className="review-answer-pad-cells" aria-hidden="true">{Array.from({ length: cells }, (_, i) => <i key={i} />)}</div>
      <canvas ref={canvasRef} aria-label="Handwrite your answer" className={eraser ? "is-erasing" : ""}
        onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
    </div>
    {!revealed ? <div className="review-answer-pad-tools" role="group" aria-label="Writing tools">
      <button type="button" disabled={!strokeCount} onClick={undo} title="Undo the last stroke"><Undo2 size={15} aria-hidden="true" /> Undo</button>
      <button type="button" aria-pressed={eraser} onClick={() => setEraser((value) => !value)}
        title={eraser ? "Back to writing" : "Erase strokes (the pen's eraser also works)"}><Eraser size={15} aria-hidden="true" /> Eraser</button>
      <button type="button" disabled={!strokeCount} onClick={clear} title="Clear the pad">Clear</button>
    </div> : null}
    {!strokeCount && revealed ? <small>No handwriting entered.</small> : null}
  </div>;
}
