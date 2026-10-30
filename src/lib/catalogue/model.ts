/**
 * Catalogue: designed publications, independent of the Notebook.
 *
 *   Notebook  = working knowledge (knowledge_records, edited while thinking)
 *   Catalogue = designed publications (catalogue_articles, laid out on A4 pages)
 *
 * The two are connected only by an explicit conversion, which COPIES a note's
 * text into a new article. An article never reads its source note again, so
 * editing or deleting that note cannot change or destroy the article.
 *
 * Tables (see supabase/migrations/20261030090000_catalogue_publications.sql):
 *   catalogue_subjects → catalogue_volumes → catalogue_articles
 * Articles may belong to a subject without a volume, or to neither.
 * Pages are stored inside the article row as ordered JSON (position = index).
 */

export const A4 = { widthMm: 210, heightMm: 297 } as const;
/** CSS pixels at 96 dpi; the browser lays the page out at exactly this size. */
export const MM_TO_PX = 96 / 25.4;
export const PAGE_WIDTH_PX = A4.widthMm * MM_TO_PX;
export const PAGE_HEIGHT_PX = A4.heightMm * MM_TO_PX;
/** PDF points. */
export const PAGE_WIDTH_PT = (A4.widthMm / 25.4) * 72;
export const PAGE_HEIGHT_PT = (A4.heightMm / 25.4) * 72;

export const LIMITS = {
  name: 120, title: 200, subtitle: 300, author: 120, edition: 80,
  caption: 600, credit: 600, quote: 4000, text: 60000, pages: 400, blocksPerPage: 60,
  /** Size of the stored page JSON, mirrored by a database check. */
  pagesBytes: 2_000_000,
} as const;

export type ArticleStatus = "draft" | "published";
export type TypographyPreset = "classical" | "literary" | "archive";
export type ColourPreset = "warm" | "white" | "dark";
export type SourceKind = "blank" | "notebook" | "docx";

export const TYPOGRAPHY_PRESETS: Array<{ id: TypographyPreset; label: string; description: string }> = [
  { id: "classical", label: "Classical", description: "Caslon titles, Garamond text, small capitals" },
  { id: "literary", label: "Literary", description: "Expressive headings, book-like paragraphs" },
  { id: "archive", label: "Modern Archive", description: "Refined serif, contemporary metadata" },
];
export const COLOUR_PRESETS: Array<{ id: ColourPreset; label: string; paper: string; ink: string; accent: string }> = [
  { id: "warm", label: "Warm", paper: "#F5F0E7", ink: "#3B2C24", accent: "#A47D58" },
  { id: "white", label: "White", paper: "#FFFFFF", ink: "#252321", accent: "#D8D6D2" },
  { id: "dark", label: "Dark", paper: "#211D1B", ink: "#F0E8DD", accent: "#B59670" },
];

// ---------------------------------------------------------------------------
// Images: a stored file plus a non-destructive frame (crop) description
// ---------------------------------------------------------------------------
export type AspectChoice = "original" | "3:2" | "4:3" | "1:1" | "4:5" | "2:3" | "16:9";
export const ASPECTS: AspectChoice[] = ["original", "3:2", "4:3", "1:1", "4:5", "2:3", "16:9"];
export type Attribution = {
  provider: "upload" | "wikimedia" | "docx";
  title?: string;
  author?: string;
  licence?: string;
  licenceUrl?: string;
  sourceUrl?: string;
};
export type ImageRef = {
  /** Object path in the private heuresis-catalogue-media bucket. Never changes for a given file. */
  path: string;
  width: number;
  height: number;
  mime: string;
  alt: string;
  /** Frame proportion. "original" keeps the file's own proportion. */
  aspect: AspectChoice;
  /** fill = the frame is covered (cropping by zoom and focal point); fit = the whole image is shown. */
  fit: "fill" | "fit";
  /** 1 … 4: magnification beyond what is needed to cover the frame. */
  zoom: number;
  /** Point of the original (0–1) kept in view when cropping. */
  focalX: number;
  focalY: number;
  attribution: Attribution | null;
};

