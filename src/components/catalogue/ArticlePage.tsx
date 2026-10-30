import { createContext, memo, useContext, useEffect, useLayoutEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import { ImagePlus } from "lucide-react";
import { editorToMarkdown, markdownToEditorHtml } from "../../lib/noteFormat";
import { frameGeometry } from "../../lib/catalogue/crop";
import { useCatalogueImage } from "../../lib/catalogue/media";
import {
  articleTitle, emptyFrameAspect, isCoverPage, type ArticlePage as Page, type Block, type CatalogueArticle, type CoverBlock, type HeadingBlock, type ImageRef,
} from "../../lib/catalogue/model";
import { coverFrameAspect, pageStyle } from "../../lib/catalogue/presets";
import { attributionLine } from "../../lib/catalogue/wikimedia";

/**
 * One A4 page. The same component draws a page in the Article Designer
 * ("edit"), the reader and the PDF export ("read"). Editing affordances are
 * either absolutely positioned or only shown for the selected block, so a page
 * occupies exactly the same space in every mode: what is laid out here is what
 * is printed.
 */
export type DesignerApi = {
  selectedId: string | null;
  select: (id: string | null) => void;
  patchBlock: (id: string, patch: Partial<Block>, kind?: "typing" | "change") => void;
  patchArticle: (patch: Partial<Pick<CatalogueArticle, "title" | "subtitle" | "author">>, kind?: "typing" | "change") => void;
  requestImage: (blockId: string) => void;
  /** Changes when content is replaced from outside (undo, redo, reload): editable fields re-read their value. */
  resetKey: number;
};
export const DesignerContext = createContext<DesignerApi | null>(null);
/**
 * True while pages are laid out off-screen for the overflow flow: empty picture
 * frames then keep their space (as in the designer), so the pages made by the flow
 * fit in the designer too. Reading and PDFs leave empty frames out.
 */
export const LayoutPlaceholders = createContext(false);
const useDesigner = () => useContext(DesignerContext);

export function articleTextHtml(markdown: string) {
  return markdownToEditorHtml(markdown);
}

// ---------------------------------------------------------------------------
// Editable fields
// ---------------------------------------------------------------------------
function RichField({ value, className, onChange, placeholder, label }: {
  value: string; className: string; onChange: (value: string) => void; placeholder: string; label: string;
}) {
  const designer = useDesigner();
  const ref = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);
  const latest = useRef(value);
  const flush = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    const root = ref.current;
    if (!root) return;
    const next = editorToMarkdown(root);
    if (next !== latest.current) { latest.current = next; onChange(next); }
  };
  useLayoutEffect(() => {
    if (!ref.current) return;
    latest.current = value;
    ref.current.innerHTML = articleTextHtml(value);
    try { document.execCommand("defaultParagraphSeparator", false, "p"); } catch { /* optional */ }
    // Only an outside replacement of the content resets the DOM; typing never does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designer?.resetKey]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  if (!designer) return <div className={className} dangerouslySetInnerHTML={{ __html: articleTextHtml(value) }} />;
  return <div ref={ref} className={`${className} ap-editable`} contentEditable suppressContentEditableWarning
    role="textbox" aria-multiline="true" aria-label={label} data-placeholder={placeholder}
    data-empty={!value.trim() ? "true" : undefined}
    onInput={() => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 220);
      const root = ref.current;
      if (root) root.dataset.empty = (root.textContent ?? "").trim() ? "" : "true";
    }}
    onBlur={flush}
    onPaste={(event) => {
      // Pasted text arrives as plain words in the article's own typography.
      event.preventDefault();
      const text = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
      if (!text) return;
      const html = text.split("\n").filter((line, index, all) => line.trim() || (index > 0 && all[index - 1].trim()))
        .map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") || "<br>"}</p>`).join("");
      document.execCommand(text.includes("\n") ? "insertHTML" : "insertText", false, text.includes("\n") ? html : text);
      flush();
    }} />;
}

