import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { ALargeSmall, Expand, Feather, FilePlus2, Keyboard, Minus, PenLine, Pin, PinOff, Shrink, X } from "lucide-react";
import { DrawingSheet } from "./DrawingSheet";
import { HandNotePad } from "./HandNotePad";
import { RichEditor, type RichEditorHandle } from "./RichEditor";
import {
  decodeHandNote, emptyHandNote, encodeHandNote, handNoteFromLegacy,
  type HandNote, type HandStroke,
} from "../../lib/handNote";
import { friendlyError, LIMITS, plainLine } from "../../lib/knowledgeWorkspace";
import { getOfflineSyncState, subscribeOfflineSync } from "../../lib/offlineFetch";
import { quickQueueBody, quickQueueDescription } from "../../lib/quickQueue";
import { readPendingCaptures } from "../../lib/workspaceMemory";
import { useWorkspace } from "./WorkspaceContext";
import "./q-queue.css";
import "./capture-panel.css";

/**
 * Capture has two surfaces with separate drafts:
 *   Quick  a line of text, a handwritten note, a card or a mistake. Save files it
 *          in Captures and clears the panel for the next one.
 *   Page   a formatted page (headings, lists, tables, colours, drawings) for a
 *          whole lesson. The first Save puts it in Captures; after that the page
 *          stays open and keeps saving itself until "New page".
 * Switching between them never discards either draft. Nothing is categorised at
 * capture time: everything waits in Captures until it is filed.
 */
type Kind = "note" | "flashcard" | "mistake";
type QuickDraft = {
  type: Kind; input: "type" | "pen";
  text: string; ink: HandNote; front: string; back: string; wrong: string; correct: string;
  /** Identity of the next save, kept until it succeeds so a retry never stores twice. */
  id?: string;
};
type PageDraft = {
  text: string; title: string; id?: string;
  /** The capture this page keeps updating once it has been saved. */
  savedId?: string; savedBody?: string; savedTitle?: string; savedAt?: string;
};
type PanelDraft = { mode: "quick" | "page"; quick: QuickDraft; page: PageDraft };

/** What the floating desktop window lends the panel (Tauri only). */
export type NativeCaptureWindow = {
  fullscreen: boolean; toggleFullscreen: () => void;
  onTop: boolean; toggleOnTop: () => void;
  minimise: () => void; startDrag: () => void; startResize: () => void;
  /** Grow the window to at least this size (logical pixels); never shrinks it. */
  ensureSize: (width: number, height: number) => void;
};

const KINDS: { value: Kind; label: string }[] = [
  { value: "note", label: "Note" }, { value: "flashcard", label: "Card" }, { value: "mistake", label: "Mistake" },
];
const blankQuick = (type: Kind = "note", input: QuickDraft["input"] = "type", paper: HandNote["paper"] = "plain"): QuickDraft => ({
  type, input, text: "", ink: emptyHandNote(paper), front: "", back: "", wrong: "", correct: "",
});
const blankPage = (): PageDraft => ({ text: "", title: "" });
const str = (value: unknown) => typeof value === "string" ? value : "";
const cleanInk = (value: unknown): HandNote => {
  try { return value && typeof value === "object" && Array.isArray((value as HandNote).strokes) ? decodeHandNote(encodeHandNote(value as HandNote)) : emptyHandNote(); }
  catch { return emptyHandNote(); }
};

const draftKey = (userId: string, floating: boolean) => `heuresis.capture.panel.v2:${userId}:${floating ? "floating" : "main"}`;
const legacyDraftKey = (userId: string, floating: boolean) => `heuresis.q.captureDraft.v1:${userId}:${floating ? "floating" : "main"}`;