// ---------------------------------------------------------------------------
// Layout blocks: a small, curated set
// ---------------------------------------------------------------------------
export type Spacing = "none" | "small" | "medium" | "large";
export type BlockBase = { id: string; spaceBefore?: Spacing };
export type CoverBlock = BlockBase & {
  type: "cover";
  /** Title, subtitle and author are the article's own fields; the cover shows them. */
  kicker: string;
  image: ImageRef | null;
  style: "framed" | "full-bleed" | "plain";
};
export type HeadingBlock = BlockBase & {
  type: "heading";
  /** "opening" shows the article title, subtitle and author; "section" has its own text. */
  level: "opening" | "section";
  kicker: string;
  text: string;
  /** Standfirst / section introduction, in the Heuresis note format. */
  intro: string;
  align: "left" | "center";
};
export type TextBlock = BlockBase & {
  type: "text";
  /** Heuresis note format (Markdown subset): paragraphs, ## subheadings, lists, **bold**, *italic*. */
  content: string;
  columns: 1 | 2;
  align: "justify" | "left";
  dropCap: boolean;
  /**
   * Set when the overflow flow divided a text block: true when the division fell inside
   * a paragraph, "paragraph" when it fell between paragraphs. Such a part is joined
   * back to the text before it whenever the two meet on one page again.
   */
  continued?: true | "paragraph";
};
export type ImageBlock = BlockBase & {
  type: "image";
  image: ImageRef | null;
  size: "full" | "wide" | "half" | "third";
  placement: "left" | "center" | "right";
  /** Edge-to-edge across the page width (full size only). */
  bleed: boolean;
  caption: string;
  showCredit: boolean;
  /** The proportion proposed for an empty frame (page layouts); used when a picture is placed. */
  frame?: AspectChoice;
};
export type ImageTextBlock = BlockBase & {
  type: "image-text";
  image: ImageRef | null;
  side: "left" | "right";
  /** Share of the width given to the image, in percent. */
  ratio: 33 | 40 | 50;
  content: string;
  caption: string;
  showCredit: boolean;
  frame?: AspectChoice;
};
export type QuoteBlock = BlockBase & {
  type: "quote";
  text: string;
  attribution: string;
  style: "centred" | "pull";
};
export type DividerBlock = BlockBase & { type: "divider"; style: "rule" | "ornament" | "space" };
export type CaptionBlock = BlockBase & { type: "caption"; text: string; source: string };

export type Block = CoverBlock | HeadingBlock | TextBlock | ImageBlock | ImageTextBlock | QuoteBlock | DividerBlock | CaptionBlock;
export type BlockType = Block["type"];

export const BLOCK_LABELS: Record<BlockType, string> = {
  cover: "Cover page", heading: "Heading", text: "Text", image: "Image",
  "image-text": "Image beside text", quote: "Quotation", divider: "Divider", caption: "Caption and source",
};

export type ArticlePage = { id: string; blocks: Block[] };

export type CatalogueSubject = {
  id: string; user_id: string; name: string; sort_order: number; created_at: string; updated_at: string;
};
export type CatalogueVolume = {
  id: string; user_id: string; subject_id: string | null;
  title: string; subtitle: string; edition: string; edition_date: string | null;
  cover: ImageRef | null; sort_order: number; created_at: string; updated_at: string;
};
export type CatalogueArticle = {
  id: string; user_id: string;
  title: string; subtitle: string; author: string;
  subject_id: string | null; volume_id: string | null; volume_order: number;
  source_note_id: string | null; source_kind: SourceKind; source_label: string;
  status: ArticleStatus; published_at: string | null;
  typography_preset: TypographyPreset; colour_preset: ColourPreset;
  page_numbers: boolean; running_header: boolean;
  cover: ImageRef | null;
  pages: ArticlePage[];
  created_at: string; updated_at: string;
};
export type CatalogueSnapshot = { subjects: CatalogueSubject[]; volumes: CatalogueVolume[]; articles: CatalogueArticle[] };
export const EMPTY_CATALOGUE: CatalogueSnapshot = { subjects: [], volumes: [], articles: [] };

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------
export function uid() {
  return crypto.randomUUID();
}

