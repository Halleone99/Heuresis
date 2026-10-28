/**
 * Handwriting inside an ordinary Heuresis note body.
 *
 * A drawing is one line of the note: `::handnote:v1:` followed by base64 JSON.
 * The prefix names the container (one base64 line), not the stroke format, so
 * every place that already recognises drawings (the parser, previews, search,
 * titles) keeps working. The JSON carries its own version:
 *
 *   version 1  { version: 1, strokes: [{ d: "M x y L x y …", color: "#202938" }] }
 *              900 × 700, one pen width. Still read; never written any more.
 *   version 2  { v: 2, h: 1050, p: "lines", s: [[tool, colour, size, x0, y0, dx, dy, …]] }
 *              900 wide, any height, pen or highlighter, three sizes, paper.
 *              Points are integers, delta-encoded, so a page of handwriting
 *              fits comfortably inside the 50,000-character note limit.
 *
 * Strokes are vectors, never a bitmap: they stay sharp at any size, follow the
 * light/dark theme, and stay small enough to sync.
 */
export const HAND_NOTE_PREFIX = "::handnote:v1:";
export const HAND_NOTE_WIDTH = 900;
export const HAND_NOTE_MIN_HEIGHT = 700;
export const HAND_NOTE_MAX_HEIGHT = 9000;
/** How much paper "Add space" and the automatic growth at the bottom add. */
export const HAND_NOTE_GROW = 350;

export type InkTool = "pen" | "marker";
export type HandPaper = "plain" | "lines" | "grid";
export type InkStroke = { tool: InkTool; colour: number; size: number; points: number[] };
export type HandNote = { height: number; paper: HandPaper; strokes: InkStroke[] };

/** Version 1 stroke, kept for reading old notes and for the retired capture panel. */
export type HandStroke = { d: string; color: string };

/** Ink colours follow the theme through CSS variables; the hex is the fallback. */
export const INK_COLOURS = [
  { name: "Ink", css: "--hn-ink", hex: "#202938" },
  { name: "Blue", css: "--hn-blue", hex: "#2563eb" },
  { name: "Red", css: "--hn-red", hex: "#c2410c" },
  { name: "Green", css: "--hn-green", hex: "#19805a" },
  { name: "Wine", css: "--hn-wine", hex: "#8b3e66" },
] as const;
export const MARKER_COLOURS = [
  { name: "Yellow", css: "--hn-mark-yellow", hex: "#facc15" },
  { name: "Green", css: "--hn-mark-green", hex: "#4ade80" },
  { name: "Blue", css: "--hn-mark-blue", hex: "#60a5fa" },
  { name: "Pink", css: "--hn-mark-pink", hex: "#f472b6" },
] as const;
export const PEN_SIZES = [2.2, 3.5, 6] as const;
export const MARKER_SIZES = [14, 22, 32] as const;
export const MARKER_OPACITY = 0.38;
/** Kept for the retired capture panel and old imports. */
export const HAND_NOTE_COLOURS = INK_COLOURS.map((colour) => colour.hex);
export const HAND_NOTE_SIZE = { width: HAND_NOTE_WIDTH, height: HAND_NOTE_MIN_HEIGHT } as const;

