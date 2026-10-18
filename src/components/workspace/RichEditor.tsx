import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { Bold, CheckCheck, Code2, Heading1, Heading2, Highlighter, Italic, Lightbulb, List, ListOrdered, MessageSquareText, Minus, Pilcrow, Quote, Redo2, Scale, Strikethrough, Undo2 } from "lucide-react";
import { editorToMarkdown, markdownToEditorHtml, type CalloutVariant } from "../../lib/noteFormat";

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
};

type BlockKind = "p" | "h2" | "h3" | "ul" | "ol" | "quote" | CalloutVariant;
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

const BLOCK_TAG = /^(P|DIV|H[1-6]|UL|OL|BLOCKQUOTE|HR|PRE)$/;

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

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export const RichEditor = forwardRef<RichEditorHandle, Props>(function RichEditor(
  { value, resetKey, onChange, placeholder, autoFocus, onEscape, onSave, onDone, ariaLabel = "Document text", extraTools }, handleRef,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const sourceRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const emitTimer = useRef<number | null>(null);
  const [source, setSource] = useState(false);
  const [sourceText, setSourceText] = useState(value);
  const [empty, setEmpty] = useState(!value.trim());
  const [active, setActive] = useState<{ block: BlockKind; bold: boolean; italic: boolean; mark: boolean }>({ block: "p", bold: false, italic: false, mark: false });
  const latest = useRef(value);

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
    setSourceText(value);
    setEmpty(!value.trim());
    if (rootRef.current) { rootRef.current.innerHTML = markdownToEditorHtml(value); ensureTrailingParagraph(rootRef.current); }
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
            : closest("H3") ? "h3" : "p";
    let bold = false; let italic = false;
    try { bold = document.queryCommandState("bold"); italic = document.queryCommandState("italic"); } catch { /* optional */ }
    setActive({ block, bold, italic, mark: Boolean(closest("MARK")) });
  }, [closest]);

  useEffect(() => {
    const onSelection = () => refreshActive();
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [refreshActive]);

  const run = useCallback((action: () => void) => {
    if (source) return;
    const root = rootRef.current;
    if (!root) return;
    if (!root.contains(window.getSelection()?.anchorNode ?? null)) placeCaret("end");
    action();
    const caret = saveCaret();
    if (hoistNestedBlocks(root)) restoreCaret(caret);
    ensureTrailingParagraph(root);
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
    if (kind === "p" || kind === "h2" || kind === "h3") {
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

  const toggleMark = useCallback(() => run(() => {
    const mark = closest("MARK");
    const selection = window.getSelection();
    if (mark && selection) {
      const range = document.createRange();
      range.selectNodeContents(mark);
      selection.removeAllRanges();
      selection.addRange(range);
      exec("insertHTML", mark.innerHTML || escapeHtml(mark.textContent ?? ""));
      return;
    }
    const text = selection?.toString() ?? "";
    if (!text) return;
    exec("insertHTML", `<mark>${escapeHtml(text)}</mark>`);
  }), [closest, run]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (composing.current || event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") { event.preventDefault(); onEscape?.(); return; }
    if (mod && event.key === "Enter") { event.preventDefault(); onDone?.(); return; }
    if (mod && !event.shiftKey && event.code === "KeyS") { event.preventDefault(); onSave?.(); return; }
    if (mod && event.altKey && event.code === "Digit1") { event.preventDefault(); setBlock("h2"); return; }
    if (mod && event.altKey && event.code === "Digit2") { event.preventDefault(); setBlock("h3"); return; }
    if (mod && event.altKey && event.code === "Digit0") { event.preventDefault(); setBlock("p"); return; }
    if (mod && event.shiftKey && event.code === "Digit8") { event.preventDefault(); setBlock("ul"); return; }
    if (mod && event.shiftKey && event.code === "Digit7") { event.preventDefault(); setBlock("ol"); return; }
    if (mod && event.shiftKey && event.code === "KeyH") { event.preventDefault(); toggleMark(); return; }
    if (mod && !event.shiftKey && (event.code === "KeyB" || event.code === "KeyI")) {
      event.preventDefault(); run(() => exec(event.code === "KeyB" ? "bold" : "italic")); return;
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
    const map: Record<string, BlockKind> = { "# ": "h2", "## ": "h3", "- ": "ul", "* ": "ul", "1. ": "ol", "1) ": "ol", "> ": "quote" };
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
      if (!text.includes("\n")) { exec("insertText", text); return; }
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
    if (source) {
      if (rootRef.current) { rootRef.current.innerHTML = markdownToEditorHtml(sourceText); ensureTrailingParagraph(rootRef.current); }
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
      onMouseDown={(event) => { event.preventDefault(); onPress(); }}>{icon}</button>;

  return <div className={`nb-editor-shell ${source ? "is-source" : ""}`}>
    <div className="nb-toolbar" role="toolbar" aria-label="Formatting">
      <div className="nb-toolbar-group">
        {tool("Body text", "", <Pilcrow size={15} />, () => setBlock("p"), active.block === "p")}
        {tool("Heading", `${MOD}+Alt+1`, <Heading1 size={15} />, () => setBlock(active.block === "h2" ? "p" : "h2"), active.block === "h2")}
        {tool("Subheading", `${MOD}+Alt+2`, <Heading2 size={15} />, () => setBlock(active.block === "h3" ? "p" : "h3"), active.block === "h3")}
      </div>
      <div className="nb-toolbar-group">
        {tool("Bold", `${MOD}+B`, <Bold size={15} />, () => run(() => exec("bold")), active.bold)}
        {tool("Italic", `${MOD}+I`, <Italic size={15} />, () => run(() => exec("italic")), active.italic)}
        {tool("Strikethrough", "", <Strikethrough size={15} />, () => run(() => exec("strikeThrough")))}
        {tool("Highlight", `${MOD}+Shift+H`, <Highlighter size={15} />, toggleMark, active.mark)}
      </div>
      <div className="nb-toolbar-group">
        {tool("Bulleted list", `${MOD}+Shift+8`, <List size={15} />, () => setBlock("ul"), active.block === "ul")}
        {tool("Numbered list", `${MOD}+Shift+7`, <ListOrdered size={15} />, () => setBlock("ol"), active.block === "ol")}
        {tool("Quotation", "", <Quote size={15} />, () => setBlock("quote"), active.block === "quote")}
      </div>
      <div className="nb-toolbar-group nb-toolbar-blocks">
        <button type="button" className={active.block === "example" ? "is-active" : ""} disabled={source} title="Example block — sentence, reading, translation on separate lines"
          onMouseDown={(event) => { event.preventDefault(); setBlock("example"); }}><MessageSquareText size={14} /><span>Example</span></button>
        <button type="button" className={active.block === "rule" ? "is-active" : ""} disabled={source} title="Rule block — a grammar rule or pattern"
          onMouseDown={(event) => { event.preventDefault(); setBlock("rule"); }}><Scale size={14} /><span>Rule</span></button>
        <button type="button" className={active.block === "correction" ? "is-active" : ""} disabled={source} title="Correction block — the right form next to a common error"
          onMouseDown={(event) => { event.preventDefault(); setBlock("correction"); }}><CheckCheck size={14} /><span>Correction</span></button>
        <button type="button" className={active.block === "tip" ? "is-active" : ""} disabled={source} title="Tip block — a hint or memory aid"
          onMouseDown={(event) => { event.preventDefault(); setBlock("tip"); }}><Lightbulb size={14} /><span>Tip</span></button>
        {tool("Divider", "", <Minus size={15} />, () => run(() => exec("insertHorizontalRule")))}
      </div>
      <span className="nb-toolbar-spacer" />
      <div className="nb-toolbar-group">
        {tool("Undo", `${MOD}+Z`, <Undo2 size={15} />, () => run(() => exec("undo")))}
        {tool("Redo", `${MOD}+Shift+Z`, <Redo2 size={15} />, () => run(() => exec("redo")))}
        <button type="button" className={source ? "is-active" : ""} aria-pressed={source} title="Edit the plain text source"
          onMouseDown={(event) => { event.preventDefault(); toggleSource(); }}><Code2 size={15} /></button>
      </div>
      {extraTools}
    </div>
    <div className="nb-editor-surface">
      {empty && !source && placeholder ? <div className="nb-placeholder" aria-hidden="true">{placeholder}</div> : null}
      <div ref={rootRef} className="nb-prose nb-editor" contentEditable={!source} suppressContentEditableWarning
        role="textbox" aria-multiline="true" aria-label={ariaLabel} spellCheck
        hidden={source}
        onInput={handleInput} onKeyDown={handleKeyDown} onPaste={handlePaste}
        onDrop={(event) => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }}
        onCompositionStart={() => { composing.current = true; }}
        onCompositionEnd={() => { composing.current = false; emit(); }} />
      {source ? <textarea ref={sourceRef} className="nb-source" value={sourceText} aria-label="Plain text source"
        spellCheck={false}
        onChange={(event) => { setSourceText(event.target.value); latest.current = event.target.value; setEmpty(!event.target.value.trim()); onChange(event.target.value); }}
        onKeyDown={(event) => {
          const mod = event.ctrlKey || event.metaKey;
          if (event.key === "Escape") { event.preventDefault(); onEscape?.(); }
          else if (mod && event.key === "Enter") { event.preventDefault(); onDone?.(); }
          else if (mod && event.code === "KeyS") { event.preventDefault(); onSave?.(); }
        }} /> : null}
    </div>
  </div>;
});
