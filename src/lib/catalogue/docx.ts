import { htmlToBlocks, type HtmlImport, type ImportedImage } from "./convert";

/**
 * Word (.docx) import. mammoth reads the document's text and structure only:
 * macros, scripts, embedded objects and external links are never executed or
 * fetched. Its HTML is then parsed into an inert document and reduced to the
 * whitelisted article structure by htmlToBlocks().
 */
const MAX_DOCX_BYTES = 40 * 1024 * 1024;

// Word style names → structure kept by the import.
const STYLE_MAP = [
  "p[style-name='Title'] => h1.title:fresh",
  "p[style-name='Subtitle'] => p.subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Block Text'] => blockquote > p:fresh",
  "p[style-name='Caption'] => p.caption:fresh",
  "r[style-name='Strong'] => strong",
  "r[style-name='Emphasis'] => em",
  // Underline has no place in the Catalogue's typography; mapping it makes it visible
  // to the import so it can be reported instead of vanishing silently.
  "u => u",
];

type MammothMessage = { type: "warning" | "error"; message: string };
type MammothImage = { contentType: string; altText?: string; read: (encoding?: string) => Promise<ArrayBuffer | Uint8Array | string> };
type Mammoth = {
  convertToHtml: (input: { arrayBuffer: ArrayBuffer }, options: Record<string, unknown>) => Promise<{ value: string; messages: MammothMessage[] }>;
  images: { imgElement: (handler: (image: MammothImage) => Promise<Record<string, string>>) => unknown };
};

export type DocxImport = HtmlImport & { images: ImportedImage[]; warnings: string[] };

function friendlyWarning(message: string) {
  if (/Unrecognised paragraph style/i.test(message)) {
    const name = /'([^']+)'/.exec(message)?.[1];
    return name ? `Paragraph style “${name}” was imported as normal text.` : "Some paragraph styles were imported as normal text.";
  }
  if (/Unrecognised run style/i.test(message)) return "Some character styles were imported as normal text.";
  if (/image/i.test(message)) return "An image could not be read and was left out.";
  return message.replace(/\s+/g, " ").slice(0, 200);
}

export async function importDocx(file: File): Promise<DocxImport> {
  if (!/\.docx$/i.test(file.name) && file.type !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    throw new Error("Choose a Word document (.docx). Older .doc files need to be saved as .docx first.");
  if (file.size > MAX_DOCX_BYTES) throw new Error("This document is larger than 40 MB. Save a copy without very large images and try again.");
  const module = await import("mammoth/mammoth.browser.min.js") as unknown as { default?: Mammoth } & Mammoth;
  const mammoth: Mammoth = module.default ?? module;
  const images: ImportedImage[] = [];
  let arrayBuffer: ArrayBuffer;
  try { arrayBuffer = await file.arrayBuffer(); }
  catch { throw new Error("The file could not be read."); }
  let result: { value: string; messages: MammothMessage[] };
  try {
    result = await mammoth.convertToHtml({ arrayBuffer }, {
      styleMap: STYLE_MAP,
      includeDefaultStyleMap: true,
      ignoreEmptyParagraphs: true,
      convertImage: mammoth.images.imgElement(async (image) => {
        const key = `docx-image:${images.length}`;
        const raw = await image.read();
        const bytes = raw instanceof ArrayBuffer ? raw : raw instanceof Uint8Array ? raw.slice().buffer as ArrayBuffer : new TextEncoder().encode(String(raw)).buffer as ArrayBuffer;
        images.push({ key, contentType: image.contentType || "image/png", bytes, alt: image.altText ?? "" });
        return { src: key, alt: image.altText ?? "" };
      }),
    });
  } catch (error) {
    throw new Error(`This document could not be imported: ${error instanceof Error ? error.message : String(error)}. Check that it opens in Word and is not password-protected.`);
  }
  const imported = htmlToBlocks(result.value);
  const warnings = new Set<string>();
  for (const message of result.messages) warnings.add(friendlyWarning(message.message));
  for (const item of imported.skipped) warnings.add(`Not imported: ${item}.`);
  const unsupportedImages = images.filter((image) => !/^image\/(png|jpe?g|gif|webp)$/i.test(image.contentType));
  if (unsupportedImages.length) warnings.add(`${unsupportedImages.length} image${unsupportedImages.length === 1 ? " is" : "s are"} in a format Heuresis cannot place (for example EMF or WMF drawings) and ${unsupportedImages.length === 1 ? "was" : "were"} left out.`);
  return { ...imported, images, warnings: Array.from(warnings) };
}
