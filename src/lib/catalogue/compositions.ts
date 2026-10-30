import {
  newBlock, plainText,
  type Block, type CoverBlock, type HeadingBlock, type ImageBlock, type ImageTextBlock, type QuoteBlock, type TextBlock,
} from "./model";

/**
 * Page compositions and the "illustrated" arrangement of converted writing.
 *
 * Both only arrange: they add empty picture frames in good places and never
 * choose, generate or insert a picture themselves. A frame stays empty until the
 * person fills it from their files or from Wikimedia Commons, and an empty frame
 * is left out when reading and in the PDF.
 */
export type CompositionId = "text" | "section" | "picture-text" | "picture-beside" | "full-picture" | "quotation" | "cover";

export const COMPOSITIONS: Array<{ id: CompositionId; label: string; description: string }> = [
  { id: "text", label: "Text", description: "Running text, ready to write in." },
  { id: "section", label: "New section", description: "A section heading and introduction, then text with a drop initial." },
  { id: "picture-text", label: "Picture above text", description: "A wide picture with its caption, then two columns of text." },
  { id: "picture-beside", label: "Picture beside text", description: "A tall picture with the text running beside it." },
  { id: "full-picture", label: "Full-page picture", description: "One large picture and its caption." },
  { id: "quotation", label: "Quotation and text", description: "A pull quotation, then two columns of text." },
  { id: "cover", label: "Cover", description: "The title with a framed picture." },
];

const text = (extra: Partial<TextBlock> = {}): TextBlock => ({ ...(newBlock("text") as TextBlock), ...extra });
const picture = (extra: Partial<ImageBlock> = {}): ImageBlock => ({ ...(newBlock("image") as ImageBlock), ...extra });
const beside = (extra: Partial<ImageTextBlock> = {}): ImageTextBlock => ({ ...(newBlock("image-text") as ImageTextBlock), ...extra });

export function compositionBlocks(id: CompositionId): Block[] {
  switch (id) {
    case "text": return [text()];
    case "section": return [newBlock("heading") as HeadingBlock, text({ dropCap: true })];
    case "picture-text": return [picture({ frame: "3:2" }), text({ columns: 2 })];
    case "picture-beside": return [beside({ frame: "4:5" }), text()];
    case "full-picture": return [picture({ frame: "4:5" })];
    case "quotation": return [{ ...(newBlock("quote") as QuoteBlock), style: "pull" }, text({ columns: 2 })];
    case "cover": return [newBlock("cover") as CoverBlock];
  }
}

