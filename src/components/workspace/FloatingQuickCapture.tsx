import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Feather, GripVertical, Maximize2, X } from "lucide-react";
import AuthGate from "../AuthGate";
import { captureDraftSummary, QQuickCapture, type NativeCaptureWindow } from "./QQuickCapture";
import { Toaster } from "./ui";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";

/**
 * The desktop's floating Capture window (Tauri). The window itself is the page:
 * it can be moved, resized from its corner grip, kept on top, made
 * full screen for writing a lesson, or folded into a small bubble.
 */
type View = "bubble" | "window";
type Size = { width: number; height: number };
const BUBBLE: Size = { width: 270, height: 58 };
const DEFAULT_SIZE: Size = { width: 620, height: 660 };
const viewKey = (userId: string) => `heuresis.quick.view.v1:${userId}`;
const sizeKey = (userId: string) => `heuresis.quick.size.v1:${userId}`;
const isTauri = () => "__TAURI_INTERNALS__" in window;

function readSize(userId: string): Size {
  try {
    const saved = JSON.parse(localStorage.getItem(sizeKey(userId)) || "null") as Partial<Size> | null;
    if (saved && Number(saved.width) >= 340 && Number(saved.height) >= 300) return { width: Number(saved.width), height: Number(saved.height) };
  } catch { /* optional */ }
  return DEFAULT_SIZE;
}

