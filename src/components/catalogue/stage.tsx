import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { editorToMarkdown } from "../../lib/noteFormat";
import { ensureArticleFonts } from "../../lib/catalogue/fonts";
import { prefetchCatalogueImages } from "../../lib/catalogue/media";
import {
  articleImages, isCoverPage, newPage, uid, type ArticlePage, type Block, type CatalogueArticle, type CatalogueVolume, type TextBlock,
} from "../../lib/catalogue/model";
import { ArticlePageView, LayoutPlaceholders } from "./ArticlePage";
import { VolumeContentsPage, volumeTitleArticle, type ContentsEntry, type VolumeLook } from "./VolumeFrontMatter";

/**
 * An off-screen place where pages are laid out at their true size (100 %, no
 * transforms) for measuring overflow, flowing text onto following pages and
 * painting the PDF. It uses the very same page component as the designer.
 */
export class PageStage {
  readonly host: HTMLDivElement;
  private root: Root;
  /** Keep the space of empty picture frames (true for the overflow flow, as in the designer). */
  private placeholders: boolean;
  constructor(options: { placeholders?: boolean } = {}) {
    this.placeholders = options.placeholders ?? false;
    this.host = document.createElement("div");
    this.host.className = "ap-stage";
    this.host.setAttribute("aria-hidden", "true");
    this.host.style.cssText = "position:fixed;left:-40000px;top:0;display:flex;flex-direction:column;gap:20px;pointer-events:none;contain:layout style;";
    document.body.appendChild(this.host);
    this.root = createRoot(this.host);
  }
  render(article: CatalogueArticle, pages: ArticlePage[], startIndex: number, labels: StageLabels = {}) {
    return this.renderNodes(<>{pages.map((page, offset) => <ArticlePageView key={page.id} article={article} page={page}
      pageIndex={startIndex + offset} pageCount={article.pages.length} kicker={labels.kicker} runningTitle={labels.runningTitle}
      folioOffset={labels.folioOffset} mode="read" />)}</>);
  }
  /** Any set of `.ap-page` elements (for example a volume's title and contents pages). */
  renderNodes(nodes: ReactNode) {
    flushSync(() => this.root.render(<LayoutPlaceholders.Provider value={this.placeholders}>{nodes}</LayoutPlaceholders.Provider>));
    return Array.from(this.host.querySelectorAll<HTMLElement>(".ap-page"));
  }
  destroy() {
    try { this.root.unmount(); } catch { /* already gone */ }
    this.host.remove();
  }
}
export type StageLabels = { kicker?: string; runningTitle?: string; folioOffset?: number };

/** How far (CSS px) a laid-out page's content runs past its bottom margin. */
export function pageOverflowPx(pageElement: HTMLElement): number {
  const content = pageElement.querySelector<HTMLElement>(".ap-content");
  if (!content) return 0;
  const limit = content.clientHeight;
  // Layout sizes (offset*) ignore the designer's zoom; measured rectangles are divided by it.
  const zoom = pageElement.getBoundingClientRect().width / Math.max(1, pageElement.offsetWidth) || 1;
  const contentTop = content.getBoundingClientRect().top;
  let bottom = 0;
  for (const child of Array.from(content.children) as HTMLElement[]) {
    const style = getComputedStyle(child);
    if (style.position === "absolute" || style.display === "none") continue;
    bottom = Math.max(bottom, child.offsetTop + child.offsetHeight + (parseFloat(style.marginBottom) || 0));
    // Absolutely placed parts of a block (a cover's text) must stay inside too.
    for (const inner of Array.from(child.querySelectorAll<HTMLElement>(".ap-cover-text"))) {
      bottom = Math.max(bottom, (inner.getBoundingClientRect().bottom - contentTop) / zoom);
    }
  }
  return Math.max(0, bottom - limit);
}

async function waitForImages(root: HTMLElement) {
  const images = Array.from(root.querySelectorAll("img"));
  await Promise.all(images.map((image) => image.decode().catch(() => undefined)));
}

export async function prepareArticle(article: CatalogueArticle) {
  await ensureArticleFonts(article);
  const failed = await prefetchCatalogueImages(articleImages(article).map((image) => image.path));
  return { failedImages: failed };
}