export function newBlock(type: BlockType): Block {
  const id = uid();
  switch (type) {
    case "cover": return { id, type, kicker: "", image: null, style: "framed" };
    case "heading": return { id, type, level: "section", kicker: "", text: "", intro: "", align: "left" };
    case "text": return { id, type, content: "", columns: 1, align: "justify", dropCap: false };
    case "image": return { id, type, image: null, size: "full", placement: "center", bleed: false, caption: "", showCredit: true };
    case "image-text": return { id, type, image: null, side: "left", ratio: 40, content: "", caption: "", showCredit: true };
    case "quote": return { id, type, text: "", attribution: "", style: "centred" };
    case "divider": return { id, type, style: "ornament" };
    case "caption": return { id, type, text: "", source: "" };
  }
}

export function newPage(blocks: Block[] = []): ArticlePage {
  return { id: uid(), blocks };
}

export function openingBlock(): HeadingBlock {
  return { ...(newBlock("heading") as HeadingBlock), level: "opening" };
}

export function blankArticle(userId: string, input: Partial<Pick<CatalogueArticle, "title" | "subject_id" | "volume_id" | "typography_preset" | "colour_preset">> = {}): CatalogueArticle {
  const now = new Date().toISOString();
  const text = newBlock("text") as TextBlock;
  return {
    id: uid(), user_id: userId,
    title: (input.title ?? "").trim(), subtitle: "", author: "",
    subject_id: input.subject_id ?? null, volume_id: input.volume_id ?? null, volume_order: 0,
    source_note_id: null, source_kind: "blank", source_label: "",
    status: "draft", published_at: null,
    typography_preset: input.typography_preset ?? "classical", colour_preset: input.colour_preset ?? "warm",
    page_numbers: true, running_header: false, cover: null,
    pages: [newPage([openingBlock(), text])],
    created_at: now, updated_at: now,
  };
}

// ---------------------------------------------------------------------------
// Defensive normalisation of rows read from the database (or a device cache)
// ---------------------------------------------------------------------------
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);
const nullable = (value: unknown) => (typeof value === "string" && value ? value : null);
const num = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  (typeof value === "string" && (allowed as readonly string[]).includes(value) ? value as T : fallback);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isoTime = (value: unknown) => {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};
const SPACINGS = ["none", "small", "medium", "large"] as const;

export function normaliseImage(raw: unknown): ImageRef | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const path = str(row.path);
  if (!path) return null;
  const attribution = row.attribution && typeof row.attribution === "object" && !Array.isArray(row.attribution)
    ? row.attribution as Record<string, unknown> : null;
  return {
    path,
    width: Math.max(1, Math.round(num(row.width, 1200))),
    height: Math.max(1, Math.round(num(row.height, 800))),
    mime: str(row.mime, "image/jpeg"),
    alt: str(row.alt).slice(0, 300),
    aspect: oneOf(row.aspect, ASPECTS, "original"),
    fit: oneOf(row.fit, ["fill", "fit"] as const, "fill"),
    zoom: clamp(num(row.zoom, 1), 1, 4),
    focalX: clamp(num(row.focalX, 0.5), 0, 1),
    focalY: clamp(num(row.focalY, 0.5), 0, 1),
    attribution: attribution ? {
      provider: oneOf(attribution.provider, ["upload", "wikimedia", "docx"] as const, "upload"),
      title: str(attribution.title).slice(0, 300) || undefined,
      author: str(attribution.author).slice(0, 300) || undefined,
      licence: str(attribution.licence).slice(0, 120) || undefined,
      licenceUrl: safeUrl(attribution.licenceUrl),
      sourceUrl: safeUrl(attribution.sourceUrl),
    } : null,
  };
}

