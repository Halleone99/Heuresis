import fontkit from "@pdf-lib/fontkit";
import {
  PDFDocument, clip, endPath, popGraphicsState, pushGraphicsState, rectangle, rgb, degrees,
  setCharacterSpacing, setLineWidth, setStrokingColor, setTextRenderingMode, TextRenderingMode,
  type PDFFont, type PDFImage, type PDFPage, type RGB,
} from "pdf-lib";
import { CATALOGUE_FONT_FILES, type CatalogueFontFile } from "./fontManifest.generated";
import { parseUnicodeRanges, woffToSfnt } from "./woff";
import { PAGE_HEIGHT_PT, PAGE_WIDTH_PT } from "../model";

/**
 * Print-quality PDF from laid-out Catalogue pages.
 *
 * Each A4 page is painted from the page exactly as the browser laid it out:
 * every word is placed where it appears on screen and drawn as real, selectable
 * text in an embedded (subsetted) font; images are drawn at up to 300 dpi and
 * clipped to their frames; rules and backgrounds are drawn as vectors. Nothing
 * is rasterised into a screenshot, and no browser print dialog is involved, so
 * the same code produces the same file in a browser, in the Windows app and on
 * Android.
 */

type KitFont = {
  unitsPerEm: number; ascent: number; descent: number;
  hasGlyphForCodePoint: (codePoint: number) => boolean;
  "OS/2"?: { typoAscender?: number; typoDescender?: number; winAscent?: number; winDescent?: number };
  hhea?: { ascent?: number; descent?: number };
};
type LoadedFace = { file: CatalogueFontFile; kit: KitFont; pdf: PDFFont };
type FaceChoice = { face: LoadedFace; synthBold: boolean; synthItalic: boolean };

const GENERIC = new Set(["serif", "sans-serif", "monospace", "system-ui", "cursive", "fantasy", "ui-serif", "ui-sans-serif", "ui-monospace", "-apple-system"]);

