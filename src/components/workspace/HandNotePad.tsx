import { memo, useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowDownToLine, Eraser, Grid3x3, Hand, Highlighter, PenLine, Redo2, Rows3, SlidersHorizontal, Square, Trash2, Undo2 } from "lucide-react";
import {
  HAND_NOTE_GROW, HAND_NOTE_MAX_HEIGHT, HAND_NOTE_MIN_HEIGHT, HAND_NOTE_WIDTH, INK_COLOURS, MARKER_COLOURS, MARKER_OPACITY,
  paperPath, simplifyPoints, smoothPath, strokeColour, strokeHit, strokeWidth,
  type HandNote, type HandPaper, type InkStroke, type InkTool,
} from "../../lib/handNote";
import "./hand-note.css";

const strokeKeys = new WeakMap<InkStroke, number>();
let nextStrokeKey = 1;
function keyOf(stroke: InkStroke) {
  let key = strokeKeys.get(stroke);
  if (!key) { key = nextStrokeKey++; strokeKeys.set(stroke, key); }
  return key;
}

const StrokePath = memo(function StrokePath({ stroke, fading = false }: { stroke: InkStroke; fading?: boolean }) {
  const d = useMemo(() => smoothPath(stroke.points), [stroke]);
  const colour = strokeColour(stroke);
  const opacity = stroke.tool === "marker" ? MARKER_OPACITY : 1;
  return <path d={d} className={`hn-stroke${stroke.tool === "marker" ? " hn-marker" : ""}${fading ? " is-fading" : ""}`} stroke={colour.hex}
    style={{ stroke: `var(${colour.css}, ${colour.hex})` }}
    strokeWidth={strokeWidth(stroke)} strokeOpacity={fading ? opacity * .22 : opacity === 1 ? undefined : opacity}
    fill="none" strokeLinecap="round" strokeLinejoin="round" />;
});

function PaperLines({ note }: { note: Pick<HandNote, "paper" | "height"> }) {
  const d = paperPath(note.paper, note.height);
  return d ? <path className="hn-paper-lines" d={d} fill="none" stroke="rgba(64,98,140,.16)" strokeWidth={1} /> : null;
}

/** A finished drawing, as it appears in notes, Captures and the editor. */
export function HandNoteDrawing({ note, label = "Handwritten note", maxHeight }: {
  note: HandNote; label?: string; maxHeight?: number;
}) {
  return <div className="hn-sheet is-static" data-paper={note.paper} style={maxHeight ? { maxHeight, overflow: "hidden" } : undefined}>
    <svg className="hn-svg" viewBox={`0 0 ${HAND_NOTE_WIDTH} ${note.height}`} role="img" aria-label={label}
      style={{ aspectRatio: `${HAND_NOTE_WIDTH} / ${note.height}` }}>
      <PaperLines note={note} />
      {note.strokes.map((stroke) => <StrokePath key={keyOf(stroke)} stroke={stroke} />)}
    </svg>
  </div>;
}

type Tool = InkTool | "eraser";
type ToolPrefs = { tool: Tool; pen: number; marker: number; penSize: number; markerSize: number };
type FingerMode = "auto" | "draw" | "scroll";
const PREFS_KEY = "heuresis.ink.tools.v1";
const FINGER_KEY = "heuresis.ink.finger.v1";
const PEN_SEEN_KEY = "heuresis.ink.penSeen.v1";
const DEFAULT_PREFS: ToolPrefs = { tool: "pen", pen: 0, marker: 0, penSize: 1, markerSize: 1 };

function readPrefs(): ToolPrefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "null") as Partial<ToolPrefs> | null;
    if (!saved) return DEFAULT_PREFS;
    const index = (value: unknown, length: number, fallback: number) =>
      Number.isInteger(value) && Number(value) >= 0 && Number(value) < length ? Number(value) : fallback;
    return {
      // The eraser is a moment's tool: a pad always opens ready to write.
      tool: saved.tool === "marker" ? "marker" : "pen",
      pen: index(saved.pen, INK_COLOURS.length, 0), marker: index(saved.marker, MARKER_COLOURS.length, 0),
      penSize: index(saved.penSize, 3, 1), markerSize: index(saved.markerSize, 3, 1),
    };
  } catch { return DEFAULT_PREFS; }
}
function readStored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function writeStored(key: string, value: string) { try { localStorage.setItem(key, value); } catch { /* optional */ } }

