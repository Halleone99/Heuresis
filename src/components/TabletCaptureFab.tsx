import { NotebookPen } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";

type Position = { x: number; y: number };
const STORAGE_KEY = "heuresis.tablet.capture.fab.v1";
const SIZE = 52;
const EDGE = 12;
const MIN_TOP = 76;
const BOTTOM_CLEARANCE = 86;

function clamp(n: number, min: number, max: number) { return Math.min(Math.max(n, min), Math.max(min, max)); }
function fit(position: Position): Position {
  return {
    x: clamp(position.x, EDGE, window.innerWidth - SIZE - EDGE),
    y: clamp(position.y, MIN_TOP, window.innerHeight - SIZE - BOTTOM_CLEARANCE),
  };
}
function initialPosition(): Position {
  const fallback = { x: window.innerWidth - SIZE - EDGE, y: window.innerHeight - SIZE - BOTTOM_CLEARANCE - 54 };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as { side?: string; heightRatio?: number } | null;
    if (saved && (saved.side === "left" || saved.side === "right") && typeof saved.heightRatio === "number") {
      return fit({ x: saved.side === "left" ? EDGE : window.innerWidth - SIZE - EDGE, y: saved.heightRatio * window.innerHeight });
    }
  } catch { /* Storage is optional in Android WebView. */ }
  return fit(fallback);
}

/** A single movable Capture shortcut on touch layouts. Drag it to either edge, tap to capture. */
export default function TabletCaptureFab({ onCapture }: { onCapture: () => void }) {
  const [position, setPosition] = useState<Position>(initialPosition);
  const start = useRef<{ pointerId: number; x: number; y: number; original: Position } | null>(null);
  const dragged = useRef(false);
  useEffect(() => {
    const resize = () => setPosition((current) => fit(current));
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  function begin(event: PointerEvent<HTMLButtonElement>) {
    if (event.pointerType === "mouse") return;
    dragged.current = false;
    start.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, original: position };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function move(event: PointerEvent<HTMLButtonElement>) {
    const held = start.current;
    if (!held || held.pointerId !== event.pointerId) return;
    const dx = event.clientX - held.x, dy = event.clientY - held.y;
    if (Math.hypot(dx, dy) > 8) dragged.current = true;
    if (dragged.current) setPosition(fit({ x: held.original.x + dx, y: held.original.y + dy }));
  }
  function finish(event: PointerEvent<HTMLButtonElement>) {
    const held = start.current;
    if (!held || held.pointerId !== event.pointerId) return;
    start.current = null;
    if (!dragged.current) return;
    const current = fit({
      x: (held.original.x + event.clientX - held.x) + SIZE / 2 < window.innerWidth / 2 ? EDGE : window.innerWidth - SIZE - EDGE,
      y: held.original.y + event.clientY - held.y,
    });
    setPosition(current);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ side: current.x < window.innerWidth / 2 ? "left" : "right", heightRatio: current.y / window.innerHeight }));
    } catch { /* Non-persistent storage is fine. */ }
  }
  return <button type="button" className="tablet-capture-fab" style={{ left: position.x, top: position.y }}
    title="Quick Capture · drag to move" aria-label="Quick Capture. Drag to reposition."
    onPointerDown={begin} onPointerMove={move} onPointerUp={finish}
    onPointerCancel={() => { start.current = null; dragged.current = true; }}
    onClick={() => { if (dragged.current) { dragged.current = false; return; } onCapture(); }}>
    <NotebookPen size={21} aria-hidden="true" />
  </button>;
}
