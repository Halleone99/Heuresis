import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Bold, CheckCheck, Code2, Heading1, Heading2, Highlighter, Italic, Palette, ChevronsUpDown, Lightbulb, List, ListOrdered, MessageSquareText, Minus, Pilcrow, Quote, Redo2, Scale, Strikethrough, Table2, Undo2 } from "lucide-react";
import { editorToMarkdown, markdownToEditorHtml, type CalloutVariant, NOTE_COLOURS, type NoteColour, type TableStyle } from "../../lib/noteFormat";

export type RichEditorHandle = { getMarkdown: () => string; focus: (where?: "start" | "end") => void; setMarkdown: (value: string) => void };

type Props = {
  value: string;
  resetKey: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  onEscape?: () => void;
  onSave?: () => void;
  onDone?: () => void;
  ariaLabel?: string;
  extraTools?: ReactNode;
  compactToolbar?: boolean;
};

type BlockKind = "p" | "h2" | "h3" | "h4" | "ul" | "ol" | "quote" | CalloutVariant;
const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl";

function exec(command: string, value?: string) {
  // execCommand is the only way to keep the browser's native undo stack intact
  // for contentEditable; it remains fully supported in Chromium/WebView2/WebKit.
  return document.execCommand(command, false, value);
}

/**
 * Keep an empty paragraph after a final list, quotation, example block or divider;
 * otherwise there is nowhere to put the caret to continue writing below it.
 */
function ensureTrailingParagraph(root: HTMLElement | null) {
  if (!root) return;
  const last = root.lastElementChild;
  if (!last || !/^(P|DIV|H[1-6])$/.test(last.tagName) || last.hasAttribute("data-callout")) {
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    root.appendChild(paragraph);
  }
}

const BLOCK_TAG = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR|PRE|TABLE)$/;

/** Folding is editor-only presentation: hidden content remains in the DOM and saves. */
function updateFolds(root: HTMLElement) {
  let foldedLevel: number | null = null;
  for (const child of Array.from(root.children) as HTMLElement[]) {
    const level = /^H[234]$/.test(child.tagName) ? Number(child.tagName[1]) : null;
    if (level !== null && foldedLevel !== null && level <= foldedLevel) foldedLevel = null;
    const hidden = foldedLevel !== null;
    child.toggleAttribute("data-fold-hidden", hidden);
    if (!hidden && level !== null && child.dataset.folded === "true") foldedLevel = level;
  }
}

type SavedCaret = { node: Node; offset: number } | null;
function saveCaret(): SavedCaret {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return { node: range.startContainer, offset: range.startOffset };
}
function restoreCaret(saved: SavedCaret) {
  if (!saved || !saved.node.isConnected) return;
  const selection = window.getSelection();
  const range = document.createRange();
  try { range.setStart(saved.node, Math.min(saved.offset, saved.node.nodeType === Node.TEXT_NODE ? (saved.node.textContent ?? "").length : saved.node.childNodes.length)); }
  catch { return; }
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
function caretInto(element: Element, atEnd = false) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  range.collapse(!atEnd);
  selection?.removeAllRanges();
  selection?.addRange(range);
}
/**
 * Chromium sometimes nests lists or paragraphs inside a <p> (e.g. after
 * insertUnorderedList). That is invalid HTML and breaks later edits and pastes,
 * so such blocks are lifted out to sit beside the paragraph instead.
 */
function hoistNestedBlocks(root: HTMLElement) {
  let changed = false;
  for (const paragraph of Array.from(root.querySelectorAll("p, h1, h2, h3, h4, h5, h6"))) {
    if (!Array.from(paragraph.children).some((child) => BLOCK_TAG.test(child.tagName))) continue;
    changed = true;
    const parent = paragraph.parentNode;
    if (!parent) continue;
    let segment: HTMLElement | null = null;
    for (const child of Array.from(paragraph.childNodes)) {
      if (child instanceof HTMLElement && BLOCK_TAG.test(child.tagName)) {
        segment = null;
        parent.insertBefore(child, paragraph);
        continue;
      }
      if (!segment) {
        if (child.nodeType === Node.TEXT_NODE && !(child.textContent ?? "").replace(/\u200b/g, "").trim()) continue;
        segment = document.createElement(paragraph.tagName.toLowerCase());
        parent.insertBefore(segment, paragraph);
      }
      segment.appendChild(child);
    }
    paragraph.remove();
  }
  return changed;
}

