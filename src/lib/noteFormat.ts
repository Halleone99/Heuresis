/**
 * Heuresis note format: a small, readable Markdown subset stored as plain text.
 *
 *   # Section                ## Subsection
 *   - bullet  /  1. numbered  (two spaces per nesting level)
 *   > quotation
 *   > [!example]  > [!rule]  > [!correction]  > [!tip]  callout blocks
 *   ---                      divider
 *   **bold**  *italic*  ==highlight==  ~~struck out~~  [[Link to another note]]
 *   {color:blue}text{/color}  {bg:amber}text{/bg}  (safe named colours)
 *
 * Every line maps to one block, so the text round-trips through the editor
 * without reflowing what the user wrote. Unknown syntax is kept verbatim.
 */

import { decodeHandNote, HAND_NOTE_PREFIX, HAND_NOTE_SIZE } from "./handNote";

export type CalloutVariant = "example" | "rule" | "correction" | "tip";
export type ListItem = { text: string; depth: number; ordered: boolean; start?: number };
export type TableStyle = "plain" | "striped" | "study";
export type Block =
  | { type: "p"; text: string }
  | { type: "h2" | "h3" | "h4"; text: string }
  | { type: "ul" | "ol"; items: ListItem[] }
  | { type: "quote"; lines: string[] }
  | { type: "callout"; variant: CalloutVariant; lines: string[] }
  | { type: "hr" }
  | { type: "handnote"; encoded: string }
  | { type: "table"; style: TableStyle; headers: string[]; rows: string[][] };

export const NOTE_COLOURS = ["red", "blue", "green", "amber", "purple"] as const;
export type NoteColour = typeof NOTE_COLOURS[number];

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "mark" | "strike"; text: string }
  | { type: "link"; target: string; label: string }
  | { type: "colour" | "tint"; colour: NoteColour; text: string };

export const CALLOUTS: Record<CalloutVariant, string> = {
  example: "Example", rule: "Rule", correction: "Correction", tip: "Tip",
};
const CALLOUT_RE = /^>\s?\[!(example|rule|correction|tip)\]\s*$/i;
const LIST_RE = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_STYLE_RE = /^\{table:(plain|striped|study)\}\s*$/;
function tableCells(line: string): string[] {
  const clean = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return clean.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}
function tableDivider(line: string, width: number) {
  const cells = tableCells(line);
  return cells.length === width && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}
function tableLine(cells: string[]) {
  return "| " + cells.map((cell) => cell.replace(/\|/g, "\\|").replace(/\n/g, " ")).join(" | ") + " |";
}

function indentDepth(indent: string) {
  const width = indent.replace(/\t/g, "  ").length;
  return Math.min(4, Math.floor(width / 2));
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith(HAND_NOTE_PREFIX) && /^[A-Za-z0-9+/=]+$/.test(line.slice(HAND_NOTE_PREFIX.length))) {
      blocks.push({ type: "handnote", encoded: line.slice(HAND_NOTE_PREFIX.length) });
      continue;
    }
    // A standard Markdown grid is a single editable block. The optional style
    // marker belongs to the table, not to a separate visible paragraph.
    const styleMatch = line.match(TABLE_STYLE_RE);
    const headerIndex = styleMatch ? index + 1 : index;
    const header = lines[headerIndex];
    const divider = lines[headerIndex + 1];
    if (header && divider && header.includes("|")) {
      const headers = tableCells(header);
      if (headers.length >= 2 && tableDivider(divider, headers.length)) {
        const rows: string[][] = [];
        index = headerIndex + 1;
        while (index + 1 < lines.length && lines[index + 1].includes("|")) {
          const cells = tableCells(lines[index + 1]);
          if (cells.length !== headers.length) break;
          rows.push(cells);
          index += 1;
        }
        blocks.push({ type: "table", style: (styleMatch?.[1] ?? "plain") as TableStyle, headers, rows });
        continue;
      }
    }
    const callout = line.match(CALLOUT_RE);
    if (callout) {
      const body: string[] = [];
      while (index + 1 < lines.length && /^>/.test(lines[index + 1]) && !CALLOUT_RE.test(lines[index + 1])) {
        index += 1;
        body.push(lines[index].replace(/^>\s?/, ""));
      }
      blocks.push({ type: "callout", variant: callout[1].toLowerCase() as CalloutVariant, lines: body.length ? body : [""] });
      continue;
    }
    if (/^>/.test(line)) {
      const body = [line.replace(/^>\s?/, "")];
      while (index + 1 < lines.length && /^>/.test(lines[index + 1]) && !CALLOUT_RE.test(lines[index + 1])) {
        index += 1;
        body.push(lines[index].replace(/^>\s?/, ""));
      }
      blocks.push({ type: "quote", lines: body });
      continue;
    }
    const heading = line.match(HEADING_RE);
    if (heading) {
      // Three heading levels are editable; keep unsupported deeper levels literal.
      if (heading[1].length > 3) blocks.push({ type: "p", text: line });
      else blocks.push({ type: heading[1].length === 1 ? "h2" : heading[1].length === 2 ? "h3" : "h4", text: heading[2] });
      continue;
    }
    if (HR_RE.test(line)) { blocks.push({ type: "hr" }); continue; }
    const list = line.match(LIST_RE);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const type = ordered ? "ol" : "ul";
      const items: ListItem[] = [{ text: list[3], depth: 0, ordered,
        start: ordered ? Number.parseInt(list[2], 10) : undefined }];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].match(LIST_RE);
        if (!next) break;
        const nextOrdered = /\d/.test(next[2]);
        // Nested items may use either marker; only top-level items decide the list type.
        if (indentDepth(next[1]) === 0 && nextOrdered !== ordered) break;
        index += 1;
        const previous = items[items.length - 1].depth;
        items.push({ text: next[3], depth: Math.min(indentDepth(next[1]), previous + 1),
          ordered: nextOrdered, start: nextOrdered ? Number.parseInt(next[2], 10) : undefined });
      }
      blocks.push({ type, items });
      continue;
    }
    blocks.push({ type: "p", text: line });
  }
  // A trailing newline should not render as an extra empty paragraph.
  while (blocks.length > 1) {
    const last = blocks[blocks.length - 1];
    if (last.type === "p" && !last.text.trim()) blocks.pop();
    else break;
  }
  if (blocks.length === 1 && blocks[0].type === "p" && !blocks[0].text) return [];
  return blocks;
}

