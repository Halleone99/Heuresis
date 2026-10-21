import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Feather, Maximize2, Minimize2, Pin, X } from "lucide-react";
import AuthGate from "../AuthGate";
import { QQuickCapture } from "./QQuickCapture";
import { Toaster } from "./ui";
import { WorkspaceProvider, useWorkspace } from "./WorkspaceContext";

type FloatingSize = "bubble" | "compact";
const SIZES: Record<FloatingSize, [number, number]> = { bubble: [230, 76], compact: [600, 630] };
const keyFor = (userId: string) => `heuresis.quick.view.v1:${userId}`;

function FloatingBody({ session }: { session: Session }) {
  const workspace = useWorkspace();
  const [view, setView] = useState<FloatingSize>(() => {
    try { return localStorage.getItem(keyFor(session.user.id)) === "bubble" ? "bubble" : "compact"; }
    catch { return "compact"; }
  });
  const [pinned, setPinned] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (view === "compact") workspace.openCapture({ mode: "note" });
    // Open the first draft once; do not reset a draft after every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem(keyFor(session.user.id), view); } catch { /* optional */ }
    if (!("__TAURI_INTERNALS__" in window)) return;
    void (async () => {
      const [{ getCurrentWindow }, { LogicalSize }] = await Promise.all([
        import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi"),
      ]);
      const [width, height] = SIZES[view];
      await getCurrentWindow().setSize(new LogicalSize(width, height));
    })().catch((reason) => setError(String(reason)));
  }, [view, session.user.id]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) =>
      getCurrentWindow().setAlwaysOnTop(pinned)).catch((reason) => setError(String(reason)));
  }, [pinned]);
  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let off: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) =>
      listen<string>("heuresis:quick-open", ({ payload }) => {
        setView("compact");
        workspace.openCapture({ mode: payload === "mistake" ? "mistake" : "note" });
      })).then((dispose) => { off = dispose; }).catch((reason) => setError(String(reason)));
    return () => { off?.(); };
  }, [workspace.openCapture]);
  async function drag() {
    if (!("__TAURI_INTERNALS__" in window)) return;
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().startDragging();
  }
  async function hide() {
    if (!("__TAURI_INTERNALS__" in window)) { setView("bubble"); return; }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }
  function open() { setView("compact"); workspace.openCapture({ mode: "note" }); }
  return <div className="quick-floating-root" data-view={view}>
    <header className="quick-floating-bar">
      <button type="button" className="quick-floating-grip"
        onPointerDown={(event) => { if (event.button === 0) void drag().catch((reason) => setError(String(reason))); }}
        aria-label="Drag Quick Capture"><Feather size={14}/><span>Quick Capture</span></button>
      <button type="button" className="quick-floating-icon" aria-label={pinned ? "Unpin" : "Pin"}
        onClick={() => setPinned((value) => !value)}><Pin size={14} fill={pinned ? "currentColor" : "none"}/></button>
      <button type="button" className="quick-floating-icon" aria-label={view === "bubble" ? "Expand" : "Minimise"}
        onClick={() => view === "bubble" ? open() : setView("bubble")}>
        {view === "bubble" ? <Maximize2 size={15}/> : <Minimize2 size={15}/>}</button>
      <button type="button" className="quick-floating-icon" aria-label="Close Quick Capture"
        onClick={() => void hide().catch((reason) => setError(String(reason)))}><X size={15}/></button>
    </header>
    {view === "bubble" ? <button type="button" className="quick-floating-bubble" onClick={open}>
      <Feather size={16}/> New capture
    </button> : <div className="quick-floating-stage">
      <QQuickCapture floating onRequestClose={() => void hide()}/>
    </div>}
    {error ? <p className="quick-floating-notice" role="alert">{error}</p> : null}
    <Toaster/>
  </div>;
}

export default function FloatingQuickCapture() {
  return <AuthGate>{(session) => <WorkspaceProvider userId={session.user.id}
    section="queue" onSection={() => undefined}><FloatingBody session={session}/></WorkspaceProvider>}</AuthGate>;
}
