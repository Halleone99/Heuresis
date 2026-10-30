import { CATALOGUE_FONT_FILES } from "./pdf/fontManifest.generated";
import { PRESET_FACES } from "./presets";
import { articleText, type CatalogueArticle } from "./model";

let registered = false;

/**
 * Registers the Catalogue-only families (EB Garamond, Cormorant Garamond and the
 * private Chinese family) from the same WOFF files the PDF export embeds.
 * Like @font-face rules, each subset downloads only when its characters appear.
 */
export function registerCatalogueFonts() {
  if (registered || typeof document === "undefined" || typeof FontFace === "undefined") return;
  registered = true;
  for (const file of CATALOGUE_FONT_FILES) {
    if (!file.screen) continue;
    try {
      document.fonts.add(new FontFace(file.family, `url("${file.url}") format("woff")`, {
        weight: String(file.weight), style: file.style, unicodeRange: file.ranges, display: "swap",
      }));
    } catch { /* an unsupported descriptor must not stop the others */ }
  }
}

const CJK_FAMILY = "Heuresis Catalogue SC";

/** Load every face an article needs before its pages are measured or exported. */
export async function ensureArticleFonts(article: Pick<CatalogueArticle, "typography_preset"> & Partial<CatalogueArticle>, extraText = "") {
  registerCatalogueFonts();
  if (typeof document === "undefined" || !document.fonts) return;
  const text = Array.from(new Set(`${article.pages ? articleText(article as CatalogueArticle) : ""} ${extraText} 0123456789 ABCabc`)).join("");
  const faces = [...PRESET_FACES[article.typography_preset],
    { family: CJK_FAMILY, weight: 400, style: "normal" as const },
    { family: "Noto Serif", weight: 400, style: "normal" as const }];
  await Promise.allSettled(faces.map((face) =>
    document.fonts.load(`${face.style} ${face.weight} 16px "${face.family}"`, text)));
  await document.fonts.ready;
}