/** Lay out every page off-screen for export; returns the page elements and a cleanup function. */
export async function layoutForExport(article: CatalogueArticle, labels: StageLabels = {}) {
  const prepared = await prepareArticle(article);
  const stage = new PageStage();
  const pages = stage.render(article, article.pages, 0, labels);
  await waitForImages(stage.host);
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const overflowing = pages.map((page, index) => ({ index, overflow: pageOverflowPx(page) })).filter((item) => item.overflow > 1);
  const missingImages = prepared.failedImages + stage.host.querySelectorAll(".ap-frame-wait").length;
  return { stage, pages, overflowing: overflowing.map((item) => item.index), missingImages };
}

/**
 * A volume's title page and contents pages, laid out off-screen for the volume PDF.
 * The contents are divided over as many pages as they need (never clipped), and the
 * page numbers listed are those of the finished PDF, whose folios run on through it.
 */
export async function layoutVolumeFrontMatter(volume: CatalogueVolume, articles: CatalogueArticle[], look: VolumeLook,
  userId: string, labels: { kicker: string; date: string }) {
  const titleArticle = volumeTitleArticle(volume, look, userId, labels.date);
  const prepared = await prepareArticle(titleArticle);
  const stage = new PageStage();
  try {
    // 1. Divide the contents into pages: as many rows per page as fit.
    const provisional = (from: number) => articles.map((article, index) => ({ article, number: index + 1, start: from + index }));
    const groups: ContentsEntry[][] = [];
    let rest = provisional(1);
    while (rest.length) {
      let count = rest.length;
      for (;;) {
        const [page] = stage.renderNodes(<VolumeContentsPage volume={volume} entries={rest.slice(0, count)} look={look} first={!groups.length} />);
        if (pageOverflowPx(page) <= 1 || count === 1) break;
        count -= 1;
      }
      groups.push(rest.slice(0, count));
      rest = rest.slice(count);
    }
    // 2. Real page numbers: the title page, the contents pages, then each article in order.
    let next = 1 + Math.max(1, groups.length) + 1;
    const starts = new Map<string, number>();
    for (const article of articles) { starts.set(article.id, next); next += article.pages.length; }
    const finalGroups = groups.map((group) => group.map((entry) => ({ ...entry, start: starts.get(entry.article.id) ?? entry.start })));
    const pages = stage.renderNodes(<>
      <ArticlePageView article={titleArticle} page={titleArticle.pages[0]} pageIndex={0} pageCount={1} kicker={labels.kicker} mode="read" />
      {(finalGroups.length ? finalGroups : [[]]).map((group, index) => <VolumeContentsPage key={index} volume={volume} entries={group} look={look} first={index === 0} />)}
    </>);
    await waitForImages(stage.host);
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const overflowing = pages.some((page) => pageOverflowPx(page) > 1);
    const missingImages = prepared.failedImages + stage.host.querySelectorAll(".ap-frame-wait").length;
    return { stage, pages, overflowing, missingImages, starts };
  } catch (error) {
    stage.destroy();
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Flowing overflowing content onto the following page
// ---------------------------------------------------------------------------
function pathTo(node: Node, root: Node): number[] {
  const path: number[] = [];
  let current: Node | null = node;
  while (current && current !== root) {
    const parent: Node | null = current.parentNode;
    if (!parent) break;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current));
    current = parent;
  }
  return path;
}
function resolvePath(root: Node, path: number[]): Node | null {
  let current: Node | null = root;
  for (const index of path) { current = current?.childNodes[index] ?? null; if (!current) return null; }
  return current;
}

type Cut = { path: number[]; offset: number; midParagraph: boolean };

