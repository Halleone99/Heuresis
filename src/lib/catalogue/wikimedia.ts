import type { Attribution } from "./model";

/**
 * Image search through Wikimedia Commons, whose files carry machine-readable
 * licence and attribution metadata. Results are real files with their real
 * licences; nothing is invented when the service is unreachable.
 * API: https://www.mediawiki.org/wiki/API:Search and API:Imageinfo (anonymous CORS via origin=*).
 */
const ENDPOINT = "https://commons.wikimedia.org/w/api.php";
const PLACEABLE = /^image\/(jpeg|png|gif|webp|tiff|svg\+xml)$/i;

export type CommonsResult = {
  title: string;
  pageUrl: string;
  thumbUrl: string;
  thumbWidth: number;
  thumbHeight: number;
  width: number;
  height: number;
  mime: string;
  description: string;
  attribution: Attribution;
  attributionRequired: boolean;
};

/** Plain text from the small HTML fragments Commons uses in metadata. */
export function metadataText(value: unknown): string {
  if (typeof value !== "string") return "";
  const document = new DOMParser().parseFromString(`<body>${value}</body>`, "text/html");
  return (document.body.textContent ?? "").replace(/\s+/g, " ").trim();
}

type ExtValue = { value?: unknown };
type ImageInfo = {
  url?: string; descriptionurl?: string; thumburl?: string; thumbwidth?: number; thumbheight?: number;
  width?: number; height?: number; mime?: string; extmetadata?: Record<string, ExtValue>;
};
type ApiPage = { title?: string; index?: number; imageinfo?: ImageInfo[] };

export function parseCommonsResponse(json: unknown): CommonsResult[] {
  const pages = (json as { query?: { pages?: Record<string, ApiPage> | ApiPage[] } })?.query?.pages;
  const list = Array.isArray(pages) ? pages : pages ? Object.values(pages) : [];
  return list
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((page): CommonsResult[] => {
      const info = page.imageinfo?.[0];
      if (!info?.url || !info.thumburl || !page.title || !PLACEABLE.test(info.mime ?? "")) return [];
      const meta = info.extmetadata ?? {};
      const licence = metadataText(meta.LicenseShortName?.value) || metadataText(meta.UsageTerms?.value);
      // Without a stated licence the file cannot be reused responsibly.
      if (!licence) return [];
      const licenceUrl = metadataText(meta.LicenseUrl?.value);
      const author = metadataText(meta.Artist?.value) || metadataText(meta.Credit?.value);
      return [{
        title: metadataText(meta.ObjectName?.value) || page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""),
        pageUrl: info.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title)}`,
        thumbUrl: info.thumburl,
        thumbWidth: info.thumbwidth ?? 480,
        thumbHeight: info.thumbheight ?? 320,
        width: info.width ?? info.thumbwidth ?? 480,
        height: info.height ?? info.thumbheight ?? 320,
        mime: info.mime ?? "image/jpeg",
        description: metadataText(meta.ImageDescription?.value).slice(0, 300),
        attribution: {
          provider: "wikimedia",
          title: page.title.replace(/^File:/, ""),
          author: author.slice(0, 200) || undefined,
          licence,
          licenceUrl: /^https?:\/\//.test(licenceUrl) ? licenceUrl.replace(/^http:/, "https:") : undefined,
          sourceUrl: info.descriptionurl,
        },
        attributionRequired: metadataText(meta.AttributionRequired?.value) !== "false",
      }];
    });
}

export async function searchCommons(query: string, offset = 0, signal?: AbortSignal): Promise<{ results: CommonsResult[]; nextOffset: number | null }> {
  const terms = query.trim();
  if (!terms) return { results: [], nextOffset: null };
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    generator: "search", gsrsearch: terms, gsrnamespace: "6", gsrlimit: "24", gsroffset: String(offset),
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: "480",
    iiextmetadatafilter: "ObjectName|ImageDescription|Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms|AttributionRequired",
  });
  let response: Response;
  try { response = await fetch(`${ENDPOINT}?${params}`, { signal, headers: { Accept: "application/json" } }); }
  catch (error) {
    if ((error as Error)?.name === "AbortError") throw error;
    throw new Error("Wikimedia Commons could not be reached. Check the connection, or upload an image instead.");
  }
  if (!response.ok) throw new Error(`Wikimedia Commons did not answer (HTTP ${response.status}). Try again later.`);
  const json = await response.json() as { continue?: { gsroffset?: number } };
  return { results: parseCommonsResponse(json), nextOffset: typeof json.continue?.gsroffset === "number" ? json.continue.gsroffset : null };
}

/** A print-quality copy (at most 2400 px wide; SVG drawings arrive as PNG). */
export async function downloadCommonsImage(result: CommonsResult): Promise<Blob> {
  const params = new URLSearchParams({
    action: "query", format: "json", formatversion: "2", origin: "*",
    titles: `File:${result.attribution.title ?? result.title}`, prop: "imageinfo", iiprop: "url|mime|size", iiurlwidth: "2400",
  });
  let url = result.thumbUrl;
  try {
    const response = await fetch(`${ENDPOINT}?${params}`);
    if (response.ok) {
      const json = await response.json() as { query?: { pages?: ApiPage[] } };
      const info = json.query?.pages?.[0]?.imageinfo?.[0];
      const raster = info && /svg|tiff/i.test(info.mime ?? "") ? info.thumburl : (info?.width ?? 0) > 2400 ? info?.thumburl : info?.url;
      if (raster) url = raster;
    }
  } catch { /* fall back to the preview size */ }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`The image could not be downloaded (HTTP ${response.status}).`);
  const blob = await response.blob();
  if (!/^image\//.test(blob.type)) throw new Error("Wikimedia Commons returned something that is not an image.");
  return blob;
}

export function attributionLine(attribution: Attribution | null | undefined) {
  if (!attribution) return "";
  const parts = [attribution.author, attribution.licence].filter(Boolean);
  if (attribution.provider === "wikimedia") parts.push("Wikimedia Commons");
  return parts.join(" · ");
}