// ---------------------------------------------------------------------------
// Illustrated arrangement of a converted note or document
// ---------------------------------------------------------------------------
const words = (markdown: string) => plainText(markdown).split(/\s+/).filter(Boolean).length;
const blockWords = (block: Block) => {
  switch (block.type) {
    case "text": return words(block.content);
    case "image-text": return words(block.content);
    case "quote": return words(block.text);
    case "heading": return words(`${block.text} ${block.intro}`);
    default: return 0;
  }
};
/** A line that starts an ordinary paragraph (not a list item, table row, quotation, callout or heading). */
const PLAIN_LINE = /^(?!\s*(?:[-*+]\s|\d+[.)]\s|\||>|#))\S/;

/** Places inside a text block where it may be divided: before a plain paragraph. */
function paragraphBreaks(content: string): Array<{ line: number; wordsBefore: number }> {
  const lines = content.split("\n");
  const breaks: Array<{ line: number; wordsBefore: number }> = [];
  let before = 0;
  for (let index = 0; index < lines.length; index += 1) {
    if (index > 0 && PLAIN_LINE.test(lines[index]) && lines[index - 1].trim()) breaks.push({ line: index, wordsBefore: before });
    before += words(lines[index]);
  }
  return breaks;
}

/** The first paragraphs of a text, up to about `limit` words, divided at a paragraph break. */
function takeParagraphs(content: string, limit: number): [string, string] | null {
  const lines = content.split("\n");
  const breaks = paragraphBreaks(content).filter((item) => item.wordsBefore > 0);
  const fitting = breaks.filter((item) => item.wordsBefore <= limit);
  const cut = fitting.length ? fitting[fitting.length - 1] : null;
  if (!cut) return words(content) <= limit ? [content, ""] : null;
  return [lines.slice(0, cut.line).join("\n").trim(), lines.slice(cut.line).join("\n").trim()];
}

type Candidate = { at: number; index: number; line: number | null; heading: boolean };

export type IllustratedLayout = { cover: CoverBlock; body: Block[]; frames: number };

/**
 * Arranges converted blocks as an illustrated article: a cover with a picture
 * frame, a drop initial at the opening, and one to three further picture frames
 * where the text breaks naturally (before a section, otherwise between
 * paragraphs), alternating a wide picture above the text with a tall picture
 * beside it. The words are not changed, only divided between blocks.
 */
export function illustratedLayout(blocks: Block[]): IllustratedLayout {
  const body: Block[] = blocks.map((block) => ({ ...block }));
  const firstText = body.findIndex((block) => block.type === "text");
  if (firstText >= 0 && body.slice(0, firstText).every((block) => block.type === "heading")) {
    body[firstText] = { ...(body[firstText] as TextBlock), dropCap: true };
  }
  const total = body.reduce((sum, block) => sum + blockWords(block), 0);
  const existing = body.filter((block) => (block.type === "image" || block.type === "image-text") && block.image).length;
  let wanted = Math.min(3, Math.floor(total / 420)) - existing;
  if (total >= 220 && existing === 0) wanted = Math.max(1, wanted);
  wanted = Math.max(0, wanted);

  // Where a picture could go, with the number of words read before that point.
  const candidates: Candidate[] = [];
  let read = 0;
  body.forEach((block, index) => {
    if (block.type === "heading" && block.level === "section" && index > firstText) candidates.push({ at: read, index, line: null, heading: true });
    if (block.type === "text") for (const item of paragraphBreaks(block.content)) candidates.push({ at: read + item.wordsBefore, index, line: item.line, heading: false });
    read += blockWords(block);
  });
  // Keep the opening typographic, and leave the last lines as they are.
  const usable = candidates.filter((item) => item.at >= Math.min(160, total * 0.18) && item.at <= total * 0.9);
  const chosen: Candidate[] = [];
  for (let k = 1; k <= wanted; k += 1) {
    const target = (total * k) / (wanted + 1);
    let best: Candidate | null = null;
    let bestScore = Infinity;
    for (const item of usable) {
      if (chosen.some((other) => Math.abs(other.at - item.at) < 170)) continue;
      const score = Math.abs(item.at - target) + (item.heading ? 0 : 70);
      if (score < bestScore) { best = item; bestScore = score; }
    }
    if (best) chosen.push(best);
  }
  chosen.sort((a, b) => a.at - b.at);

  // Apply from the end so earlier positions stay valid.
  const styles = chosen.map((_, order) => (order % 2 === 0 ? "above" : "beside") as "above" | "beside");
  let frames = 0;
  for (let order = chosen.length - 1; order >= 0; order -= 1) {
    const item = chosen[order];
    const style = styles[order];
    const side = order % 4 === 1 ? "left" : "right";
    if (item.heading) {
      // Before a section: a wide picture; or the section's first paragraphs beside a tall one.
      const next = body[item.index + 1];
      const split = style === "beside" && next?.type === "text" && !next.columns ? takeParagraphs(next.content, 170) : null;
      if (split && split[0]) {
        const rest: Block[] = split[1] ? [{ ...next, content: split[1], dropCap: false } as TextBlock] : [];
        body.splice(item.index + 1, 1, beside({ frame: "4:5", side, content: split[0] }), ...rest);
      } else {
        body.splice(item.index, 0, picture({ frame: "3:2" }));
      }
      frames += 1;
      continue;
    }
    const block = body[item.index] as TextBlock;
    const lines = block.content.split("\n");
    const head = lines.slice(0, item.line ?? 0).join("\n").trim();
    const tail = lines.slice(item.line ?? 0).join("\n").trim();
    if (!head || !tail) continue;
    const before: TextBlock = { ...block, content: head };
    const split = style === "beside" ? takeParagraphs(tail, 170) : null;
    if (split && split[0]) {
      const after: Block[] = split[1] ? [{ ...text({ columns: block.columns, align: block.align }), content: split[1] }] : [];
      body.splice(item.index, 1, before, beside({ frame: "4:5", side, content: split[0] }), ...after);
    } else {
      body.splice(item.index, 1, before, picture({ frame: "3:2" }), { ...text({ columns: block.columns, align: block.align }), content: tail });
    }
    frames += 1;
  }
  const cover: CoverBlock = { ...(newBlock("cover") as CoverBlock), style: "framed" };
  return { cover, body, frames: frames + 1 };
}
