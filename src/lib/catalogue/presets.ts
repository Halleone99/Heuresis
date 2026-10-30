import type { CSSProperties } from "react";
import { A4, type CoverBlock, type TypographyPreset } from "./model";

/**
 * Page geometry of the three typography presets, in millimetres. These values
 * drive both the CSS of every page (as custom properties) and the few layout
 * calculations made in code, so the two cannot drift apart.
 */
export type PageGeometry = { top: number; bottom: number; inner: number; outer: number };

export const PAGE_GEOMETRY: Record<TypographyPreset, PageGeometry> = {
  classical: { top: 24, bottom: 27, inner: 23, outer: 23 },
  literary: { top: 26, bottom: 29, inner: 25, outer: 25 },
  archive: { top: 20, bottom: 23, inner: 20, outer: 20 },
};

/** Share of the content height given to a framed cover image, and of the page height to a full-bleed one. */
export const COVER_FRAME_SHARE = 0.62;
export const COVER_BLEED_SHARE = 0.6;

export function contentSize(preset: TypographyPreset) {
  const g = PAGE_GEOMETRY[preset];
  return { width: A4.widthMm - g.inner - g.outer, height: A4.heightMm - g.top - g.bottom };
}

/** The frame proportion (width / height) of a cover image, fixed by the cover style. */
export function coverFrameAspect(preset: TypographyPreset, style: CoverBlock["style"]) {
  if (style === "full-bleed") return A4.widthMm / (A4.heightMm * COVER_BLEED_SHARE);
  const size = contentSize(preset);
  return size.width / (size.height * COVER_FRAME_SHARE);
}

export function pageStyle(preset: TypographyPreset): CSSProperties {
  const g = PAGE_GEOMETRY[preset];
  return {
    "--ap-mt": `${g.top}mm`, "--ap-mb": `${g.bottom}mm`, "--ap-mi": `${g.inner}mm`, "--ap-mo": `${g.outer}mm`,
  } as CSSProperties;
}

/** Fonts used by each preset, for loading before layout and for the PDF registry. */
export const PRESET_FACES: Record<TypographyPreset, Array<{ family: string; weight: number; style: "normal" | "italic" }>> = {
  classical: [
    { family: "Libre Caslon Display", weight: 400, style: "normal" },
    { family: "EB Garamond", weight: 400, style: "normal" }, { family: "EB Garamond", weight: 400, style: "italic" },
    { family: "EB Garamond", weight: 600, style: "normal" }, { family: "EB Garamond", weight: 600, style: "italic" },
  ],
  literary: [
    { family: "Cormorant Garamond", weight: 500, style: "normal" }, { family: "Cormorant Garamond", weight: 500, style: "italic" },
    { family: "Cormorant Garamond", weight: 600, style: "normal" },
    { family: "EB Garamond", weight: 400, style: "normal" }, { family: "EB Garamond", weight: 400, style: "italic" },
    { family: "EB Garamond", weight: 600, style: "normal" },
  ],
  archive: [
    { family: "Noto Serif", weight: 400, style: "normal" }, { family: "Noto Serif", weight: 400, style: "italic" },
    { family: "Noto Serif", weight: 700, style: "normal" },
    { family: "Inter", weight: 400, style: "normal" }, { family: "Inter", weight: 500, style: "normal" }, { family: "Inter", weight: 600, style: "normal" },
  ],
};
