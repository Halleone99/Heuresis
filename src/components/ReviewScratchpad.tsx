import { Eye, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import "./review-scratchpad.css";

type TargetRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type Point = {
  x: number;
  y: number;
};

type Stroke = {
  points: Point[];
  width: number;
};

const INK = "#332e29";

function rectChanged(previous: TargetRect | null, next: TargetRect) {
  if (!previous) return true;
  return Math.abs(previous.left - next.left) > 0.5
    || Math.abs(previous.top - next.top) > 0.5
    || Math.abs(previous.width - next.width) > 0.5
    || Math.abs(previous.height - next.height) > 0.5;
}

export default function ReviewScratchpad() {
  const params = new URLSearchParams(window.location.search);
  const reviewWindow = params.get("cosmos") === "1" && (params.get("related") === "1" || params.get("mode") !== "sort");
  const [active, setActive] = useState(false);
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [canReveal, setCanReveal] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const drawingPointerRef = useRef<number | null>(null);
  const currentStrokeRef = useRef<Stroke | null>(null);
  const lastCardMarkerRef = useRef("");

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, bounds.width, bounds.height);
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";

    for (const stroke of strokesRef.current) {
      if (!stroke.points.length) continue;
      ctx.lineWidth = stroke.width;
      if (stroke.points.length === 1) {
        const point = stroke.points[0];
        ctx.beginPath();
        ctx.arc(point.x * bounds.width, point.y * bounds.height, stroke.width / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      stroke.points.forEach((point, index) => {
        const x = point.x * bounds.width;
        const y = point.y * bounds.height;
        if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      });
      ctx.stroke();
    }
  }, []);

  const clearScratchpad = useCallback(() => {
    strokesRef.current = [];
    currentStrokeRef.current = null;
    drawingPointerRef.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    canvas.getContext("2d")?.clearRect(0, 0, bounds.width, bounds.height);
  }, []);

  useEffect(() => {
    if (!reviewWindow) return;

    let frame = 0;
    const resizeObserver = new ResizeObserver(() => scheduleMeasure());

    function measure() {
      frame = 0;
      const target = document.querySelector<HTMLElement>(".cosmos-nucleus");
      if (target !== targetRef.current) {
        resizeObserver.disconnect();
        targetRef.current = target;
        if (target) resizeObserver.observe(target);
      }

      if (!target) {
        setTargetRect(null);
      } else {
        const rect = target.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const next = { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
          setTargetRect((previous) => rectChanged(previous, next) ? next : previous);
        }
      }

      setCanReveal(Boolean(document.querySelector(".cosmos-inline-reveal")));
      const marker = document.querySelector<HTMLElement>(".cosmos-count")?.textContent?.trim() ?? "";
      if (marker && lastCardMarkerRef.current && marker !== lastCardMarkerRef.current) clearScratchpad();
      if (marker) lastCardMarkerRef.current = marker;
    }

    function scheduleMeasure() {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    }

    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "style", "aria-expanded"],
    });
    window.addEventListener("resize", scheduleMeasure);
    scheduleMeasure();

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [clearScratchpad, reviewWindow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !targetRect) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(targetRect.width * dpr));
    canvas.height = Math.max(1, Math.round(targetRect.height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }, [redraw, targetRect?.width, targetRect?.height]);

  if (!reviewWindow || !targetRect) return null;

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width))),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / Math.max(1, rect.height))),
    };
  }

  function beginStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!active) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const pressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.45;
    const stroke: Stroke = {
      points: [pointFromEvent(event)],
      width: event.pointerType === "pen" ? 1.5 + pressure * 2.8 : 2.7,
    };
    strokesRef.current.push(stroke);
    currentStrokeRef.current = stroke;
    drawingPointerRef.current = event.pointerId;
    redraw();
  }

  function continueStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!active || drawingPointerRef.current !== event.pointerId || !currentStrokeRef.current) return;
    event.preventDefault();
    currentStrokeRef.current.points.push(pointFromEvent(event));
    redraw();
  }

  function endStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (drawingPointerRef.current !== event.pointerId) return;
    event.preventDefault();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drawingPointerRef.current = null;
    currentStrokeRef.current = null;
  }

  function undo() {
    strokesRef.current.pop();
    redraw();
  }

  function revealCard() {
    document.querySelector<HTMLButtonElement>(".cosmos-inline-reveal")?.click();
  }

  const toolbarLeft = Math.max(12, targetRect.left + targetRect.width - (active ? (canReveal ? 174 : 136) : 42));
  const toolbarTop = targetRect.top + 14;

  return <>
    <canvas
      ref={canvasRef}
      className={`review-scratchpad-canvas${active ? " active" : ""}`}
      style={{ left: targetRect.left, top: targetRect.top, width: targetRect.width, height: targetRect.height }}
      aria-label="Review scratchpad"
      onPointerDown={beginStroke}
      onPointerMove={continueStroke}
      onPointerUp={endStroke}
      onPointerCancel={endStroke}
    />
    <div className={`review-scratchpad-tools${active ? " active" : ""}`} style={{ left: toolbarLeft, top: toolbarTop }}>
      <button type="button" className={active ? "selected" : ""} title={active ? "Stop writing" : "Write on card"} aria-label={active ? "Stop writing" : "Write on card"} aria-pressed={active} onClick={() => setActive((value) => !value)}><Pencil size={16} /></button>
      {active ? <>
        <button type="button" title="Undo stroke" aria-label="Undo stroke" onClick={undo}><RotateCcw size={15} /></button>
        <button type="button" title="Clear writing" aria-label="Clear writing" onClick={clearScratchpad}><Trash2 size={15} /></button>
        {canReveal ? <button type="button" className="reveal" title="Reveal card" aria-label="Reveal card" onClick={revealCard}><Eye size={16} /></button> : null}
      </> : null}
    </div>
  </>;
}