function safeUrl(value: unknown) {
  const text = str(value);
  return /^https:\/\/[^\s"'<>]+$/i.test(text) ? text.slice(0, 600) : undefined;
}

const frameHint = (value: unknown): { frame?: AspectChoice } =>
  (typeof value === "string" && value !== "original" && (ASPECTS as readonly string[]).includes(value) ? { frame: value as AspectChoice } : {});

/** Width / height of an empty frame: its proposed proportion, or 3:2. */
export function emptyFrameAspect(frame: AspectChoice | undefined) {
  if (!frame || frame === "original") return 1.5;
  const [w, h] = frame.split(":").map(Number);
  return w / h;
}

/** Picture frames still waiting for a picture. They are left out when reading and in PDFs. */
export function emptyPictureFrames(article: Pick<CatalogueArticle, "pages">) {
  let count = 0;
  for (const page of article.pages) for (const block of page.blocks)
    if ((block.type === "image" || block.type === "image-text" || (block.type === "cover" && block.style !== "plain")) && !block.image) count += 1;
  return count;
}

export function normaliseBlock(raw: unknown): Block | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const id = str(row.id) || uid();
  const spaceBefore = row.spaceBefore === undefined ? undefined : oneOf(row.spaceBefore, SPACINGS, "medium");
  const base = spaceBefore ? { id, spaceBefore } : { id };
  switch (row.type) {
    case "cover": return { ...base, type: "cover", kicker: str(row.kicker).slice(0, LIMITS.subtitle), image: normaliseImage(row.image), style: oneOf(row.style, ["framed", "full-bleed", "plain"] as const, "framed") };
    case "heading": return { ...base, type: "heading", level: oneOf(row.level, ["opening", "section"] as const, "section"), kicker: str(row.kicker).slice(0, LIMITS.subtitle), text: str(row.text).slice(0, LIMITS.title), intro: str(row.intro).slice(0, LIMITS.quote), align: oneOf(row.align, ["left", "center"] as const, "left") };
    case "text": return { ...base, type: "text", content: str(row.content).slice(0, LIMITS.text), columns: row.columns === 2 ? 2 : 1, align: oneOf(row.align, ["justify", "left"] as const, "justify"), dropCap: row.dropCap === true, ...(row.continued === true ? { continued: true as const } : row.continued === "paragraph" ? { continued: "paragraph" as const } : {}) };
    case "image": return { ...base, type: "image", image: normaliseImage(row.image), size: oneOf(row.size, ["full", "wide", "half", "third"] as const, "full"), placement: oneOf(row.placement, ["left", "center", "right"] as const, "center"), bleed: row.bleed === true, caption: str(row.caption).slice(0, LIMITS.caption), showCredit: row.showCredit !== false, ...frameHint(row.frame) };
    case "image-text": return { ...base, type: "image-text", image: normaliseImage(row.image), side: oneOf(row.side, ["left", "right"] as const, "left"), ratio: row.ratio === 33 || row.ratio === 50 ? row.ratio : 40, content: str(row.content).slice(0, LIMITS.text), caption: str(row.caption).slice(0, LIMITS.caption), showCredit: row.showCredit !== false, ...frameHint(row.frame) };
    case "quote": return { ...base, type: "quote", text: str(row.text).slice(0, LIMITS.quote), attribution: str(row.attribution).slice(0, LIMITS.credit), style: oneOf(row.style, ["centred", "pull"] as const, "centred") };
    case "divider": return { ...base, type: "divider", style: oneOf(row.style, ["rule", "ornament", "space"] as const, "ornament") };
    case "caption": return { ...base, type: "caption", text: str(row.text).slice(0, LIMITS.caption), source: str(row.source).slice(0, LIMITS.credit) };
    default: return null;
  }
}