function PlainField({ value, className, onChange, placeholder, label, multiline = false, as = "div" }: {
  value: string; className: string; onChange: (value: string) => void; placeholder: string; label: string; multiline?: boolean; as?: "div" | "h1" | "h2" | "p";
}) {
  const designer = useDesigner();
  const ref = useRef<HTMLElement>(null);
  const timer = useRef<number | null>(null);
  const pending = useRef<string | null>(null);
  // Reflect changes made elsewhere (the title bar, undo) unless this field is being typed in.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || document.activeElement === element) return;
    if (element.textContent !== value) element.textContent = value;
    element.dataset.empty = value.trim() ? "" : "true";
  }, [value, designer?.resetKey]);
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);
  const Tag = as;
  if (!designer) return <Tag className={className}>{value}</Tag>;
  const flush = () => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    if (pending.current !== null) { const next = pending.current; pending.current = null; onChange(next); }
  };
  const emit = () => {
    const element = ref.current;
    if (!element) return;
    const raw = (multiline ? element.innerText : element.textContent ?? "").replace(/\u00a0/g, " ");
    const text = multiline ? raw.replace(/\n{3,}/g, "\n\n").replace(/\n$/, "") : raw.replace(/\s*\n\s*/g, " ");
    element.dataset.empty = text.trim() ? "" : "true";
    pending.current = text;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 140);
  };
  return <Tag ref={ref as never} className={`${className} ap-editable`} contentEditable={"plaintext-only" as unknown as boolean}
    suppressContentEditableWarning role="textbox" aria-label={label} aria-multiline={multiline}
    data-placeholder={placeholder} data-empty={!value.trim() ? "true" : undefined}
    onInput={emit} onBlur={flush}
    onKeyDown={(event: KeyboardEvent) => { if (!multiline && event.key === "Enter") { event.preventDefault(); (event.currentTarget as HTMLElement).blur(); } }} />;
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------
export function ImageFrame({ image, aspect, className = "", blockId, emptyLabel = "Add image" }: {
  image: ImageRef | null; aspect?: number; className?: string; blockId?: string; emptyLabel?: string;
}) {
  const designer = useDesigner();
  const placeholders = useContext(LayoutPlaceholders);
  const { url, error } = useCatalogueImage(image?.path);
  if (!image) {
    if (!designer || !blockId) {
      return placeholders ? <div className={`ap-frame is-empty ${className}`} style={{ aspectRatio: String(aspect ?? 1.5) }} /> : null;
    }
    return <div className={`ap-frame is-empty ${className}`} style={{ aspectRatio: String(aspect ?? 1.5) }}>
      <button type="button" className="ap-no-print ap-add-image" onClick={(event) => { event.stopPropagation(); designer.requestImage(blockId); }}>
        <ImagePlus size={22} strokeWidth={1.4} /> <span>{emptyLabel}</span>
      </button>
    </div>;
  }
  const geometry = frameGeometry(image, aspect);
  const style: CSSProperties = { aspectRatio: String(geometry.frameAspect) };
  return <div className={`ap-frame ${className}`} style={style} data-fit={image.fit}>
    {url ? <img src={url} alt={image.alt} draggable={false} style={{
      left: `${geometry.left}%`, top: `${geometry.top}%`, width: `${geometry.width}%`, height: `${geometry.height}%`,
    }} /> : <span className="ap-frame-wait ap-no-print">{error || "Loading image…"}</span>}
  </div>;
}

