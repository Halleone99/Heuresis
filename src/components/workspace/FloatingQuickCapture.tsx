import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { CircleDot, Maximize2, Minimize2, NotebookPen, Pin, PinOff, X } from "lucide-react";
import AuthGate from "../AuthGate";
import { entryTitle } from "../../lib/knowledgeWorkspace";
import { QuickCapture } from "./QuickCapture";
import { Toaster } from "./ui";
import { WorkspaceProvider, useWorkspace, type CaptureMode } from "./WorkspaceContext";

type FloatingSize = "bubble" | "compact" | "expanded";
const DIMENSIONS: Record<FloatingSize, [number, number]> = {
  bubble: [238, 98], compact: [492, 338], expanded: [560, 700],
};
const viewKey = (userId: string) => `heuresis.quick.view.v1:${userId}`;
const pinKey = (userId: string) => `heuresis.quick.pin.v1:${userId}`;
const positionKey = "heuresis.quick.position.v1";

function storedView(userId: string): FloatingSize {
  try {
    const value = localStorage.getItem(viewKey(userId));
    return value === "expanded" || value === "bubble" ? value : "compact";
  } catch { return "compact"; }
}
function savePref(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* optional */ }
}
function FloatingCaptureBody({ session }: { session: Session }) {
  const workspace = useWorkspace();
  const [view, setView] = useState<FloatingSize>(() => storedView(session.user.id));
  const [pin, setPin] = useState(() => {
    try { return localStorage.getItem(pinKey(session.user.id)) !== "false"; }
    catch { return true; }
  });
  const [notice, setNotice] = useState("");
  const started = useMemo(() => Date.now(), []);
  const lesson = workspace.currentLesson;
  const captured = useMemo(() => workspace.snapshot.entries
    .filter((entry) => lesson ? entry.lesson_id === lesson.id : new Date(entry.created_at).getTime() >= started)
    .sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 18),
  [lesson, started, workspace.snapshot.entries]);

  const openCapture = (mode: CaptureMode = "note") => {
    setView((current) => current === "bubble" ? "compact" : current);
    workspace.openCapture({ mode });
  };

  // The capture pane is the exact same durable, idempotent save path as
  // Notebook. Only its containing window and controls differ.
  useEffect(() => {
    workspace.updateMemory((memory) => ({
      ...memory,
      capture: { ...memory.capture, keepOpen: true, stream: true },
    }));
    if (view !== "bubble") workspace.openCapture({ mode: "note" });
    // Initialisation must run once per authenticated floating window.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    savePref(viewKey(session.user.id), view);
    if (!("__TAURI_INTERNALS__" in window)) return;
    let disposed = false;
    void (async () => {
      const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
        import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi"),
      ]);
      if (disposed) return;
      const [width, height] = DIMENSIONS[view];
      await getCurrentWindow().setSize(new LogicalSize(width, height));
    })().catch((error) => setNotice(String(error)));
    return () => { disposed = true; };
  }, [view, session.user.id]);

  useEffect(() => {
    savePref(pinKey(session.user.id), String(pin));
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().setAlwaysOnTop(pin)).catch((error) => setNotice(String(error)));
  }, [pin, session.user.id]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let active = true;
    let offMove: (() => void) | undefined;
    let offOpen: (() => void) | undefined;
    void (async () => {
      const [{ getCurrentWindow }, { PhysicalPosition }, { listen }] = await Promise.all([
        import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi"), import("@tauri-apps/api/event"),
      ]);
      const appWindow = getCurrentWindow();
      const raw = localStorage.getItem(positionKey);
      if (raw) {
        try {
          const position = JSON.parse(raw) as { x: number; y: number };
          if (Number.isFinite(position.x) && Number.isFinite(position.y)) {
            await appWindow.setPosition(new PhysicalPosition(position.x, position.y));
          }
        } catch { /* Invalid or inaccessible saved geometry is ignored. */ }
      }
      if (!active) return;
      offMove = await appWindow.onMoved(({ payload: position }) =>
        savePref(positionKey, JSON.stringify({ x: position.x, y: position.y })));
      offOpen = await listen<string>("heuresis:quick-open", ({ payload }) => {
        const mode: CaptureMode = payload === "mistake" || payload === "lesson" ? payload : "note";
        setView("compact");
        workspace.openCapture({ mode });
      });
    })().catch((error) => setNotice(String(error)));
    return () => { active = false; offMove?.(); offOpen?.(); };
  }, [workspace.openCapture]);

  async function drag() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  }
  async function hide() {
    // Keeping the same window alive also preserves the draft and input.
    if (!("__TAURI_INTERNALS__" in window)) { setView("bubble"); return; }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }

  return <div className="quick-floating-root" data-view={view}>
    <header className="quick-floating-bar">
      <button type="button" className="quick-floating-grip" onPointerDown={(event) => {
        if (event.button === 0) void drag().catch((error) => setNotice(String(error)));
      }} title="Drag to move Quick Capture" aria-label="Drag Quick Capture">
        <CircleDot size={12}/><span>{lesson ? entryTitle(lesson) : "Quick Capture"}</span>
      </button>
      <span className="quick-floating-count" title="Captures in this lesson or since opening">
        {captured.length} captured
      </span>
      <button type="button" className="quick-floating-icon" onClick={() => setPin((value) => !value)}
        title={pin ? "Unpin: allow other windows on top" : "Pin above other windows"}
        aria-label={pin ? "Unpin capture window" : "Pin capture window"}
        aria-pressed={pin}>{pin ? <Pin size={14}/> : <PinOff size={14}/>}</button>
      <button type="button" className="quick-floating-icon" title={view === "bubble" ? "Open input" : "Collapse to bubble"}
        aria-label={view === "bubble" ? "Open capture input" : "Collapse to bubble"}
        onClick={() => view === "bubble" ? openCapture() : setView("bubble")}>
        {view === "bubble" ? <Maximize2 size={14}/> : <Minimize2 size={14}/>}</button>
      <button type="button" className="quick-floating-icon" title="Hide quick capture" aria-label="Hide quick capture"
        onClick={() => void hide().catch((error) => setNotice(String(error)))}><X size={14}/></button>
    </header>
    {view === "bubble" ? <button type="button" className="quick-floating-bubble" onClick={() => openCapture()}>
      <NotebookPen size={15}/> Capture now · Ctrl+Alt+Space
    </button> : null}
    {/* Remains mounted in bubble mode so drafts are never lost on collapse. */}
    <div className="quick-floating-stage">
      <QuickCapture floating/>
      {!workspace.capture ? <button type="button" className="quick-floating-reopen" onClick={() => openCapture()}>
        <NotebookPen size={15}/> New capture</button> : null}
    </div>
    {view !== "bubble" ? <>
      {view === "expanded" ? <section className="quick-floating-recent" aria-label="Captured during this lesson">
        <div className="quick-floating-recent-head">
          <strong>Running captures</strong><small>{lesson ? "Current lesson" : "Since window opened"}</small>
        </div>
        {!captured.length ? <p>Your captured lines appear here as you save them.</p> :
          <ol>{captured.map((entry) => <li key={entry.id}>
            <time>{new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            <span>{entry.kind === "mistake" ? [entry.attempt, entry.correction].filter(Boolean).join(" → ") : entryTitle(entry)}</span>
          </li>)}</ol>}
      </section> : null}
      <footer className="quick-floating-footer">
        <span>{view === "compact" ? "Enter saves each line" : "Live lesson stream"}</span>
        <button type="button" onClick={() => setView(view === "expanded" ? "compact" : "expanded")}>
          {view === "expanded" ? "Compact" : "Expand history"}
        </button>
      </footer>
    </> : null}
    {notice ? <p className="quick-floating-notice" role="alert">{notice}</p> : null}
    <Toaster/>
  </div>;
}

export default function FloatingQuickCapture() {
  return <AuthGate>{(session) =>
    <WorkspaceProvider userId={session.user.id} section="notebook" onSection={() => undefined}>
      <FloatingCaptureBody session={session}/>
    </WorkspaceProvider>
  }</AuthGate>;
}