function readDraft(userId: string, floating: boolean): PanelDraft {
  try {
    const saved = JSON.parse(localStorage.getItem(draftKey(userId, floating)) || "null") as Partial<PanelDraft> | null;
    if (saved?.quick && saved.page) {
      const quick = saved.quick as Partial<QuickDraft>;
      const page = saved.page as Partial<PageDraft>;
      return {
        mode: saved.mode === "page" ? "page" : "quick",
        quick: {
          type: quick.type === "flashcard" || quick.type === "mistake" ? quick.type : "note",
          input: quick.input === "pen" ? "pen" : "type",
          text: str(quick.text), ink: cleanInk(quick.ink), front: str(quick.front), back: str(quick.back),
          wrong: str(quick.wrong), correct: str(quick.correct), id: str(quick.id) || undefined,
        },
        page: {
          text: str(page.text), title: str(page.title), id: str(page.id) || undefined,
          savedId: str(page.savedId) || undefined, savedBody: typeof page.savedBody === "string" ? page.savedBody : undefined,
          savedTitle: typeof page.savedTitle === "string" ? page.savedTitle : undefined, savedAt: str(page.savedAt) || undefined,
        },
      };
    }
    // The previous panel kept one draft with a handwriting flag and version 1 strokes.
    const legacy = JSON.parse(localStorage.getItem(legacyDraftKey(userId, floating)) || "null") as Record<string, unknown> | null;
    if (legacy) return {
      mode: "quick",
      quick: {
        type: legacy.type === "flashcard" || legacy.type === "mistake" ? legacy.type : "note",
        input: legacy.handwriting ? "pen" : "type", text: str(legacy.text),
        ink: Array.isArray(legacy.strokes) ? handNoteFromLegacy(legacy.strokes as HandStroke[]) : emptyHandNote(),
        front: str(legacy.front), back: str(legacy.back), wrong: str(legacy.wrong), correct: str(legacy.correct),
        id: str(legacy.id) || undefined,
      },
      page: blankPage(),
    };
  } catch { /* a damaged local draft starts clean */ }
  return { mode: "quick", quick: blankQuick(), page: blankPage() };
}

/** One line describing the waiting draft, for the minimised pill and the desktop bubble. */
export function captureDraftSummary(userId: string, floating: boolean): string {
  const draft = readDraft(userId, floating);
  if (draft.mode === "page") return draft.page.title.trim() || plainLine(draft.page.text) || "New page";
  const quick = draft.quick;
  if (quick.type === "flashcard") return quick.front.trim();
  if (quick.type === "mistake") return quick.wrong.trim();
  return quick.text.trim().split("\n")[0] || (quick.input === "pen" && quick.ink.strokes.length ? "✎ Handwriting" : "");
}

type Frame = { x: number | null; y: number | null; w: number | null; h: number | null; view: "normal" | "min" | "full" };
const frameKey = (userId: string) => `heuresis.capture.panel.frame.v1:${userId}`;
function readFrame(userId: string): Frame {
  const frame: Frame = { x: null, y: null, w: null, h: null, view: "normal" };
  try {
    const saved = JSON.parse(localStorage.getItem(frameKey(userId)) || "null") as Partial<Frame> | null;
    const old = JSON.parse(localStorage.getItem(`heuresis.q.capturePosition.v1:${userId}`) || "null") as { x?: number; y?: number } | null;
    const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    frame.x = number(saved?.x ?? old?.x); frame.y = number(saved?.y ?? old?.y);
    frame.w = number(saved?.w); frame.h = number(saved?.h);
    frame.view = saved?.view === "full" ? "full" : "normal";
  } catch { /* position memory is optional */ }
  return frame;
}
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), Math.max(min, max));
function touchLayout() {
  return typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse) and (max-width: 900px)").matches;
}
/** Where the in-app panel may sit: inside the window, clear of the tablet header and bottom bar. */
function placeFrame(frame: Frame) {
  const touch = touchLayout();
  const top = touch ? 66 : 8;
  const bottom = touch ? 78 : 8;
  const viewportW = window.innerWidth; const viewportH = window.innerHeight;
  const w = clamp(frame.w ?? 640, Math.min(340, viewportW - 16), viewportW - 16);
  const h = clamp(frame.h ?? 620, Math.min(320, viewportH - top - bottom), viewportH - top - bottom);
  const x = clamp(frame.x ?? viewportW - w - 22, 8, viewportW - w - 8);
  const y = clamp(frame.y ?? viewportH - h - bottom - 14, top, viewportH - h - bottom);
  return { x, y, w, h };
}
const timeLabel = (iso?: string) => iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