function Credit({ image, show }: { image: ImageRef | null; show: boolean }) {
  const line = show ? attributionLine(image?.attribution) : "";
  return line ? <span className="ap-credit">{line}</span> : null;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------
function blockClass(block: Block) {
  const parts = ["ap-block", `ap-${block.type}`];
  if (block.type === "text") parts.push(`cols-${block.columns}`, `align-${block.align}`, block.dropCap && !block.continued ? "has-dropcap" : "", block.continued === true ? "is-continued" : "");
  if (block.type === "heading") parts.push(`is-${block.level}`, `align-${block.align}`);
  if (block.type === "image") parts.push(`size-${block.size}`, `place-${block.placement}`, block.bleed && block.size === "full" ? "is-bleed" : "");
  if (block.type === "image-text") parts.push(`side-${block.side}`, `ratio-${block.ratio}`);
  if (block.type === "quote") parts.push(`style-${block.style}`);
  if (block.type === "divider") parts.push(`style-${block.style}`);
  if (block.type === "cover") parts.push(`style-${block.style}`);
  return parts.filter(Boolean).join(" ");
}

function Opening({ block, article, kicker, titleOnCover }: { block: HeadingBlock; article: CatalogueArticle; kicker: string; titleOnCover: boolean }) {
  const designer = useDesigner();
  const selected = designer?.selectedId === block.id;
  const showKicker = Boolean(block.kicker.trim() || kicker) || selected;
  if (titleOnCover) {
    // The cover already carries the title, subtitle and author: the text page only
    // keeps the introduction, if there is one, so the title is not printed twice.
    return <>
      {designer ? <div className="ap-opening-note ap-no-print">Title, subtitle and author are on the cover.</div> : null}
      {block.intro.trim() || designer ? <RichField className="ap-standfirst" value={block.intro} label="Introduction" placeholder="Introduction (optional)"
        onChange={(intro) => designer?.patchBlock(block.id, { intro }, "typing")} /> : null}
      {block.intro.trim() ? <div className="ap-opening-rule" aria-hidden="true" /> : null}
    </>;
  }
  return <>
    {showKicker ? (block.kicker.trim() || !kicker || selected
      ? <PlainField className="ap-kicker" value={block.kicker} label="Kicker" placeholder={kicker || "Section or series label"}
        onChange={(kickerText) => designer?.patchBlock(block.id, { kicker: kickerText }, "typing")} />
      : <div className="ap-kicker">{kicker}</div>) : null}
    <PlainField as="h1" className="ap-title" value={article.title} label="Article title" placeholder="Title of the article"
      onChange={(title) => designer?.patchArticle({ title }, "typing")} />
    {article.subtitle.trim() || selected ? <PlainField as="p" className="ap-subtitle" value={article.subtitle} label="Subtitle" placeholder="Subtitle (optional)" multiline
      onChange={(subtitle) => designer?.patchArticle({ subtitle }, "typing")} /> : null}
    {article.author.trim() || selected ? <PlainField className="ap-byline" value={article.author} label="Author" placeholder="Author (optional)"
      onChange={(author) => designer?.patchArticle({ author }, "typing")} /> : null}
    {block.intro.trim() || selected ? <RichField className="ap-standfirst" value={block.intro} label="Introduction" placeholder="Introduction (optional)"
      onChange={(intro) => designer?.patchBlock(block.id, { intro }, "typing")} /> : null}
    <div className="ap-opening-rule" aria-hidden="true" />
  </>;
}

function Cover({ block, article, kicker }: { block: CoverBlock; article: CatalogueArticle; kicker: string }) {
  const designer = useDesigner();
  const placeholders = useContext(LayoutPlaceholders);
  const selected = designer?.selectedId === block.id;
  const aspect = coverFrameAspect(article.typography_preset, block.style);
  const text = <div className="ap-cover-text">
    {block.kicker.trim() || kicker || selected ? (block.kicker.trim() || !kicker || selected
      ? <PlainField className="ap-kicker" value={block.kicker} label="Cover label" placeholder={kicker || "Series, subject or edition"}
        onChange={(value) => designer?.patchBlock(block.id, { kicker: value }, "typing")} />
      : <div className="ap-kicker">{kicker}</div>) : null}
    <PlainField as="h1" className="ap-title" value={article.title} label="Article title" placeholder="Title of the article"
      onChange={(title) => designer?.patchArticle({ title }, "typing")} />
    {article.subtitle.trim() || selected ? <PlainField as="p" className="ap-subtitle" value={article.subtitle} label="Subtitle" placeholder="Subtitle (optional)" multiline
      onChange={(subtitle) => designer?.patchArticle({ subtitle }, "typing")} /> : null}
    {article.author.trim() || selected ? <PlainField className="ap-byline" value={article.author} label="Author" placeholder="Author (optional)"
      onChange={(author) => designer?.patchArticle({ author }, "typing")} /> : null}
  </div>;
  if (block.style === "plain") return <div className="ap-cover-plain"><div className="ap-cover-ornament" aria-hidden="true" />{text}<div className="ap-cover-ornament" aria-hidden="true" /></div>;
  return <>
    {block.style === "full-bleed" && (block.image || designer || placeholders) ? <ImageFrame image={block.image} aspect={aspect} className="ap-cover-bleed" blockId={block.id} emptyLabel="Add cover image" /> : null}
    {text}
    {block.style === "framed" && (block.image || designer || placeholders) ? <div className="ap-cover-figure"><ImageFrame image={block.image} aspect={aspect} className="ap-cover-image" blockId={block.id} emptyLabel="Add cover image" /></div> : null}
  </>;
}

function BlockBody({ block, article, kicker, titleOnCover }: { block: Block; article: CatalogueArticle; kicker: string; titleOnCover: boolean }) {
  const designer = useDesigner();
  const placeholders = useContext(LayoutPlaceholders);
  const selected = designer?.selectedId === block.id;
  const patch = (value: Partial<Block>) => designer?.patchBlock(block.id, value, "typing");
  switch (block.type) {
    case "cover": return <Cover block={block} article={article} kicker={kicker} />;
    case "heading":
      if (block.level === "opening") return <Opening block={block} article={article} kicker={kicker} titleOnCover={titleOnCover} />;
      return <>
        {block.kicker.trim() || selected ? <PlainField className="ap-kicker" value={block.kicker} label="Section label" placeholder="Label (optional), e.g. I or Part One"
          onChange={(kickerText) => patch({ kicker: kickerText })} /> : null}
        <PlainField as="h2" className="ap-section-title" value={block.text} label="Heading" placeholder="Section heading" onChange={(text) => patch({ text })} />
        {block.intro.trim() || selected ? <RichField className="ap-standfirst" value={block.intro} label="Section introduction" placeholder="Introduction (optional)"
          onChange={(intro) => patch({ intro })} /> : null}
      </>;
    case "text":
      return <RichField className="ap-text-body" value={block.content} label="Text" placeholder="Write, or paste text…" onChange={(content) => patch({ content })} />;
    case "image":
      return <figure className="ap-figure">
        <ImageFrame image={block.image} blockId={block.id} aspect={block.image ? undefined : emptyFrameAspect(block.frame)} />
        {block.caption.trim() || (block.showCredit && block.image?.attribution) || (selected && block.image)
          ? <figcaption className="ap-figcaption">
            {block.caption.trim() || selected ? <PlainField className="ap-caption-text" value={block.caption} label="Caption" placeholder="Caption (optional)" multiline onChange={(caption) => patch({ caption })} /> : null}
            <Credit image={block.image} show={block.showCredit} />
          </figcaption> : null}
      </figure>;
    case "image-text":
      // Reading an unfilled frame: only the text is shown.
      if (!block.image && !designer && !placeholders) return <RichField className="ap-text-body" value={block.content} label="Text" placeholder="" onChange={() => undefined} />;
      return <div className="ap-image-text-grid">
        <figure className="ap-figure">
          <ImageFrame image={block.image} blockId={block.id} aspect={block.image ? undefined : emptyFrameAspect(block.frame)} />
          {block.caption.trim() || (block.showCredit && block.image?.attribution) || (selected && block.image)
            ? <figcaption className="ap-figcaption">
              {block.caption.trim() || selected ? <PlainField className="ap-caption-text" value={block.caption} label="Caption" placeholder="Caption (optional)" multiline onChange={(caption) => patch({ caption })} /> : null}
              <Credit image={block.image} show={block.showCredit} />
            </figcaption> : null}
        </figure>
        <RichField className="ap-text-body" value={block.content} label="Text beside the image" placeholder="Text beside the image…" onChange={(content) => patch({ content })} />
      </div>;
    case "quote":
      return <blockquote className="ap-quote-inner">
        <PlainField className="ap-quote-text" value={block.text} label="Quotation" placeholder="Quotation" multiline onChange={(text) => patch({ text })} />
        {block.attribution.trim() || selected ? <PlainField className="ap-quote-source" value={block.attribution} label="Attribution" placeholder="Attribution (optional)" onChange={(attribution) => patch({ attribution })} /> : null}
      </blockquote>;
    case "divider":
      return block.style === "ornament"
        ? <div className="ap-ornament" aria-hidden="true"><span className="ap-orn-rule" /><span className="ap-orn-diamond" /><span className="ap-orn-rule" /></div>
        : <div className="ap-rule" aria-hidden="true" />;
    case "caption":
      return <div className="ap-caption-block">
        <PlainField className="ap-caption-text" value={block.text} label="Caption" placeholder="Caption" multiline onChange={(text) => patch({ text })} />
        {block.source.trim() || selected ? <PlainField className="ap-caption-source" value={block.source} label="Source" placeholder="Source (optional)" onChange={(source) => patch({ source })} /> : null}
      </div>;
  }
}

const BlockView = memo(function BlockView({ block, article, kicker, selected, titleOnCover, runsOn = false }: {
  block: Block; article: CatalogueArticle; kicker: string; selected: boolean; titleOnCover: boolean;
  /** The paragraph continues on the next page: its last line here is set full width. */
  runsOn?: boolean;
}) {
  const designer = useDesigner();
  const placeholders = useContext(LayoutPlaceholders);
  // An empty picture frame is a placeholder for the designer only: never read or printed.
  if (!designer && !placeholders && block.type === "image" && !block.image) return null;
  // An opening after a cover with no introduction prints nothing at all.
  const printsNothing = titleOnCover && block.type === "heading" && block.level === "opening" && !block.intro.trim();
  if (printsNothing && !designer) return null;
  return <section className={`${blockClass(block)}${titleOnCover && block.type === "heading" && block.level === "opening" ? " is-after-cover" : ""}${runsOn ? " runs-on" : ""}`} data-block-id={block.id} data-space={block.spaceBefore ?? undefined}
    data-selected={selected ? "true" : undefined} data-print-empty={printsNothing ? "true" : undefined}
    onMouseDown={designer ? (event) => { if (!(event.target as HTMLElement).closest(".ap-no-print")) designer.select(block.id); } : undefined}
    onFocusCapture={designer ? () => designer.select(block.id) : undefined}>
    <BlockBody block={block} article={article} kicker={kicker} titleOnCover={titleOnCover} />
  </section>;
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------
export type PageRenderProps = {
  article: CatalogueArticle;
  page: Page;
  pageIndex: number;
  pageCount: number;
  /** Subject or volume shown as the article's label and running header. */
  kicker?: string;
  runningTitle?: string;
  mode: "edit" | "read";
  className?: string;
  /** Visual scale (transform only; the page is always laid out at full A4 size). */
  scale?: number;
  /** Pages before this article in the same document (a volume PDF), so page numbers run on. */
  folioOffset?: number;
};

export const ArticlePageView = memo(function ArticlePageView({ article, page, pageIndex, kicker = "", runningTitle, mode, className = "", scale, folioOffset = 0 }: PageRenderProps) {
  const designer = useDesigner();
  const cover = isCoverPage(page);
  const showFolio = article.page_numbers && !cover;
  const showRunning = article.running_header && !cover && pageIndex > 0;
  const coverIndex = article.pages.findIndex(isCoverPage);
  const titleOnCover = coverIndex >= 0 && coverIndex < pageIndex;
  const nextFirst = article.pages[pageIndex + 1]?.blocks[0];
  const lastBlock = page.blocks[page.blocks.length - 1];
  const runsOnId = lastBlock?.type === "text" && nextFirst?.type === "text" && nextFirst.continued === true ? lastBlock.id : null;
  return <div className={`ap-page ap-type-${article.typography_preset} ap-colour-${article.colour_preset} ${cover ? "is-cover" : ""} ${mode === "edit" ? "is-editing" : "is-reading"} ${className}`}
    style={scale && scale !== 1 ? { ...pageStyle(article.typography_preset), transform: `scale(${scale})`, transformOrigin: "0 0" } : pageStyle(article.typography_preset)}
    data-page-id={page.id} data-page-index={pageIndex}>
    {showRunning ? <div className="ap-running">{runningTitle || articleTitle(article)}</div> : null}
    <div className="ap-content">
      {page.blocks.map((block) => <BlockView key={block.id} block={block} article={article} kicker={kicker}
        selected={designer?.selectedId === block.id} titleOnCover={titleOnCover} runsOn={block.id === runsOnId} />)}
    </div>
    {showFolio ? <div className="ap-folio">{folioOffset + pageIndex + 1}</div> : null}
  </div>;
});