function parseFamilies(value: string): string[] {
  return value.split(",").map((part) => part.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
}

/** CSS font matching (simplified): pick the weight closest in the CSS direction. */
function pickWeight(available: number[], desired: number) {
  const sorted = [...new Set(available)].sort((a, b) => a - b);
  if (sorted.includes(desired)) return desired;
  if (desired >= 400 && desired <= 500) {
    const up = sorted.filter((w) => w > desired && w <= 500);
    if (up.length) return up[0];
    const down = sorted.filter((w) => w < desired).reverse();
    if (down.length) return down[0];
    return sorted.find((w) => w > 500) ?? sorted[0];
  }
  if (desired > 500) return sorted.find((w) => w > desired) ?? [...sorted].reverse().find((w) => w < desired) ?? sorted[0];
  return [...sorted].reverse().find((w) => w < desired) ?? sorted.find((w) => w > desired) ?? sorted[0];
}

class FontRegistry {
  private byFamily = new Map<string, Array<{ file: CatalogueFontFile; ranges: Array<[number, number]> }>>();
  private loaded = new Map<string, Promise<LoadedFace | null>>();
  private choiceCache = new Map<string, FaceChoice | null>();
  failures: string[] = [];
  constructor(private doc: PDFDocument) {
    for (const file of CATALOGUE_FONT_FILES) {
      const key = file.family.toLocaleLowerCase();
      const list = this.byFamily.get(key) ?? [];
      list.push({ file, ranges: parseUnicodeRanges(file.ranges) });
      this.byFamily.set(key, list);
    }
  }
  has(family: string) { return this.byFamily.has(family.toLocaleLowerCase()); }

  private load(file: CatalogueFontFile): Promise<LoadedFace | null> {
    const existing = this.loaded.get(file.url);
    if (existing) return existing;
    const job = (async () => {
      try {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const sfnt = await woffToSfnt(await response.arrayBuffer());
        const kit = fontkit.create(sfnt) as unknown as KitFont;
        const pdf = await this.doc.embedFont(sfnt, { subset: true });
        return { file, kit, pdf };
      } catch (error) {
        this.failures.push(`${file.family} ${file.weight}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    })();
    this.loaded.set(file.url, job);
    return job;
  }

  /** The face the browser would use for this character, or null when no embedded font has it. */
  async choose(families: string[], weight: number, italic: boolean, codePoint: number): Promise<FaceChoice | null> {
    const cacheKey = `${families.join("|")}|${weight}|${italic}|${codePoint}`;
    if (this.choiceCache.has(cacheKey)) return this.choiceCache.get(cacheKey)!;
    let result: FaceChoice | null = null;
    for (const family of families) {
      if (GENERIC.has(family.toLocaleLowerCase())) continue;
      const faces = this.byFamily.get(family.toLocaleLowerCase());
      if (!faces) continue;
      const wanted = italic ? "italic" : "normal";
      const styled = faces.filter((face) => face.file.style === wanted);
      const pool = styled.length ? styled : faces.filter((face) => face.file.style === "normal");
      if (!pool.length) continue;
      const chosenWeight = pickWeight(pool.map((face) => face.file.weight), weight);
      const variant = pool.filter((face) => face.file.weight === chosenWeight);
      const subset = variant.find((face) => face.ranges.some(([a, b]) => codePoint >= a && codePoint <= b));
      if (!subset) continue;
      const loaded = await this.load(subset.file);
      if (!loaded || !loaded.kit.hasGlyphForCodePoint(codePoint)) continue;
      result = { face: loaded, synthBold: weight >= 600 && chosenWeight < 600, synthItalic: italic && subset.file.style !== "italic" };
      break;
    }
    this.choiceCache.set(cacheKey, result);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Colours and geometry
// ---------------------------------------------------------------------------
type Colour = { color: RGB; alpha: number } | null;
const colourCache = new Map<string, Colour>();
function parseColour(value: string): Colour {
  if (colourCache.has(value)) return colourCache.get(value)!;
  let result: Colour = null;
  const match = value.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/i);
  if (match) {
    const alphaRaw = match[4];
    const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
    if (alpha > 0.002) result = { color: rgb(Number(match[1]) / 255, Number(match[2]) / 255, Number(match[3]) / 255), alpha: Math.min(1, alpha) };
  } else if (/^color\(srgb/i.test(value)) {
    const parts = value.match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)/i);
    if (parts) {
      const alphaRaw = parts[4];
      const alpha = alphaRaw === undefined ? 1 : alphaRaw.endsWith("%") ? Number(alphaRaw.slice(0, -1)) / 100 : Number(alphaRaw);
      if (alpha > 0.002) result = { color: rgb(Number(parts[1]), Number(parts[2]), Number(parts[3])), alpha };
    }
  }
  colourCache.set(value, result);
  return result;
}

type Ctx = {
  doc: PDFDocument; page: PDFPage; fonts: FontRegistry; origin: DOMRect; scale: number;
  images: Map<string, Promise<PDFImage | null>>; missing: Set<string>; warnings: Set<string>;
};
const X = (ctx: Ctx, px: number) => (px - ctx.origin.left) * ctx.scale;
const Y = (ctx: Ctx, py: number) => PAGE_HEIGHT_PT - (py - ctx.origin.top) * ctx.scale;

function fillRect(ctx: Ctx, left: number, top: number, width: number, height: number, colour: NonNullable<Colour>) {
  if (width <= 0 || height <= 0) return;
  ctx.page.drawRectangle({
    x: X(ctx, left), y: Y(ctx, top + height), width: width * ctx.scale, height: height * ctx.scale,
    color: colour.color, opacity: colour.alpha, borderWidth: 0,
  });
}

function paintBorders(ctx: Ctx, rect: DOMRect, style: CSSStyleDeclaration) {
  const sides = [
    ["Top", rect.left, rect.top, rect.width, "h"], ["Bottom", rect.left, rect.bottom, rect.width, "h"],
    ["Left", rect.left, rect.top, rect.height, "v"], ["Right", rect.right, rect.top, rect.height, "v"],
  ] as const;
  for (const [side, x, y, length, direction] of sides) {
    const width = parseFloat(style.getPropertyValue(`border-${side.toLowerCase()}-width`)) || 0;
    const kind = style.getPropertyValue(`border-${side.toLowerCase()}-style`);
    if (width <= 0 || kind === "none" || kind === "hidden") continue;
    const colour = parseColour(style.getPropertyValue(`border-${side.toLowerCase()}-color`));
    if (!colour) continue;
    const thickness = width * ctx.scale;
    const dash = kind === "dashed" ? [thickness * 3, thickness * 2] : kind === "dotted" ? [thickness, thickness * 1.5] : undefined;
    if (direction === "h") {
      const centre = side === "Top" ? y + width / 2 : y - width / 2;
      ctx.page.drawLine({ start: { x: X(ctx, x), y: Y(ctx, centre) }, end: { x: X(ctx, x + length), y: Y(ctx, centre) }, thickness, color: colour.color, opacity: colour.alpha, dashArray: dash });
    } else {
      const centre = side === "Left" ? x + width / 2 : x - width / 2;
      ctx.page.drawLine({ start: { x: X(ctx, centre), y: Y(ctx, y) }, end: { x: X(ctx, centre), y: Y(ctx, y + length) }, thickness, color: colour.color, opacity: colour.alpha, dashArray: dash });
    }
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------
const CJK = /[⺀-鿿豈-﫿＀-￯　-〿]/;
type Unit = { start: number; end: number };
function tokenize(text: string): Unit[] {
  const units: Unit[] = [];
  let index = 0;
  while (index < text.length) {
    const code = text.codePointAt(index)!;
    const char = String.fromCodePoint(code);
    if (/\s/.test(char)) { index += char.length; continue; }
    if (CJK.test(char)) { units.push({ start: index, end: index + char.length }); index += char.length; continue; }
    const start = index;
    while (index < text.length) {
      const next = String.fromCodePoint(text.codePointAt(index)!);
      if (/\s/.test(next) || CJK.test(next)) break;
      index += next.length;
    }
    units.push({ start, end: index });
  }
  return units;
}

function transformText(value: string, transform: string) {
  if (transform === "uppercase") return value.toLocaleUpperCase();
  if (transform === "lowercase") return value.toLocaleLowerCase();
  return value;
}

type TextStyle = {
  families: string[]; weight: number; italic: boolean; sizePx: number; colour: NonNullable<Colour>;
  letterSpacingPx: number; transform: string; decoration: { line: boolean; under: boolean; colour: NonNullable<Colour> | null };
};

function textStyle(style: CSSStyleDeclaration, decoration: TextStyle["decoration"]): TextStyle | null {
  const colour = parseColour(style.color);
  if (!colour) return null;
  const weight = Number(style.fontWeight) || (style.fontWeight === "bold" ? 700 : 400);
  return {
    families: parseFamilies(style.fontFamily), weight, italic: style.fontStyle === "italic" || style.fontStyle.startsWith("oblique"),
    sizePx: parseFloat(style.fontSize) || 16, colour, letterSpacingPx: parseFloat(style.letterSpacing) || 0,
    transform: style.textTransform, decoration,
  };
}

function baselineOffset(face: LoadedFace, sizePx: number, rectHeight: number) {
  // The browser's text box spans the font's ascent + descent. Use whichever of
  // the font's metric sets reproduces the measured box (hhea, typo or win).
  const kit = face.kit;
  const upm = kit.unitsPerEm || 1000;
  const os2 = kit["OS/2"] ?? {};
  const sets = [
    [kit.ascent, -kit.descent],
    [os2.typoAscender ?? kit.ascent, -(os2.typoDescender ?? kit.descent)],
    [os2.winAscent ?? kit.ascent, os2.winDescent ?? -kit.descent],
  ].map(([a, d]) => ({ ascent: (a / upm) * sizePx, total: ((a + d) / upm) * sizePx }));
  const best = sets.reduce((winner, set) => Math.abs(set.total - rectHeight) < Math.abs(winner.total - rectHeight) ? set : winner, sets[0]);
  // Centre the font's own box inside the measured box if they differ slightly.
  return best.ascent + (rectHeight - best.total) / 2;
}

async function drawRun(ctx: Ctx, text: string, rect: DOMRect, choice: FaceChoice, style: TextStyle, primary: FaceChoice | null, trailingSpace = false) {
  const sizePt = style.sizePx * ctx.scale;
  const metricsFace = primary ?? choice;
  const baseline = rect.top + baselineOffset(metricsFace.face, style.sizePx, rect.height);
  const x = X(ctx, rect.left);
  const y = Y(ctx, baseline);
  // Spread any difference between the browser's shaped width (kerning, ligatures)
  // and the PDF font's plain advances across the characters, so every word ends
  // exactly where it ends on screen and word spaces keep their width.
  const glyphs = Array.from(text).length;
  const natural = choice.face.pdf.widthOfTextAtSize(text, sizePt);
  const target = rect.width * ctx.scale;
  const spacing = glyphs ? (target - natural) / glyphs : 0;
  // A real space after the word keeps the words apart when text is copied or searched.
  const withSpace = trailingSpace && choice.face.kit.hasGlyphForCodePoint(32) ? `${text} ` : text;
  const ops = [];
  if (Math.abs(spacing) > 0.001) ops.push(setCharacterSpacing(spacing));
  if (choice.synthBold) ops.push(setTextRenderingMode(TextRenderingMode.FillAndOutline), setLineWidth(sizePt * 0.032), setStrokingColor(style.colour.color));
  if (ops.length) ctx.page.pushOperators(pushGraphicsState(), ...ops);
  try {
    ctx.page.drawText(withSpace, {
      x, y, size: sizePt, font: choice.face.pdf, color: style.colour.color, opacity: style.colour.alpha,
      xSkew: choice.synthItalic ? degrees(12) : undefined,
    });
  } finally {
    if (ops.length) ctx.page.pushOperators(popGraphicsState());
  }
  if (style.decoration.line || style.decoration.under) {
    const thickness = Math.max(0.35, sizePt * 0.055);
    const colour = style.decoration.colour ?? style.colour;
    const lineY = style.decoration.line ? y + sizePt * 0.28 : y - sizePt * 0.11;
    ctx.page.drawLine({ start: { x, y: lineY }, end: { x: X(ctx, rect.right), y: lineY }, thickness, color: colour.color, opacity: colour.alpha });
  }
}

async function primaryFace(ctx: Ctx, style: TextStyle) {
  return ctx.fonts.choose(style.families, style.weight, style.italic, 0x20).then((choice) => choice ?? ctx.fonts.choose(style.families, style.weight, style.italic, 0x61));
}

async function paintText(ctx: Ctx, node: Text, style: TextStyle, firstLetter: TextStyle | null) {
  const text = node.data;
  if (!text.trim()) return;
  const range = document.createRange();
  const primary = await primaryFace(ctx, style);
  const units = tokenize(text);
  for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
    const unit = units[unitIndex];
    range.setStart(node, unit.start);
    range.setEnd(node, unit.end);
    const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0.05 && rect.height > 0.05);
    if (!rects.length) continue;
    const raw = text.slice(unit.start, unit.end);
    const chars = Array.from(raw);
    const choices = await Promise.all(chars.map((char) => ctx.fonts.choose(style.families, style.weight, style.italic, char.codePointAt(0)!)));
    const uniform = choices.every((choice) => choice && choice.face === choices[0]?.face && choice.synthBold === choices[0]?.synthBold);
    const dropCap = firstLetter && unitIndex === 0;
    const followedBySpace = /\s/.test(text[unit.end] ?? "") && unitIndex + 1 < units.length;
    if (rects.length === 1 && uniform && !dropCap && choices[0]) {
      const drawn = transformText(raw, style.transform);
      const width = choices[0].face.pdf.widthOfTextAtSize(drawn, style.sizePx);
      // Within a few per cent the word is drawn whole (spacing absorbs the difference).
      if (Math.abs(width + style.letterSpacingPx * Array.from(drawn).length - rects[0].width) <= Math.max(2, rects[0].width * 0.08)) {
        await drawRun(ctx, drawn, rects[0], choices[0], style, primary, followedBySpace);
        continue;
      }
    }
    // Character by character: mixed fonts, a word broken across lines, a drop
    // capital, or shaping that differs from the browser's.
    let offset = unit.start;
    for (let index = 0; index < chars.length; index += 1) {
      const char = chars[index];
      range.setStart(node, offset);
      range.setEnd(node, offset + char.length);
      offset += char.length;
      const rect = Array.from(range.getClientRects()).find((item) => item.width > 0.05 && item.height > 0.05);
      if (!rect) continue;
      const charStyle = dropCap && index === 0 && firstLetter ? firstLetter : style;
      const choice = charStyle === style ? choices[index]
        : await ctx.fonts.choose(charStyle.families, charStyle.weight, charStyle.italic, char.codePointAt(0)!);
      if (!choice) { ctx.missing.add(char); continue; }
      const charPrimary = charStyle === style ? primary : choice;
      await drawRun(ctx, transformText(char, charStyle.transform), rect, choice, { ...charStyle, letterSpacingPx: 0 }, charPrimary);
    }
  }
  range.detach?.();
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
async function embedImage(ctx: Ctx, img: HTMLImageElement, drawnWidthPt: number, drawnHeightPt: number): Promise<PDFImage | null> {
  const src = img.currentSrc || img.src;
  if (!src) return null;
  // 300 dpi at the printed size, never more than the original.
  const wantWidth = Math.ceil((drawnWidthPt / 72) * 300);
  const wantHeight = Math.ceil((drawnHeightPt / 72) * 300);
  const scale = Math.min(1, wantWidth / Math.max(1, img.naturalWidth), wantHeight / Math.max(1, img.naturalHeight));
  const width = Math.max(1, Math.round(img.naturalWidth * scale));
  const height = Math.max(1, Math.round(img.naturalHeight * scale));
  const key = `${src}|${width}x${height}`;
  const existing = ctx.images.get(key);
  if (existing) return existing;
  const job = (async () => {
    try {
      const blob = await (await fetch(src)).blob();
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("no canvas");
      context.imageSmoothingQuality = "high";
      context.drawImage(bitmap, 0, 0, width, height);
      bitmap.close?.();
      const transparent = blob.type === "image/png" || blob.type === "image/gif" || blob.type === "image/webp";
      const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, transparent ? "image/png" : "image/jpeg", 0.92));
      if (!out) throw new Error("no image data");
      const bytes = new Uint8Array(await out.arrayBuffer());
      return transparent ? await ctx.doc.embedPng(bytes) : await ctx.doc.embedJpg(bytes);
    } catch {
      ctx.warnings.add("An image could not be included.");
      return null;
    }
  })();
  ctx.images.set(key, job);
  return job;
}

// ---------------------------------------------------------------------------
// Tree walk
// ---------------------------------------------------------------------------
async function paintListMarker(ctx: Ctx, li: HTMLElement, style: CSSStyleDeclaration) {
  const list = li.parentElement;
  if (!list || style.display !== "list-item") return;
  const type = style.listStyleType;
  if (type === "none") return;
  let marker = "•";
  if (list.tagName === "OL") {
    const start = Number(list.getAttribute("start")) || 1;
    const position = Array.from(list.children).filter((child) => child.tagName === "LI").indexOf(li);
    marker = `${start + position}.`;
  }
  // First line of the item: the first rendered text inside it.
  const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
  let first: DOMRect | null = null;
  const range = document.createRange();
  while (!first && walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (!node.data.trim()) continue;
    range.selectNodeContents(node);
    first = Array.from(range.getClientRects()).find((rect) => rect.width > 0) ?? null;
  }
  if (!first) return;
  const markerStyle = getComputedStyle(li, "::marker");
  const text = textStyle(style, { line: false, under: false, colour: null });
  if (!text) return;
  const colour = parseColour(markerStyle.color) ?? text.colour;
  const choice = await ctx.fonts.choose(text.families, text.weight, false, marker.codePointAt(0)!);
  if (!choice) return;
  const sizePt = text.sizePx * ctx.scale;
  const width = choice.face.pdf.widthOfTextAtSize(marker, sizePt);
  const contentLeft = li.getBoundingClientRect().left;
  const gap = text.sizePx * 0.45;
  const baseline = first.top + baselineOffset(choice.face, text.sizePx, first.height);
  ctx.page.drawText(marker, { x: X(ctx, contentLeft - gap) - width, y: Y(ctx, baseline), size: sizePt, font: choice.face.pdf, color: colour.color, opacity: colour.alpha });
}

async function paintElement(ctx: Ctx, element: Element, decoration: TextStyle["decoration"]) {
  if (!(element instanceof HTMLElement)) return;
  if (element.classList.contains("ap-no-print")) return;
  const style = getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return;
  const inline = style.display === "inline";
  const background = parseColour(style.backgroundColor);
  if (element.classList.contains("ap-orn-diamond")) {
    // A small square turned 45°, drawn from its laid-out bounding box.
    const rect = element.getBoundingClientRect();
    if (background) {
      const cx = X(ctx, rect.left + rect.width / 2); const cy = Y(ctx, rect.top + rect.height / 2);
      const half = (rect.width / 2) * ctx.scale;
      ctx.page.drawSvgPath(`M 0 ${-half} L ${half} 0 L 0 ${half} L ${-half} 0 Z`, { x: cx, y: cy, color: background.color, opacity: background.alpha, borderWidth: 0 });
    }
    return;
  }
  if (background) {
    const rects = inline ? Array.from(element.getClientRects()) : [element.getBoundingClientRect()];
    for (const rect of rects) fillRect(ctx, rect.left, rect.top, rect.width, rect.height, background);
  }
  if (!inline) paintBorders(ctx, element.getBoundingClientRect(), style);
  if (element.tagName === "LI") await paintListMarker(ctx, element, style);
  if (element instanceof HTMLImageElement) {
    const rect = element.getBoundingClientRect();
    if (element.complete && element.naturalWidth > 0 && rect.width > 0 && rect.height > 0) {
      const image = await embedImage(ctx, element, rect.width * ctx.scale, rect.height * ctx.scale);
      if (image) ctx.page.drawImage(image, { x: X(ctx, rect.left), y: Y(ctx, rect.bottom), width: rect.width * ctx.scale, height: rect.height * ctx.scale });
    } else ctx.warnings.add("An image had not finished loading and was left out.");
    return;
  }
  // Decorations propagate to descendants (they are not inherited properties).
  const lines = style.textDecorationLine;
  const nextDecoration = {
    line: decoration.line || lines.includes("line-through"),
    under: decoration.under || lines.includes("underline"),
    colour: lines !== "none" ? parseColour(style.textDecorationColor) ?? decoration.colour : decoration.colour,
  };
  const clipping = style.overflowX !== "visible" || style.overflowY !== "visible";
  if (clipping) {
    const rect = element.getBoundingClientRect();
    ctx.page.pushOperators(pushGraphicsState(), rectangle(X(ctx, rect.left), Y(ctx, rect.bottom), rect.width * ctx.scale, rect.height * ctx.scale), clip(), endPath());
  }
  try {
    const text = textStyle(style, nextDecoration);
    let firstLetter: TextStyle | null = null;
    if (element.tagName === "P" && element.parentElement?.closest(".has-dropcap") && element === element.parentElement.firstElementChild) {
      const letter = getComputedStyle(element, "::first-letter");
      firstLetter = textStyle(letter, nextDecoration);
    }
    let firstText = true;
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (text) await paintText(ctx, child as Text, text, firstText ? firstLetter : null);
        if ((child as Text).data.trim()) firstText = false;
      } else if (child.nodeType === Node.ELEMENT_NODE) {
        await paintElement(ctx, child as Element, nextDecoration);
        if ((child.textContent ?? "").trim()) firstText = false;
      }
    }
  } finally {
    if (clipping) ctx.page.pushOperators(popGraphicsState());
  }
}

export type PdfMetadata = { title: string; author?: string; subject?: string; keywords?: string[]; language?: string };
export type PdfResult = { bytes: Uint8Array; pageCount: number; warnings: string[] };

/** Paint already laid-out `.ap-page` elements (at 100 % scale) into a PDF. */
export async function pagesToPdf(pages: HTMLElement[], meta: PdfMetadata, onProgress?: (done: number, total: number) => void): Promise<PdfResult> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(meta.title || "Untitled article", { showInWindowTitleBar: true });
  if (meta.author) doc.setAuthor(meta.author);
  if (meta.subject) doc.setSubject(meta.subject);
  if (meta.keywords?.length) doc.setKeywords(meta.keywords);
  if (meta.language) doc.setLanguage(meta.language);
  doc.setCreator("Heuresis Catalogue");
  doc.setProducer("Heuresis (pdf-lib)");
  const now = new Date();
  doc.setCreationDate(now); doc.setModificationDate(now);
  const fonts = new FontRegistry(doc);
  const images = new Map<string, Promise<PDFImage | null>>();
  const missing = new Set<string>();
  const warnings = new Set<string>();
  for (let index = 0; index < pages.length; index += 1) {
    const element = pages[index];
    const origin = element.getBoundingClientRect();
    const page = doc.addPage([PAGE_WIDTH_PT, PAGE_HEIGHT_PT]);
    const ctx: Ctx = { doc, page, fonts, origin, scale: PAGE_WIDTH_PT / origin.width, images, missing, warnings };
    const paper = parseColour(getComputedStyle(element).backgroundColor);
    if (paper) page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH_PT, height: PAGE_HEIGHT_PT, color: paper.color, opacity: paper.alpha, borderWidth: 0 });
    page.pushOperators(pushGraphicsState(), rectangle(0, 0, PAGE_WIDTH_PT, PAGE_HEIGHT_PT), clip(), endPath());
    for (const child of Array.from(element.children)) await paintElement(ctx, child, { line: false, under: false, colour: null });
    page.pushOperators(popGraphicsState());
    onProgress?.(index + 1, pages.length);
    // Let the interface breathe between pages.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }
  if (missing.size) warnings.add(`${missing.size} character${missing.size === 1 ? "" : "s"} (${Array.from(missing).slice(0, 8).join(" ")}) ${missing.size === 1 ? "has" : "have"} no embeddable font and ${missing.size === 1 ? "was" : "were"} left out.`);
  if (fonts.failures.length) warnings.add("A font could not be embedded; some text may be missing.");
  const bytes = await doc.save({ useObjectStreams: true });
  return { bytes, pageCount: pages.length, warnings: Array.from(warnings) };
}

/** Several article PDFs in order, as one document (a volume). */
export async function mergePdfs(parts: Uint8Array[], meta: PdfMetadata): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(meta.title, { showInWindowTitleBar: true });
  if (meta.author) out.setAuthor(meta.author);
  if (meta.subject) out.setSubject(meta.subject);
  out.setCreator("Heuresis Catalogue");
  out.setProducer("Heuresis (pdf-lib)");
  for (const part of parts) {
    const source = await PDFDocument.load(part);
    const copied = await out.copyPages(source, source.getPageIndices());
    copied.forEach((page) => out.addPage(page));
  }
  return out.save({ useObjectStreams: true });
}
