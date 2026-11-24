import type { CSSProperties } from "react";
import type { BackgroundSettings } from "../hooks/useHeuresisBackground";

export type Wallpaper = { imageUrl: string; settings: BackgroundSettings };

export function activeWallpaper(background?: { imageUrl: string | null; settings: BackgroundSettings }): Wallpaper | undefined {
  return background?.imageUrl && background.settings.enabled
    ? { imageUrl: background.imageUrl, settings: background.settings }
    : undefined;
}

export function PageWallpaper({ wallpaper, fixed = false }: { wallpaper?: Wallpaper; fixed?: boolean }) {
  if (!wallpaper) return null;
  const { imageUrl, settings } = wallpaper;
  const style = {
    "--wallpaper-image": `url("${imageUrl}")`,
    "--wallpaper-opacity": settings.opacity,
    "--wallpaper-veil": settings.veil,
    "--wallpaper-blur": `${settings.blur}px`,
    "--wallpaper-position": settings.position,
    "--wallpaper-fit": settings.fit,
  } as CSSProperties;
  return <span className={fixed ? "page-wallpaper is-fixed" : "page-wallpaper"} style={style} aria-hidden="true" />;
}