const INLINE_RE = /\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|==(.+?)==|\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]|\*(?![\s*])([^*]*?[^\s*])\*|~~(.+?)~~|\{color:(red|blue|green|amber|purple)\}(.+?)\{\/color\}|\{bg:(red|blue|green|amber|purple)\}(.+?)\{\/bg\}/g;

/** Backslash escapes prevent literal formatting markers from changing notes. */
const unescapeInline = (value: string) => value.replace(/\\(\\|\*|=|~|\[|\]|\{|\})/g, "$1");
const escapedMarker = (text: string, index: number) => {
  let backslashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) backslashes++;
  return backslashes % 2 === 1;
};
const inlineText = (value: string): Inline => ({ type: "text", text: unescapeInline(value) });

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (start < last || escapedMarker(text, start)) continue;
    const inner = match[1] ?? match[2] ?? match[3] ?? match[6] ?? match[7];
    // Only single-star maths inside Latin text is literal; bold and Hanzi are not.
    const emphasis = match[6] !== undefined;
    // Preserve maths and grammar examples such as "x == y == z" and "a*b*c".
    if (inner !== undefined && (!inner.trim() || /^\s|\s$/.test(inner))) continue;
    if (emphasis && (
      /[\p{Script=Latin}\p{N}]/u.test(text[start - 1] ?? "") &&
      /[\p{Script=Latin}\p{N}]/u.test(text[end] ?? "")
    )) continue;
    if (start > last) result.push(inlineText(text.slice(last, start)));
    // Triple markers must be recognised before double markers; preserve
    // both styles using nested syntax already understood by the renderer.
    if (match[1] !== undefined) result.push({ type: "strong", text: `*${match[1]}*` });
    else if (match[2] !== undefined) result.push({ type: "strong", text: match[2] });
    else if (match[3] !== undefined) result.push({ type: "mark", text: match[3] });
    else if (match[4] !== undefined) result.push({ type: "link", target: match[4].trim(), label: (match[5] ?? match[4]).trim() });
    else if (match[6] !== undefined) result.push({ type: "em", text: match[6] });
    else if (match[7] !== undefined) result.push({ type: "strike", text: match[7] });
    else if (match[8] !== undefined) result.push({ type: "colour", colour: match[8] as NoteColour, text: match[9] });
    else if (match[10] !== undefined) result.push({ type: "tint", colour: match[10] as NoteColour, text: match[11] });
    last = start + match[0].length;
  }
  if (last < text.length) result.push(inlineText(text.slice(last)));
  return result;
}

