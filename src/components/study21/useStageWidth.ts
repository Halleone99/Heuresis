import { useEffect, useState, type RefObject } from "react";

/** The observed shell width, not the physical screen width, decides panel layout. */
export function useStageWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(() => typeof window === "undefined" ? 1280 : window.innerWidth);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}