/** Word starts (and every CJK character) in document order: the places text may be divided. */
function cutPoints(body: HTMLElement): Cut[] {
  const cuts: Cut[] = [];
  const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  let firstInBlock = new WeakSet<Element>();
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const block = node.parentElement?.closest("p, li, h2, h3, h4, td, th, blockquote") ?? body;
    const path = pathTo(node, body);
    const text = node.data;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const previous = index > 0 ? text[index - 1] : " ";
      const wordStart = /\S/.test(char) && (/\s/.test(previous) || /[　-鿿＀-￯]/.test(char));
      if (!wordStart) continue;
      const atBlockStart = !firstInBlock.has(block);
      firstInBlock.add(block);
      // Never divide inside a table row or a heading.
      if (!atBlockStart && block.closest("table, h2, h3, h4")) continue;
      cuts.push({ path, offset: index, midParagraph: !atBlockStart });
    }
  }
  firstInBlock = new WeakSet();
  return cuts;
}

function partAt(body: HTMLElement, cut: Cut, keep: "before" | "after"): HTMLElement | null {
  const clone = body.cloneNode(true) as HTMLElement;
  const node = resolvePath(clone, cut.path);
  if (!node) return null;
  const range = document.createRange();
  if (keep === "before") { range.setStart(node, cut.offset); range.setEnd(clone, clone.childNodes.length); }
  else { range.setStart(clone, 0); range.setEnd(node, cut.offset); }
  // Continue an ordered list with the right number on the next page.
  if (keep === "after") {
    const item = node.parentElement?.closest("li");
    const list = item?.parentElement;
    if (item && list?.tagName === "OL") {
      const position = Array.from(list.children).filter((child) => child.tagName === "LI").indexOf(item);
      const start = Number(list.getAttribute("start")) || 1;
      if (position > 0) list.setAttribute("start", String(start + position));
    }
  }
  range.deleteContents();
  return clone;
}

function trimMarkdown(markdown: string) {
  return markdown.replace(/^\s*\n/, "").replace(/\n\s*$/g, "").replace(/^(\s*\n)+/, "").trimEnd();
}

/** Divide a text block so that its first part fits in `available` px. */
function splitText(block: TextBlock, blockElement: HTMLElement, available: number): { first: TextBlock; rest: TextBlock } | null {
  const body = blockElement.querySelector<HTMLElement>(".ap-text-body");
  if (!body) return null;
  const cuts = cutPoints(body);
  if (cuts.length < 2) return null;
  const fits = (index: number) => {
    const part = partAt(body, cuts[index], "before");
    if (!part) return false;
    body.replaceWith(part);
    const height = blockElement.offsetHeight;
    part.replaceWith(body);
    return height <= available;
  };
  // Largest number of words (cut index) whose first part still fits.
  let low = 1; let high = cuts.length - 1; let best = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (fits(middle)) { best = middle; low = middle + 1; } else high = middle - 1;
  }
  if (best <= 0) return null;
  // No single line of a paragraph alone at the foot of the page or the top of the next.
  if (block.columns === 1 && cuts[best].midParagraph) {
    const lineHeight = parseFloat(getComputedStyle(body).lineHeight) || 20;
    let start = best;
    while (start > 0 && cuts[start].midParagraph) start -= 1;
    const linesOf = (part: HTMLElement | null, which: "first" | "last") => {
      if (!part) return 0;
      body.replaceWith(part);
      const items = Array.from(part.querySelectorAll<HTMLElement>("p, li, blockquote")).filter((item) => (item.textContent ?? "").trim());
      const item = which === "first" ? items[0] : items[items.length - 1];
      const height = item ? item.getBoundingClientRect().height : 0;
      part.replaceWith(body);
      return height / lineHeight;
    };
    // Widow: pull words back until the next page starts with at least two lines.
    // (Never back to the very start of the block: something must stay on this page.)
    const floor = Math.max(start, 1);
    for (let guard = 0; best > floor && guard < 40 && linesOf(partAt(body, cuts[best], "after"), "first") < 1.6; guard += 1) best -= 1;
    // Orphan: if only one line would stay here, the whole paragraph moves on.
    if (start > 0 && best > start && linesOf(partAt(body, cuts[best], "before"), "last") < 1.6) best = start;
  }
  // Keep a subheading with the text that follows it.
  const before = partAt(body, cuts[best], "before");
  if (!before) return null;
  const last = Array.from(before.children).filter((child) => (child.textContent ?? "").trim()).pop();
  if (last && /^H[2-4]$/.test(last.tagName)) {
    const heading = resolvePath(body, pathTo(last, before));
    const headingStart = heading ? cuts.findIndex((cut) => heading.contains(resolvePath(body, cut.path))) : -1;
    if (headingStart > 0) best = headingStart;
  }
  const firstPart = partAt(body, cuts[best], "before");
  const restPart = partAt(body, cuts[best], "after");
  if (!firstPart || !restPart) return null;
  const first = trimMarkdown(editorToMarkdown(firstPart));
  const rest = trimMarkdown(editorToMarkdown(restPart));
  if (!first.trim() || !rest.trim()) return null;
  return {
    first: { ...block, content: first },
    rest: { ...block, id: uid(), content: rest, dropCap: false, continued: cuts[best].midParagraph ? true : "paragraph", spaceBefore: undefined },
  };
}