export function normalisePages(raw: unknown): ArticlePage[] {
  const list = Array.isArray(raw) ? raw : [];
  const pages = list.slice(0, LIMITS.pages).flatMap((item): ArticlePage[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const row = item as Record<string, unknown>;
    const blocks = (Array.isArray(row.blocks) ? row.blocks : []).slice(0, LIMITS.blocksPerPage)
      .map(normaliseBlock).filter((block): block is Block => Boolean(block));
    return [{ id: str(row.id) || uid(), blocks }];
  });
  return pages.length ? pages : [newPage()];
}

export function normaliseSubject(row: Record<string, unknown>): CatalogueSubject {
  const created = str(row.created_at, new Date().toISOString());
  return { id: str(row.id), user_id: str(row.user_id), name: str(row.name), sort_order: num(row.sort_order, 0), created_at: created, updated_at: str(row.updated_at, created) };
}
export function normaliseVolume(row: Record<string, unknown>): CatalogueVolume {
  const created = str(row.created_at, new Date().toISOString());
  return {
    id: str(row.id), user_id: str(row.user_id), subject_id: nullable(row.subject_id),
    title: str(row.title), subtitle: str(row.subtitle), edition: str(row.edition),
    edition_date: nullable(row.edition_date), cover: normaliseImage(row.cover),
    sort_order: num(row.sort_order, 0), created_at: created, updated_at: str(row.updated_at, created),
  };
}
export function normaliseArticle(row: Record<string, unknown>): CatalogueArticle {
  const created = str(row.created_at, new Date().toISOString());
  return {
    id: str(row.id), user_id: str(row.user_id),
    title: str(row.title), subtitle: str(row.subtitle), author: str(row.author),
    subject_id: nullable(row.subject_id), volume_id: nullable(row.volume_id), volume_order: num(row.volume_order, 0),
    source_note_id: nullable(row.source_note_id), source_kind: oneOf(row.source_kind, ["blank", "notebook", "docx"] as const, "blank"),
    source_label: str(row.source_label),
    // The database answers in its own time-zone format; keep one form so a saved value compares equal.
    status: row.status === "published" ? "published" : "draft", published_at: isoTime(row.published_at),
    typography_preset: oneOf(row.typography_preset, ["classical", "literary", "archive"] as const, "classical"),
    colour_preset: oneOf(row.colour_preset, ["warm", "white", "dark"] as const, "warm"),
    page_numbers: row.page_numbers !== false, running_header: row.running_header === true,
    cover: normaliseImage(row.cover),
    pages: normalisePages(row.pages),
    created_at: created, updated_at: str(row.updated_at, created),
  };
}

// ---------------------------------------------------------------------------
// Validation (mirrors the database checks so errors are explained before saving)
// ---------------------------------------------------------------------------
export function cleanName(value: string, max: number = LIMITS.name, label = "The name") {
  const clean = value.trim().replace(/\s+/g, " ");
  if (!clean) throw new Error(`${label} cannot be empty.`);
  if (clean.length > max) throw new Error(`${label} can be at most ${max} characters.`);
  return clean;
}

export function validateArticle(article: CatalogueArticle) {
  if (article.title.length > LIMITS.title) throw new Error(`The title can be at most ${LIMITS.title} characters.`);
  if (article.subtitle.length > LIMITS.subtitle) throw new Error(`The subtitle can be at most ${LIMITS.subtitle} characters.`);
  if (article.author.length > LIMITS.author) throw new Error(`The author can be at most ${LIMITS.author} characters.`);
  if (!article.pages.length) throw new Error("An article needs at least one page.");
  if (article.pages.length > LIMITS.pages) throw new Error(`An article can have at most ${LIMITS.pages} pages.`);
  const bytes = new TextEncoder().encode(JSON.stringify(article.pages)).length;
  if (bytes > LIMITS.pagesBytes) throw new Error("This article is too large to save as one publication. Split it into two articles.");
}