export function emptyHandNote(paper: HandPaper = "plain"): HandNote {
  return { height: HAND_NOTE_MIN_HEIGHT, paper, strokes: [] };
}
export function isHandNoteEmpty(note: HandNote | null | undefined) {
  return !note || note.strokes.length === 0;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const PAPERS: HandPaper[] = ["plain", "lines", "grid"];

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

function toBase64(text: string) {
  if (typeof btoa === "function") return btoa(text);
  return (globalThis as unknown as { Buffer: { from(s: string, e: string): { toString(e: string): string } } }).Buffer.from(text, "binary").toString("base64");
}
function fromBase64(text: string) {
  if (typeof atob === "function") return atob(text);
  return (globalThis as unknown as { Buffer: { from(s: string, e: string): { toString(e: string): string } } }).Buffer.from(text, "base64").toString("binary");
}

/** One complete note line. Accepts the old stroke list so retired code still compiles. */
export function encodeHandNote(note: HandNote | HandStroke[]): string {
  const value = Array.isArray(note) ? handNoteFromLegacy(note) : note;
  const strokes = value.strokes.filter((stroke) => stroke.points.length >= 2).map((stroke) => {
    const row = [stroke.tool === "marker" ? 1 : 0, stroke.colour, stroke.size];
    let x = 0; let y = 0;
    for (let index = 0; index + 1 < stroke.points.length; index += 2) {
      const nx = Math.round(stroke.points[index]); const ny = Math.round(stroke.points[index + 1]);
      row.push(nx - x, ny - y);
      x = nx; y = ny;
    }
    return row;
  });
  const payload: { v: 2; h: number; p?: HandPaper; s: number[][] } = { v: 2, h: Math.round(value.height), s: strokes };
  if (value.paper !== "plain") payload.p = value.paper;
  return HAND_NOTE_PREFIX + toBase64(JSON.stringify(payload));
}

/** Reads either version. Accepts the full line or only the part after the prefix. */
export function decodeHandNote(encoded: string): HandNote {
  try {
    const trimmed = encoded.trim();
    const payload = trimmed.startsWith(HAND_NOTE_PREFIX) ? trimmed.slice(HAND_NOTE_PREFIX.length) : trimmed;
    const data = JSON.parse(fromBase64(payload)) as Record<string, unknown>;
    if (data.version === 1) return readVersionOne(data.strokes);
    if (data.v === 2) return readVersionTwo(data);
  } catch { /* fall through: an unreadable drawing renders as empty paper */ }
  return emptyHandNote();
}

function readVersionOne(raw: unknown): HandNote {
  if (!Array.isArray(raw) || raw.length > 1000) return emptyHandNote();
  const strokes: HandStroke[] = [];
  for (const item of raw) {
    const row = item as HandStroke;
    if (typeof row?.d !== "string" || row.d.length > 50000 || !/^[ML0-9 .-]+$/.test(row.d)) continue;
    strokes.push({ d: row.d, color: String(row.color ?? "") });
  }
  return handNoteFromLegacy(strokes);
}

function readVersionTwo(data: Record<string, unknown>): HandNote {
  const height = clamp(Math.round(Number(data.h) || HAND_NOTE_MIN_HEIGHT), 300, HAND_NOTE_MAX_HEIGHT);
  const paper = PAPERS.includes(data.p as HandPaper) ? data.p as HandPaper : "plain";
  const rows = Array.isArray(data.s) ? data.s.slice(0, 6000) : [];
  const strokes: InkStroke[] = [];
  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5 || row.length % 2 === 0 || row.length > 40003) continue;
    if (!row.every((value) => Number.isInteger(value))) continue;
    const tool: InkTool = row[0] === 1 ? "marker" : "pen";
    const palette = tool === "marker" ? MARKER_COLOURS : INK_COLOURS;
    const colour = row[1] >= 0 && row[1] < palette.length ? row[1] : 0;
    const size = row[2] >= 0 && row[2] <= 2 ? row[2] : 1;
    const points: number[] = [];
    let x = 0; let y = 0;
    for (let index = 3; index + 1 < row.length; index += 2) {
      x += row[index]; y += row[index + 1];
      points.push(clamp(x, 0, HAND_NOTE_WIDTH), clamp(y, 0, height));
    }
    strokes.push({ tool, colour, size, points });
  }
  return { height, paper, strokes };
}

/** Version 1 strokes as version 2: same 900-wide space, medium pen. */
export function handNoteFromLegacy(strokes: HandStroke[]): HandNote {
  const out: InkStroke[] = [];
  for (const stroke of strokes) {
    const numbers = stroke.d.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    if (numbers.length < 2) continue;
    const points: number[] = [];
    for (let index = 0; index + 1 < numbers.length; index += 2)
      points.push(clamp(Math.round(numbers[index]), 0, HAND_NOTE_WIDTH), clamp(Math.round(numbers[index + 1]), 0, HAND_NOTE_MIN_HEIGHT));
    const colour = INK_COLOURS.findIndex((ink) => ink.hex.toLowerCase() === stroke.color.toLowerCase());
    out.push({ tool: "pen", colour: colour < 0 ? 0 : colour, size: 1, points });
  }
  return { height: HAND_NOTE_MIN_HEIGHT, paper: "plain", strokes: out };
}