function isSectionHeading(block: Block | undefined) {
  return block?.type === "heading" && block.level === "section";
}

/** Which blocks stay on a page and which continue on the next one; null when nothing can be moved. */
function divide(page: ArticlePage, element: HTMLElement): { keep: Block[]; carry: Block[] } | null {
  const content = element.querySelector<HTMLElement>(".ap-content");
  if (!content) return null;
  const limit = content.clientHeight;
  // Blocks that print nothing (an empty opening after a cover) have no element, so
  // elements are matched to blocks by id, never by position.
  const blockElement = Array.from(content.querySelectorAll<HTMLElement>(":scope > .ap-block"))
    .find((item) => item.offsetTop + item.offsetHeight > limit + 0.5);
  if (!blockElement) return null;
  const index = page.blocks.findIndex((item) => item.id === blockElement.dataset.blockId);
  if (index < 0) return null;
  const block = page.blocks[index];
  const available = limit - blockElement.offsetTop;
  const lineHeight = parseFloat(getComputedStyle(blockElement).lineHeight) || 20;
  if (block?.type === "text" && available >= lineHeight * 1.6) {
    const split = splitText(block, blockElement, available);
    if (split) return { keep: [...page.blocks.slice(0, index), split.first], carry: [split.rest, ...page.blocks.slice(index + 1)] };
  }
  let cut = index;
  while (cut > 0 && isSectionHeading(page.blocks[cut - 1])) cut -= 1;
  if (cut === 0) {
    if (index > 0) cut = index; // a page of headings: move only the overflowing block
    else if (block?.type === "text" && available >= lineHeight) {
      const split = splitText(block, blockElement, available);
      return split ? { keep: [split.first], carry: [split.rest, ...page.blocks.slice(1)] } : null;
    } else return null;
  }
  return { keep: page.blocks.slice(0, cut), carry: page.blocks.slice(cut) };
}

// ---------------------------------------------------------------------------
// Parts of one text that meet again are joined, so a reflow never leaves a
// paragraph broken in two on the same page.
// ---------------------------------------------------------------------------
const ITEM_START = /^\s*(?:[-*+]|\d+[.)])\s+|^>\s?/;
function joinable(previous: Block | undefined, next: Block | undefined): next is TextBlock {
  return previous?.type === "text" && next?.type === "text" && Boolean(next.continued) && previous.columns === next.columns;
}
function joinText(previous: TextBlock, next: TextBlock): TextBlock {
  if (next.continued === true) {
    // The division fell inside a paragraph (or a list item): rejoin it with a space.
    return { ...previous, content: `${previous.content.trimEnd()} ${next.content.trimStart().replace(ITEM_START, "")}` };
  }
  return { ...previous, content: `${previous.content.trimEnd()}\n${next.content.trimStart()}` };
}
/** Joins neighbouring parts of a divided text within one page. */
export function mergeFragments(blocks: Block[]): Block[] {
  const merged: Block[] = [];
  for (const block of blocks) {
    const previous = merged[merged.length - 1];
    if (joinable(previous, block)) merged[merged.length - 1] = joinText(previous as TextBlock, block);
    else merged.push(block);
  }
  return merged;
}

/**
 * An empty picture frame (placed by a layout, not yet filled) that does not fit at
 * the foot of a page floats past the next text, as figures do in a typeset book, so
 * the page is not left a fifth empty. A frame never floats past a picture or a
 * quotation, never more than three times, and the text keeps its own order.
 */