async function tauriWindow() {
  const [{ getCurrentWindow }, dpi] = await Promise.all([import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi")]);
  return { win: getCurrentWindow(), dpi };
}

/** The window's current size in logical pixels. */
async function currentSize(): Promise<Size | null> {
  if (!isTauri()) return null;
  const { win } = await tauriWindow();
  const [size, scale] = await Promise.all([win.innerSize(), win.scaleFactor()]);
  return { width: Math.round(size.width / scale), height: Math.round(size.height / scale) };
}

/** Resize, then move the window back inside the screen's work area if it now overhangs it. */
async function applySize(next: Size) {
  if (!isTauri()) return;
  const { win, dpi } = await tauriWindow();
  const { currentMonitor } = await import("@tauri-apps/api/window");
  const monitor = await currentMonitor().catch(() => null);
  const scale = monitor?.scaleFactor ?? await win.scaleFactor();
  const area = monitor?.workArea;
  const width = area ? Math.min(next.width, Math.floor(area.size.width / scale) - 16) : next.width;
  const height = area ? Math.min(next.height, Math.floor(area.size.height / scale) - 16) : next.height;
  await win.setSize(new dpi.LogicalSize(width, height));
  if (!area) return;
  const position = await win.outerPosition();
  const outer = await win.outerSize();
  const maxX = area.position.x + area.size.width - outer.width;
  const maxY = area.position.y + area.size.height - outer.height;
  const x = Math.max(area.position.x, Math.min(position.x, maxX));
  const y = Math.max(area.position.y, Math.min(position.y, maxY));
  if (x !== position.x || y !== position.y) await win.setPosition(new dpi.PhysicalPosition(x, y));
}

function FloatingBody({ session }: { session: Session }) {
  const workspace = useWorkspace();
  const userId = session.user.id;
  const [view, setView] = useState<View>(() => {
    try { return localStorage.getItem(viewKey(userId)) === "bubble" ? "bubble" : "window"; }
    catch { return "window"; }
  });
  const [fullscreen, setFullscreen] = useState(false);
  const [onTop, setOnTop] = useState(true);
  const [notice, setNotice] = useState("");
  const report = useCallback((reason: unknown) => setNotice(reason instanceof Error ? reason.message : String(reason)), []);

  useEffect(() => {
    if (view === "window") workspace.openCapture({ mode: "note" });
    if (!isTauri()) return;
    void (async () => {
      const { win } = await tauriWindow();
      setFullscreen(await win.isFullscreen());
      await applySize(view === "bubble" ? BUBBLE : readSize(userId));
    })().catch(report);
    // Open the first draft and size the window once; not after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { try { localStorage.setItem(viewKey(userId), view); } catch { /* optional */ } }, [view, userId]);
  useEffect(() => {
    if (!isTauri()) return;
    void tauriWindow().then(({ win }) => win.setAlwaysOnTop(onTop)).catch(report);
  }, [onTop, report]);
  // Remember the size the window was given by hand, so it reopens the same way.
  useEffect(() => {
    if (!isTauri() || view !== "window") return;
    let off: (() => void) | undefined;
    let timer = 0;
    void tauriWindow().then(({ win }) => win.onResized(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void Promise.all([currentSize(), win.isFullscreen()]).then(([size, full]) => {
          setFullscreen(full);
          if (size && !full && size.width >= 340 && size.height >= 300) {
            try { localStorage.setItem(sizeKey(userId), JSON.stringify(size)); } catch { /* optional */ }
          }
        }).catch(() => undefined);
      }, 300);
    })).then((dispose) => { off = dispose; }).catch(() => undefined);
    return () => { window.clearTimeout(timer); off?.(); };
  }, [view, userId]);
  useEffect(() => {
    if (!isTauri()) return;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("heuresis:quick-open", ({ payload }) => {
        setView((current) => {
          if (current === "bubble") void applySize(readSize(userId)).catch(report);
          return "window";
        });
        workspace.openCapture({ mode: payload === "mistake" ? "mistake" : "note" });
      })).then((dispose) => { off = dispose; }).catch(report);
    return () => { off?.(); };
  }, [workspace.openCapture, userId, report]);

  // Closing hides the window; the draft stays for the next Ctrl+Alt+Space.
  const hide = useCallback(async () => {
    if (!isTauri()) { setView("bubble"); return; }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }, []);
  const expand = useCallback(() => {
    setView("window");
    workspace.openCapture({ mode: "note" });
    void applySize(readSize(userId)).catch(report);
  }, [report, userId, workspace]);
  const drag = useCallback(() => {
    if (!isTauri()) return;
    void tauriWindow().then(({ win }) => win.startDragging()).catch(report);
  }, [report]);

  const native = useMemo<NativeCaptureWindow>(() => ({
    fullscreen, onTop,
    toggleFullscreen: () => {
      if (!isTauri()) { setFullscreen((value) => !value); return; }
      void tauriWindow().then(async ({ win }) => {
        const next = !(await win.isFullscreen());
        await win.setFullscreen(next);
        setFullscreen(next);
      }).catch(report);
    },
    toggleOnTop: () => setOnTop((value) => !value),
    minimise: () => {
      void (async () => {
        if (isTauri()) {
          const { win } = await tauriWindow();
          if (await win.isFullscreen()) { await win.setFullscreen(false); setFullscreen(false); }
          const size = await currentSize();
          if (size && size.width >= 340 && size.height >= 300) {
            try { localStorage.setItem(sizeKey(userId), JSON.stringify(size)); } catch { /* optional */ }
          }
        }
        setView("bubble");
        await applySize(BUBBLE);
      })().catch(report);
    },
    startDrag: drag,
    startResize: () => {
      if (!isTauri()) return;
      void tauriWindow().then(({ win }) => win.startResizeDragging("SouthEast")).catch(report);
    },
    ensureSize: (width, height) => {
      if (fullscreen) return;
      void currentSize().then((size) => {
        if (!size || (size.width >= width && size.height >= height)) return;
        return applySize({ width: Math.max(size.width, width), height: Math.max(size.height, height) });
      }).catch(report);
    },
  }), [drag, fullscreen, onTop, report, userId]);

  const summary = view === "bubble" ? captureDraftSummary(userId, true) : "";
  return <div className="quick-floating-root" data-view={view} data-fullscreen={fullscreen ? "true" : undefined}>
    {view === "bubble" ? <div className="cap-bubble">
      <button type="button" className="cap-bubble-grip" aria-label="Move Capture"
        onPointerDown={(event) => { if (event.button === 0) drag(); }}><GripVertical size={16} /></button>
      <button type="button" className="cap-bubble-open" onClick={expand} title="Open Capture">
        <Feather size={16} aria-hidden="true" /><span>{summary || "New capture"}</span>
      </button>
      <button type="button" className="cap-bubble-icon" aria-label="Open Capture" title="Open" onClick={expand}><Maximize2 size={15} /></button>
      <button type="button" className="cap-bubble-icon" aria-label="Close Capture" title="Close (the draft stays)"
        onClick={() => void hide().catch(report)}><X size={15} /></button>
    </div> : <QQuickCapture floating onRequestClose={() => void hide().catch(report)} native={native} />}
    {notice ? <p className="quick-floating-notice" role="alert">{notice}<button type="button" onClick={() => setNotice("")} aria-label="Dismiss">×</button></p> : null}
    <Toaster />
  </div>;
}

export default function FloatingQuickCapture() {
  return <AuthGate>{(session) => <WorkspaceProvider userId={session.user.id}
    section="queue" onSection={() => undefined}><FloatingBody session={session} /></WorkspaceProvider>}</AuthGate>;
}