export function wikiLinks(markdown: string) {
  const targets = new Set<string>();
  // Use the same escape-aware parser as the editor: a literal \\[[example]]
  // must not become a backlink just because it contains two brackets.
  for (const line of markdown.split("\n")) {
    for (const part of parseInline(line)) {
      if (part.type === "link") targets.add(part.target.trim().toLocaleLowerCase());
    }
  }
  return targets;
}


/** Pinyin needs a font with complete precomposed Mandarin tone vowels.
 * Split out Latin runs rather than switching the entire Chinese/English note
 * to a sans-serif font. Normalize canonical decomposed tone marks for display.
 * The original Markdown is otherwise unchanged.
 */
const LATIN_RUN = /[A-Za-z\u00c0-\u024f\u1e00-\u1eff]+(?:[ \t]+[A-Za-z\u00c0-\u024f\u1e00-\u1eff]+)*/gu;
const PINYIN_TONE = /[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜü]/iu;

export function pinyinSegments(text: string): Array<{ text: string; pinyin: boolean }> {
  const normalized = text.normalize("NFC");
  const segments: Array<{ text: string; pinyin: boolean }> = [];
  let last = 0;
  for (const match of normalized.matchAll(LATIN_RUN)) {
    const start = match.index ?? 0;
    const value = match[0];
    if (!PINYIN_TONE.test(value)) continue;
    if (start > last) segments.push({ text: normalized.slice(last, start), pinyin: false });
    segments.push({ text: value, pinyin: true });
    last = start + value.length;
  }
  if (last < normalized.length) segments.push({ text: normalized.slice(last), pinyin: false });
  return segments.length ? segments : [{ text: normalized, pinyin: false }];
}

export function inlinePlain(text: string): string {
  return parseInline(text).map((part) => part.type === "link" ? part.label : part.type === "text" ? part.text : inlinePlain(part.text)).join("");
}

// ---------------------------------------------------------------------------
// Editor HTML (contentEditable) <-> Markdown
// ---------------------------------------------------------------------------
function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
/** Span styling is visual only: editorToMarkdown() serializes its text,
 * not the span, so pinyin never gains extra markup in the saved document. */
function pinyinHtml(text: string) {
  return pinyinSegments(text).map(({ text: value, pinyin }) =>
    pinyin ? `<span class="nb-pinyin" lang="zh-Latn">${escapeHtml(value)}</span>` : escapeHtml(value)
  ).join("");
}
/** Wiki links stay as literal [[text]] while editing so they cannot drift out of sync. */
function inlineHtml(text: string): string {
  return parseInline(text).map((part) => {
    if (part.type === "strong") return `<strong>${inlineHtml(part.text)}</strong>`;
    if (part.type === "em") return `<em>${inlineHtml(part.text)}</em>`;
    if (part.type === "mark") return `<mark>${inlineHtml(part.text)}</mark>`;
    if (part.type === "strike") return `<s>${inlineHtml(part.text)}</s>`;
    if (part.type === "colour") return `<span data-ink="${part.colour}">${inlineHtml(part.text)}</span>`;
    if (part.type === "tint") return `<mark data-tone="${part.colour}">${inlineHtml(part.text)}</mark>`;
    if (part.type === "link") return `<span data-wikilink="true">${escapeHtml(part.label === part.target ? `[[${part.target}]]` : `[[${part.target}|${part.label}]]`)}</span>`;
    return pinyinHtml(part.text);
  }).join("");
}
function paragraphHtml(text: string) {
  const inner = inlineHtml(text);
  return `<p>${inner || "<br>"}</p>`;
}
function tableHtml(block: Extract<Block, { type: "table" }>) {
  const head = "<thead><tr>" + block.headers.map((cell) => "<th scope=\"col\">" + (inlineHtml(cell) || "<br>") + "</th>").join("") + "</tr></thead>";
  const body = "<tbody>" + block.rows.map((row) =>
    "<tr>" + row.map((cell) => "<td>" + (inlineHtml(cell) || "<br>") + "</td>").join("") + "</tr>"
  ).join("") + "</tbody>";
  return '<table class="nb-table" data-table-style="' + block.style + '">' + head + body + "</table>";
}
function listHtml(items: ListItem[]) {
  let html = "";
  const stack: Array<"ul" | "ol"> = [];
  const openList = (tag: "ul" | "ol", start?: number) =>
    tag === "ol" && start && start !== 1 ? `<ol start="${start}">` : `<${tag}>`;
  for (const item of items) {
    const tag = item.ordered ? "ol" : "ul";
    const content = `<li>${inlineHtml(item.text) || "<br>"}`;
    if (!stack.length) { html += `${openList(tag, item.start)}${content}`; stack.push(tag); continue; }
    const current = stack.length - 1;
    if (item.depth > current) { html += `${openList(tag, item.start)}${content}`; stack.push(tag); continue; }
    while (stack.length - 1 > item.depth) html += `</li></${stack.pop()}>`;
    html += `</li>${content}`;
  }
  while (stack.length) html += `</li></${stack.pop()}>`;
  return html;
}