// ---------------------------------------------------------------------------
// Page operations (pure: return a new page list)
// ---------------------------------------------------------------------------
export function clonePageWithNewIds(page: ArticlePage): ArticlePage {
  return { id: uid(), blocks: page.blocks.map((block) => ({ ...structuredClone(block), id: uid() })) };
}
export function insertPage(pages: ArticlePage[], index: number, page: ArticlePage = newPage()): ArticlePage[] {
  const next = [...pages];
  next.splice(clamp(index, 0, pages.length), 0, page);
  return next;
}
export function duplicatePage(pages: ArticlePage[], pageId: string): ArticlePage[] {
  const index = pages.findIndex((page) => page.id === pageId);
  if (index < 0) return pages;
  return insertPage(pages, index + 1, clonePageWithNewIds(pages[index]));
}
export function deletePage(pages: ArticlePage[], pageId: string): ArticlePage[] {
  const next = pages.filter((page) => page.id !== pageId);
  return next.length ? next : [newPage()];
}
export function movePage(pages: ArticlePage[], pageId: string, toIndex: number): ArticlePage[] {
  const from = pages.findIndex((page) => page.id === pageId);
  if (from < 0) return pages;
  const next = [...pages];
  const [page] = next.splice(from, 1);
  next.splice(clamp(toIndex, 0, next.length), 0, page);
  return next;
}

export function updateBlock(pages: ArticlePage[], blockId: string, patch: Partial<Block>): ArticlePage[] {
  return pages.map((page) => page.blocks.some((block) => block.id === blockId)
    ? { ...page, blocks: page.blocks.map((block) => block.id === blockId ? { ...block, ...patch } as Block : block) }
    : page);
}
export function removeBlock(pages: ArticlePage[], blockId: string): ArticlePage[] {
  return pages.map((page) => ({ ...page, blocks: page.blocks.filter((block) => block.id !== blockId) }));
}
export function insertBlock(pages: ArticlePage[], pageId: string, index: number, block: Block): ArticlePage[] {
  return pages.map((page) => {
    if (page.id !== pageId) return page;
    const blocks = [...page.blocks];
    blocks.splice(clamp(index, 0, blocks.length), 0, block);
    return { ...page, blocks };
  });
}
export function moveBlockWithinPage(pages: ArticlePage[], blockId: string, delta: -1 | 1): ArticlePage[] {
  return pages.map((page) => {
    const index = page.blocks.findIndex((block) => block.id === blockId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= page.blocks.length) return page;
    const blocks = [...page.blocks];
    [blocks[index], blocks[target]] = [blocks[target], blocks[index]];
    return { ...page, blocks };
  });
}
/** Move a block to the start (moving forward) or the end (moving back) of the neighbouring page. */
export function moveBlockToPage(pages: ArticlePage[], blockId: string, direction: -1 | 1): ArticlePage[] {
  const pageIndex = pages.findIndex((page) => page.blocks.some((block) => block.id === blockId));
  if (pageIndex < 0) return pages;
  const block = pages[pageIndex].blocks.find((item) => item.id === blockId)!;
  let next = removeBlock(pages, blockId);
  let targetIndex = pageIndex + direction;
  if (targetIndex < 0) return pages;
  if (targetIndex >= next.length) { next = insertPage(next, next.length); targetIndex = next.length - 1; }
  const target = next[targetIndex];
  return insertBlock(next, target.id, direction === 1 ? 0 : target.blocks.length, block);
}

export function findBlock(pages: ArticlePage[], blockId: string): { page: ArticlePage; pageIndex: number; block: Block; index: number } | null {
  for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex];
    const index = page.blocks.findIndex((block) => block.id === blockId);
    if (index >= 0) return { page, pageIndex, block: page.blocks[index], index };
  }
  return null;
}

export function isCoverPage(page: ArticlePage) {
  return page.blocks.some((block) => block.type === "cover");
}

