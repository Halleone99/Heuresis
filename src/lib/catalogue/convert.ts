import { editorToMarkdown } from "../noteFormat";
import {
  newBlock, openingBlock, type Block, type CaptionBlock, type DividerBlock, type HeadingBlock,
  type ImageBlock, type QuoteBlock, type TextBlock,
} from "./model";

/**
 * Turning existing writing into article blocks. Conversion COPIES text and
 * keeps the author's words exactly: no rewriting, summarising or "improving".
 * Only the visual structure is chosen (sections → headings, quotations →
 * quotation blocks, dividers → dividers); everything else stays in text blocks
 * in the Heuresis note format.
 */

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const CALLOUT_RE = /^>\s?\[!(example|rule|correction|tip)\]\s*$/i;
const HAND_NOTE_PREFIX = "::handnote:";
const ATTRIBUTION_RE = /^\s*(?:—|–|--|~)\s*(.+)$/;

/** [[Target|Label]] → Label. Links to notes mean nothing inside a publication. */
export function stripWikiLinks(text: string) {
  return text.replace(/\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g, (_, target: string, label?: string) => (label ?? target).trim());
}

/** Inline Markdown markers removed, for plain fields such as quotations. */
export function inlineToPlain(text: string) {
  return stripWikiLinks(text)
    .replace(/\*\*\*(.+?)\*\*\*/g, "$1").replace(/\*\*(.+?)\*\*/g, "$1").replace(/==(.+?)==/g, "$1")
    .replace(/~~(.+?)~~/g, "$1").replace(/(^|[^\w*])\*(\S(?:.*?\S)?)\*(?!\w)/g, "$1$2")
    .replace(/\{(?:color|bg):[a-z]+\}(.+?)\{\/(?:color|bg)\}/g, "$1").replace(/\\([\\*=~[\]{}])/g, "$1");
}

export type ConversionReport = { skippedHandwriting: number };

/** A note (Heuresis note format) as article blocks, starting with an opening heading. */
export function markdownToBlocks(markdown: string, report: ConversionReport = { skippedHandwriting: 0 }): Block[] {
  const blocks: Block[] = [];
  let text: string[] = [];
  const flush = () => {
    while (text.length && !text[text.length - 1].trim()) text.pop();
    while (text.length && !text[0].trim()) text.shift();
    if (text.length) blocks.push({ ...(newBlock("text") as TextBlock), content: text.join("\n") });
    text = [];
  };
  const lines = stripWikiLinks(markdown.replace(/\r\n?/g, "\n")).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith(HAND_NOTE_PREFIX)) { report.skippedHandwriting += 1; continue; }
    const heading = line.match(HEADING_RE);
    if (heading && heading[1].length === 1) {
      flush();
      blocks.push({ ...(newBlock("heading") as HeadingBlock), text: inlineToPlain(heading[2]).trim() });
      continue;
    }
    if (HR_RE.test(line)) { flush(); blocks.push(newBlock("divider") as DividerBlock); continue; }
    if (/^>/.test(line) && !CALLOUT_RE.test(line)) {
      const quote = [line.replace(/^>\s?/, "")];
      while (index + 1 < lines.length && /^>/.test(lines[index + 1]) && !CALLOUT_RE.test(lines[index + 1])) {
        index += 1; quote.push(lines[index].replace(/^>\s?/, ""));
      }
      const body = quote.map((part) => inlineToPlain(part).trim());
      let attribution = "";
      const last = body.length > 1 ? body[body.length - 1].match(ATTRIBUTION_RE) : null;
      if (last) { attribution = last[1].trim(); body.pop(); }
      const textValue = body.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      if (textValue) { flush(); blocks.push({ ...(newBlock("quote") as QuoteBlock), text: textValue, attribution }); }
      continue;
    }
    if (CALLOUT_RE.test(line)) {
      // Example/Rule/Tip boxes stay inside the text, exactly as written.
      text.push(line);
      while (index + 1 < lines.length && /^>/.test(lines[index + 1]) && !CALLOUT_RE.test(lines[index + 1])) { index += 1; text.push(lines[index]); }
      continue;
    }
    text.push(heading ? `${"#".repeat(heading[1].length)} ${heading[2]}` : line);
  }
  flush();
  return blocks;
}