export function markdownToEditorHtml(markdown: string): string {
  const blocks = parseBlocks(markdown);
  if (!blocks.length) return "<p><br></p>";
  return blocks.map((block): string => {
    switch (block.type) {
      case "h2": return `<h2>${inlineHtml(block.text) || "<br>"}</h2>`;
      case "h3": return `<h3>${inlineHtml(block.text) || "<br>"}</h3>`;
      case "h4": return `<h4>${inlineHtml(block.text) || "<br>"}</h4>`;
      case "ul": case "ol": return listHtml(block.items);
      // Quotations and callouts may contain their own lists and headings.
      case "quote": return `<blockquote>${markdownToEditorHtml(block.lines.join("\n"))}</blockquote>`;
      case "callout": return `<blockquote data-callout="${block.variant}">${markdownToEditorHtml(block.lines.join("\n"))}</blockquote>`;
      case "hr": return "<hr>";
      case "handnote": {
        const paths = decodeHandNote(block.encoded).map((stroke) => `<path d="${stroke.d}" stroke="${stroke.color}" fill="none" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`).join("");
        return `<div data-handnote="${block.encoded}" contenteditable="false" style="margin:10px 0;max-width:100%;border:1px solid #cbd5e1;border-radius:10px;overflow:hidden;background:white"><svg viewBox="0 0 ${HAND_NOTE_SIZE.width} ${HAND_NOTE_SIZE.height}" role="img" aria-label="Handwritten note" style="width:100%;display:block;max-height:350px">${paths}</svg></div>`;
      }
      case "table": return tableHtml(block);
      default: return paragraphHtml(block.text);
    }
  }).join("");
}

function isBold(element: HTMLElement) {
  if (element.tagName === "STRONG" || element.tagName === "B") return true;
  const weight = element.style?.fontWeight;
  return weight === "bold" || Number(weight) >= 600;
}
function isItalic(element: HTMLElement) {
  return element.tagName === "EM" || element.tagName === "I" || element.style?.fontStyle === "italic";
}
function isMark(element: HTMLElement) {
  return element.tagName === "MARK";
}
function isStrike(element: HTMLElement) {
  return element.tagName === "S" || element.tagName === "DEL" || element.tagName === "STRIKE" || element.style?.textDecorationLine === "line-through";
}
function wrap(marker: string, inner: string) {
  if (!inner.trim()) return inner;
  const lead = inner.match(/^\s*/)?.[0] ?? "";
  const trail = inner.match(/\s*$/)?.[0] ?? "";
  return `${lead}${marker}${inner.trim()}${marker}${trail}`;
}

/** Serialise inline content. Returns text where "\n" marks a hard line break. */
function escapeInlineText(value: string): string {
  return value.replace(/\\/g, "\\\\")
    .replace(/(\*{1,3}|==|~~|\[\[(?![^\]]*\]\])|\{(?:color|bg):)(?=\S)/g, "\\$1");
}
function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeInlineText((node.textContent ?? "").replace(/ /g, " ").replace(/​/g, ""));
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  if (element.hasAttribute("data-wikilink")) return element.textContent ?? "";
  if (element.tagName === "BR") return "\n";
  if (["UL", "OL", "SCRIPT", "STYLE"].includes(element.tagName)) return "";
  let inner = Array.from(element.childNodes).map(inlineMarkdown).join("");
  const ink = element.getAttribute("data-ink");
  const tone = element.getAttribute("data-tone");
  if (ink && NOTE_COLOURS.includes(ink as NoteColour)) inner = inner.trim() ? `{color:${ink}}${inner}{/color}` : inner;
  if (tone && NOTE_COLOURS.includes(tone as NoteColour)) inner = inner.trim() ? `{bg:${tone}}${inner}{/bg}` : inner;
  else if (isMark(element)) inner = wrap("==", inner);
  if (isStrike(element)) inner = wrap("~~", inner);
  if (isItalic(element) && !isBold(element)) inner = wrap("*", inner);
  if (isBold(element)) inner = wrap("**", inner);
  return inner;
}