// ---------------------------------------------------------------------------
// Reading helpers
// ---------------------------------------------------------------------------
export function articleTitle(article: Pick<CatalogueArticle, "title">) {
  return article.title.trim() || "Untitled article";
}
export function articleImages(article: CatalogueArticle): ImageRef[] {
  const images: ImageRef[] = [];
  if (article.cover) images.push(article.cover);
  for (const page of article.pages) for (const block of page.blocks) {
    if ((block.type === "cover" || block.type === "image" || block.type === "image-text") && block.image) images.push(block.image);
  }
  return images;
}
/** The gallery cover: an explicit cover, else the first illustration. */
export function articleCoverImage(article: CatalogueArticle): ImageRef | null {
  return articleImages(article)[0] ?? null;
}
export function plainText(markdown: string) {
  return markdown.replace(/^\s{0,3}#{1,6}\s+/gm, "").replace(/^\s*>\s?(\[![a-z]+\]\s*)?/gim, "")
    .replace(/^\s*([-*•]|\d+[.)])\s+/gm, "").replace(/\*\*|==|~~|\[\[|\]\]|\{\/?(?:color|bg)(?::[a-z]+)?\}/g, "")
    .replace(/(^|\s)\*(\S)/g, "$1$2").replace(/\s+/g, " ").trim();
}
export function blockText(block: Block): string {
  switch (block.type) {
    case "text": case "image-text": return plainText(block.content) + (block.type === "image-text" && block.caption ? ` ${block.caption}` : "");
    case "heading": return [block.kicker, block.text, plainText(block.intro)].filter(Boolean).join(" ");
    case "quote": return [block.text, block.attribution].filter(Boolean).join(" ");
    case "caption": return [block.text, block.source].filter(Boolean).join(" ");
    case "image": return block.caption;
    case "cover": return block.kicker;
    default: return "";
  }
}
/** Whether deleting the page would remove anything the person wrote or chose (words or pictures). */
export function pageHasContent(page: ArticlePage) {
  return page.blocks.some((block) => blockText(block).trim() || ("image" in block && block.image) || block.type === "cover");
}
export function articleText(article: CatalogueArticle) {
  return [article.title, article.subtitle, article.author,
    ...article.pages.flatMap((page) => page.blocks.map(blockText))].filter(Boolean).join(" ");
}
export function articleExcerpt(article: CatalogueArticle, max = 180) {
  for (const page of article.pages) for (const block of page.blocks) {
    if (block.type === "heading" && block.level === "opening" && block.intro.trim()) return clip(plainText(block.intro), max);
    if (block.type === "text" && block.content.trim()) return clip(plainText(block.content), max);
  }
  return article.subtitle;
}
function clip(text: string, max: number) {
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
export function wordCount(article: CatalogueArticle) {
  const text = article.pages.flatMap((page) => page.blocks.map(blockText)).join(" ");
  const latin = text.replace(/[㐀-鿿豈-﫿]/g, " ").split(/\s+/).filter(Boolean).length;
  const cjk = (text.match(/[㐀-鿿豈-﫿]/g) ?? []).length;
  return latin + cjk;
}

const ROMAN: Array<[number, string]> = [[1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"], [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]];
export function roman(value: number) {
  let rest = Math.max(1, Math.min(3999, Math.floor(value)));
  let out = "";
  for (const [amount, glyph] of ROMAN) while (rest >= amount) { out += glyph; rest -= amount; }
  return out;
}

/** JSON with object keys in a fixed order (the database returns jsonb keys re-ordered). */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.keys(item as Record<string, unknown>).sort()
      .filter((key) => (item as Record<string, unknown>)[key] !== undefined)
      .map((key) => [key, (item as Record<string, unknown>)[key]]));
  }) ?? "null";
}

export function normaliseSearch(text: string) {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
}

export function sortArticles(articles: CatalogueArticle[]) {
  return [...articles].sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}
export function volumeArticles(articles: CatalogueArticle[], volumeId: string) {
  return articles.filter((article) => article.volume_id === volumeId)
    .sort((a, b) => a.volume_order - b.volume_order || a.created_at.localeCompare(b.created_at));
}