export function noteToBlocks(title: string, description: string, body: string, report?: ConversionReport): { blocks: Block[]; subtitle: string } {
  const opening = openingBlock();
  const rest = markdownToBlocks(body, report);
  // A first "# Heading" identical to the title would print the title twice.
  const first = rest[0];
  if (first?.type === "heading" && first.text.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase()) rest.shift();
  return { blocks: [opening, ...rest], subtitle: description.trim() };
}

// ---------------------------------------------------------------------------
// HTML (from a DOCX conversion) → blocks. The HTML is parsed into an inert
// document and only a small whitelist of structure is copied; nothing from it
// is ever inserted into the page as HTML.
// ---------------------------------------------------------------------------
export type ImportedImage = { key: string; contentType: string; bytes: ArrayBuffer; alt: string };
export type HtmlImport = {
  title: string; subtitle: string; blocks: Block[];
  /** Image blocks waiting for their imported file, by import key. */
  imageKeys: Map<string, ImageBlock>;
  skipped: string[];
};

const INLINE_KEEP = new Set(["STRONG", "B", "EM", "I", "S", "DEL", "STRIKE"]);

function sanitiseInline(source: Node, target: Node, skipped: Set<string>) {
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) { target.appendChild(document.createTextNode(child.textContent ?? "")); continue; }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toUpperCase();
    if (tag === "BR") { target.appendChild(document.createElement("br")); continue; }
    if (tag === "IMG") continue; // handled by the caller as its own block
    if (INLINE_KEEP.has(tag)) {
      const element = document.createElement(tag === "B" ? "strong" : tag === "I" ? "em" : tag === "DEL" || tag === "STRIKE" ? "s" : tag.toLowerCase());
      sanitiseInline(child, element, skipped);
      target.appendChild(element);
      continue;
    }
    if (tag === "U") skipped.add("underline");
    if (tag === "SUP" || tag === "SUB") skipped.add("superscript and subscript");
    // Links, spans, underline etc.: keep the words, drop the markup.
    sanitiseInline(child, target, skipped);
  }
}

function sanitiseList(list: Element, skipped: Set<string>): HTMLElement {
  const out = document.createElement(list.tagName.toUpperCase() === "OL" ? "ol" : "ul");
  for (const item of Array.from(list.children)) {
    if (item.tagName.toUpperCase() !== "LI") continue;
    const li = document.createElement("li");
    for (const child of Array.from(item.childNodes)) {
      if (child instanceof Element && /^(UL|OL)$/i.test(child.tagName)) li.appendChild(sanitiseList(child, skipped));
      else if (child instanceof Element && /^P$/i.test(child.tagName)) sanitiseInline(child, li, skipped);
      else { const holder = document.createElement("span"); holder.appendChild(child.cloneNode(true)); sanitiseInline(holder, li, skipped); }
    }
    out.appendChild(li);
  }
  return out;
}

function sanitiseTable(table: Element, skipped: Set<string>): HTMLElement {
  const out = document.createElement("table");
  for (const row of Array.from(table.querySelectorAll("tr"))) {
    const tr = document.createElement("tr");
    for (const cell of Array.from(row.children)) {
      if (!/^(TD|TH)$/i.test(cell.tagName)) continue;
      const td = document.createElement("td");
      for (const part of Array.from(cell.childNodes)) {
        const holder = document.createElement("span");
        holder.appendChild(part.cloneNode(true));
        sanitiseInline(holder, td, skipped);
        td.appendChild(document.createTextNode(" "));
      }
      tr.appendChild(td);
    }
    if (tr.children.length) out.appendChild(tr);
  }
  if (table.querySelector("td[colspan], td[rowspan], th[colspan], th[rowspan]")) skipped.add("merged table cells");
  return out;
}