function blockLines(element: HTMLElement): string[] {
  // A block may hold nested blocks (Chrome sometimes nests <div>s) or <br> breaks.
  const hasBlockChild = Array.from(element.children).some((child) => BLOCK_TAGS.has(child.tagName));
  if (hasBlockChild) return serializeChildren(element);
  const text = inlineMarkdown(element);
  // A lone trailing <br> is only the browser's placeholder for an empty line.
  const cleaned = text.endsWith("\n") ? text.slice(0, -1) : text;
  return cleaned.split("\n");
}

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "HR", "PRE", "TABLE"]);

function listLines(list: HTMLElement, depth: number, out: string[]) {
  const ordered = list.tagName === "OL";
  let counter = ordered ? (Number(list.getAttribute("start")) || 1) - 1 : 0;
  for (const child of Array.from(list.children)) {
    if (child.tagName === "UL" || child.tagName === "OL") { listLines(child as HTMLElement, depth + 1, out); continue; }
    if (child.tagName !== "LI") continue;
    counter += 1;
    const ownText = Array.from(child.childNodes)
      .filter((node) => !(node instanceof HTMLElement && (node.tagName === "UL" || node.tagName === "OL")))
      .map((node) => node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName) ? blockLines(node).join(" ") : inlineMarkdown(node))
      .join("").replace(/\n+$/, "").replace(/\n/g, " ");
    out.push(`${"  ".repeat(depth)}${ordered ? `${counter}.` : "-"} ${ownText.replace(/\s+$/, "")}`);
    for (const nested of Array.from(child.children)) {
      if (nested.tagName === "UL" || nested.tagName === "OL") listLines(nested as HTMLElement, depth + 1, out);
    }
  }
}

function serializeChildren(root: HTMLElement): string[] {
  const out: string[] = [];
  let inlineBuffer = "";
  const flushInline = () => {
    if (!inlineBuffer) return;
    out.push(...inlineBuffer.replace(/\n$/, "").split("\n"));
    inlineBuffer = "";
  };
  for (const node of Array.from(root.childNodes)) {
    if (!(node instanceof HTMLElement) || !BLOCK_TAGS.has(node.tagName)) {
      inlineBuffer += inlineMarkdown(node);
      continue;
    }
    flushInline();
    const tag = node.tagName;
    if (tag === "H1" || tag === "H2") out.push(`# ${blockLines(node).join(" ").trim()}`.trimEnd());
    else if (/^H[3-6]$/.test(tag)) out.push(`${"#".repeat(Math.min(6, Number(tag[1]) - 1))} ${blockLines(node).join(" ").trim()}`.trimEnd());
    else if (tag === "HR") out.push("---");
    else if (tag === "DIV" && node.hasAttribute("data-handnote")) out.push(HAND_NOTE_PREFIX + node.getAttribute("data-handnote"));
    else if (tag === "TABLE") {
      const table = node as HTMLTableElement;
      const style = table.getAttribute("data-table-style");
      if (style === "striped" || style === "study") out.push("{table:" + style + "}");
      const trs = Array.from(table.querySelectorAll("tr"));
      const rowText = (row: HTMLTableRowElement) => Array.from(row.cells).map((cell) =>
        Array.from(cell.childNodes).map(inlineMarkdown).join("").replace(/\n/g, " ").trim()
      );
      const headers = trs.length ? rowText(trs[0]) : [];
      if (headers.length) {
        out.push(tableLine(headers));
        out.push(tableLine(headers.map(() => "---")));
        for (const row of trs.slice(1)) out.push(tableLine(rowText(row)));
      }
    }
    else if (tag === "UL" || tag === "OL") listLines(node, 0, out);
    else if (tag === "BLOCKQUOTE") {
      const variant = node.getAttribute("data-callout");
      const inner = serializeChildren(node);
      if (variant && variant in CALLOUTS) out.push(`> [!${variant}]`);
      for (const line of inner.length ? inner : [""]) out.push(line ? `> ${line}` : ">");
    } else out.push(...blockLines(node));
  }
  flushInline();
  return out;
}

export function editorToMarkdown(root: HTMLElement) {
  const lines = serializeChildren(root);
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines.join("\n");
}

/** Normalise stored text the way a save from the editor would, for change detection. */
export function canonicalMarkdown(markdown: string) {
  if (typeof document === "undefined") return markdown;
  const container = document.createElement("div");
  container.innerHTML = markdownToEditorHtml(markdown);
  return editorToMarkdown(container);
}
