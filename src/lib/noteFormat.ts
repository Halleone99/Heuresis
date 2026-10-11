/**
 * Heuresis note format: a small, readable Markdown subset stored as plain text.
 *
 *   # Section                ## Subsection
 *   - bullet  /  1. numbered  (two spaces per nesting level)
 *   > quotation
 *   > [!example]  > [!rule]  > [!correction]  > [!tip]  callout blocks
 *   ---                      divider
 *   **bold**  *italic*  ==highlight==  ~~struck out~~  [[Link to another note]]
 *
 * Every line maps to one block, so the text round-trips through the editor
 * without reflowing what the user wrote. Unknown syntax is kept verbatim.
 */

export type CalloutVariant = "example" | "rule" | "correction" | "tip";
export type ListItem = { text: string; depth: number; ordered: boolean };
export type Block =
  | { type: "p"; text: string }
  | { type: "h2" | "h3"; text: string }
  | { type: "ul" | "ol"; items: ListItem[] }
  | { type: "quote"; lines: string[] }
  | { type: "callout"; variant: CalloutVariant; lines: string[] }
  | { type: "hr" };

export type Inline =
  | { type: "text"; text: string }
  | { type: "strong" | "em" | "mark" | "strike"; text: string }
  | { type: "link"; target: string; label: string };

export const CALLOUTS: Record<CalloutVariant, string> = {
  example: "Example", rule: "Rule", correction: "Correction", tip: "Tip",
};
const CALLOUT_RE = /^>\s?\[!(example|rule|correction|tip)\]\s*$/i;
const LIST_RE = /^(\s*)([-*•]|\d+[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;

function indentDepth(indent: string) {
  const width = indent.replace(/\t/g, "  ").length;
  return Math.min(4, Math.floor(width / 2));
}

export function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
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
      blocks.push({ type: heading[1].length === 1 ? "h2" : "h3", text: heading[2] });
      continue;
    }
    if (HR_RE.test(line)) { blocks.push({ type: "hr" }); continue; }
    const list = line.match(LIST_RE);
    if (list) {
      const ordered = /\d/.test(list[2]);
      const type = ordered ? "ol" : "ul";
      const items: ListItem[] = [{ text: list[3], depth: 0, ordered }];
      while (index + 1 < lines.length) {
        const next = lines[index + 1].match(LIST_RE);
        if (!next) break;
        const nextOrdered = /\d/.test(next[2]);
        // Nested items may use either marker; only top-level items decide the list type.
        if (indentDepth(next[1]) === 0 && nextOrdered !== ordered) break;
        index += 1;
        const previous = items[items.length - 1].depth;
        items.push({ text: next[3], depth: Math.min(indentDepth(next[1]), previous + 1), ordered: nextOrdered });
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

const INLINE_RE = /\*\*(.+?)\*\*|==(.+?)==|\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]|\*(?![\s*])([^*]*?[^\s*])\*|~~(.+?)~~/g;

export function parseInline(text: string): Inline[] {
  const result: Inline[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE_RE)) {
    const start = match.index ?? 0;
    if (start > last) result.push({ type: "text", text: text.slice(last, start) });
    if (match[1] !== undefined) result.push({ type: "strong", text: match[1] });
    else if (match[2] !== undefined) result.push({ type: "mark", text: match[2] });
    else if (match[3] !== undefined) result.push({ type: "link", target: match[3].trim(), label: (match[4] ?? match[3]).trim() });
    else if (match[5] !== undefined) result.push({ type: "em", text: match[5] });
    else if (match[6] !== undefined) result.push({ type: "strike", text: match[6] });
    last = start + match[0].length;
  }
  if (last < text.length) result.push({ type: "text", text: text.slice(last) });
  return result;
}

export function wikiLinks(markdown: string) {
  const targets = new Set<string>();
  for (const match of markdown.matchAll(/\[\[([^\]|]+?)(?:\|[^\]]+?)?\]\]/g)) targets.add(match[1].trim().toLocaleLowerCase());
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

export function inlinePlain(text: string) {
  return parseInline(text).map((part) => part.type === "link" ? part.label : part.text).join("");
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
function inlineHtml(text: string) {
  return parseInline(text).map((part) => {
    if (part.type === "strong") return `<strong>${pinyinHtml(part.text)}</strong>`;
    if (part.type === "em") return `<em>${pinyinHtml(part.text)}</em>`;
    if (part.type === "mark") return `<mark>${pinyinHtml(part.text)}</mark>`;
    if (part.type === "strike") return `<s>${pinyinHtml(part.text)}</s>`;
    if (part.type === "link") return escapeHtml(part.label === part.target ? `[[${part.target}]]` : `[[${part.target}|${part.label}]]`);
    return pinyinHtml(part.text);
  }).join("");
}
function paragraphHtml(text: string) {
  const inner = inlineHtml(text);
  return `<p>${inner || "<br>"}</p>`;
}
function listHtml(items: ListItem[]) {
  let html = "";
  const stack: Array<"ul" | "ol"> = [];
  for (const item of items) {
    const tag = item.ordered ? "ol" : "ul";
    const content = `<li>${inlineHtml(item.text) || "<br>"}`;
    if (!stack.length) { html += `<${tag}>${content}`; stack.push(tag); continue; }
    const current = stack.length - 1;
    if (item.depth > current) { html += `<${tag}>${content}`; stack.push(tag); continue; }
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
      case "ul": case "ol": return listHtml(block.items);
      // Quotations and callouts may contain their own lists and headings.
      case "quote": return `<blockquote>${markdownToEditorHtml(block.lines.join("\n"))}</blockquote>`;
      case "callout": return `<blockquote data-callout="${block.variant}">${markdownToEditorHtml(block.lines.join("\n"))}</blockquote>`;
      case "hr": return "<hr>";
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
function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/ /g, " ").replace(/​/g, "");
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const element = node as HTMLElement;
  if (element.tagName === "BR") return "\n";
  if (["UL", "OL", "SCRIPT", "STYLE"].includes(element.tagName)) return "";
  let inner = Array.from(element.childNodes).map(inlineMarkdown).join("");
  if (isMark(element)) inner = wrap("==", inner);
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

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "BLOCKQUOTE", "HR", "PRE"]);

function listLines(list: HTMLElement, depth: number, out: string[]) {
  let counter = 0;
  const ordered = list.tagName === "OL";
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
    else if (/^H[3-6]$/.test(tag)) out.push(`## ${blockLines(node).join(" ").trim()}`.trimEnd());
    else if (tag === "HR") out.push("---");
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
