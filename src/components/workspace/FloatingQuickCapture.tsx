import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ChevronDown, ChevronRight, CircleDot, Maximize2, Minimize2, NotebookPen, Pin, X } from "lucide-react";
import { AICheck } from "./AICheck";
import AuthGate from "../AuthGate";
import { entryTitle } from "../../lib/knowledgeWorkspace";
import { QuickCapture } from "./QuickCapture";
import { Toaster } from "./ui";
import { WorkspaceProvider, useWorkspace, type CaptureMode } from "./WorkspaceContext";

type FloatingSize = "bubble" | "compact";
const DIMENSIONS: Record<FloatingSize, [number, number]> = {
  bubble: [240, 76], compact: [560, 490],
};
const viewKey = (userId: string) => `heuresis.quick.view.v1:${userId}`;
const pinKey = (userId: string) => `heuresis.quick.pin.v1:${userId}`;
const positionKey = "heuresis.quick.position.v1";

function storedView(userId: string): FloatingSize {
  try {
    const value = localStorage.getItem(viewKey(userId));
    return value === "bubble" ? value : "compact";
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
  const [recentOpen, setRecentOpen] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Recent saved notes and mistakes, not only items filed in an Inbox.
  const captured = useMemo(() => workspace.snapshot.entries
    .filter((entry) => entry.kind !== "lesson")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 12), [workspace.snapshot.entries]);

  const openCapture = (mode: CaptureMode = "note") => {
    setView((current) => current === "bubble" ? "compact" : current);
    workspace.openCapture({ mode });
  };

  // Same durable, idempotent Notebook save path; this window is only a fast entry point.
  useEffect(() => {
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
    // Hide the entire native window, NOT just the inner capture panel.
    // Retaining this WebView also retains the typed draft when reopened.
    if (!("__TAURI_INTERNALS__" in window)) { setView("bubble"); return; }
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().hide();
  }
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      void hide().catch((error) => setNotice(String(error)));
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  return <div className="quick-floating-root" data-view={view}>
    <header className="quick-floating-bar">
      <button type="button" className="quick-floating-grip" onPointerDown={(event) => {
        if (event.button === 0) void drag().catch((error) => setNotice(String(error)));
      }} title="Drag to move Quick Capture" aria-label="Drag Quick Capture">
        <CircleDot size={12}/><span>Quick Capture</span>
      </button>
      <button type="button" className="quick-floating-icon" onClick={() => setPin((value) => !value)}
        title={pin ? "Unpin: allow other windows on top" : "Pin above other windows"}
        aria-label={pin ? "Unpin capture window" : "Pin capture window"}
        aria-pressed={pin}><Pin size={14} fill={pin ? "currentColor" : "none"}/></button>
      <button type="button" className="quick-floating-icon" title={view === "bubble" ? "Open input" : "Collapse to bubble"}
        aria-label={view === "bubble" ? "Open capture input" : "Collapse to bubble"}
        onClick={() => view === "bubble" ? openCapture() : setView("bubble")}>
        {view === "bubble" ? <Maximize2 size={14}/> : <Minimize2 size={14}/>}</button>
      <button type="button" className="quick-floating-icon" title="Close Quick Capture" aria-label="Close Quick Capture window"
        onClick={() => void hide().catch((error) => setNotice(String(error)))}><X size={14}/></button>
    </header>
    {view === "bubble" ? <button type="button" className="quick-floating-bubble" onClick={() => openCapture()}>
      <NotebookPen size={15}/> Write an idea
    </button> : null}
    {/* Remains mounted in bubble mode so drafts are never lost on collapse. */}
    <div className="quick-floating-stage">
      <QuickCapture floating onRequestClose={() => { void hide().catch((error) => setNotice(String(error))); }}/>
      {!workspace.capture ? <button type="button" className="quick-floating-reopen" onClick={() => openCapture()}>
        <NotebookPen size={15}/> New capture</button> : null}
    </div>
    {view !== "bubble" ? <section className="quick-floating-recent" aria-label="Recent captures">
      <button type="button" className="quick-floating-recent-head qc-recent-collapse"
        aria-expanded={recentOpen} onClick={() => setRecentOpen((value) => !value)}>
        <strong>Recent captures</strong>
        <span>{recentOpen ? <ChevronDown size={15}/> : <ChevronRight size={15}/>}</span>
      </button>
      {recentOpen ? captured.length ? <ol>{captured.map((entry) => {
        const expanded = expandedId === entry.id;
        const label = entry.kind === "mistake" ? "Mistake Log" : entry.category === "note" ? "Raw" : (entry.category || "Raw");
        const fullText = entry.kind === "mistake"
          ? [entry.attempt ? `Mistake: ${entry.attempt}` : "", entry.correction ? `Correction: ${entry.correction}` : "", entry.explanation].filter(Boolean).join("\n")
          : entry.body;
        const targetText = entry.kind === "mistake" ? entry.correction : entry.body;
        const heading = (entry.title || (entry.kind === "mistake" ? entry.attempt : entry.body.split("\n")[0]) || "Untitled capture").trim();
        const subject = workspace.topicPath(entry.topic_id).subject?.name ?? "No category";
        return <li key={entry.id}>
          <div className="qc-recent-item-head">
            <button type="button" className="qc-recent-item-toggle" aria-expanded={expanded}
              onClick={() => setExpandedId((value) => value === entry.id ? null : entry.id)}>
              {expanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
              <span className="qc-recent-title">{heading}</span>
            </button>
            <AICheck text={targetText} language={subject} context={entry.kind === "mistake" ? "mistake" : "note"} compact
              onApply={(next) => workspace.patchEntry(entry.id, entry.kind === "mistake" ? { correction: next } : { body: next }).then(() => undefined)} />
          </div>
          <span className="quick-floating-recent-meta">
            <time>{new Date(entry.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
            {label} · {subject}
          </span>
          {expanded ? <div className="qc-recent-full" aria-label="Full saved capture">{fullText}</div> : null}
        </li>;
      })}</ol> : <p>No captures yet. Save one above to see it here.</p> : null}
    </section> : null}
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
