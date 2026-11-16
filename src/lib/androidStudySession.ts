import { useEffect, useRef } from "react";
import { isAndroidRuntime } from "./platform";

/** A single history entry for full-screen Android New/Learn; StrictMode reuses it. */
export function useAndroidOverlayBack(kind: "new" | "learn", onBack: () => void) {
  const callback = useRef(onBack);
  callback.current = onBack;
  useEffect(() => {
    if (!isAndroidRuntime()) return;
    const state = window.history.state as Record<string, unknown> | null;
    if (state?.heuresisOverlay) window.history.replaceState({ ...state, heuresisOverlay: kind }, "");
    else window.history.pushState({ ...(state ?? {}), heuresisOverlay: kind }, "");
    const onPop = (event: PopStateEvent) => {
      if ((event.state as { heuresisOverlay?: string } | null)?.heuresisOverlay !== kind) {
        callback.current();
        // A save can fail or an editor can refuse to close. If the overlay remains
        // on screen, restore its Back guard rather than letting the next swipe exit.
        window.setTimeout(() => {
          const stillOpen = document.querySelector(kind === "new" ? ".sort-modal--session" : ".lrn");
          if (stillOpen && !window.history.state?.heuresisOverlay) {
            window.history.pushState({ ...(window.history.state ?? {}), heuresisOverlay: kind }, "");
          }
        }, 120);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [kind]);
  return (preserveForNextOverlay = false) => {
    if (isAndroidRuntime() && !preserveForNextOverlay && window.history.state?.heuresisOverlay === kind) {
      window.history.back();
    }
  };
}

/** Native keep-screen-on backs up WebView implementations without Wake Lock. */
export function useAndroidStudyWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !isAndroidRuntime()) return;
    let disposed = false;
    let lock: WakeLockSentinel | null = null;
    const native = () => window.HeuresisAndroidSpeech;
    const acquire = async () => {
      if (disposed || document.visibilityState === "hidden") return;
      try {
        if (!("wakeLock" in navigator)) throw new Error("Wake Lock unavailable");
        lock = await navigator.wakeLock.request("screen");
        if (disposed) { void lock.release(); lock = null; }
      } catch {
        if (!disposed) native()?.keepScreenOn(true);
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void acquire();
      else {
        if (lock) { void lock.release(); lock = null; }
        native()?.keepScreenOn(false);
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", visible);
    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", visible);
      if (lock) { void lock.release(); lock = null; }
      native()?.keepScreenOn(false);
    };
  }, [active]);
}
