import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(file, "utf8");
const rust = read("src-tauri/src/lib.rs");
const cap = JSON.parse(read("src-tauri/capabilities/default.json"));
const main = read("src/main.tsx");
const shell = read("src/App.tsx");
const floating = read("src/components/workspace/FloatingQuickCapture.tsx");
const quick = read("src/components/workspace/QuickCapture.tsx");
const provider = read("src/components/workspace/WorkspaceContext.tsx");

assert.ok(cap.windows.includes("quick-capture"), "New window must have Tauri capabilities");
for (const permission of ["core:window:allow-hide","core:window:allow-set-size",
  "core:window:allow-set-position","core:window:allow-set-always-on-top",
  "core:window:allow-start-dragging"]) {
  assert.ok(cap.permissions.includes(permission), `Missing ${permission}`);
}
assert.match(rust, /WebviewWindowBuilder::new\(/, "A pre-created native window is needed for instant opening");
assert.match(rust, /"quick-capture"/);
assert.match(rust, /\.visible\(false\)/);
assert.match(rust, /Modifiers::CONTROL \| Modifiers::ALT, Code::Space/);
assert.match(rust, /shortcut\.matches\(Modifiers::CONTROL \| Modifiers::ALT, Code::Space\)/);
assert.match(rust, /show_quick_capture_handle\(app, "note"\)/);
assert.match(rust, /if let Err\(err\) = app\.global_shortcut\(\)\.register\(shortcut\)/,
  "Shortcut collisions must not prevent app startup");
assert.match(main, /params\.get\("quick"\) === "1"/);
assert.match(main, /<FloatingQuickCapture \/>/);
assert.match(shell, /showFloatingQuickCapture\(mode\)/);
assert.match(quick, /export function QuickCapture\(\{ floating = false, onRequestClose \}/);
assert.match(floating, /<QuickCapture floating onRequestClose=/, "Native window close is wired through capture");
assert.match(floating, /const DIMENSIONS: Record<FloatingSize/);
assert.match(floating, /view === "bubble"/);
assert.doesNotMatch(floating, /view === "expanded"/, "Extra view mode should not clutter capture");
assert.match(floating, /appWindow\.onMoved/);
assert.match(floating, /\.setAlwaysOnTop\(pin\)/);
assert.match(floating, /const \[\{ getCurrentWindow \}, \{ PhysicalPosition \}/);
assert.match(provider, /window\.addEventListener\("storage", onStorage\)/);
assert.match(floating, /Remains mounted in bubble mode so drafts are never lost on collapse/);
assert.match(quick, /const stream = mode === "note" && !floating/, "Floating Enter must insert lines, not auto-save");
assert.match(quick, /if \(!destination \|\| floating \|\|/, "Floating ideas always enter a subject Inbox");
assert.match(quick, /qc-floating-destination/, "Destination must be prominent at top");
assert.match(floating, /aria-label="Close Quick Capture window"/);
assert.match(floating, /getCurrentWindow\(\)\.hide\(\)/, "Close button hides the native window");
assert.match(floating, /Saved ideas/, "Confirmation receipts must be visible beneath captured ideas");
console.log("Native floating Quick Capture integration checks passed.");