/** The reverse, for the retired capture panel only: drops widths and highlighters. */
export function legacyStrokes(note: HandNote): HandStroke[] {
  return note.strokes.filter((stroke) => stroke.tool === "pen").map((stroke) => ({
    color: INK_COLOURS[stroke.colour]?.hex ?? INK_COLOURS[0].hex,
    d: stroke.points.reduce((path, value, index) => path + (index === 0 ? "M" : index % 2 === 0 ? " L" : " ") + Math.round(value), ""),
  }));
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

/** Drop points that sit on a near-straight line (Ramer–Douglas–Peucker). */
export function simplifyPoints(points: number[], tolerance = 0.75): number[] {
  const count = points.length / 2;
  if (count <= 2) return points.slice();
  const keep = new Uint8Array(count);
  keep[0] = 1; keep[count - 1] = 1;
  const stack: Array<[number, number]> = [[0, count - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const ax = points[first * 2], ay = points[first * 2 + 1];
    const bx = points[last * 2], by = points[last * 2 + 1];
    let worst = -1; let worstDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const distance = segmentDistance(points[index * 2], points[index * 2 + 1], ax, ay, bx, by);
      if (distance > worstDistance) { worst = index; worstDistance = distance; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([first, worst], [worst, last]); }
  }
  const out: number[] = [];
  for (let index = 0; index < count; index += 1) if (keep[index]) out.push(points[index * 2], points[index * 2 + 1]);
  return out;
}

export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax; const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? clamp(((px - ax) * dx + (py - ay) * dy) / length, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeWidth(stroke: Pick<InkStroke, "tool" | "size">) {
  return (stroke.tool === "marker" ? MARKER_SIZES : PEN_SIZES)[stroke.size] ?? PEN_SIZES[1];
}

/** True when the eraser circle at (x, y) touches the stroke. */
export function strokeHit(stroke: InkStroke, x: number, y: number, radius: number) {
  const reach = radius + strokeWidth(stroke) / 2;
  const p = stroke.points;
  if (p.length === 2) return Math.hypot(p[0] - x, p[1] - y) <= reach;
  for (let index = 0; index + 3 < p.length; index += 2) {
    const ax = p[index], ay = p[index + 1], bx = p[index + 2], by = p[index + 3];
    if (Math.min(ax, bx) - reach > x || Math.max(ax, bx) + reach < x || Math.min(ay, by) - reach > y || Math.max(ay, by) + reach < y) continue;
    if (segmentDistance(x, y, ax, ay, bx, by) <= reach) return true;
  }
  return false;
}

const n = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1);
/** A smooth path through the points: quadratic curves between midpoints. */
export function smoothPath(points: number[]): string {
  const count = points.length / 2;
  if (count === 0) return "";
  if (count === 1) return `M${n(points[0])} ${n(points[1])}L${n(points[0])} ${n(points[1])}`;
  if (count === 2) return `M${n(points[0])} ${n(points[1])}L${n(points[2])} ${n(points[3])}`;
  let path = `M${n(points[0])} ${n(points[1])}`;
  for (let index = 1; index < count - 1; index += 1) {
    const x = points[index * 2], y = points[index * 2 + 1];
    const mx = (x + points[index * 2 + 2]) / 2, my = (y + points[index * 2 + 3]) / 2;
    path += `Q${n(x)} ${n(y)} ${n(mx)} ${n(my)}`;
  }
  return path + `L${n(points[count * 2 - 2])} ${n(points[count * 2 - 1])}`;
}

export function strokeColour(stroke: Pick<InkStroke, "tool" | "colour">) {
  return (stroke.tool === "marker" ? MARKER_COLOURS : INK_COLOURS)[stroke.colour] ?? INK_COLOURS[0];
}

/** Ruled lines or squares, as one path so the paper costs a single element. */
export function paperPath(paper: HandPaper, height: number, step = 56): string {
  if (paper === "plain") return "";
  let path = "";
  for (let y = step; y < height; y += step) path += `M0 ${y}H${HAND_NOTE_WIDTH}`;
  if (paper === "grid") for (let x = step; x < HAND_NOTE_WIDTH; x += step) path += `M${x} 0V${height}`;
  return path;
}

export function lowestPoint(note: HandNote) {
  let lowest = 0;
  for (const stroke of note.strokes)
    for (let index = 1; index < stroke.points.length; index += 2) lowest = Math.max(lowest, stroke.points[index]);
  return lowest;
}

const escapeAttribute = (value: string) => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Static SVG markup for places that build HTML strings (the rich editor).
 * React views use <HandNoteDrawing>, which draws the same paths.
 */
export function handNoteSvgMarkup(note: HandNote, label = "Handwritten note"): string {
  const paper = paperPath(note.paper, note.height);
  const paths = note.strokes.map((stroke) => {
    const colour = strokeColour(stroke);
    const opacity = stroke.tool === "marker" ? ` class="hn-marker" stroke-opacity="${MARKER_OPACITY}"` : "";
    return `<path d="${smoothPath(stroke.points)}" stroke="${colour.hex}" style="stroke:var(${colour.css},${colour.hex})" stroke-width="${strokeWidth(stroke)}"${opacity} fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  }).join("");
  return `<svg class="hn-svg" viewBox="0 0 ${HAND_NOTE_WIDTH} ${note.height}" role="img" aria-label="${escapeAttribute(label)}" style="display:block;width:100%;height:auto;aspect-ratio:${HAND_NOTE_WIDTH}/${note.height}">` +
    (paper ? `<path class="hn-paper-lines" d="${paper}" fill="none" stroke="rgba(64,98,140,.16)" stroke-width="1"/>` : "") +
    paths + "</svg>";
}