function floatEmptyFrame(page: ArticlePage, element: HTMLElement, floated: Map<string, number>): ArticlePage | null {
  const content = element.querySelector<HTMLElement>(".ap-content");
  if (!content) return null;
  const limit = content.clientHeight;
  const frameElement = Array.from(content.querySelectorAll<HTMLElement>(":scope > .ap-block"))
    .find((item) => item.offsetTop + item.offsetHeight > limit + 0.5);
  const index = frameElement ? page.blocks.findIndex((item) => item.id === frameElement.dataset.blockId) : -1;
  const frame = page.blocks[index];
  if (!frameElement || frame?.type !== "image" || frame.image || (floated.get(frame.id) ?? 0) >= 3) return null;
  if (limit - frameElement.offsetTop < limit * 0.2) return null;
  let after = index + 1;
  if (isSectionHeading(page.blocks[after])) after += 1;
  if (page.blocks[after]?.type !== "text") return null;
  const blocks = [...page.blocks];
  blocks.splice(index, 1);
  blocks.splice(after, 0, frame);
  floated.set(frame.id, (floated.get(frame.id) ?? 0) + 1);
  return { ...page, blocks };
}

export type FlowResult = { pages: ArticlePage[]; changed: boolean; unresolved: number[] };

/**
 * Move content that runs past the bottom margin onto the following page
 * (creating pages where needed), from `startPage` onwards. Text is divided at a
 * word, subheadings stay with their text, other blocks move whole. Pages that
 * already fit are never touched.
 */
export async function flowOverflow(article: CatalogueArticle, options: { startPage?: number; labels?: StageLabels } = {}): Promise<FlowResult> {
  await prepareArticle(article);
  const stage = new PageStage({ placeholders: true });
  const pages = [...article.pages];
  const unresolved: number[] = [];
  let changed = false;
  let start = Math.max(0, options.startPage ?? 0);
  // Rejoin divided text first (within pages, and a continuation at the top of a page
  // with the text it continues), so the flow divides it again in the right place.
  for (let index = 0; index < pages.length; index += 1) {
    const merged = mergeFragments(pages[index].blocks);
    if (merged.length !== pages[index].blocks.length) { pages[index] = { ...pages[index], blocks: merged }; changed = true; }
    const next = pages[index + 1];
    const last = pages[index].blocks[pages[index].blocks.length - 1];
    if (next && joinable(last, next.blocks[0])) {
      pages[index] = { ...pages[index], blocks: [...pages[index].blocks.slice(0, -1), joinText(last as TextBlock, next.blocks[0] as TextBlock)] };
      pages[index + 1] = { ...next, blocks: next.blocks.slice(1) };
      changed = true;
      start = Math.min(start, index);
      index -= 1; // the next page may continue it again
    }
  }
  // A page emptied by rejoining goes, unless it was empty before.
  for (let index = pages.length - 1; index > 0; index -= 1) {
    if (!pages[index].blocks.length && article.pages.find((page) => page.id === pages[index].id)?.blocks.length) pages.splice(index, 1);
  }
  const floated = new Map<string, number>();
  try {
    let index = start;
    let guard = 0;
    while (index < pages.length && guard < 600) {
      guard += 1;
      const [element] = stage.render({ ...article, pages }, [pages[index]], index, options.labels);
      if (!element || pageOverflowPx(element) <= 1) { index += 1; continue; }
      const floatedPage = floatEmptyFrame(pages[index], element, floated);
      if (floatedPage) { pages[index] = floatedPage; changed = true; continue; }
      const division = divide(pages[index], element);
      if (!division || !division.carry.length || !division.keep.length) { unresolved.push(index); index += 1; continue; }
      changed = true;
      pages[index] = { ...pages[index], blocks: division.keep };
      const next = pages[index + 1];
      if (next && !isCoverPage(next)) pages[index + 1] = { ...next, blocks: mergeFragments([...division.carry, ...next.blocks]) };
      else pages.splice(index + 1, 0, newPage(division.carry));
      index += 1;
    }
  } finally {
    stage.destroy();
  }
  return { pages, changed, unresolved };
}
