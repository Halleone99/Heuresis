import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./review-answer-pad.css";

type Point = { x: number; y: number };
type Stroke = { points: Point[]; width: number };
type Props = { revealed: boolean; onHasWritingChange: (value: boolean) => void };

/** An inline, aspect-locked writing pad; no DOM observation or floating overlay. */
export default function ReviewAnswerPad({ revealed, onHasWritingChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activePointer = useRef<number | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [eraser, setEraser] = useState(false);
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;

  useEffect(() => { onHasWritingChange(strokes.length > 0); }, [strokes.length, onHasWritingChange]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const paint = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(bounds.width * dpr);
      canvas.height = Math.round(bounds.height * dpr);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, bounds.width, bounds.height);
      const ink = getComputedStyle(canvas).color || "#302c29";
      context.strokeStyle = ink;
      context.fillStyle = ink;
      context.lineCap = "round";
      context.lineJoin = "round";
      for (const stroke of strokesRef.current) {
        const pts = stroke.points;
        if (!pts.length) continue;
        context.lineWidth = stroke.width * Math.min(bounds.width / 600, bounds.height / 220);
        context.beginPath();
        pts.forEach((p, i) => {
          const x = p.x * bounds.width;
          const y = p.y * bounds.height;
          if (i === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        });
        if (pts.length === 1) {
          context.arc(pts[0].x * bounds.width, pts[0].y * bounds.height, Math.max(1.5, context.lineWidth / 2), 0, Math.PI * 2);
          context.fill();
        } else context.stroke();
      }
    };
    const observer = new ResizeObserver(paint);
    observer.observe(canvas);
    paint();
    return () => observer.disconnect();
  }, [strokes]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  };
  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (revealed) return;
    event.preventDefault();
    const p = point(event);
    if (eraser) {
      // Remove the nearest stroke, not the whole answer.
      const distances = strokesRef.current.map((stroke) => Math.min(...stroke.points.map((q) => Math.hypot((q.x - p.x) * 2.7, q.y - p.y))));
      const minimum = Math.min(...distances);
      if (minimum < 0.12) setStrokes((previous) => previous.filter((_, i) => i !== distances.indexOf(minimum)));
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    activePointer.current = event.pointerId;
    const pressure = event.pointerType === "pen" ? Math.max(.2, event.pressure) : .55;
    setStrokes((previous) => [...previous, { points: [p], width: 5 + pressure * 3 }]);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (revealed || activePointer.current !== event.pointerId) return;
    event.preventDefault();
    const p = point(event);
    setStrokes((previous) => previous.map((stroke, i) => i === previous.length - 1 ? { ...stroke, points: [...stroke.points, p] } : stroke));
  };
  const stop = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointer.current !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    activePointer.current = null;
  };

  return <div className={`review-answer-pad${revealed ? " is-revealed" : ""}`}>
    <div className="review-answer-pad-heading"><span>{revealed ? "Yours" : "Write your answer"}</span>
      {!revealed ? <div className="review-answer-pad-tools">
        <button type="button" aria-pressed={eraser} onClick={() => setEraser((v) => !v)}>{eraser ? "Pen" : "Eraser"}</button>
        <button type="button" disabled={!strokes.length} onClick={() => setStrokes((previous) => previous.slice(0, -1))}>Undo</button>
        <button type="button" disabled={!strokes.length} onClick={() => setStrokes([])}>Clear</button>
      </div> : null}
    </div>
    <div className="review-answer-pad-grid">
      <canvas ref={canvasRef} aria-label="Handwrite your answer" className={eraser ? "is-erasing" : ""} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
    </div>
    {!strokes.length && revealed ? <small>No handwriting entered.</small> : null}
  </div>;
}