/** A quotation/callout always holds paragraphs, never bare text, so Enter adds a line inside it. */
function normaliseQuote(quote: HTMLElement) {
  let run: Node[] = [];
  const flush = (before: Node | null) => {
    if (!run.length) return;
    const paragraph = document.createElement("p");
    quote.insertBefore(paragraph, before);
    run.forEach((node) => paragraph.appendChild(node));
    run = [];
  };
  for (const child of Array.from(quote.childNodes)) {
    if (child instanceof HTMLElement && BLOCK_TAG.test(child.tagName)) flush(child);
    else run.push(child);
  }
  flush(null);
  if (!quote.firstChild) quote.appendChild(Object.assign(document.createElement("p"), { innerHTML: "<br>" }));
}

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { value, resetKey, onChange, placeholder, autoFocus, onEscape, onSave, onDone, ariaLabel = "Document text", extraTools, compactToolbar = false }, handleRef,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const emitTimer = useRef<number | null>(null);
  const [source, setSource] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tableOpen, setTableOpen] = useState(false);
  // Palettes are temporary controls: dismiss on Escape or a click elsewhere,
  // rather than leaving attention-demanding overlays on screen.
  useEffect(() => {
    if (!paletteOpen && !tableOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      setPaletteOpen(false);
      setTableOpen(false);
    };
    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".nb-colour-anchor, .nb-table-anchor")) return;
      setPaletteOpen(false);
      setTableOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape, true);
    document.addEventListener("pointerdown", closeOnOutside, true);
    return () => {
      window.removeEventListener("keydown", closeOnEscape, true);
      document.removeEventListener("pointerdown", closeOnOutside, true);
    };
  }, [paletteOpen, tableOpen]);
  const [colourHint, setColourHint] = useState("");
  const [sourceText, setSourceText] = useState(value);
  const [empty, setEmpty] = useState(!value.trim());
  const [active, setActive] = useState<{ block: BlockKind; bold: boolean; italic: boolean; mark: boolean }>({ block: "p", bold: false, italic: false, mark: false });
  const latest = useRef(value);
  // Preserve selections while tapping the toolbar (especially on touch screens).
  const savedSelection = useRef<Range | null>(null);

  const readMarkdown = useCallback(() => {
    if (source) return sourceText;
    const root = rootRef.current;
    return root ? editorToMarkdown(root) : latest.current;
  }, [source, sourceText]);

  const emit = useCallback(() => {
    if (emitTimer.current) window.clearTimeout(emitTimer.current);
    emitTimer.current = window.setTimeout(() => {
      emitTimer.current = null;
      const next = readMarkdown();
      latest.current = next;
      setEmpty(!next.trim());
      onChange(next);
    }, 120);
  }, [onChange, readMarkdown]);

  const placeCaret = useCallback((where: "start" | "end") => {
    const root = rootRef.current;
    if (!root) return;
    root.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.selectNodeContents(root);
    range.collapse(where === "start");
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  useImperativeHandle(handleRef, () => ({
    getMarkdown: () => {
      if (emitTimer.current) { window.clearTimeout(emitTimer.current); emitTimer.current = null; }
      const next = readMarkdown();
      latest.current = next;
      return next;
    },
    focus: (where = "end") => { if (source) sourceRef.current?.focus(); else placeCaret(where); },
    setMarkdown: (next: string) => {
      latest.current = next;
      setSourceText(next);
      if (rootRef.current) { rootRef.current.innerHTML = markdownToEditorHtml(next); ensureTrailingParagraph(rootRef.current); }
      setEmpty(!next.trim());
      onChange(next);
    },
  }), [onChange, placeCaret, readMarkdown, source]);

  // Initialise once per document; afterwards the DOM is owned by the browser.
  useEffect(() => {
    latest.current = value;
    savedSelection.current = null;
    setSourceText(value);
    setEmpty(!value.trim());
    if (rootRef.current) { rootRef.current.innerHTML = markdownToEditorHtml(value); ensureTrailingParagraph(rootRef.current); updateFolds(rootRef.current); }
    try { exec("defaultParagraphSeparator", "p"); exec("styleWithCSS", "false"); } catch { /* optional */ }
    if (autoFocus) window.requestAnimationFrame(() => placeCaret(value.trim() ? "end" : "start"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  useEffect(() => () => { if (emitTimer.current) window.clearTimeout(emitTimer.current); }, []);

  const currentBlock = useCallback((): HTMLElement | null => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return null;
    let node: Node | null = selection.getRangeAt(0).startContainer;
    while (node && node !== root) {
      if (node instanceof HTMLElement && /^(P|DIV|H[1-6]|LI)$/.test(node.tagName)) return node;
      node = node.parentNode;
    }
    return null;
  }, []);

  const closest = useCallback((tag: string): HTMLElement | null => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount) return null;
    let node: Node | null = selection.getRangeAt(0).startContainer;
    while (node && node !== root) {
      if (node instanceof HTMLElement && node.tagName === tag) return node;
      node = node.parentNode;
    }
    return null;
  }, []);

  const refreshActive = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount || !root.contains(selection.anchorNode)) return;
    const quote = closest("BLOCKQUOTE");
    const variant = quote?.getAttribute("data-callout") as CalloutVariant | null;
    const block: BlockKind = closest("UL") && !closest("OL") ? "ul"
      : closest("OL") ? "ol"
        : quote ? (variant ?? "quote")
          : closest("H2") || closest("H1") ? "h2"
            : closest("H3") ? "h3" : closest("H4") ? "h4" : "p";
    let bold = false; let italic = false;
    try { bold = document.queryCommandState("bold"); italic = document.queryCommandState("italic"); } catch { /* optional */ }
    setActive({ block, bold, italic, mark: Boolean(closest("MARK")) });
  }, [closest]);

  useEffect(() => {
    const onSelection = () => {
      const root = rootRef.current;
      const selection = window.getSelection();
      if (root && selection?.rangeCount) {
        const range = selection.getRangeAt(0);
        if (root.contains(range.startContainer) && root.contains(range.endContainer) &&
            (!selection.isCollapsed || document.activeElement === root)) {
          savedSelection.current = range.cloneRange();
        }
      }
      refreshActive();
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [refreshActive]);

  const run = useCallback((action: () => void) => {
    if (source) return;
    const root = rootRef.current;
    if (!root) return;
    const selection = window.getSelection();
    const current = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!current || !root.contains(current.startContainer) || !root.contains(current.endContainer)) {
      const saved = savedSelection.current;
      if (saved && saved.startContainer.isConnected && saved.endContainer.isConnected &&
          root.contains(saved.startContainer) && root.contains(saved.endContainer) && selection) {
        root.focus({ preventScroll: true });
        selection.removeAllRanges();
        selection.addRange(saved.cloneRange());
      } else placeCaret("end");
    }
    action();
    const caret = saveCaret();
    if (hoistNestedBlocks(root)) restoreCaret(caret);
    ensureTrailingParagraph(root);
    updateFolds(root);
    const nextSelection = window.getSelection();
    if (nextSelection?.rangeCount && root.contains(nextSelection.anchorNode))
      savedSelection.current = nextSelection.getRangeAt(0).cloneRange();
    emit();
    refreshActive();
  }, [emit, placeCaret, refreshActive, source]);

  const setBlock = useCallback((kind: BlockKind) => run(() => {
    const quote = closest("BLOCKQUOTE");
    const list = closest("UL") ?? closest("OL");
    if (kind === "ul" || kind === "ol") {
      exec(kind === "ul" ? "insertUnorderedList" : "insertOrderedList");
      return;
    }
    if (list) exec(list.tagName === "UL" ? "insertUnorderedList" : "insertOrderedList");
    if (kind === "p" || kind === "h2" || kind === "h3" || kind === "h4") {
      exec("formatBlock", kind === "p" ? "<p>" : `<${kind}>`);
      return;
    }
    // Quotations and callouts wrap the current block. Done on the DOM directly:
    // execCommand's blockquote handling turns the quote itself into the line,
    // which makes every Enter start a new, separate block.
    const variant = kind === "quote" ? null : kind;
    const saved = saveCaret();
    if (quote) {
      const currentVariant = quote.getAttribute("data-callout");
      if ((currentVariant ?? null) === variant) {
        normaliseQuote(quote);
        const parent = quote.parentNode;
        while (quote.firstChild) parent?.insertBefore(quote.firstChild, quote);
        quote.remove();
      } else if (variant) quote.setAttribute("data-callout", variant);
      else quote.removeAttribute("data-callout");
      restoreCaret(saved);
      return;
    }
    let block = currentBlock();
    const root = rootRef.current;
    if (!block || !root) return;
    if (block.tagName !== "P") {
      exec("formatBlock", "<p>");
      block = currentBlock();
      if (!block) return;
    }
    const wrapper = document.createElement("blockquote");
    if (variant) wrapper.setAttribute("data-callout", variant);
    block.parentNode?.insertBefore(wrapper, block);
    wrapper.appendChild(block);
    restoreCaret(saveCaret() ?? saved);
    if (!wrapper.contains(window.getSelection()?.anchorNode ?? null)) caretInto(block, true);
  }), [closest, currentBlock, run]);

  /**
   * Split the current inline selection into before / selected / after fragments.
   * Cloning the entire ancestor chain keeps bold, italic and other inline styles
   * when a selection starts inside a <mark> or a coloured <span>.
   */
  const selectedInline = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    if (!root || !selection?.rangeCount || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return null;

    const blocks = Array.from(root.querySelectorAll<HTMLElement>("p,h1,h2,h3,li,td,th"))
      .filter((block) => range.intersectsNode(block))
      .filter((block, _, all) => !all.some((other) => other !== block && block.contains(other)));
    if (blocks.length !== 1) return null;
    const block = blocks[0];

    // Selecting a whole paragraph may put the Range endpoints outside it.
    // Work inside the paragraph to avoid accidentally replacing the next line.
    if (!block.contains(range.startContainer) || !block.contains(range.endContainer)) {
      if (selection.toString().trim() !== (block.textContent ?? "").trim()) return null;
      range.selectNodeContents(block);
    }
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(range.startContainer, range.startOffset);
    const start = before.toString().length;
    const length = range.toString().length;
    if (!length || !range.toString().trim()) return null;
    const end = start + length;

    const pieces: [DocumentFragment, DocumentFragment, DocumentFragment] = [
      document.createDocumentFragment(), document.createDocumentFragment(), document.createDocumentFragment(),
    ];
    let position = 0;
    const split = (node: Node): [Node | null, Node | null, Node | null] => {
      if (node.nodeType === Node.TEXT_NODE) {
        const value = node.textContent ?? "";
        const begin = position;
        position += value.length;
        const texts = [
          value.slice(0, Math.max(0, Math.min(value.length, start - begin))),
          value.slice(Math.max(0, start - begin), Math.max(0, Math.min(value.length, end - begin))),
          value.slice(Math.max(0, Math.min(value.length, end - begin))),
        ];
        return texts.map((part) => part ? document.createTextNode(part) : null) as [Node | null, Node | null, Node | null];
      }
      if (!(node instanceof Element)) return [null, null, null];
      if (!node.childNodes.length) {
        const result: [Node | null, Node | null, Node | null] = [null, null, null];
        result[position < start ? 0 : position >= end ? 2 : 1] = node.cloneNode(true);
        return result;
      }
      const copies = [node.cloneNode(false), node.cloneNode(false), node.cloneNode(false)];
      for (const child of Array.from(node.childNodes)) {
        const sections = split(child);
        sections.forEach((part, index) => { if (part) copies[index].appendChild(part); });
      }
      return copies.map((copy) => copy.hasChildNodes() ? copy : null) as [Node | null, Node | null, Node | null];
    };
    for (const child of Array.from(block.childNodes)) {
      split(child).forEach((part, index) => { if (part) pieces[index].appendChild(part); });
    }
    return { block, pieces, start, end };
  }, []);

  const stripInline = (fragment: DocumentFragment, mode: "mark" | "ink" | "all") => {
    const selector = mode === "mark" ? "mark" : mode === "ink" ? "span[data-ink]" : "mark,span[data-ink]";
    for (const wrapper of Array.from(fragment.querySelectorAll<HTMLElement>(selector)).reverse()) {
      wrapper.replaceWith(...Array.from(wrapper.childNodes));
    }
  };

  const restoreInlineSelection = (block: HTMLElement, start: number, end: number) => {
    if (!block.isConnected) return;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
    let position = 0;
    let first: { node: Node; offset: number } | null = null;
    let last: { node: Node; offset: number } | null = null;
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const length = (node.textContent ?? "").length;
      if (!first && start <= position + length) first = { node, offset: Math.max(0, start - position) };
      if (!last && end <= position + length) last = { node, offset: Math.max(0, end - position) };
      position += length;
      if (first && last) break;
    }
    if (!first || !last) return;
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(first.node, first.offset);
    range.setEnd(last.node, last.offset);
    selection?.removeAllRanges();
    selection?.addRange(range);
  };

  /** Transform only the selected text, preserving unrelated inline formatting. */
  const formatSelection = useCallback((mode: "toggle-mark" | "ink" | "tone" | "clear", colour?: NoteColour) => {
    const selected = selectedInline();
    if (!selected) return false;
    const { block, pieces, start, end } = selected;
    const middle = pieces[1];
    const hasMark = Boolean(middle.querySelector("mark"));
    if (mode === "toggle-mark") {
      if (hasMark) stripInline(middle, "mark");
      else {
        const mark = document.createElement("mark");
        mark.append(...Array.from(middle.childNodes));
        middle.appendChild(mark);
      }
    } else if (mode === "clear") {
      stripInline(middle, "all");
    } else {
      stripInline(middle, mode === "ink" ? "ink" : "mark");
      const wrapper = document.createElement(mode === "ink" ? "span" : "mark");
      if (mode === "ink") wrapper.setAttribute("data-ink", colour ?? "");
      else wrapper.setAttribute("data-tone", colour ?? "");
      wrapper.append(...Array.from(middle.childNodes));
      middle.appendChild(wrapper);
    }
    const html = pieces.map((part) => {
      const holder = document.createElement("div");
      holder.appendChild(part);
      return holder.innerHTML;
    }).join("");
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(block);
    selection?.removeAllRanges();
    selection?.addRange(range);
    // Chromium can treat a same-text insertion as a no-op and leave <mark> intact.
    // A neutral wrapper forces it to replace the styled nodes while retaining Undo.
    const applied = exec("insertHTML", `<span>${html}</span>`);
    if (applied) restoreInlineSelection(block, start, end);
    return applied;
  }, [selectedInline]);

  const toggleMark = useCallback(() => run(() => {
    // A collapsed caret inside a highlight removes that highlight too.
    const selection = window.getSelection();
    if (selection?.isCollapsed) {
      const mark = closest("MARK");
      if (!mark) return;
      const range = document.createRange();
      range.selectNodeContents(mark);
      selection.removeAllRanges();
      selection.addRange(range);
    }
    formatSelection("toggle-mark");
  }), [closest, formatSelection, run]);

  /** Apply, replace or remove colour without discarding bold/italic formatting. */
  const applyColour = useCallback((mode: "ink" | "tone" | "clear", colour?: NoteColour) => {
    let applied = false;
    run(() => { applied = formatSelection(mode, colour); });
    if (applied) { setPaletteOpen(false); setColourHint(""); }
    else setColourHint("Select a word or one complete line in the note first.");
  }, [formatSelection, run]);

  /** Insert a real table (or restyle the table under the caret) without
   * converting it into plain-text pipes when the note is saved. */
  const insertTable = useCallback((style: TableStyle, columns: number) => {
    run(() => {
      const existing = closest("TABLE");
      if (existing) { existing.setAttribute("data-table-style", style); return; }
      const headers = Array.from({ length: columns }, (_, i) => i === 0 ? "Heading" : "Column " + i);
      const row = Array.from({ length: columns }, () => " ");
      const markdown = (style === "plain" ? "" : "{table:" + style + "}\n") +
        "| " + headers.join(" | ") + " |\n" +
        "| " + headers.map(() => "---").join(" | ") + " |\n" +
        Array.from({ length: 3 }, () => "| " + row.join(" | ") + " |").join("\n");
      exec("insertHTML", markdownToEditorHtml(markdown));
      const root = rootRef.current;
      const tables = root?.querySelectorAll("table");
      const inserted = tables?.[tables.length - 1];
      const first = inserted?.querySelector("th,td");
      if (first) caretInto(first);
    });
    setTableOpen(false);
  }, [closest, run]);

  const foldAll = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const headings = Array.from(root.children).filter((node) => /^H[234]$/.test(node.tagName)) as HTMLElement[];
    if (!headings.length) return;
    const shouldFold = headings.some((heading) => heading.dataset.folded !== "true");
    headings.forEach((heading) => { heading.dataset.folded = String(shouldFold); });
    updateFolds(root);
  }, []);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (composing.current || event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") {
      event.preventDefault();
      if (paletteOpen || tableOpen) { setPaletteOpen(false); setTableOpen(false); return; }
      onEscape?.();
      return;
    }
    // Windows AltGr is reported as Ctrl+Alt by WebView2. Never intercept
    // characters such as } and ² as formatting shortcuts.
    if (event.nativeEvent.getModifierState("AltGraph")) return;
    if (mod && event.key === "Enter") { event.preventDefault(); onDone?.(); return; }
    if (mod && !event.shiftKey && event.code === "KeyS") { event.preventDefault(); onSave?.(); return; }
    if (mod && event.shiftKey && !event.altKey && event.code === "Digit1") { event.preventDefault(); setBlock("h2"); return; }
    if (mod && event.shiftKey && !event.altKey && event.code === "Digit2") { event.preventDefault(); setBlock("h3"); return; }
    if (mod && event.shiftKey && !event.altKey && event.code === "Digit3") { event.preventDefault(); setBlock("h4"); return; }
    if (mod && event.shiftKey && !event.altKey && event.code === "Digit0") { event.preventDefault(); setBlock("p"); return; }
    if (mod && event.shiftKey && event.code === "Digit8") { event.preventDefault(); setBlock("ul"); return; }
    if (mod && event.shiftKey && event.code === "Digit7") { event.preventDefault(); setBlock("ol"); return; }
    if (mod && event.shiftKey && event.code === "KeyH") { event.preventDefault(); toggleMark(); return; }
    if (mod && !event.shiftKey && (event.code === "KeyB" || event.code === "KeyI")) {
      event.preventDefault(); run(() => exec(event.code === "KeyB" ? "bold" : "italic")); return;
    }
    if (event.key === "Tab" && (closest("TD") || closest("TH"))) {
      event.preventDefault();
      run(() => {
        const cell = closest("TD") ?? closest("TH");
        const table = closest("TABLE");
        if (!cell || !table) return;
        const cells = Array.from(table.querySelectorAll("th,td"));
        const position = cells.indexOf(cell);
        let next = cells[position + (event.shiftKey ? -1 : 1)];
        if (!next && !event.shiftKey) {
          const body = table.querySelector("tbody") ?? table.appendChild(document.createElement("tbody"));
          const count = table.querySelector("tr")?.children.length ?? 3;
          const row = document.createElement("tr");
          for (let n = 0; n < count; n++) {
            const td = document.createElement("td");
            td.appendChild(document.createElement("br"));
            row.appendChild(td);
          }
          body.appendChild(row);
          next = row.firstElementChild as HTMLElement;
        }
        if (next) caretInto(next);
      });
      return;
    }
    if (event.key === "Tab" && (closest("LI"))) {
      event.preventDefault(); run(() => exec(event.shiftKey ? "outdent" : "indent")); return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      const block = currentBlock();
      const quote = closest("BLOCKQUOTE");
      if (quote && block && block.parentElement === quote && !block.textContent?.trim() && block === quote.lastElementChild) {
        // An empty last line inside a quote or callout ends it, as in most editors.
        event.preventDefault();
        run(() => {
          const paragraph = document.createElement("p");
          paragraph.appendChild(document.createElement("br"));
          quote.after(paragraph);
          block.remove();
          if (!quote.firstElementChild) quote.remove();
          caretInto(paragraph);
        });
        return;
      }
      if (block && /^H[1-6]$/.test(block.tagName)) {
        const selection = window.getSelection();
        const atEnd = selection?.rangeCount && selection.isCollapsed && (() => {
          const range = document.createRange();
          range.selectNodeContents(block);
          range.setStart(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
          return !range.toString().length;
        })();
        if (atEnd) { event.preventDefault(); run(() => { exec("insertParagraph"); exec("formatBlock", "<p>"); }); return; }
      }
      if (block && block.textContent?.trim() === "---" && !closest("LI")) {
        event.preventDefault();
        run(() => {
          const selection = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(block);
          selection?.removeAllRanges(); selection?.addRange(range);
          exec("delete");
          exec("insertHorizontalRule");
        });
        return;
      }
    }
  }

  function handleInput(event: React.FormEvent<HTMLDivElement>) {
    const native = event.nativeEvent as InputEvent;
    if (!composing.current && native.inputType === "insertText" && native.data === " ") applyMarkdownShortcut();
    const root = rootRef.current;
    if (root && !root.firstElementChild) root.innerHTML = "<p><br></p>";
    if (root && !composing.current) {
      const caret = saveCaret();
      if (hoistNestedBlocks(root)) restoreCaret(caret);
      ensureTrailingParagraph(root);
      updateFolds(root);
    }
    emit();
  }

  function applyMarkdownShortcut() {
    const block = currentBlock();
    const selection = window.getSelection();
    if (!block || !selection?.rangeCount || !selection.isCollapsed) return;
    const before = document.createRange();
    before.selectNodeContents(block);
    before.setEnd(selection.getRangeAt(0).endContainer, selection.getRangeAt(0).endOffset);
    const typed = before.toString().replace(/ /g, " ");
    const map: Record<string, BlockKind> = { "# ": "h2", "## ": "h3", "### ": "h4", "- ": "ul", "* ": "ul", "1. ": "ol", "1) ": "ol", "> ": "quote" };
    const kind = map[typed];
    if (!kind || closest("LI") || (kind === "quote" && closest("BLOCKQUOTE"))) return;
    selection.removeAllRanges();
    selection.addRange(before);
    exec("delete");
    setBlock(kind);
  }

  function handlePaste(event: React.ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
    if (!text) return;
    run(() => {
      if (!text.includes("\n")) {
        // Single-line Markdown deserves the same treatment as multi-line
        // paste. Insert inline content inside the current paragraph, without
        // nesting a <p> in another paragraph.
        const holder = document.createElement("div");
        holder.innerHTML = markdownToEditorHtml(text);
        const only = holder.firstElementChild;
        const html = holder.children.length === 1 && only?.tagName === "P"
          ? only.innerHTML : holder.innerHTML;
        exec("insertHTML", html);
        return;
      }
      // An empty line can still carry inline formatting (e.g. italics from the line
      // above); pasting blocks into it would flatten lists, so clear it first.
      const block = currentBlock();
      if (block && !block.textContent?.trim() && block.querySelector("em,i,strong,b,mark,s,span")) {
        block.innerHTML = "<br>";
        caretInto(block);
      }
      exec("insertHTML", markdownToEditorHtml(text));
    });
  }

  function toggleSource() {
    setPaletteOpen(false);
    if (source) {
      if (rootRef.current) { rootRef.current.innerHTML = markdownToEditorHtml(sourceText); ensureTrailingParagraph(rootRef.current); updateFolds(rootRef.current); }
      setSource(false);
      window.requestAnimationFrame(() => placeCaret("end"));
    } else {
      const current = readMarkdown();
      setSourceText(current);
      setSource(true);
      window.requestAnimationFrame(() => sourceRef.current?.focus());
    }
  }

  const tool = (label: string, shortcut: string, icon: ReactNode, onPress: () => void, pressed = false) =>
    <button type="button" className={pressed ? "is-active" : ""} aria-label={label} aria-pressed={pressed}
      title={shortcut ? `${label} (${shortcut})` : label} disabled={source}
      onMouseDown={(event) => event.preventDefault()} onClick={onPress}>{icon}</button>;

  return <div className={`nb-editor-shell ${source ? "is-source" : ""} ${compactToolbar ? "is-compact-toolbar" : ""}`}>
    <div className="nb-toolbar" role="toolbar" aria-label="Formatting">
      {!compactToolbar ? <div className="nb-toolbar-group">
        {tool("Body text", "", <Pilcrow size={15} />, () => setBlock("p"), active.block === "p")}
        {tool("Heading", `${MOD}+Shift+1`, <Heading1 size={15} />, () => setBlock(active.block === "h2" ? "p" : "h2"), active.block === "h2")}
        {tool("Subheading", `${MOD}+Shift+2`, <Heading2 size={15} />, () => setBlock(active.block === "h3" ? "p" : "h3"), active.block === "h3")}
        {tool("Small heading", `${MOD}+Shift+3`, <Heading2 size={13} />, () => setBlock(active.block === "h4" ? "p" : "h4"), active.block === "h4")}
      </div> : null}
      <div className="nb-toolbar-group">
        {tool("Bold", `${MOD}+B`, <Bold size={15} />, () => run(() => exec("bold")), active.bold)}
        {tool("Italic", `${MOD}+I`, <Italic size={15} />, () => run(() => exec("italic")), active.italic)}
        {!compactToolbar ? tool("Strikethrough", "", <Strikethrough size={15} />, () => run(() => exec("strikeThrough"))) : null}
        {!compactToolbar ? tool("Highlight", `${MOD}+Shift+H`, <Highlighter size={15} />, toggleMark, active.mark) : null}
        <div className="nb-colour-anchor">
          <button type="button" aria-label="Text and highlight colours" aria-expanded={paletteOpen} title="Text and highlight colours" disabled={source}
            className={paletteOpen ? "is-active" : ""}
            onMouseDown={(event) => event.preventDefault()} onClick={() => { setColourHint(""); setTableOpen(false); setPaletteOpen((open) => !open); }}><Palette size={15}/></button>
          {paletteOpen && !source ? <div className="nb-colour-popover" aria-label="Colours">
            <div className="nb-colour-row"><span>Text</span>{NOTE_COLOURS.map((colour) =>
              <button key={colour} type="button" className="nb-colour-swatch" data-swatch={colour}
                aria-label={`${colour} text`} title={`${colour} text`}
                onMouseDown={(event) => event.preventDefault()} onClick={() => applyColour("ink", colour)}/>)}</div>
            <div className="nb-colour-row"><span>Highlight</span>{NOTE_COLOURS.map((colour) =>
              <button key={colour} type="button" className="nb-colour-swatch" data-swatch={colour}
                aria-label={`${colour} highlight`} title={`${colour} highlight`}
                onMouseDown={(event) => event.preventDefault()} onClick={() => applyColour("tone", colour)}/>)}</div>
            <button type="button" className="nb-colour-clear" onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyColour("clear")}>Remove highlight / text colour</button>
            <span className="nb-colour-help" role="status">{colourHint || "Select a phrase first"}</span>
          </div> : null}
        </div>
      </div>
      {!compactToolbar ? <div className="nb-toolbar-group">
        {tool("Bulleted list", `${MOD}+Shift+8`, <List size={15} />, () => setBlock("ul"), active.block === "ul")}
        {tool("Numbered list", `${MOD}+Shift+7`, <ListOrdered size={15} />, () => setBlock("ol"), active.block === "ol")}
        {tool("Quotation", "", <Quote size={15} />, () => setBlock("quote"), active.block === "quote")}
      </div> : null}
      {!compactToolbar ? <div className="nb-toolbar-group">
        <div className="nb-table-anchor">
          <button type="button" aria-label="Insert table" aria-expanded={tableOpen}
            title="Insert or style a table" disabled={source} className={tableOpen ? "is-active" : ""}
            onMouseDown={(event) => event.preventDefault()} onClick={() => { setPaletteOpen(false); setTableOpen((open) => !open); }}>
            <Table2 size={15}/>
          </button>
          {tableOpen && !source ? <div className="nb-table-popover" aria-label="Table layouts">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertTable("plain", 3)}>
              <span>Simple <small>3 columns · clean grid</small></span>
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertTable("striped", 4)}>
              <span>Comparison <small>4 columns · alternating rows</small></span>
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => insertTable("study", 5)}>
              <span>Study reference <small>5 columns · highlighted labels</small></span>
            </button>
          </div> : null}
        </div>
      </div> : null}
      <div className="nb-toolbar-group nb-toolbar-blocks" hidden={compactToolbar}>
        <button type="button" className={active.block === "example" ? "is-active" : ""} disabled={source} title="Example block — sentence, reading, translation on separate lines"
          onMouseDown={(event) => event.preventDefault()} onClick={() => setBlock("example")}><MessageSquareText size={14} /><span>Example</span></button>
        <button type="button" className={active.block === "rule" ? "is-active" : ""} disabled={source} title="Rule block — a grammar rule or pattern"
          onMouseDown={(event) => event.preventDefault()} onClick={() => setBlock("rule")}><Scale size={14} /><span>Rule</span></button>
        <button type="button" className={active.block === "correction" ? "is-active" : ""} disabled={source} title="Correction block — the right form next to a common error"
          onMouseDown={(event) => event.preventDefault()} onClick={() => setBlock("correction")}><CheckCheck size={14} /><span>Correction</span></button>
        <button type="button" className={active.block === "tip" ? "is-active" : ""} disabled={source} title="Tip block — a hint or memory aid"
          onMouseDown={(event) => event.preventDefault()} onClick={() => setBlock("tip")}><Lightbulb size={14} /><span>Tip</span></button>
        {tool("Divider", "", <Minus size={15} />, () => run(() => exec("insertHorizontalRule")))}
        {tool("Collapse or expand all headings", "", <ChevronsUpDown size={15}/>, foldAll)}
      </div>
      {!compactToolbar ? <span className="nb-toolbar-spacer" /> : null}
      {!compactToolbar ? <div className="nb-toolbar-group">
        {tool("Undo", `${MOD}+Z`, <Undo2 size={15} />, () => run(() => exec("undo")))}
        {tool("Redo", `${MOD}+Shift+Z`, <Redo2 size={15} />, () => run(() => exec("redo")))}
        <button type="button" className={source ? "is-active" : ""} aria-pressed={source} title="Edit the plain text source"
          onMouseDown={(event) => event.preventDefault()} onClick={toggleSource}><Code2 size={15} /></button>
      </div> : null}
      {extraTools}
    </div>
    <div className="nb-editor-surface">
      {empty && !source && placeholder ? <div className="nb-placeholder" aria-hidden="true">{placeholder}</div> : null}
      <div ref={rootRef} className="nb-prose nb-editor" contentEditable={!source} suppressContentEditableWarning
        role="textbox" aria-multiline="true" aria-label={ariaLabel} spellCheck
        hidden={source}
        onInput={handleInput} onKeyDown={handleKeyDown} onPaste={handlePaste}
        onMouseDown={(event) => {
          const root = rootRef.current;
          const target = event.target;
          if (!root || !(target instanceof Element)) return;
          const heading = target.closest("h2,h3,h4") as HTMLElement | null;
          if (!heading || heading.parentElement !== root) return;
          // The arrow occupies the first 22px; clicking the words still edits the heading.
          const offset = event.clientX - heading.getBoundingClientRect().left;
          if (offset < -30 || offset > 0) return;
          event.preventDefault();
          heading.dataset.folded = String(heading.dataset.folded !== "true");
          updateFolds(root);
        }}
        onDrop={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; emit(); }} />
      {source ? <textarea ref={sourceRef} className="nb-source" value={sourceText} aria-label="Plain text source"
        spellCheck={false}
        onChange={(event) => { setSourceText(event.target.value); latest.current = event.target.value; setEmpty(!event.target.value.trim()); onChange(event.target.value); }}
        onKeyDown={(event) => {
          const mod = event.ctrlKey || event.metaKey;
          if (event.key === "Escape") {
            event.preventDefault();
            if (paletteOpen || tableOpen) { setPaletteOpen(false); setTableOpen(false); }
            else onEscape?.();
          }
          else if (mod && event.key === "Enter") { event.preventDefault(); onDone?.(); }
          else if (mod && event.code === "KeyS") { event.preventDefault(); onSave?.(); }
        }} /> : null}
    </div>
  </div>;
});
