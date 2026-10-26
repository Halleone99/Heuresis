// Builds a Vite fixture page around the real Capture panel, with an in-memory
// workspace instead of Supabase. Used by check-capture-panel-browser.mjs.
// The page loads the same fonts and stylesheets as src/main.tsx, in the same
// order, so cascade conflicts with older rules show up here too.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export function writeCaptureFixture(dir) {
  mkdirSync(dir, { recursive: true });
  const main = readFileSync("src/main.tsx", "utf8");
  const styles = [...main.matchAll(/^import "([^"]+\.css)";$/gm)].map((match) => match[1])
    .map((path) => path.startsWith("./") ? `../../src/${path.slice(2)}` : path);
  writeFileSync(dir + "/index.html", '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="./fixture.tsx"></script></body></html>');
  writeFileSync(dir + "/fixture.tsx", `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
${styles.map((path) => `import ${JSON.stringify(path)};`).join("\n")}
import { WorkspaceContext } from "../../src/components/workspace/WorkspaceContext";
import { QQuickCapture, type NativeCaptureWindow } from "../../src/components/workspace/QQuickCapture";
import { QQueuePage } from "../../src/components/workspace/QQueuePage";
import { RichText } from "../../src/components/workspace/RichText";
import { Toaster } from "../../src/components/workspace/ui";
import TabletCaptureFab from "../../src/components/TabletCaptureFab";
import { markAndroidRuntime } from "../../src/lib/platform";
import * as ink from "../../src/lib/handNote";
import * as noteFormat from "../../src/lib/noteFormat";

const params = new URLSearchParams(location.search);
document.documentElement.dataset.theme = params.get("theme") ?? "light";
document.documentElement.dataset.palette = params.get("palette") ?? "slate";
markAndroidRuntime();
const w = window as any;
w.__calls = [];
w.__ink = ink;
w.__noteFormat = noteFormat;
const entries: any[] = [];
w.__entries = entries;
try { for (const entry of JSON.parse(localStorage.getItem("fixture.entries") || "[]")) entries.push(entry); } catch { /* none */ }

function Harness() {
  const [capture, setCapture] = useState<any>(params.get("closed") ? null : { mode: "note" });
  const [toasts, setToasts] = useState<any[]>([]);
  const [full, setFull] = useState(false);
  const [onTop, setOnTop] = useState(true);
  const [reader, setReader] = useState("");
  const [, setVersion] = useState(0);
  w.__refresh = () => setVersion((value) => value + 1);
  w.__open = (mode = "note") => setCapture({ mode });
  w.__setReader = setReader;
  const value: any = {
    userId: "u1", writable: true, loading: false, error: "",
    snapshot: { subjects: [{ id: "s1", name: "Unsorted" }], topics: [{ id: "t1", subject_id: "s1", parent_id: null, name: "Inbox" }], entries, practice: [] },
    capture, openCapture: (request: any) => setCapture({ ...request }), closeCapture: () => setCapture(null),
    addSubject: async (name: string) => ({ id: "s1", name }), ensureInbox: async () => ({ id: "t1", name: "Inbox" }),
    submitCapture: async (input: any) => {
      w.__calls.push({ type: "submit", input });
      if (w.__failSubmit) return null;
      const now = new Date().toISOString();
      const entry = { ...input, topic_id: input.topicId, title: input.title ?? "", created_at: now, updated_at: now };
      entries.unshift(entry);
      return entry;
    },
    patchEntry: async (id: string, patch: any) => {
      w.__calls.push({ type: "patch", id, patch });
      const entry = entries.find((row) => row.id === id);
      if (!entry || w.__failPatch) throw new Error("This note changed on another device, or was deleted.");
      Object.assign(entry, patch, { updated_at: new Date().toISOString() });
      return entry;
    },
    toast: (message: string) => { w.__calls.push({ type: "toast", message }); setToasts((list) => [...list, { id: Date.now() + Math.random(), message }]); },
    toasts, dismissToast: (id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)),
    pathLabel: () => "Unsorted › Inbox", openDocument: (id: string, options: any) => w.__calls.push({ type: "openDocument", id, options }),
    addEntry: async (input: any) => { w.__calls.push({ type: "addEntry", input }); return input; },
    removeEntry: async (id: string) => { w.__calls.push({ type: "removeEntry", id }); },
  };
  if (params.get("view") === "captures") return <WorkspaceContext.Provider value={value}>
    <div className="heuresis-desktop" data-section="queue"><QQueuePage onCapture={() => undefined} /></div>
  </WorkspaceContext.Provider>;
  const native: NativeCaptureWindow | undefined = params.get("mode") === "native" ? {
    fullscreen: full, onTop,
    toggleFullscreen: () => { w.__calls.push({ type: "fullscreen" }); setFull((value) => !value); },
    toggleOnTop: () => setOnTop((value) => !value),
    minimise: () => w.__calls.push({ type: "minimise" }),
    startDrag: () => w.__calls.push({ type: "drag" }),
    startResize: () => w.__calls.push({ type: "resize" }),
    ensureSize: (width, height) => w.__calls.push({ type: "ensureSize", width, height }),
  } : undefined;
  return <WorkspaceContext.Provider value={value}>
    {native
      ? <div className="quick-floating-root" data-view="window"><QQuickCapture floating onRequestClose={() => w.__calls.push({ type: "hide" })} native={native} /></div>
      : <div className="heuresis-desktop" data-section="notebook" style={{ minHeight: "100vh" }}>
        <header data-testid="app-header" style={{ position: "sticky", top: 0, zIndex: 35, height: 48, background: "var(--ws-chrome)", color: "var(--ws-chrome-text)", display: "flex", alignItems: "center", padding: "0 16px" }}>Heuresis</header>
        <main style={{ padding: 24 }}>
          <h1 style={{ fontFamily: "var(--ws-display)", fontWeight: 400 }}>Notebook</h1>
          <p>Background page. Capture floats above it without blocking it.</p>
          <button type="button" data-testid="behind">A button behind the panel</button>
          <div data-testid="reader" style={{ maxWidth: 760 }}>{reader ? <RichText text={reader} /> : null}</div>
        </main>
        <nav className="mobile-workspace-nav" data-testid="bottom-nav"><button type="button">Study</button><button type="button">Notebook</button></nav>
        <TabletCaptureFab onCapture={() => setCapture({ mode: "note" })} />
        <QQuickCapture />
      </div>}
    <Toaster />
  </WorkspaceContext.Provider>;
}
createRoot(document.getElementById("root")!).render(<Harness />);
`);
}