function textOf(element: Element) {
  return (element.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function htmlToBlocks(html: string): HtmlImport {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}</body>`, "text/html");
  const blocks: Block[] = [];
  const imageKeys = new Map<string, ImageBlock>();
  const skipped = new Set<string>();
  let title = "";
  let subtitle = "";
  let buffer = document.createElement("div");
  let lastImage: ImageBlock | null = null;

  const flushText = () => {
    if (!buffer.childNodes.length) return;
    const markdown = editorToMarkdown(buffer).replace(/\n{3,}/g, "\n\n").trim();
    if (markdown) blocks.push({ ...(newBlock("text") as TextBlock), content: markdown });
    buffer = document.createElement("div");
  };
  const addImages = (element: Element) => {
    for (const image of Array.from(element.querySelectorAll("img"))) {
      const key = image.getAttribute("src") ?? "";
      if (!key.startsWith("docx-image:")) { skipped.add("linked images"); continue; }
      flushText();
      const block: ImageBlock = { ...(newBlock("image") as ImageBlock), caption: "" };
      imageKeys.set(key, block);
      blocks.push(block);
      lastImage = block;
    }
  };

  for (const node of Array.from(parsed.body.childNodes)) {
    if (!(node instanceof Element)) {
      if ((node.textContent ?? "").trim()) { const p = document.createElement("p"); p.textContent = node.textContent; buffer.appendChild(p); }
      continue;
    }
    const tag = node.tagName.toUpperCase();
    const className = node.getAttribute("class") ?? "";
    const hasImage = Boolean(node.querySelector("img"));
    if (hasImage) addImages(node);
    const words = textOf(node);
    if (tag === "H1" && /\btitle\b/.test(className)) { if (!title) title = words; else if (words) blocks.push({ ...(newBlock("heading") as HeadingBlock), text: words }); lastImage = null; continue; }
    if (tag === "P" && /\bsubtitle\b/.test(className)) { if (!subtitle) subtitle = words; lastImage = null; continue; }
    if (tag === "P" && /\bcaption\b/.test(className)) {
      const target = lastImage as ImageBlock | null;
      if (target && !target.caption) target.caption = words;
      else if (words) { flushText(); blocks.push({ ...(newBlock("caption") as CaptionBlock), text: words }); }
      continue;
    }
    if (!hasImage) lastImage = null;
    if (!words && tag !== "HR" && tag !== "TABLE") continue;
    if (tag === "H1" || tag === "H2") { flushText(); blocks.push({ ...(newBlock("heading") as HeadingBlock), text: words }); continue; }
    if (/^H[3-6]$/.test(tag)) { const heading = document.createElement(tag === "H3" ? "h3" : "h4"); sanitiseInline(node, heading, skipped); buffer.appendChild(heading); continue; }
    if (tag === "HR") { flushText(); blocks.push(newBlock("divider")); continue; }
    if (tag === "BLOCKQUOTE") {
      flushText();
      const paragraphs = Array.from(node.querySelectorAll("p")).map(textOf).filter(Boolean);
      const lines = paragraphs.length ? paragraphs : [words];
      const attribution = lines.length > 1 ? lines[lines.length - 1].match(ATTRIBUTION_RE)?.[1] ?? "" : "";
      if (attribution) lines.pop();
      blocks.push({ ...(newBlock("quote") as QuoteBlock), text: lines.join("\n"), attribution });
      continue;
    }
    if (tag === "UL" || tag === "OL") { buffer.appendChild(sanitiseList(node, skipped)); continue; }
    if (tag === "TABLE") { buffer.appendChild(sanitiseTable(node, skipped)); continue; }
    const paragraph = document.createElement("p");
    sanitiseInline(node, paragraph, skipped);
    if ((paragraph.textContent ?? "").trim()) buffer.appendChild(paragraph);
  }
  flushText();
  return { title, subtitle, blocks: [openingBlock(), ...blocks], imageKeys, skipped: Array.from(skipped) };
}