type Gesture =
  | { kind: "draw"; pointerId: number; rect: DOMRect; points: number[]; stroke: Omit<InkStroke, "points"> }
  | { kind: "erase"; pointerId: number; rect: DOMRect; hits: Set<InkStroke>; lastX: number; lastY: number }
  | { kind: "scroll"; pointerId: number; startY: number; startScroll: number };

const PAPER_NEXT: Record<HandPaper, HandPaper> = { plain: "lines", lines: "grid", grid: "plain" };
const PAPER_LABEL: Record<HandPaper, string> = { plain: "Plain paper", lines: "Lined paper", grid: "Squared paper" };
const SIZE_LABEL = ["Fine", "Medium", "Bold"];
const ERASER_PX = 11;

/**
 * Handwriting pad: pen, highlighter and stroke eraser, three sizes, undo and redo,
 * paper that grows as you write. A stylus's eraser end (or side button) erases.
 * Once a stylus has been used on this device, fingers scroll instead of drawing,
 * so a resting hand leaves no marks; the hand button switches that.
 */
export function HandNotePad({ value, onChange, disabled = false, variant = "compact", autoFocus = false, fill = variant === "sheet" }: {
  value: HandNote; onChange: (next: HandNote) => void; disabled?: boolean;
  /** "sheet" centres a wide page for drawing inside a page or full screen. */
  variant?: "compact" | "sheet"; autoFocus?: boolean;
  /** The pad has a fixed height (set by its container) and the paper should fill it. */
  fill?: boolean;
}) {
  const [prefs, setPrefs] = useState<ToolPrefs>(readPrefs);
  const [fingerMode, setFingerMode] = useState<FingerMode>(() => {
    const stored = readStored(FINGER_KEY);
    return stored === "draw" || stored === "scroll" ? stored : "auto";
  });
  const [penSeen, setPenSeen] = useState(() => readStored(PEN_SEEN_KEY) === "1");
  const [erasing, setErasing] = useState<Set<InkStroke>>(() => new Set());
  const [status, setStatus] = useState("");
  const [moreTools, setMoreTools] = useState(false);
  const [, setHistoryVersion] = useState(0);
  const padRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<SVGPathElement>(null);
  const cursorRef = useRef<SVGCircleElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const valueRef = useRef(value);
  // The paper always reaches the bottom of the space it is given; only the part
  // actually written on is stored, so a tall screen never saves empty paper.
  const [visibleUnits, setVisibleUnits] = useState(0);
  const displayHeight = Math.min(HAND_NOTE_MAX_HEIGHT, Math.max(value.height, visibleUnits));
  const displayRef = useRef(displayHeight);
  displayRef.current = displayHeight;
  const emitted = useRef<HandNote | null>(null);
  const past = useRef<HandNote[]>([]);
  const future = useRef<HandNote[]>([]);
  valueRef.current = value;

  // A drawing replaced from outside (saved, discarded, another draft) starts a new history.
  if (value !== emitted.current && emitted.current !== null) {
    emitted.current = null;
    past.current = [];
    future.current = [];
  }
  const touchCapable = typeof navigator !== "undefined" && navigator.maxTouchPoints > 0;
  const fingerDraws = fingerMode === "auto" ? !penSeen : fingerMode === "draw";

  useEffect(() => { writeStored(PREFS_KEY, JSON.stringify(prefs)); }, [prefs]);
  useEffect(() => { if (autoFocus) padRef.current?.focus({ preventScroll: true }); }, [autoFocus]);
  useEffect(() => () => { if (frame.current) cancelAnimationFrame(frame.current); }, []);
  useEffect(() => {
    const scroller = scrollRef.current;
    const sheet = scroller?.querySelector(".hn-sheet");
    if (!fill || !scroller || !sheet || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const width = sheet.clientWidth;
      setVisibleUnits(width ? Math.floor((scroller.clientHeight - 2) / width * HAND_NOTE_WIDTH) : 0);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    observer.observe(sheet);
    return () => observer.disconnect();
  }, [fill]);
  useEffect(() => {
    if (!status) return;
    const timer = window.setTimeout(() => setStatus(""), 4000);
    return () => window.clearTimeout(timer);
  }, [status]);

  const commit = useCallback((next: HandNote) => {
    past.current = [...past.current.slice(-199), valueRef.current];
    future.current = [];
    emitted.current = next;
    setHistoryVersion((version) => version + 1);
    onChange(next);
  }, [onChange]);
  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    future.current.push(valueRef.current);
    emitted.current = previous;
    setHistoryVersion((version) => version + 1);
    onChange(previous);
  }, [onChange]);
  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    past.current.push(valueRef.current);
    emitted.current = next;
    setHistoryVersion((version) => version + 1);
    onChange(next);
  }, [onChange]);

  const setTool = (tool: Tool) => setPrefs((current) => ({ ...current, tool }));
  const toUnits = (event: { clientX: number; clientY: number }, rect: DOMRect) => ({
    x: Math.max(0, Math.min(HAND_NOTE_WIDTH, (event.clientX - rect.left) / rect.width * HAND_NOTE_WIDTH)),
    y: Math.max(0, Math.min(displayRef.current, (event.clientY - rect.top) / rect.height * displayRef.current)),
  });
  const placeCursor = (x: number, y: number, rect: DOMRect | null) => {
    const cursor = cursorRef.current;
    if (!cursor) return;
    if (!rect) { cursor.setAttribute("visibility", "hidden"); return; }
    cursor.setAttribute("cx", String(x));
    cursor.setAttribute("cy", String(y));
    cursor.setAttribute("r", String(ERASER_PX * HAND_NOTE_WIDTH / rect.width));
    cursor.setAttribute("visibility", "visible");
  };
  /** Erase along the path from the previous eraser position, so a quick swipe misses nothing in between. */
  const eraseAt = (hits: Set<InkStroke>, x: number, y: number, rect: DOMRect, fromX = x, fromY = y) => {
    const radius = ERASER_PX * HAND_NOTE_WIDTH / rect.width;
    const steps = Math.max(1, Math.ceil(Math.hypot(x - fromX, y - fromY) / (radius / 2)));
    let added = false;
    for (let step = 1; step <= steps; step += 1) {
      const px = fromX + (x - fromX) * step / steps, py = fromY + (y - fromY) * step / steps;
      for (const stroke of valueRef.current.strokes) {
        if (!hits.has(stroke) && strokeHit(stroke, px, py, radius)) { hits.add(stroke); added = true; }
      }
    }
    if (added) setErasing(new Set(hits));
  };
  const paintActive = () => {
    frame.current = 0;
    const current = gesture.current;
    if (current?.kind === "draw") activeRef.current?.setAttribute("d", smoothPath(current.points));
  };

  // Keep receiving the stroke when it leaves the paper; a pointer the browser no longer tracks is ignored.
  const capture = (event: PointerEvent<SVGSVGElement>) => {
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not an active pointer */ }
  };

  function start(event: PointerEvent<SVGSVGElement>) {
    if (disabled) return;
    const native = event.nativeEvent;
    if (event.pointerType === "pen" && !penSeen) { setPenSeen(true); writeStored(PEN_SEEN_KEY, "1"); }
    // One gesture at a time: a palm or second finger never adds marks.
    if (gesture.current) { event.preventDefault(); return; }
    const stylusEraser = event.pointerType === "pen" && ((event.buttons & 32) !== 0 || event.button === 5 || (event.buttons & 2) !== 0);
    if (event.pointerType === "mouse" && event.button !== 0) return;
    padRef.current?.focus({ preventScroll: true });
    if (event.pointerType === "touch" && !fingerDraws) {
      const scroller = scrollRef.current;
      gesture.current = { kind: "scroll", pointerId: event.pointerId, startY: event.clientY, startScroll: scroller?.scrollTop ?? 0 };
      capture(event);
      return;
    }
    event.preventDefault();
    capture(event);
    const rect = event.currentTarget.getBoundingClientRect();
    const point = toUnits(native, rect);
    if (stylusEraser || prefs.tool === "eraser") {
      const hits = new Set<InkStroke>();
      gesture.current = { kind: "erase", pointerId: event.pointerId, rect, hits, lastX: point.x, lastY: point.y };
      placeCursor(point.x, point.y, rect);
      eraseAt(hits, point.x, point.y, rect);
      return;
    }
    const tool: InkTool = prefs.tool === "marker" ? "marker" : "pen";
    const stroke = tool === "marker"
      ? { tool, colour: prefs.marker, size: prefs.markerSize }
      : { tool, colour: prefs.pen, size: prefs.penSize };
    gesture.current = { kind: "draw", pointerId: event.pointerId, rect, points: [point.x, point.y], stroke };
    const path = activeRef.current;
    if (path) {
      const colour = strokeColour(stroke);
      path.setAttribute("stroke", colour.hex);
      path.style.stroke = `var(${colour.css}, ${colour.hex})`;
      path.setAttribute("stroke-width", String(strokeWidth(stroke)));
      path.setAttribute("stroke-opacity", String(tool === "marker" ? MARKER_OPACITY : 1));
      path.setAttribute("d", smoothPath([point.x, point.y]));
      path.setAttribute("visibility", "visible");
    }
  }

  function move(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current) {
      // Hovering mouse or stylus shows where the eraser would act.
      const hoverErase = prefs.tool === "eraser" && event.pointerType !== "touch";
      if (hoverErase) {
        const rect = event.currentTarget.getBoundingClientRect();
        const point = toUnits(event.nativeEvent, rect);
        placeCursor(point.x, point.y, rect);
      }
      return;
    }
    if (current.pointerId !== event.pointerId) return;
    if (current.kind === "scroll") {
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollTop = current.startScroll - (event.clientY - current.startY);
      return;
    }
    event.preventDefault();
    const native = event.nativeEvent;
    const samples = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    const events = samples.length ? samples : [native];
    if (current.kind === "erase") {
      for (const sample of events) {
        const point = toUnits(sample, current.rect);
        eraseAt(current.hits, point.x, point.y, current.rect, current.lastX, current.lastY);
        current.lastX = point.x; current.lastY = point.y;
      }
      const last = toUnits(native, current.rect);
      placeCursor(last.x, last.y, current.rect);
      return;
    }
    const points = current.points;
    for (const sample of events) {
      const point = toUnits(sample, current.rect);
      const lastX = points[points.length - 2], lastY = points[points.length - 1];
      if (Math.hypot(point.x - lastX, point.y - lastY) < 1.2) continue;
      points.push(point.x, point.y);
    }
    if (!frame.current) frame.current = requestAnimationFrame(paintActive);
  }

  function finish(event: PointerEvent<SVGSVGElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (current.kind === "scroll") return;
    if (current.kind === "erase") {
      if (prefs.tool !== "eraser" || event.pointerType === "touch") placeCursor(0, 0, null);
      setErasing(new Set());
      if (current.hits.size) commit({ ...valueRef.current, strokes: valueRef.current.strokes.filter((stroke) => !current.hits.has(stroke)) });
      return;
    }
    if (frame.current) { cancelAnimationFrame(frame.current); frame.current = 0; }
    activeRef.current?.setAttribute("visibility", "hidden");
    const points = simplifyPoints(current.points).map((value) => Math.round(value));
    const stroke: InkStroke = { ...current.stroke, points };
    const note = valueRef.current;
    let lowest = 0;
    for (let index = 1; index < points.length; index += 2) lowest = Math.max(lowest, points[index]);
    // Writing near the bottom adds paper, so a lesson can continue down the page.
    const height = lowest > note.height - 140
      ? Math.min(HAND_NOTE_MAX_HEIGHT, Math.max(note.height + HAND_NOTE_GROW, Math.ceil((lowest + 140) / 50) * 50))
      : note.height;
    commit({ ...note, height, strokes: [...note.strokes, stroke] });
  }

  function clear() {
    if (!value.strokes.length) return;
    commit({ ...value, height: HAND_NOTE_MIN_HEIGHT, strokes: [] });
    setStatus("Page cleared. Undo brings it back.");
    // The button disables itself; keep the keyboard (Ctrl+Z) on the pad.
    padRef.current?.focus({ preventScroll: true });
  }
  function addSpace() {
    if (displayHeight >= HAND_NOTE_MAX_HEIGHT) { setStatus("This page is as long as it can be."); return; }
    commit({ ...value, height: Math.min(HAND_NOTE_MAX_HEIGHT, displayHeight + HAND_NOTE_GROW) });
    window.requestAnimationFrame(() => {
      const scroller = scrollRef.current;
      if (scroller) scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    });
  }
  function toggleFinger() {
    const next: FingerMode = fingerDraws ? "scroll" : "draw";
    setFingerMode(next);
    writeStored(FINGER_KEY, next);
    setStatus(next === "draw" ? "Fingers draw." : "Fingers scroll; draw with the stylus.");
  }

  function keyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, [contenteditable='true']")) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    let handled = true;
    if (mod && key === "z" && !event.shiftKey) undo();
    else if (mod && ((key === "z" && event.shiftKey) || key === "y")) redo();
    else if (!mod && !event.altKey && key === "p") setTool("pen");
    else if (!mod && !event.altKey && key === "h") setTool("marker");
    else if (!mod && !event.altKey && key === "e") setTool("eraser");
    else handled = false;
    if (handled) { event.preventDefault(); event.stopPropagation(); }
  }

  const marker = prefs.tool === "marker";
  const palette = marker ? MARKER_COLOURS : INK_COLOURS;
  const colourIndex = marker ? prefs.marker : prefs.pen;
  const sizeIndex = marker ? prefs.markerSize : prefs.penSize;
  const PaperIcon = value.paper === "plain" ? Square : value.paper === "lines" ? Rows3 : Grid3x3;
  const toolButton = (tool: Tool, label: string, Icon: typeof PenLine) =>
    <button type="button" className={prefs.tool === tool ? "is-on" : ""} aria-pressed={prefs.tool === tool}
      aria-label={label} title={label} disabled={disabled} onClick={() => setTool(tool)}><Icon size={17} /></button>;

  return <div ref={padRef} className={`hn-pad ${variant === "sheet" ? "is-sheet" : ""} ${fill ? "is-fill" : ""}`} tabIndex={-1} onKeyDown={keyDown}
    data-tool={prefs.tool}>
    <div className="hn-tools" role="toolbar" aria-label="Handwriting tools">
      <div className="hn-group" role="group" aria-label="Tool">
        {toolButton("pen", "Pen (P)", PenLine)}
        {toolButton("marker", "Highlighter (H)", Highlighter)}
        {toolButton("eraser", "Eraser (E). A stylus's eraser end or side button also erases", Eraser)}
      </div>
      {prefs.tool !== "eraser" ? <>
        <div className="hn-group hn-colours" role="group" aria-label={marker ? "Highlighter colour" : "Ink colour"}>
          {palette.map((colour, index) => <button key={colour.name} type="button" className="hn-swatch"
            aria-pressed={colourIndex === index} aria-label={`${colour.name} ${marker ? "highlighter" : "ink"}`} title={colour.name}
            disabled={disabled} style={{ ["--swatch" as string]: `var(${colour.css}, ${colour.hex})` }}
            onClick={() => setPrefs((current) => marker ? { ...current, marker: index } : { ...current, pen: index })} />)}
        </div>
        <div className="hn-group hn-sizes" role="group" aria-label="Size" hidden={!moreTools}>
          {[0, 1, 2].map((size) => <button key={size} type="button" className="hn-size" aria-pressed={sizeIndex === size}
            aria-label={SIZE_LABEL[size]} title={SIZE_LABEL[size]} disabled={disabled}
            onClick={() => setPrefs((current) => marker ? { ...current, markerSize: size } : { ...current, penSize: size })}>
            <i style={{ width: 4 + size * 4, height: 4 + size * 4 }} /></button>)}
        </div>
      </> : <span className="hn-hint">Touch a stroke to remove it</span>}
      <div className="hn-group" role="group" aria-label="History">
        <button type="button" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" disabled={disabled || !past.current.length}
          onClick={() => { undo(); padRef.current?.focus({ preventScroll: true }); }}><Undo2 size={17} /></button>
        <button type="button" aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" disabled={disabled || !future.current.length}
          onClick={() => { redo(); padRef.current?.focus({ preventScroll: true }); }}><Redo2 size={17} /></button>
      </div>
      <span className="hn-spacer" />
      <div className="hn-group" role="group" aria-label="Page">
        {touchCapable ? <button type="button" className={fingerDraws ? "is-on" : ""} aria-pressed={fingerDraws}
          aria-label={fingerDraws ? "Fingers draw. Switch to scrolling with fingers" : "Fingers scroll. Switch to drawing with fingers"}
          title={fingerDraws ? "Fingers draw (tap to let fingers scroll)" : "Fingers scroll, the stylus draws (tap to draw with fingers)"}
          disabled={disabled} onClick={toggleFinger}><Hand size={17} /></button> : null}
        <button type="button" aria-label={moreTools ? "Hide secondary pen controls" : "More handwriting tools"}
          aria-expanded={moreTools} title={moreTools ? "Fewer tools" : "Pen sizes, paper and page tools"}
          onClick={() => setMoreTools((current) => !current)}><SlidersHorizontal size={17} /></button>
        {moreTools ? <>
          <button type="button" aria-label={`${PAPER_LABEL[value.paper]}. Change paper`} title={`${PAPER_LABEL[value.paper]} (tap to change)`}
            disabled={disabled} onClick={() => commit({ ...value, paper: PAPER_NEXT[value.paper] })}><PaperIcon size={16} /></button>
          <button type="button" aria-label="More space" title="More space at the bottom" disabled={disabled} onClick={addSpace}><ArrowDownToLine size={17} /></button>
          <button type="button" aria-label="Clear page" title="Clear the page (Undo brings it back)" disabled={disabled || !value.strokes.length} onClick={clear}><Trash2 size={16} /></button>
        </> : null}
      </div>
    </div>
    <div ref={scrollRef} className="hn-scroll">
      <div className="hn-sheet" data-paper={value.paper}>
        <svg className="hn-svg hn-canvas" viewBox={`0 0 ${HAND_NOTE_WIDTH} ${displayHeight}`} role="img"
          aria-label="Handwriting canvas" style={{ aspectRatio: `${HAND_NOTE_WIDTH} / ${displayHeight}` }}
          data-finger={fingerDraws ? "draw" : "scroll"}
          onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish}
          onPointerLeave={() => { if (!gesture.current) placeCursor(0, 0, null); }}
          onContextMenu={(event) => event.preventDefault()}>
          <PaperLines note={{ paper: value.paper, height: displayHeight }} />
          {value.strokes.map((stroke) => <StrokePath key={keyOf(stroke)} stroke={stroke} fading={erasing.has(stroke)} />)}
          <path ref={activeRef} visibility="hidden" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          <circle ref={cursorRef} className="hn-eraser-cursor" r={ERASER_PX} visibility="hidden" />
        </svg>
      </div>
    </div>
    {status ? <p className="hn-status" role="status">{status}</p> : null}
  </div>;
}