type Drawing = { note: HandNote; apply: ((line: string | null) => void) | null };
type PageState = "idle" | "saving" | "offline" | "error";

export function QQuickCapture({ floating = false, onRequestClose, native }: {
  floating?: boolean; onRequestClose?: () => void; native?: NativeCaptureWindow;
} = {}) {
  const workspace = useWorkspace();
  const request = workspace.capture;
  const userId = workspace.userId;
  const surface = floating ? "floating" : "inline";
  const [draft, setDraft] = useState<PanelDraft>(() => readDraft(userId, floating));
  const [frame, setFrame] = useState<Frame>(() => readFrame(userId));
  const [, setViewportTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState("");
  const [pageState, setPageState] = useState<PageState>("idle");
  const [online, setOnline] = useState(() => getOfflineSyncState().online);
  const [pageKey, setPageKey] = useState(0);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [lastRequest, setLastRequest] = useState<typeof request>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<RichEditorHandle>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const savingRef = useRef(false);
  const pageSave = useRef<Promise<boolean> | null>(null);
  const gesture = useRef<{ kind: "move" | "size"; pointerId: number; fromX: number; fromY: number; box: { x: number; y: number; w: number; h: number } } | null>(null);

  const inline = !native;
  const isFull = native ? native.fullscreen : frame.view === "full";
  const pageMode = draft.mode === "page";
  const quick = draft.quick;
  const page = draft.page;

  useEffect(() => {
    try {
      localStorage.setItem(draftKey(userId, floating), JSON.stringify(draft));
      localStorage.removeItem(legacyDraftKey(userId, floating));
    } catch { /* optional draft cache */ }
  }, [draft, floating, userId]);
  useEffect(() => {
    if (!inline) return;
    try { localStorage.setItem(frameKey(userId), JSON.stringify({ ...frame, view: frame.view === "min" ? "normal" : frame.view })); }
    catch { /* optional */ }
  }, [frame, inline, userId]);
  useEffect(() => {
    if (!inline) return;
    const fit = () => setViewportTick((tick) => tick + 1);
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [inline]);
  useEffect(() => subscribeOfflineSync((state) => setOnline(state.online)), []);
  useEffect(() => {
    if (!flash) return;
    const timer = window.setTimeout(() => setFlash(""), 3200);
    return () => window.clearTimeout(timer);
  }, [flash]);

  if (request && request !== lastRequest) {
    setLastRequest(request);
    // A shortcut names a provisional Captures label; it never creates a final record.
    // A note request leaves an open page alone: the page is the lesson being written.
    if (request.mode === "mistake") setDraft((current) => ({ ...current, mode: "quick", quick: { ...current.quick, type: "mistake" } }));
    else if (request.mode === "note" && draft.mode === "quick" && quick.type !== "note") setDraft((current) => ({ ...current, quick: { ...current.quick, type: "note" } }));
    if (frame.view === "min") setFrame((current) => ({ ...current, view: "normal" }));
  }

  const patchQuick = useCallback((values: Partial<QuickDraft>) => {
    setDraft((current) => ({ ...current, quick: { ...current.quick, ...values } }));
    setError("");
  }, []);
  const patchPage = useCallback((values: Partial<PageDraft>) => {
    setDraft((current) => ({ ...current, page: { ...current.page, ...values } }));
  }, []);

  const pageBody = () => (editorRef.current?.getMarkdown() ?? draftRef.current.page.text).replace(/\s+$/, "");
  const pageDirty = pageMode && (page.text.replace(/\s+$/, "") !== (page.savedBody ?? "") || page.title.trim() !== (page.savedTitle ?? ""));
  /**
   * The editor reports changes a moment after they happen; leaving the page
   * (New page, Quick, minimise, close) asks it directly so nothing is missed.
   * Reading it cancels that pending report, so the draft is updated here.
   */
  function readPage() {
    const current = draftRef.current.page;
    const body = pageBody();
    if (body !== current.text) patchPage({ text: body });
    const dirty = body !== (current.savedBody ?? "") || current.title.trim() !== (current.savedTitle ?? "");
    return { body, dirty, saved: !!current.savedId };
  }

  async function captureInbox() {
    const unsorted = workspace.snapshot.subjects.find((subject) => subject.name.toLowerCase() === "unsorted")
      ?? await workspace.addSubject("Unsorted");
    return workspace.ensureInbox(unsorted.id);
  }

  // ---------------------------------------------------------------------------
  // Quick save: one capture, then a clean panel for the next one.
  // ---------------------------------------------------------------------------
  const quickBody = quick.type === "note"
    ? quick.input === "pen"
      ? [quick.text.trim(), quick.ink.strokes.length ? encodeHandNote(quick.ink) : ""].filter(Boolean).join("\n\n")
      : quick.text.trim()
    : quickQueueBody(quick.type, quick);
  const quickValid = quick.type === "note" ? (quick.input === "pen" ? quick.ink.strokes.length > 0 : !!quick.text.trim())
    : quick.type === "flashcard" ? !!quick.front.trim() && !!quick.back.trim() : !!quick.wrong.trim() && !!quick.correct.trim();

  async function saveQuick() {
    const draft = draftRef.current.quick;
    if (savingRef.current || !quickValid) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      if (!workspace.writable) throw new Error("Notebook storage is not ready. Your draft is preserved.");
      if (quickBody.length > LIMITS.body) throw new Error("This capture is too long. Shorten it before saving.");
      // No final categorisation at capture time. A normal backed-up note record
      // holds the queue content, with a durable Captures marker in its description.
      const inbox = await captureInbox();
      const id = draft.id ?? crypto.randomUUID();
      if (!draft.id) patchQuick({ id });
      const result = await workspace.submitCapture({
        id, kind: "note", topicId: inbox.id, description: quickQueueDescription(draft.type),
        body: quickBody, category: "note",
      }, plainLine(quickBody).slice(0, 45) || "Handwritten capture", surface);
      if (!result) { setError("The capture is kept for retry. It has not been discarded."); return; }
      setDraft((current) => ({ ...current, quick: blankQuick(current.quick.type, current.quick.input, current.quick.ink.paper) }));
      if (getOfflineSyncState().pending) workspace.toast("Saved on this device; waiting to sync.");
      setFlash(`Saved to Captures · ${timeLabel(new Date().toISOString())}`);
    } catch (reason) { setError(friendlyError(reason)); }
    finally { savingRef.current = false; setSaving(false); }
  }

  // ---------------------------------------------------------------------------
  // Page save: create once, then update the same capture.
  // ---------------------------------------------------------------------------
  /** One page save at a time; a save asked for during another runs after it, with the newest text. */
  function savePage(explicit: boolean): Promise<boolean> {
    if (pageSave.current) return pageSave.current.then(() => savePage(explicit));
    const run = writePage(explicit).finally(() => { pageSave.current = null; });
    pageSave.current = run;
    return run;
  }
  async function writePage(explicit: boolean): Promise<boolean> {
    const current = draftRef.current.page;
    const body = pageBody();
    const title = current.title.trim();
    // Reading the editor cancels its pending update, so record what it holds now.
    if (body !== current.text) patchPage({ text: body });
    if (!body.trim()) { if (explicit) setError(title ? "Write something under the title first." : "Write something on the page first."); return !explicit; }
    if (body.length > LIMITS.body) { setError("This page is full: a note holds about 50,000 characters. Save it as it is and start a new page."); return false; }
    if (title.length > LIMITS.title) { setError("The title is too long."); return false; }
    const existing = current.savedId ? workspace.snapshot.entries.find((entry) => entry.id === current.savedId) : undefined;
    if (current.savedId && existing && !getOfflineSyncState().online) {
      // Updates are only sent online, so they cannot pile up out of order; the draft keeps everything.
      setPageState("offline");
      return false;
    }
    setSaving(true); setPageState("saving"); setError("");
    try {
      if (!workspace.writable) throw new Error("Notebook storage is not ready. Your page is kept here.");
      if (current.savedId && existing) {
        await workspace.patchEntry(current.savedId, { body, title });
        patchPage({ savedBody: body, savedTitle: title, savedAt: new Date().toISOString() });
        setPageState("idle");
        return true;
      }
      // First save, or the saved copy is not on this device yet (still waiting to sync).
      const queued = !!current.savedId && readPendingCaptures(userId).some((item) => item.input.id === current.savedId);
      const id = queued ? current.savedId! : current.savedId ? crypto.randomUUID() : current.id ?? crypto.randomUUID();
      if (current.savedId && !queued) workspace.toast("The earlier copy of this page is no longer in Captures, so it was saved again as a new capture.");
      patchPage({ id });
      const inbox = await captureInbox();
      const result = await workspace.submitCapture({
        id, kind: "note", topicId: inbox.id, description: quickQueueDescription("note"),
        body, category: "note", title,
      }, title || plainLine(body).slice(0, 45) || "Page", surface);
      const pending = !result && readPendingCaptures(userId).some((item) => item.input.id === id);
      if (!result && !pending) { patchPage({ id: undefined }); setPageState("error"); return false; }
      patchPage({ id: undefined, savedId: id, savedBody: body, savedTitle: title, savedAt: result ? new Date().toISOString() : undefined });
      setPageState(result ? "idle" : "offline");
      if (explicit && result && !current.savedId) setFlash("Saved to Captures. This page now saves itself as you write.");
      return true;
    } catch (reason) {
      // Changed or removed elsewhere: never overwrite it. Keep the text; the next Save makes a new capture.
      patchPage({ savedId: undefined, savedBody: undefined, savedTitle: undefined, savedAt: undefined });
      setError(`${friendlyError(reason)} Your page is still here: Save keeps it as a new capture.`);
      setPageState("error");
      return false;
    } finally { setSaving(false); }
  }

  // After the first save, changes save themselves a moment after you stop writing.
  useEffect(() => {
    if (!pageMode || !page.savedId || !pageDirty || !online || pageState === "error" || saving || drawing) return;
    const timer = window.setTimeout(() => { void savePage(false); }, 2500);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageMode, page.savedId, page.text, page.title, online, pageState, saving, drawing]);
  useEffect(() => { if (online && pageState === "offline") setPageState("idle"); }, [online, pageState]);

  async function newPage() {
    const { body, dirty, saved } = readPage();
    if (body.trim() && (dirty || !saved)) {
      if (!await savePage(true)) return;
    } else if (pageSave.current) await pageSave.current;
    setDraft((current) => ({ ...current, page: blankPage() }));
    setPageKey((key) => key + 1);
    setPageState("idle"); setError("");
  }

  // ---------------------------------------------------------------------------
  // Switching between Quick and Page
  // ---------------------------------------------------------------------------
  function openPage() {
    setDraft((current) => {
      const next = { ...current, mode: "page" as const };
      // An empty page takes over what was just written quickly, so "Format" formats it.
      if (!current.page.text.trim() && current.quick.type === "note") {
        const carried = current.quick.input === "pen"
          ? [current.quick.text.trim(), current.quick.ink.strokes.length ? encodeHandNote(current.quick.ink) : ""].filter(Boolean).join("\n\n")
          : current.quick.text;
        if (carried.trim()) {
          next.page = { ...current.page, text: carried };
          next.quick = { ...current.quick, text: "", ink: emptyHandNote(current.quick.ink.paper), id: undefined };
        }
      }
      return next;
    });
    setPageKey((key) => key + 1);
    setError("");
    native?.ensureSize(920, 760);
  }
  function openQuick() {
    flushPage();
    setDrawing(null);
    setDraft((current) => ({ ...current, mode: "quick", quick: { ...current.quick, type: "note" } }));
    setError("");
  }

  // ---------------------------------------------------------------------------
  // Window: close, minimise, full screen, move and resize
  // ---------------------------------------------------------------------------
  function flushPage() {
    if (!pageMode) return;
    const { dirty, saved } = readPage();
    if (saved && dirty && getOfflineSyncState().online) void savePage(false);
  }
  function finishDrawing() {
    if (!drawing) return;
    const { note, apply } = drawing;
    if (note.strokes.length) {
      const line = encodeHandNote(note);
      if (apply) apply(line); else editorRef.current?.insertDrawing(line);
    } else if (apply) apply(null);
    setDrawing(null);
  }
  const close = () => {
    if (drawing) finishDrawing();
    flushPage();
    if (onRequestClose) onRequestClose();
    else workspace.closeCapture();
  };
  const toggleFull = () => {
    if (native) native.toggleFullscreen();
    else setFrame((current) => ({ ...current, view: current.view === "full" ? "normal" : "full" }));
  };
  const minimise = () => {
    if (drawing) finishDrawing();
    flushPage();
    if (native) native.minimise();
    else setFrame((current) => ({ ...current, view: "min" }));
  };
  function escape() {
    if (drawing) { finishDrawing(); return; }
    if (isFull) { toggleFull(); return; }
    close();
  }
  function save() { if (pageMode) void savePage(true); else void saveQuick(); }

  const box = inline && !isFull ? placeFrame(frame) : null;
  function beginGesture(kind: "move" | "size", event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if (kind === "move" && (event.target as HTMLElement).closest("button, input, select")) return;
    if (native) {
      event.preventDefault();
      if (kind === "move" && !native.fullscreen) native.startDrag();
      if (kind === "size" && !native.fullscreen) native.startResize();
      return;
    }
    if (!box) return;
    event.preventDefault();
    gesture.current = { kind, pointerId: event.pointerId, fromX: event.clientX, fromY: event.clientY, box };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* not an active pointer */ }
  }
  function moveGesture(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - current.fromX; const dy = event.clientY - current.fromY;
    setFrame((value) => current.kind === "move"
      ? { ...value, x: current.box.x + dx, y: current.box.y + dy, w: current.box.w, h: current.box.h }
      : { ...value, x: current.box.x, y: current.box.y, w: current.box.w + dx, h: current.box.h + dy });
  }
  function endGesture(event: ReactPointerEvent<HTMLElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    gesture.current = null;
    // Store where it actually landed, inside the window.
    setFrame((value) => ({ ...value, ...placeFrame(value) }));
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* released */ }
  }

  function keyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    event.stopPropagation();
    // An input method choosing a candidate (Chinese, Japanese…) owns Enter and Escape.
    if (event.nativeEvent.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    const mod = event.ctrlKey || event.metaKey;
    if (event.key === "Escape") { event.preventDefault(); escape(); return; }
    if (event.key === "F11") { event.preventDefault(); toggleFull(); return; }
    if (drawing) return;
    if (mod && event.key === "Enter") { event.preventDefault(); save(); return; }
    if (mod && !event.shiftKey && event.code === "KeyS") { event.preventDefault(); save(); }
  }

  if (!request) return null;

  if (inline && frame.view === "min") {
    const summary = pageMode ? page.title.trim() || plainLine(page.text) : captureDraftSummary(userId, floating);
    return <button type="button" className="cap-pill" onClick={() => setFrame((current) => ({ ...current, view: "normal" }))}
      aria-label={`Open Capture${summary ? `: ${summary}` : ""}`} title="Open Capture">
      <Feather size={18} aria-hidden="true" /><span>{summary || "Capture"}</span>
    </button>;
  }

  const pageStatus = pageState === "saving" ? "Saving…"
    : pageState === "offline" || (page.savedId && pageDirty && !online) ? "Offline · kept on this device, saves when you are back online"
      : pageState === "error" ? "Not saved"
        : page.savedId ? (pageDirty ? "Editing…" : page.savedAt ? `Saved ${timeLabel(page.savedAt)}` : "Saved on this device · waiting to sync")
          : page.text.trim() ? "Not in Captures yet · Save puts it there" : "";
  const bodyLength = pageMode ? page.text.length : quickBody.length;
  const fullness = bodyLength / LIMITS.body;
  const footNote = error ? "" : flash || (fullness > .8
    ? `Nearly full: ${Math.round(fullness * 100)}% of a note's space. ${pageMode ? "Start a new page soon." : "Save it soon."}`
    : pageMode ? pageStatus : "File it later from Captures.");
  const canSave = pageMode ? !!page.text.trim() && (!page.savedId || pageDirty) : quickValid;

  return <div ref={panelRef}
    className={`qc-panel cap-panel ${native ? "is-native" : "is-inline"} ${isFull ? "is-full" : ""} ${pageMode ? "is-page" : ""}`}
    style={box ? { left: box.x, top: box.y, width: box.w, height: box.h } : undefined}
    role="dialog" aria-label="Capture" onKeyDown={keyDown}>
    <header className="cap-head" onPointerDown={(event) => beginGesture("move", event)}
      onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture}>
      <span className="cap-title"><Feather size={16} aria-hidden="true" /> Capture{pageMode ? <em>Page</em> : null}</span>
      <div className="cap-window" role="group" aria-label="Window">
        <button type="button" onClick={toggleFull} aria-label={isFull ? "Leave full screen" : "Full screen"}
          title={isFull ? "Leave full screen (F11 or Esc)" : "Full screen (F11)"}>{isFull ? <Shrink size={16} /> : <Expand size={16} />}</button>
        {native ? <button type="button" onClick={native.toggleOnTop} aria-pressed={native.onTop}
          aria-label={native.onTop ? "Stop keeping on top" : "Keep on top of other windows"}
          title={native.onTop ? "Kept on top of other windows (click to release)" : "Keep on top of other windows"}>
          {native.onTop ? <Pin size={15} fill="currentColor" /> : <PinOff size={15} />}</button> : null}
        <button type="button" onClick={minimise} aria-label="Minimise" title="Minimise (the draft stays)"><Minus size={17} /></button>
        <button type="button" onClick={close} aria-label="Close Capture" title="Close (Esc). The draft stays"><X size={17} /></button>
      </div>
    </header>

    <div className="cap-bar">
      {pageMode ? <>
        <button type="button" className="cap-chip" onClick={openQuick} title="Back to quick capture. This page stays as it is">
          <Feather size={15} aria-hidden="true" /> Quick</button>
        <span className="cap-spacer" />
        <button type="button" className="cap-chip" onClick={() => void newPage()} disabled={saving || (!page.text.trim() && !page.title.trim())}
          title="Save this page and start a blank one"><FilePlus2 size={15} aria-hidden="true" /> New page</button>
      </> : <>
        <div className="cap-seg" role="group" aria-label="Capture type">
          {KINDS.map((kind) => <button type="button" key={kind.value} aria-pressed={quick.type === kind.value}
            className={quick.type === kind.value ? "active" : ""} onClick={() => patchQuick({ type: kind.value })}>{kind.label}</button>)}
        </div>
        <span className="cap-spacer" />
        {quick.type === "note" ? <>
          <div className="cap-seg is-icons" role="group" aria-label="Input">
            <button type="button" aria-pressed={quick.input === "type"} className={quick.input === "type" ? "active" : ""}
              onClick={() => patchQuick({ input: "type" })} title="Type"><Keyboard size={16} aria-hidden="true" /><span>Text</span></button>
            <button type="button" aria-pressed={quick.input === "pen"} className={quick.input === "pen" ? "active" : ""}
              onClick={() => patchQuick({ input: "pen" })} title="Write by hand"><PenLine size={16} aria-hidden="true" /><span>Pen</span></button>
          </div>
          <button type="button" className="cap-chip is-format" onClick={openPage}
            title="Format: a full page with headings, lists, tables, colours and drawings, for writing a lesson">
            <ALargeSmall size={17} aria-hidden="true" /> Format</button>
        </> : null}
      </>}
    </div>

    <div className={`cap-body ${pageMode ? "is-page" : quick.type === "note" && quick.input === "pen" ? "is-pen" : ""}`}>
      {pageMode ? <div className="cap-page">
        <input className="cap-page-title" value={page.title} aria-label="Page title" placeholder="Title"
          maxLength={LIMITS.title} onChange={(event) => { patchPage({ title: event.target.value }); setError(""); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); editorRef.current?.focus("start"); } }} />
        <RichEditor ref={editorRef} value={page.text} resetKey={`capture-page-${pageKey}`} autoFocus
          ariaLabel="Page" placeholder="Write the lesson. # heading, - list, Ctrl+B bold…"
          onChange={(markdown) => { patchPage({ text: markdown }); setError(""); }}
          onEscape={escape} onSave={save} onDone={save}
          onEditDrawing={(line, apply) => setDrawing({ note: decodeHandNote(line), apply })}
          extraTools={<div className="nb-toolbar-group cap-draw-tool">
            <button type="button" title="Draw: handwriting or a sketch, placed at the cursor" aria-label="Draw"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setDrawing({ note: emptyHandNote(quick.ink.paper), apply: null })}>
              <PenLine size={15} aria-hidden="true" /><span>Draw</span></button>
          </div>} />
      </div> : quick.type === "note" && quick.input === "pen" ? <>
        <HandNotePad value={quick.ink} onChange={(ink) => patchQuick({ ink })} disabled={saving} autoFocus fill
          variant={isFull ? "sheet" : "compact"} />
        <textarea className="cap-caption" rows={Math.min(3, Math.max(1, quick.text.split("\n").length))} value={quick.text}
          onChange={(event) => patchQuick({ text: event.target.value })} aria-label="Optional caption" placeholder="Caption (optional)" />
      </> : quick.type === "note" ? <textarea className="qc-main-input cap-text" autoFocus aria-label="Quick note" value={quick.text}
        placeholder="Write it down…" onChange={(event) => patchQuick({ text: event.target.value })} />
        : quick.type === "flashcard" ? <>
          <label className="cap-field">Front<textarea autoFocus value={quick.front} placeholder="Question or phrase…" onChange={(event) => patchQuick({ front: event.target.value })} /></label>
          <label className="cap-field">Back<textarea value={quick.back} placeholder="Answer or translation…" onChange={(event) => patchQuick({ back: event.target.value })} /></label>
        </> : <>
          <label className="cap-field">Mistake<textarea autoFocus value={quick.wrong} placeholder="What was wrong?" onChange={(event) => patchQuick({ wrong: event.target.value })} /></label>
          <label className="cap-field">Correction<textarea value={quick.correct} placeholder="Correct version…" onChange={(event) => patchQuick({ correct: event.target.value })} /></label>
        </>}
      {drawing ? <DrawingSheet note={drawing.note} editing={!!drawing.apply}
        onNoteChange={(note) => setDrawing((current) => current ? { ...current, note } : current)}
        onDone={finishDrawing} onCancel={() => setDrawing(null)}
        onRemove={() => { drawing.apply?.(null); setDrawing(null); }} /> : null}
    </div>

    {error ? <p className="q-capture-error cap-error" role="alert">{error}</p> : null}
    <footer className="cap-foot">
      <span className={`cap-foot-note ${flash ? "is-flash" : ""} ${fullness > .8 ? "is-warn" : ""}`} role="status">{footNote}</span>
      <span className="cap-keys" aria-hidden="true">{MOD} ↵ save</span>
      <button type="button" className="q-primary cap-save" disabled={saving || !canSave || !!drawing} onClick={save}>
        {saving && (!pageMode || pageState === "saving") ? "Saving…" : pageMode && page.savedId && !pageDirty ? "Saved" : "Save"}
      </button>
    </footer>
    {!isFull ? <span className="cap-resize" aria-hidden="true"
      onPointerDown={(event) => beginGesture("size", event)} onPointerMove={moveGesture} onPointerUp={endGesture} onPointerCancel={endGesture} /> : null}
  </div>;
}

