import type { AspectChoice, ImageRef } from "./model";

/**
 * Non-destructive image framing. The stored file is never altered; a frame
 * (proportion, fit/fill, zoom, focal point) decides which part is visible.
 * The result is expressed in percentages of the frame, so the same numbers
 * position the image on screen, in thumbnails and in the exported PDF
 * (which measures the laid-out page).
 */
export function aspectValue(aspect: AspectChoice, image: Pick<ImageRef, "width" | "height">) {
  if (aspect === "original") return image.width / Math.max(1, image.height);
  const [w, h] = aspect.split(":").map(Number);
  return w / h;
}

export type FrameGeometry = {
  /** Frame width / height. */
  frameAspect: number;
  /** Image box inside the frame, in percent of the frame's width (x, w) and height (y, h). */
  left: number; top: number; width: number; height: number;
};

export function frameGeometry(image: ImageRef, aspectOverride?: number): FrameGeometry {
  const imageAspect = image.width / Math.max(1, image.height);
  const frameAspect = aspectOverride ?? aspectValue(image.aspect, image);
  if (image.fit === "fit") {
    // The whole picture is visible; it is centred in the frame.
    if (imageAspect > frameAspect) {
      const height = (frameAspect / imageAspect) * 100;
      return { frameAspect, left: 0, top: (100 - height) / 2, width: 100, height };
    }
    const width = (imageAspect / frameAspect) * 100;
    return { frameAspect, left: (100 - width) / 2, top: 0, width, height: 100 };
  }
  // Fill: cover the frame, magnify by zoom, keep the focal point in view.
  let width: number; let height: number;
  if (imageAspect > frameAspect) { height = 100; width = (imageAspect / frameAspect) * 100; }
  else { width = 100; height = (frameAspect / imageAspect) * 100; }
  const zoom = Math.min(4, Math.max(1, image.zoom || 1));
  width *= zoom; height *= zoom;
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  const left = clamp(50 - image.focalX * width, 100 - width, 0);
  const top = clamp(50 - image.focalY * height, 100 - height, 0);
  return { frameAspect, left, top, width, height };
}

/** The focal point that would put a given frame position (0–1) at the centre, for click-to-focus. */
export function focalFromFramePoint(image: ImageRef, x: number, y: number, aspectOverride?: number) {
  const geometry = frameGeometry({ ...image, fit: "fill" }, aspectOverride);
  const fx = ((x * 100) - geometry.left) / geometry.width;
  const fy = ((y * 100) - geometry.top) / geometry.height;
  return { focalX: Math.min(1, Math.max(0, fx)), focalY: Math.min(1, Math.max(0, fy)) };
}
