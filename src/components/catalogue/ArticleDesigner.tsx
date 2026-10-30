import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlignCenter, AlignJustify, AlignLeft, ArrowDown, ArrowLeft, ArrowUp, Bold, BookOpenCheck, ChevronDown, ChevronsDown, ChevronsUp,
  Columns2, Copy, Crop, Eye, FileDown, Heading, ImagePlus, Info, Italic, List, ListOrdered, Minus, MoreHorizontal, PanelLeft,
  Plus, Quote, Redo2, Rows3, Square, Trash2, Type, Undo2, X,
} from "lucide-react";
import {
  BLOCK_LABELS, COLOUR_PRESETS, PAGE_HEIGHT_PX, PAGE_WIDTH_PX, TYPOGRAPHY_PRESETS, articleTitle, deletePage, duplicatePage, emptyPictureFrames, findBlock,
  insertBlock, insertPage, isCoverPage, moveBlockToPage, pageHasContent, moveBlockWithinPage, movePage, newBlock, newPage, removeBlock, stableJson, updateBlock,
  type Block, type BlockType, type CatalogueArticle, type ImageRef, type Spacing,
} from "../../lib/catalogue/model";
import { COMPOSITIONS, compositionBlocks, type CompositionId } from "../../lib/catalogue/compositions";
import { coverFrameAspect } from "../../lib/catalogue/presets";
import { ConflictError, catalogueError, createArticle, fetchArticle, updateArticle, type ArticlePatch } from "../../lib/catalogue/store";
import { Portal, useConfirm } from "../workspace/ui";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { ArticlePageView, DesignerContext, type DesignerApi } from "./ArticlePage";
import { ArticleReader } from "./ArticleReader";
import { useCatalogue } from "./CatalogueData";
import { ExportDialog } from "./ExportDialog";
import { ImageDialog } from "./ImageDialog";
import { clearDesignerNotice, peekDesignerNotice } from "./notices";
import { Field, Menu, PageThumb, Segmented, formatDate } from "./parts";
import { flowOverflow, pageOverflowPx } from "./stage";
import { VolumeDialog } from "./VolumeView";

type SaveState = "saved" | "unsaved" | "saving" | "offline" | "error" | "conflict";
const CONTENT_KEYS = ["title", "subtitle", "author", "subject_id", "volume_id", "volume_order", "status", "published_at",
  "typography_preset", "colour_preset", "page_numbers", "running_header", "cover", "pages"] as const;
const draftKey = (userId: string, id: string) => `heuresis.catalogue.draft.v1:${userId}:${id}`;
type LocalDraft = { article: CatalogueArticle; base: string; savedAt: string };

function contentPatch(base: CatalogueArticle, current: CatalogueArticle): ArticlePatch {
  const patch: Record<string, unknown> = {};
  for (const key of CONTENT_KEYS) if (stableJson(base[key]) !== stableJson(current[key])) patch[key] = current[key];
  return patch as ArticlePatch;
}
function readDraft(userId: string, id: string): LocalDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId, id));
    const parsed = raw ? JSON.parse(raw) as LocalDraft : null;
    return parsed?.article?.id === id ? parsed : null;
  } catch { return null; }
}
function writeDraft(userId: string, article: CatalogueArticle, base: string) {
  try { localStorage.setItem(draftKey(userId, article.id), JSON.stringify({ article, base, savedAt: new Date().toISOString() } satisfies LocalDraft)); }
  catch { /* storage full or unavailable: the server save still runs */ }
}
function clearDraft(userId: string, id: string) {
  try { localStorage.removeItem(draftKey(userId, id)); } catch { /* optional */ }
}

const BLOCK_ICONS: Record<BlockType, ReactNode> = {
  text: <Type size={15} />, heading: <Heading size={15} />, image: <ImagePlus size={15} />, "image-text": <Columns2 size={15} />,
  quote: <Quote size={15} />, divider: <Minus size={15} />, caption: <Rows3 size={15} />, cover: <BookOpenCheck size={15} />,
};
const ADDABLE: BlockType[] = ["text", "heading", "image", "image-text", "quote", "divider", "caption", "cover"];

type ImageTarget = { kind: "block"; blockId: string } | { kind: "cover" };

/**
 * Saves still running for an article whose designer has closed. Opening the article
 * again waits for them, so the designer never starts from an older revision (which
 * would make its next save look like a change from another device).
 */
const pendingSaves = new Map<string, Promise<void>>();

/**
 * Measures the pages as they will be printed: empty fields that only the designer
 * shows (placeholders such as "Attribution (optional)" on a selected block) are left
 * out, so selecting a block never makes a page look too full.
 */
function measuringAsPrinted<T>(canvas: HTMLElement, measure: () => T): T {
  canvas.classList.add("is-measuring");
  try { return measure(); } finally { canvas.classList.remove("is-measuring"); }
}

export function ArticleDesigner({ articleId }: { articleId: string }) {
  const [ready, setReady] = useState(() => !pendingSaves.has(articleId));
  useEffect(() => {
    if (ready) return;
    let live = true;
    void (async () => {
      while (pendingSaves.has(articleId)) await pendingSaves.get(articleId)!.catch(() => undefined);
      if (live) setReady(true);
    })();
    return () => { live = false; };
  }, [articleId, ready]);
  if (!ready) return <Portal><div className="ct-studio" role="dialog" aria-modal="true" aria-label="Article Designer">
    <div className="ct-studio-missing"><div className="ct-busy" role="status"><span className="ws-spinner" /> Saving your last changes…</div></div>
  </div></Portal>;
  return <DesignerStudio articleId={articleId} />;
}

function DesignerStudio({ articleId }: { articleId: string }) {
  const catalogue = useCatalogue();
  const workspace = useWorkspace();
  // Saving must not depend on the context's identity (it changes after every save).
  const catalogueRef = useRef(catalogue);
  catalogueRef.current = catalogue;
  const initial = catalogue.articleById.get(articleId) ?? null;
  const [article, setArticle] = useState<CatalogueArticle | null>(initial);
  const articleRef = useRef<CatalogueArticle | null>(initial);
  const serverRef = useRef<CatalogueArticle | null>(initial);
  const history = useRef<CatalogueArticle[]>([]);
  const future = useRef<CatalogueArticle[]>([]);
  const lastEdit = useRef<{ key: string; at: number }>({ key: "", at: 0 });
  const [, setHistoryVersion] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState("");
  const [overflow, setOverflow] = useState<Record<string, number>>({});
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [fitScale, setFitScale] = useState(0.8);
  const [railOpen, setRailOpen] = useState(() => window.innerWidth > 1100);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [imageTarget, setImageTarget] = useState<ImageTarget | null>(null);
  const [notice, setNotice] = useState<string[] | null>(() => peekDesignerNotice(articleId));
  const [flowing, setFlowing] = useState(false);
  const [toolbar, setToolbar] = useState<{ top: number; left: number; docked: boolean } | null>(null);
  const [addMenu, setAddMenu] = useState<{ pageId: string; index: number } | null>(null);
  const [volumeDialog, setVolumeDialog] = useState(false);
  const [layoutMenu, setLayoutMenu] = useState<{ index: number } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [currentPage, setCurrentPage] = useState<string | null>(null);
  const previewingRef = useRef(false);
  previewingRef.current = previewing;
  const [confirmElement, confirm] = useConfirm();
  const canvasRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const draftTimer = useRef<number | null>(null);
  const saving = useRef(false);
  const again = useRef(false);
  const deferred = useDeferredValue(article);
  const scale = zoom === "fit" ? fitScale : zoom;
  const labels = article ? catalogue.labelFor(article) : { kicker: "", runningTitle: "" };

  // ------------------------------------------------------------------ saving
  const saveNow = useCallback(async () => {
    const current = articleRef.current;
    const base = serverRef.current;
    if (!current || !base) return;
    if (saving.current) { again.current = true; return; }
    const patch = contentPatch(base, current);
    if (!Object.keys(patch).length) { setSaveState(navigator.onLine ? "saved" : "offline"); clearDraft(catalogueRef.current.userId, current.id); return; }
    saving.current = true;
    setSaveState("saving");
    const job = (async () => { try {
      const saved = await updateArticle(base, patch);
      serverRef.current = saved;
      const latest = articleRef.current ?? current;
      articleRef.current = { ...latest, updated_at: saved.updated_at };
      setArticle(articleRef.current);
      catalogueRef.current.articleSaved(saved);
      const clean = !Object.keys(contentPatch(saved, articleRef.current)).length;
      if (clean) clearDraft(catalogueRef.current.userId, current.id);
      setSaveState(clean ? (navigator.onLine ? "saved" : "offline") : "unsaved");
      setSaveError("");
    } catch (error) {
      if (error instanceof ConflictError) setSaveState("conflict");
      else { setSaveState("error"); setSaveError(catalogueError(error)); }
    } })();
    const tracked: Promise<void> = job.finally(() => { if (pendingSaves.get(current.id) === tracked) pendingSaves.delete(current.id); });
    pendingSaves.set(current.id, tracked);
    try {
      await tracked;
    } finally {
      saving.current = false;
      if (again.current) { again.current = false; void saveNow(); }
    }
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState((state) => state === "conflict" ? state : "unsaved");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => { saveTimer.current = null; void saveNow(); }, 900);
    if (draftTimer.current) window.clearTimeout(draftTimer.current);
    draftTimer.current = window.setTimeout(() => {
      draftTimer.current = null;
      if (articleRef.current && serverRef.current) writeDraft(catalogue.userId, articleRef.current, serverRef.current.updated_at);
    }, 300);
  }, [catalogue.userId, saveNow]);

  // ------------------------------------------------------------------ changes and history
  const apply = useCallback((update: (current: CatalogueArticle) => CatalogueArticle, kind: "typing" | "change" = "change", key = "") => {
    const current = articleRef.current;
    if (!current) return;
    const next = update(current);
    if (next === current) return;
    const now = Date.now();
    const coalesce = kind === "typing" && lastEdit.current.key === key && now - lastEdit.current.at < 1600;
    if (!coalesce) {
      history.current.push(current);
      if (history.current.length > 120) history.current.shift();
      future.current = [];
      setHistoryVersion((value) => value + 1);
    }
    lastEdit.current = { key: kind === "typing" ? key : "", at: now };
    articleRef.current = next;
    setArticle(next);
    scheduleSave();
  }, [scheduleSave]);

  /** Replace the content wholesale (undo, redo, flow, reload) and let every field re-read it. */
  const replaceContent = useCallback((next: CatalogueArticle, record = true) => {
    const current = articleRef.current;
    if (!current) return;
    if (record) { history.current.push(current); future.current = []; }
    articleRef.current = { ...next, updated_at: current.updated_at };
    setArticle(articleRef.current);
    setResetKey((value) => value + 1);
    setHistoryVersion((value) => value + 1);
    lastEdit.current = { key: "", at: 0 };
    scheduleSave();
  }, [scheduleSave]);

  const flushEditing = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.isContentEditable) active.blur();
  };
  const undo = useCallback(() => {
    flushEditing();
    const previous = history.current.pop();
    if (!previous || !articleRef.current) return;
    future.current.push(articleRef.current);
    replaceContent(previous, false);
  }, [replaceContent]);
  const redo = useCallback(() => {
    flushEditing();
    const next = future.current.pop();
    if (!next || !articleRef.current) return;
    history.current.push(articleRef.current);
    replaceContent(next, false);
  }, [replaceContent]);

  // ------------------------------------------------------------------ opening
  useEffect(() => {
    if (!initial) return;
    const draft = readDraft(catalogue.userId, initial.id);
    if (draft && Object.keys(contentPatch(initial, draft.article)).length) {
      if (draft.base === initial.updated_at) {
        articleRef.current = { ...draft.article, updated_at: initial.updated_at };
        setArticle(articleRef.current);
        setResetKey((value) => value + 1);
        scheduleSave();
        workspace.toast("Unsaved changes from your last session were restored.");
      } else {
        workspace.toast("This device has an older unsaved version of this article.", {
          action: { label: "Restore it", run: () => replaceContent({ ...draft.article }) },
        });
      }
    }
    // Make sure the latest revision from another device is being edited.
    if (navigator.onLine) void fetchArticle(catalogue.userId, initial.id).then((latest) => {
      if (!latest || !serverRef.current || latest.updated_at === serverRef.current.updated_at) return;
      const local = articleRef.current;
      if (local && Object.keys(contentPatch(serverRef.current, local)).length) return; // local edits win the next save conflict check
      serverRef.current = latest;
      articleRef.current = latest;
      setArticle(latest);
      setResetKey((value) => value + 1);
      catalogue.articleSaved(latest);
    }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Leaving: flush the field being typed in and save at once (the device copy stays until it is stored).
  const saveRef = useRef(saveNow);
  saveRef.current = saveNow;
  useEffect(() => {
    const userId = catalogueRef.current.userId;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const beforeUnload = () => { if (articleRef.current && serverRef.current) writeDraft(userId, articleRef.current, serverRef.current.updated_at); };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      clearDesignerNotice(articleId);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("beforeunload", beforeUnload);
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (draftTimer.current) window.clearTimeout(draftTimer.current);
      if (articleRef.current && serverRef.current && Object.keys(contentPatch(serverRef.current, articleRef.current)).length) {
        writeDraft(userId, articleRef.current, serverRef.current.updated_at);
        void saveRef.current();
      }
    };
  }, [articleId]);

  // ------------------------------------------------------------------ layout: scale and overflow
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const measure = () => setFitScale(Math.max(0.3, Math.min(1.25, (canvas.clientWidth - (window.innerWidth < 700 ? 24 : 96)) / PAGE_WIDTH_PX)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [article !== null]);

  const measureOverflow = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const next: Record<string, number> = {};
    measuringAsPrinted(canvas, () => {
      for (const page of Array.from(canvas.querySelectorAll<HTMLElement>(".ct-page-slot > .ap-page"))) {
        const px = pageOverflowPx(page);
        if (px > 1) next[page.dataset.pageId ?? ""] = px;
      }
    });
    setOverflow((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
  }, []);
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(measureOverflow);
    return () => cancelAnimationFrame(frame);
  }, [article, measureOverflow, resetKey]);
  useEffect(() => {
    const onFonts = () => measureOverflow();
    document.fonts?.addEventListener?.("loadingdone", onFonts);
    const timer = window.setTimeout(measureOverflow, 600);
    return () => { document.fonts?.removeEventListener?.("loadingdone", onFonts); window.clearTimeout(timer); };
  }, [measureOverflow]);

  // ------------------------------------------------------------------ the selected block's toolbar
  // A calm contextual strip just above the selected block (or just below it when there is no room
  // above), so it does not sit on the text being edited. On narrow screens it is docked at the bottom.
  const placeToolbar = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !selectedId) { setToolbar(null); return; }
    const element = canvas.querySelector<HTMLElement>(`.ct-page-slot [data-block-id="${selectedId}"]`);
    if (!element) { setToolbar(null); return; }
    if (window.innerWidth < 760) { setToolbar((current) => current?.docked ? current : { top: 0, left: 0, docked: true }); return; }
    const canvasRect = canvas.getBoundingClientRect();
    const blockRect = element.getBoundingClientRect();
    const height = document.querySelector<HTMLElement>(".ct-block-toolbar")?.offsetHeight || 44;
    const gap = 10;
    const top = blockRect.top - height - gap >= canvasRect.top + 8 ? blockRect.top - height - gap
      : blockRect.bottom + gap + height <= canvasRect.bottom - 8 ? blockRect.bottom + gap
        : canvasRect.top + 10;
    setToolbar((current) => {
      const next = { top: Math.round(top), left: Math.round(canvasRect.left + canvasRect.width / 2), docked: false };
      return current && current.top === next.top && current.left === next.left && !current.docked ? current : next;
    });
  }, [selectedId]);
  useLayoutEffect(() => { placeToolbar(); }, [placeToolbar, article, scale, overflow]);
  // Once the toolbar exists its real height is known (it may wrap), so place it again.
  const toolbarShown = toolbar !== null;
  useLayoutEffect(() => { if (toolbarShown) placeToolbar(); }, [toolbarShown, placeToolbar]);
  // The page in view (or holding the selected block) is marked in the page list.
  const findCurrentPage = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const line = canvas.getBoundingClientRect().top + canvas.clientHeight * 0.35;
    const slots = Array.from(canvas.querySelectorAll<HTMLElement>(".ct-page-slot"));
    const slot = slots.find((item) => item.getBoundingClientRect().bottom >= line) ?? slots[slots.length - 1];
    if (slot?.dataset.slot) setCurrentPage(slot.dataset.slot);
  }, []);
  useEffect(() => {
    const canvas = canvasRef.current;
    let frame = 0;
    const schedule = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(() => { placeToolbar(); findCurrentPage(); }); };
    window.addEventListener("resize", schedule);
    canvas?.addEventListener("scroll", schedule, { passive: true });
    schedule();
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener("resize", schedule); canvas?.removeEventListener("scroll", schedule); };
  }, [placeToolbar, findCurrentPage]);
  useEffect(() => {
    const pageId = selectedId && articleRef.current ? findBlock(articleRef.current.pages, selectedId)?.page.id : null;
    if (pageId) setCurrentPage(pageId);
  }, [selectedId]);
  useEffect(() => {
    if (!currentPage) return;
    document.querySelector<HTMLElement>(`.ct-rail li[data-page="${currentPage}"]`)?.scrollIntoView({ block: "nearest" });
  }, [currentPage]);

  // ------------------------------------------------------------------ operations
  const patchBlock = useCallback((id: string, patch: Partial<Block>, kind: "typing" | "change" = "change") =>
    apply((current) => ({ ...current, pages: updateBlock(current.pages, id, patch) }), kind, `block:${id}:${Object.keys(patch).join(",")}`), [apply]);
  const patchArticle = useCallback((patch: Partial<CatalogueArticle>, kind: "typing" | "change" = "change") =>
    apply((current) => ({ ...current, ...patch }), kind, `article:${Object.keys(patch).join(",")}`), [apply]);
  const requestImage = useCallback((blockId: string) => setImageTarget({ kind: "block", blockId }), []);

  const api = useMemo<DesignerApi>(() => ({
    selectedId, select: setSelectedId, patchBlock, patchArticle, requestImage, resetKey,
  }), [patchArticle, patchBlock, requestImage, resetKey, selectedId]);

  const addBlock = (type: BlockType, pageId: string, index: number) => {
    setAddMenu(null);
    const current = articleRef.current;
    if (!current) return;
    if (type === "cover") {
      const pageIndex = current.pages.findIndex((page) => page.id === pageId);
      const page = current.pages[pageIndex];
      const cover = newBlock("cover");
      const pages = page && !page.blocks.length ? current.pages.map((item) => item.id === pageId ? { ...item, blocks: [cover] } : item)
        : insertPage(current.pages, Math.max(0, pageIndex), newPage([cover]));
      apply((article) => ({ ...article, pages }));
      setSelectedId(cover.id);
      return;
    }
    const block = newBlock(type);
    apply((article) => ({ ...article, pages: insertBlock(article.pages, pageId, index, block) }));
    setSelectedId(block.id);
    if (type === "image" || type === "image-text") setImageTarget({ kind: "block", blockId: block.id });
    else window.requestAnimationFrame(() => {
      const target = canvasRef.current?.querySelector<HTMLElement>(`[data-block-id="${block.id}"] .ap-editable`);
      target?.focus();
    });
  };

  const selected = article && selectedId ? findBlock(article.pages, selectedId) : null;

  async function removeSelected() {
    if (!selected) return;
    apply((current) => ({ ...current, pages: removeBlock(current.pages, selected.block.id) }));
    setSelectedId(null);
    workspace.toast(`${BLOCK_LABELS[selected.block.type]} removed.`, { action: { label: "Undo", run: undo } });
  }

  async function pageAction(action: "before" | "after" | "duplicate" | "up" | "down" | "delete", pageId: string) {
    const current = articleRef.current;
    if (!current) return;
    const index = current.pages.findIndex((page) => page.id === pageId);
    if (index < 0) return;
    if (action === "delete") {
      const page = current.pages[index];
      const asked = pageHasContent(page);
      if (asked && !await confirm({ title: `Delete page ${index + 1}?`, body: "Its content is removed with it. You can undo this.", confirmLabel: "Delete page", danger: true })) return;
      apply((article) => ({ ...article, pages: deletePage(article.pages, pageId) }));
      if (!asked) workspace.toast(`Page ${index + 1} deleted.`, { action: { label: "Undo", run: undo } });
      return;
    }
    if (action === "before" || action === "after") {
      const page = newPage();
      apply((article) => ({ ...article, pages: insertPage(article.pages, action === "before" ? index : index + 1, page) }));
      window.requestAnimationFrame(() => scrollToPage(page.id));
      return;
    }
    if (action === "duplicate") { apply((article) => ({ ...article, pages: duplicatePage(article.pages, pageId) })); return; }
    apply((article) => ({ ...article, pages: movePage(article.pages, pageId, index + (action === "up" ? -1 : 1)) }));
  }

  function scrollToPage(pageId: string) {
    const element = canvasRef.current?.querySelector<HTMLElement>(`.ct-page-slot[data-slot="${pageId}"]`);
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  /** Moves overflowing content onward; true when everything now fits on its page. */
  async function flow(fromIndex: number, relaidMessage?: string): Promise<boolean> {
    const current = articleRef.current;
    if (!current || flowing) return false;
    flushEditing();
    setFlowing(true);
    try {
      const result = await flowOverflow(articleRef.current ?? current, { startPage: fromIndex, labels });
      if (result.changed) {
        replaceContent({ ...(articleRef.current ?? current), pages: result.pages });
        const added = result.pages.length - current.pages.length;
        workspace.toast(relaidMessage ?? (added > 0 ? `Content moved onward; ${added} ${added === 1 ? "page was" : "pages were"} added.` : "Content moved to the following page."), { action: { label: "Undo", run: undo } });
      }
      if (result.unresolved.length) workspace.toast(`Page ${result.unresolved.map((index) => index + 1).join(", ")} still has a block taller than the page. Make that image smaller or choose another proportion.`, { tone: "error" });
      return !result.unresolved.length;
    } catch (error) {
      workspace.toast(catalogueError(error), { tone: "error" });
      return false;
    } finally { setFlowing(false); }
  }

  /** Pages whose content runs past the bottom margin, measured now. */
  function overflowingPages() {
    const canvas = canvasRef.current;
    if (!canvas) return [];
    return measuringAsPrinted(canvas, () => Array.from(canvas.querySelectorAll<HTMLElement>(".ct-page-slot > .ap-page"))
      .map((page, index) => (pageOverflowPx(page) > 1 ? index : -1)).filter((index) => index >= 0));
  }

  /** Publishing requires every word to be visible; empty picture frames are pointed out. */
  async function requestPublish() {
    flushEditing();
    const overflowing = overflowingPages();
    if (overflowing.length) {
      const list = overflowing.map((index) => index + 1).join(", ");
      const moveIt = await confirm({
        title: overflowing.length === 1 ? `Page ${list} has more than fits` : `Pages ${list} have more than fits`,
        body: "A published article shows every word, so it cannot be published while content runs past a page's bottom margin. The extra content can be moved onto the following pages, then the article is published.",
        confirmLabel: "Move overflow and publish",
      });
      if (!moveIt || !await flow(overflowing[0])) return;
    }
    const current = articleRef.current;
    if (!current) return;
    const empty = emptyPictureFrames(current);
    if (empty && !await confirm({
      title: empty === 1 ? "A picture frame is still empty" : `${empty} picture frames are still empty`,
      body: "Empty frames are left out when the article is read and in the PDF. Publish now, or add the pictures first.",
      confirmLabel: "Publish now",
    })) return;
    patchArticle({ status: "published", published_at: current.published_at ?? new Date().toISOString() });
    workspace.toast("Published. It is now on the library shelves.");
  }

  function addPageWithLayout(id: CompositionId, index: number) {
    setLayoutMenu(null);
    const blocks = compositionBlocks(id);
    const page = newPage(blocks);
    apply((current) => ({ ...current, pages: insertPage(current.pages, index, page) }));
    setSelectedId(blocks[0]?.id ?? null);
    window.requestAnimationFrame(() => scrollToPage(page.id));
  }

  // ------------------------------------------------------------------ keyboard
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (previewing || document.querySelector(".ws-dialog-backdrop")) return;
      const mod = event.ctrlKey || event.metaKey;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)));
      if (mod && !event.altKey && event.code === "KeyZ") { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return; }
      if (mod && !event.altKey && event.code === "KeyY") { event.preventDefault(); redo(); return; }
      if (mod && event.code === "KeyS") { event.preventDefault(); flushEditing(); void saveNow(); return; }
      if (event.key === "Escape") {
        if (typing && target) { target.blur(); event.preventDefault(); return; }
        if (selectedId) { setSelectedId(null); event.preventDefault(); }
        return;
      }
      if (typing || !selectedId) return;
      if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); void removeSelected(); return; }
      if (event.altKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        apply((current) => ({ ...current, pages: moveBlockWithinPage(current.pages, selectedId, event.key === "ArrowUp" ? -1 : 1) }));
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
  useEffect(() => {
    // The browser's own undo would fight the designer's history inside text fields.
    const onBeforeInput = (event: InputEvent) => {
      if (event.inputType === "historyUndo" || event.inputType === "historyRedo") {
        event.preventDefault();
        if (previewingRef.current) return;
        if (event.inputType === "historyUndo") undo(); else redo();
      }
    };
    window.addEventListener("beforeinput", onBeforeInput as EventListener, true);
    return () => window.removeEventListener("beforeinput", onBeforeInput as EventListener, true);
  }, [redo, undo]);

  // ------------------------------------------------------------------ rendering
  if (!article) return <Portal><div className="ct-studio" role="dialog" aria-modal="true" aria-label="Article Designer">
    <div className="ct-studio-missing"><p>This article is no longer in the Catalogue. It may have been deleted on another device.</p>
      <button type="button" className="ws-button" onClick={() => catalogue.navigate({ view: "library" })}>Back to Catalogue</button></div>
  </div></Portal>;

  const back = () => {
    flushEditing();
    const from = catalogue.route.view === "design" ? catalogue.route.from : undefined;
    catalogue.navigate(from && from.view !== "design" ? from : { view: "library" });
  };
  // Preview shows exactly what is on screen (saved or not) and closes back into the designer.
  const preview = () => { flushEditing(); setSelectedId(null); setPreviewing(true); };
  const saveLabel = { saved: "Saved", unsaved: "Unsaved changes", saving: "Saving…", offline: "Saved on this device", error: "Not saved", conflict: "Changed elsewhere" }[saveState];
  const overflowPages = article.pages.map((page, index) => ({ page, index, px: overflow[page.id] ?? 0 })).filter((item) => item.px > 0);
  const blockForImage = imageTarget?.kind === "block" ? findBlock(article.pages, imageTarget.blockId)?.block ?? null : null;

  const topBar = <header className="ct-studio-bar">
    <button type="button" className="ct-bar-back" onClick={back} aria-label="Back to Catalogue"><ArrowLeft size={17} /><span>Catalogue</span></button>
    <button type="button" className={`ws-icon-button ct-rail-toggle ${railOpen ? "is-on" : ""}`} aria-label={railOpen ? "Hide pages" : "Show pages"} aria-pressed={railOpen} onClick={() => setRailOpen((value) => !value)}><PanelLeft size={16} /></button>
    <input className="ct-bar-title" value={article.title} maxLength={200} placeholder="Untitled article" aria-label="Article title"
      onChange={(event) => patchArticle({ title: event.target.value }, "typing")} />
    <span className={`ct-save is-${saveState}`} role="status" title={saveError || undefined}>{saveLabel}</span>
    <span className="ct-bar-group">
      <button type="button" className="ws-icon-button" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.current.length} onClick={undo}><Undo2 size={16} /></button>
      <button type="button" className="ws-icon-button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!future.current.length} onClick={redo}><Redo2 size={16} /></button>
    </span>
    <span className="ct-bar-spacer" />
    <label className="ct-preset-select" title="Typography">
      <span className="ct-sr">Typography</span>
      <select aria-label="Typography preset" value={article.typography_preset} onChange={(event) => {
        const preset = event.target.value as CatalogueArticle["typography_preset"];
        patchArticle({ typography_preset: preset });
        // Another type size changes how much fits: divided text is joined and the pages laid out again.
        window.requestAnimationFrame(() => void flow(0, `Pages laid out again for ${TYPOGRAPHY_PRESETS.find((item) => item.id === preset)?.label ?? preset}.`));
      }}>
        {TYPOGRAPHY_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
      </select><ChevronDown size={13} aria-hidden="true" />
    </label>
    <div className="ct-swatches" role="radiogroup" aria-label="Colour preset">
      {COLOUR_PRESETS.map((preset) => <button key={preset.id} type="button" role="radio" aria-checked={article.colour_preset === preset.id}
        aria-label={preset.label} title={preset.label} className={article.colour_preset === preset.id ? "is-on" : ""}
        style={{ background: preset.paper, color: preset.ink, borderColor: preset.accent }} onClick={() => patchArticle({ colour_preset: preset.id })}>
        <span style={{ background: preset.ink }} /></button>)}
    </div>
    <button type="button" className={`ws-icon-button ${detailsOpen ? "is-on" : ""}`} aria-label="Article details" title="Details" aria-pressed={detailsOpen} onClick={() => setDetailsOpen((value) => !value)}><Info size={16} /></button>
    <button type="button" className="ws-button is-small ct-bar-button" onClick={preview}><Eye size={14} /><span>Preview</span></button>
    <button type="button" className="ws-button is-small ct-bar-button" onClick={() => { flushEditing(); setExporting(true); }}><FileDown size={14} /><span>Export PDF</span></button>
    {article.status === "draft"
      ? <button type="button" className="ws-button is-small is-primary ct-bar-button" onClick={() => void requestPublish()}>Publish</button>
      : <Menu label="Publication status" align="right" trigger={<span className="ct-published">Published <ChevronDown size={12} /></span>} items={[
        { label: "Return to draft", run: () => patchArticle({ status: "draft" }) },
      ]} />}
  </header>;

  const blockToolbar = selected && toolbar ? <BlockToolbar block={selected.block} pageIndex={selected.pageIndex} pageCount={article.pages.length}
    index={selected.index} blocksOnPage={selected.page.blocks.length} position={toolbar}
    onPatch={(patch) => patchBlock(selected.block.id, patch)}
    onMove={(delta) => apply((current) => ({ ...current, pages: moveBlockWithinPage(current.pages, selected.block.id, delta) }))}
    onMovePage={(direction) => apply((current) => ({ ...current, pages: moveBlockToPage(current.pages, selected.block.id, direction) }))}
    onDelete={() => void removeSelected()}
    onImage={() => setImageTarget({ kind: "block", blockId: selected.block.id })}
    onAdd={() => setAddMenu({ pageId: selected.page.id, index: selected.index + 1 })}
    onClose={() => setSelectedId(null)} /> : null;

  return <DesignerContext.Provider value={api}><Portal>
    <div className={`ct-studio ${railOpen ? "has-rail" : ""} ${detailsOpen ? "has-details" : ""}`} role="dialog" aria-modal="true" aria-label="Article Designer">
      {confirmElement}
      {topBar}
      {notice ? <div className="ct-notice" role="status">
        <div>{notice.map((line) => <p key={line}>{line}</p>)}</div>
        <button type="button" className="ws-icon-button" aria-label="Dismiss" onClick={() => { setNotice(null); clearDesignerNotice(article.id); }}><X size={15} /></button>
      </div> : null}
      {saveState === "conflict" ? <ConflictBar article={article} onLoadTheirs={async () => {
        const latest = await fetchArticle(catalogue.userId, article.id);
        if (!latest) { workspace.toast("The other version could not be loaded.", { tone: "error" }); return; }
        serverRef.current = latest; articleRef.current = latest; history.current = []; future.current = [];
        setArticle(latest); setResetKey((value) => value + 1); setSaveState("saved"); clearDraft(catalogue.userId, latest.id);
        catalogue.articleSaved(latest);
      }} onKeepCopy={async () => {
        const mine = articleRef.current;
        if (!mine) return;
        const copy = await createArticle({ ...mine, id: crypto.randomUUID(), title: `${articleTitle(mine)} (my version)`, status: "draft", published_at: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        catalogue.articleSaved(copy);
        workspace.toast("Your version was saved as a separate draft.");
        const latest = await fetchArticle(catalogue.userId, article.id);
        if (latest) { serverRef.current = latest; articleRef.current = latest; setArticle(latest); setResetKey((value) => value + 1); setSaveState("saved"); clearDraft(catalogue.userId, latest.id); catalogue.articleSaved(latest); }
      }} /> : null}
      {saveState === "error" ? <div className="ct-notice is-error" role="alert"><p>{saveError || "The article could not be saved."} Your changes are kept on this device.</p>
        <button type="button" className="ws-button is-small" onClick={() => void saveNow()}>Try again</button></div> : null}
      <div className="ct-studio-body">
        {railOpen ? <aside className="ct-rail" aria-label="Pages">
          <ol>
            {(deferred ?? article).pages.map((page, index) => <li key={page.id} data-page={page.id} className={`${overflow[page.id] ? "has-overflow" : ""} ${page.id === currentPage ? "is-current" : ""}`}
              draggable onDragStart={(event) => { event.dataTransfer.setData("text/x-heuresis-page", page.id); event.dataTransfer.effectAllowed = "move"; }}
              onDragOver={(event) => { if (event.dataTransfer.types.includes("text/x-heuresis-page")) { event.preventDefault(); event.currentTarget.classList.add("is-drop"); } }}
              onDragLeave={(event) => event.currentTarget.classList.remove("is-drop")}
              onDrop={(event) => { event.preventDefault(); event.currentTarget.classList.remove("is-drop"); const id = event.dataTransfer.getData("text/x-heuresis-page"); if (id && id !== page.id) apply((current) => ({ ...current, pages: movePage(current.pages, id, index) })); }}>
              <button type="button" className="ct-rail-page" onClick={() => { setCurrentPage(page.id); scrollToPage(page.id); }} aria-label={`Page ${index + 1}`} aria-current={page.id === currentPage ? "page" : undefined}>
                <PageThumb article={deferred ?? article} page={page} pageIndex={index} width={104} kicker={labels.kicker} runningTitle={labels.runningTitle} />
              </button>
              <span className="ct-rail-number">{index + 1}{overflow[page.id] ? <i title="Content runs past the margin">!</i> : null}</span>
              <PageMenu index={index} count={article.pages.length} onAction={(action) => void pageAction(action, page.id)} />
            </li>)}
          </ol>
          <button type="button" className="ct-rail-add" onClick={() => setLayoutMenu({ index: article.pages.length })}><Plus size={14} /> Add Page</button>
        </aside> : null}
        <div className="ct-canvas" ref={canvasRef}
          onMouseDown={(event) => { if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains("ct-page-column")) setSelectedId(null); }}>
          <div className="ct-page-column">
            {article.pages.map((page, index) => {
              const extra = overflow[page.id] ?? 0;
              return <div key={page.id} className="ct-page-block">
                <div className={`ct-page-slot ${extra ? "has-overflow" : ""}`} data-slot={page.id}
                  style={{ width: PAGE_WIDTH_PX * scale, height: (PAGE_HEIGHT_PX + extra + (extra ? 24 : 0)) * scale }}>
                  <ArticlePageView article={article} page={page} pageIndex={index} pageCount={article.pages.length}
                    kicker={labels.kicker} runningTitle={labels.runningTitle} mode="edit"
                    className="ct-live-page" scale={scale} />
                  {extra ? <div className="ct-overflow-band" style={{ top: PAGE_HEIGHT_PX * scale, height: (extra + 24) * scale }} aria-hidden="true" /> : null}
                </div>
                {extra ? <div className="ct-overflow-note" role="alert">
                  <span>The content of page {index + 1} runs {(extra / (96 / 2.54)).toFixed(1)} cm past the bottom margin.</span>
                  <button type="button" className="ws-button is-small is-primary" disabled={flowing} onClick={() => void flow(index)}>
                    {flowing ? "Moving…" : "Move overflow to next page"}</button>
                </div> : null}
                <div className="ct-page-tools" style={{ width: PAGE_WIDTH_PX * scale }}>
                  <button type="button" className="ct-add-block" onClick={() => setAddMenu({ pageId: page.id, index: page.blocks.length })}><Plus size={14} /> Add block</button>
                  <span>Page {index + 1}{isCoverPage(page) ? " · cover" : ""}</span>
                  <PageMenu index={index} count={article.pages.length} onAction={(action) => void pageAction(action, page.id)} />
                </div>
              </div>;
            })}
            <button type="button" className="ct-add-page" onClick={() => setLayoutMenu({ index: article.pages.length })}><Plus size={15} /> Add Page</button>
          </div>
        </div>
        {detailsOpen ? <DetailsPanel article={article} onPatch={(patch) => patchArticle(patch)} onPublish={() => void requestPublish()} onClose={() => setDetailsOpen(false)}
          onCover={() => setImageTarget({ kind: "cover" })} onNewVolume={() => setVolumeDialog(true)}
          onDelete={async () => {
            if (!await confirm({ title: "Delete this article?", body: "It moves to Deleted articles, where it can be restored. The Notebook is not affected.", confirmLabel: "Delete article", danger: true })) return;
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
            await saveNow();
            await catalogue.removeArticle(serverRef.current ?? article);
            clearDraft(catalogue.userId, article.id);
            catalogue.navigate({ view: "library" });
          }} /> : null}
      </div>
      <div className="ct-zoom" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.3, Math.round((scale - 0.1) * 10) / 10))}><Minus size={14} /></button>
        <button type="button" className="ct-zoom-value" onClick={() => setZoom("fit")} title="Fit the width">{zoom === "fit" ? "Fit" : `${Math.round(scale * 100)}%`}</button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(2.5, Math.round((scale + 0.1) * 10) / 10))}><Plus size={14} /></button>
      </div>
      {overflowPages.length && !flowing ? <button type="button" className="ct-overflow-pill" onClick={() => scrollToPage(overflowPages[0].page.id)}>
        {overflowPages.length === 1 ? `Page ${overflowPages[0].index + 1} overflows` : `${overflowPages.length} pages overflow`}</button> : null}
      {blockToolbar}
      {addMenu ? <AddBlockMenu onPick={(type) => addBlock(type, addMenu.pageId, addMenu.index)} onClose={() => setAddMenu(null)} /> : null}
      {layoutMenu ? <PageLayoutMenu onPick={(id) => addPageWithLayout(id, layoutMenu.index)} onClose={() => setLayoutMenu(null)} /> : null}
      {imageTarget ? <ImageDialog
        initial={imageTarget.kind === "cover" ? article.cover : blockForImage && "image" in blockForImage ? blockForImage.image : null}
        lockedAspect={blockForImage?.type === "cover" ? coverFrameAspect(article.typography_preset, blockForImage.style) : imageTarget.kind === "cover" ? 1 / 1.414 : undefined}
        showCaption={blockForImage?.type === "image" || blockForImage?.type === "image-text"}
        defaultAspect={(blockForImage?.type === "image" || blockForImage?.type === "image-text") && !blockForImage.image ? blockForImage.frame : undefined}
        caption={blockForImage && (blockForImage.type === "image" || blockForImage.type === "image-text") ? blockForImage.caption : ""}
        title={imageTarget.kind === "cover" ? "Library cover" : undefined}
        onClose={() => setImageTarget(null)}
        onApply={(image: ImageRef, caption?: string) => {
          if (imageTarget.kind === "cover") patchArticle({ cover: image });
          else patchBlock(imageTarget.blockId, caption !== undefined ? { image, caption } as Partial<Block> : { image } as Partial<Block>);
          setImageTarget(null);
          setResetKey((value) => value + 1);
        }} /> : null}
      {exporting ? <ExportDialog articles={[article]} title={articleTitle(article)} onClose={() => setExporting(false)}
        onFixOverflow={(_, first) => void flow(first)} /> : null}
      {volumeDialog ? <VolumeDialog volume={null} subjectId={article.subject_id} onClose={() => setVolumeDialog(false)}
        onSaved={(volume) => patchArticle({ volume_id: volume.id, subject_id: volume.subject_id ?? article.subject_id })} /> : null}
    </div>
    {previewing ? <DesignerContext.Provider value={null}>
      <ArticleReader articleId={article.id} preview={{ article, onClose: () => setPreviewing(false) }} />
    </DesignerContext.Provider> : null}
  </Portal></DesignerContext.Provider>;
}

// ---------------------------------------------------------------------------
/** Page layouts: a new page that already holds a good composition (picture frames stay empty until filled). */
function PageLayoutMenu({ onPick, onClose }: { onPick: (id: CompositionId) => void; onClose: () => void }) {
  return <div className="ws-dialog-backdrop ct-add-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ct-add-menu ct-layout-menu" role="dialog" aria-modal="true" aria-label="New page" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <h2>New page</h2>
      <div>{COMPOSITIONS.map((item, index) => <button key={item.id} type="button" autoFocus={index === 0} onClick={() => onPick(item.id)}>
        <span className={`ct-layout-sketch is-${item.id}`} aria-hidden="true"><i /><i /><i /></span>
        <span><strong>{item.label}</strong><small>{item.description}</small></span>
      </button>)}</div>
    </div>
  </div>;
}

function ConflictBar({ onLoadTheirs, onKeepCopy }: { article: CatalogueArticle; onLoadTheirs: () => Promise<void>; onKeepCopy: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const run = (job: () => Promise<void>) => { setBusy(true); void job().finally(() => setBusy(false)); };
  return <div className="ct-notice is-error" role="alert">
    <p>This article was changed on another device. Your edits were not saved over that version and are kept here.</p>
    <span className="ct-row">
      <button type="button" className="ws-button is-small is-primary" disabled={busy} onClick={() => run(onKeepCopy)}>Save mine as a separate draft</button>
      <button type="button" className="ws-button is-small" disabled={busy} onClick={() => run(onLoadTheirs)}>Discard mine and open the other version</button>
    </span>
  </div>;
}

function PageMenu({ index, count, onAction }: { index: number; count: number; onAction: (action: "before" | "after" | "duplicate" | "up" | "down" | "delete") => void }) {
  return <Menu label={`Page ${index + 1} actions`} items={[
    { label: "Add page after", icon: <Plus size={14} />, run: () => onAction("after") },
    { label: "Insert page before", icon: <Plus size={14} />, run: () => onAction("before") },
    { label: "Duplicate page", icon: <Copy size={14} />, run: () => onAction("duplicate") },
    "divider",
    { label: "Move page up", icon: <ArrowUp size={14} />, disabled: index === 0, run: () => onAction("up") },
    { label: "Move page down", icon: <ArrowDown size={14} />, disabled: index >= count - 1, run: () => onAction("down") },
    "divider",
    { label: "Delete page", icon: <Trash2 size={14} />, danger: true, run: () => onAction("delete") },
  ]} />;
}

function AddBlockMenu({ onPick, onClose }: { onPick: (type: BlockType) => void; onClose: () => void }) {
  return <div className="ws-dialog-backdrop ct-add-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ct-add-menu" role="dialog" aria-modal="true" aria-label="Add block" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <h2>Add block</h2>
      <div>{ADDABLE.map((type, index) => <button key={type} type="button" autoFocus={index === 0} onClick={() => onPick(type)}>
        {BLOCK_ICONS[type]}<span>{BLOCK_LABELS[type]}</span></button>)}</div>
    </div>
  </div>;
}

function textCommand(command: "bold" | "italic" | "subheading" | "ul" | "ol") {
  const selection = window.getSelection();
  const anchor = selection?.anchorNode instanceof Element ? selection.anchorNode : selection?.anchorNode?.parentElement;
  if (!anchor?.closest(".ap-text-body.ap-editable, .ap-standfirst.ap-editable")) return false;
  if (command === "bold" || command === "italic") document.execCommand(command);
  else if (command === "ul") document.execCommand("insertUnorderedList");
  else if (command === "ol") document.execCommand("insertOrderedList");
  else {
    const inHeading = anchor.closest("h3");
    document.execCommand("formatBlock", false, inHeading ? "<p>" : "<h3>");
  }
  return true;
}

function BlockToolbar({ block, pageIndex, pageCount, index, blocksOnPage, position, onPatch, onMove, onMovePage, onDelete, onImage, onAdd, onClose }: {
  block: Block; pageIndex: number; pageCount: number; index: number; blocksOnPage: number; position: { top: number; left: number; docked: boolean };
  onPatch: (patch: Partial<Block>) => void; onMove: (delta: -1 | 1) => void; onMovePage: (direction: -1 | 1) => void;
  onDelete: () => void; onImage: () => void; onAdd: () => void; onClose: () => void;
}) {
  const keep = (event: React.MouseEvent) => event.preventDefault();
  const format = (command: Parameters<typeof textCommand>[0]) => (event: React.MouseEvent) => { event.preventDefault(); textCommand(command); };
  const textTools = <span className="ct-tool-group">
    <button type="button" aria-label="Bold" title="Bold (Ctrl+B)" onMouseDown={format("bold")}><Bold size={15} /></button>
    <button type="button" aria-label="Italic" title="Italic (Ctrl+I)" onMouseDown={format("italic")}><Italic size={15} /></button>
    <button type="button" aria-label="Subheading" title="Subheading" onMouseDown={format("subheading")}><Heading size={15} /></button>
    <button type="button" aria-label="Bulleted list" title="Bulleted list" onMouseDown={format("ul")}><List size={15} /></button>
    <button type="button" aria-label="Numbered list" title="Numbered list" onMouseDown={format("ol")}><ListOrdered size={15} /></button>
  </span>;
  let specific: ReactNode = null;
  switch (block.type) {
    case "text":
      specific = <>
        {textTools}
        <Segmented label="Columns" value={block.columns} onChange={(columns) => onPatch({ columns })} options={[
          { value: 1, label: <Square size={14} />, title: "One column" }, { value: 2, label: <Columns2 size={14} />, title: "Two columns" }]} />
        <Segmented label="Alignment" value={block.align} onChange={(align) => onPatch({ align })} options={[
          { value: "justify", label: <AlignJustify size={14} />, title: "Justified" }, { value: "left", label: <AlignLeft size={14} />, title: "Ragged right" }]} />
        <button type="button" className={`ct-tool-text ${block.dropCap ? "is-on" : ""}`} aria-pressed={block.dropCap} onMouseDown={keep} onClick={() => onPatch({ dropCap: !block.dropCap })} title="Large initial letter">Initial</button>
      </>;
      break;
    case "heading":
      specific = <Segmented label="Alignment" value={block.align} onChange={(align) => onPatch({ align })} options={[
        { value: "left", label: <AlignLeft size={14} />, title: "Left" }, { value: "center", label: <AlignCenter size={14} />, title: "Centred" }]} />;
      break;
    case "image":
      specific = <>
        <button type="button" className="ct-tool-text" onClick={onImage}><Crop size={14} /> {block.image ? "Adjust image" : "Add image"}</button>
        <Segmented label="Size" value={block.size} onChange={(size) => onPatch({ size, bleed: size === "full" ? block.bleed : false })} options={[
          { value: "full", label: "Full" }, { value: "wide", label: "¾" }, { value: "half", label: "½" }, { value: "third", label: "⅓" }]} />
        {block.size !== "full" ? <Segmented label="Placement" value={block.placement} onChange={(placement) => onPatch({ placement })} options={[
          { value: "left", label: <AlignLeft size={14} />, title: "Left" }, { value: "center", label: <AlignCenter size={14} />, title: "Centre" }, { value: "right", label: <AlignLeft size={14} style={{ transform: "scaleX(-1)" }} />, title: "Right" }]} />
          : <button type="button" className={`ct-tool-text ${block.bleed ? "is-on" : ""}`} aria-pressed={block.bleed} onClick={() => onPatch({ bleed: !block.bleed })} title="Extend to the edges of the page">Edge to edge</button>}
        {block.image?.attribution?.author || block.image?.attribution?.licence ? <button type="button" className={`ct-tool-text ${block.showCredit ? "is-on" : ""}`} aria-pressed={block.showCredit} onClick={() => onPatch({ showCredit: !block.showCredit })}>Credit</button> : null}
      </>;
      break;
    case "image-text":
      specific = <>
        <button type="button" className="ct-tool-text" onClick={onImage}><Crop size={14} /> {block.image ? "Adjust image" : "Add image"}</button>
        <Segmented label="Image side" value={block.side} onChange={(side) => onPatch({ side })} options={[{ value: "left", label: "Image left" }, { value: "right", label: "Image right" }]} />
        <Segmented label="Image share" value={block.ratio} onChange={(ratio) => onPatch({ ratio })} options={[{ value: 33, label: "⅓" }, { value: 40, label: "⅖" }, { value: 50, label: "½" }]} />
        {textTools}
      </>;
      break;
    case "quote":
      specific = <Segmented label="Quotation style" value={block.style} onChange={(style) => onPatch({ style })} options={[{ value: "centred", label: "Centred" }, { value: "pull", label: "Pull quote" }]} />;
      break;
    case "divider":
      specific = <Segmented label="Divider style" value={block.style} onChange={(style) => onPatch({ style })} options={[{ value: "ornament", label: "Ornament" }, { value: "rule", label: "Rule" }, { value: "space", label: "Space" }]} />;
      break;
    case "cover":
      specific = <>
        <Segmented label="Cover style" value={block.style} onChange={(style) => onPatch({ style })} options={[{ value: "framed", label: "Framed" }, { value: "full-bleed", label: "Full image" }, { value: "plain", label: "Type only" }]} />
        {block.style !== "plain" ? <button type="button" className="ct-tool-text" onClick={onImage}><Crop size={14} /> {block.image ? "Adjust image" : "Add image"}</button> : null}
      </>;
      break;
    default: break;
  }
  const spacing = block.spaceBefore ?? "default";
  return <div className={`ct-block-toolbar ${position.docked ? "is-docked" : ""}`} style={position.docked ? undefined : { top: position.top, left: position.left }}
    role="toolbar" aria-label={`${BLOCK_LABELS[block.type]} options`} onMouseDown={(event) => { if ((event.target as HTMLElement).tagName !== "SELECT") event.preventDefault(); }}>
    <span className="ct-tool-label">{BLOCK_LABELS[block.type]}</span>
    {specific}
    <span className="ct-tool-group">
      <button type="button" aria-label="Move up" title="Move up (Alt+↑)" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={15} /></button>
      <button type="button" aria-label="Move down" title="Move down (Alt+↓)" disabled={index >= blocksOnPage - 1} onClick={() => onMove(1)}><ArrowDown size={15} /></button>
    </span>
    <Menu label="More block actions" align="right" trigger={<MoreHorizontal size={15} />} items={[
      { label: "Add block below", icon: <Plus size={14} />, run: onAdd },
      { label: "Move to previous page", icon: <ChevronsUp size={14} />, disabled: pageIndex === 0, run: () => onMovePage(-1) },
      { label: pageIndex >= pageCount - 1 ? "Move to a new page" : "Move to next page", icon: <ChevronsDown size={14} />, run: () => onMovePage(1) },
      "divider",
      ...(["default", "none", "small", "medium", "large"] as const).map((value) => ({
        label: `${spacing === value ? "✓ " : ""}Space above: ${value === "default" ? "automatic" : value}`,
        run: () => onPatch({ spaceBefore: value === "default" ? undefined : value as Spacing }),
      })),
      "divider",
      { label: "Delete block", icon: <Trash2 size={14} />, danger: true, run: onDelete },
    ]} />
    <button type="button" className="ct-tool-close" aria-label="Done" onClick={onClose}><X size={14} /></button>
  </div>;
}

function DetailsPanel({ article, onPatch, onPublish, onClose, onCover, onNewVolume, onDelete }: {
  article: CatalogueArticle; onPatch: (patch: Partial<CatalogueArticle>) => void; onPublish: () => void; onClose: () => void; onCover: () => void; onNewVolume: () => void; onDelete: () => void;
}) {
  const catalogue = useCatalogue();
  const [newSubject, setNewSubject] = useState<string | null>(null);
  const [error, setError] = useState("");
  const volumes = catalogue.snapshot.volumes.filter((volume) => !article.subject_id || volume.subject_id === article.subject_id);
  return <aside className="ct-details" aria-label="Article details">
    <div className="ct-details-head"><h2>Details</h2><button type="button" className="ws-icon-button" aria-label="Close details" onClick={onClose}><X size={15} /></button></div>
    <Field label="Status">
      <Segmented label="Status" value={article.status} onChange={(status) => { if (status === "published") onPublish(); else onPatch({ status }); }}
        options={[{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }]} />
    </Field>
    <p className="ct-quiet">{article.status === "draft" ? "Drafts stay under Drafts and are not shown on the library shelves." : `Published ${formatDate(article.published_at)}. Shown on the library shelves and in its volume.`}</p>
    <Field label="Subtitle"><textarea rows={2} maxLength={300} value={article.subtitle} onChange={(event) => onPatch({ subtitle: event.target.value })} /></Field>
    <Field label="Author"><input maxLength={120} value={article.author} onChange={(event) => onPatch({ author: event.target.value })} /></Field>
    <Field label="Subject">
      {newSubject === null ? <select value={article.subject_id ?? ""} onChange={(event) => {
        if (event.target.value === "__new") { setNewSubject(""); return; }
        const subjectId = event.target.value || null;
        const volume = article.volume_id ? catalogue.volumeById.get(article.volume_id) : null;
        onPatch({ subject_id: subjectId, volume_id: volume && volume.subject_id !== subjectId ? null : article.volume_id });
      }}>
        <option value="">None</option>
        {catalogue.snapshot.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        <option value="__new">New subject…</option>
      </select> : <form className="ct-row" onSubmit={(event) => {
        event.preventDefault();
        void catalogue.addSubject(newSubject).then((subject) => { onPatch({ subject_id: subject.id, volume_id: null }); setNewSubject(null); setError(""); })
          .catch((cause) => setError(catalogueError(cause)));
      }}><input autoFocus value={newSubject} maxLength={120} placeholder="Subject name" onChange={(event) => setNewSubject(event.target.value)} aria-label="New subject name" />
        <button type="submit" className="ws-button is-small is-primary" disabled={!newSubject.trim()}>Add</button>
        <button type="button" className="ws-button is-small" onClick={() => setNewSubject(null)}>Cancel</button></form>}
    </Field>
    <Field label="Volume">
      <select value={article.volume_id ?? ""} onChange={(event) => {
        if (event.target.value === "__new") { onNewVolume(); return; }
        const volume = event.target.value ? catalogue.volumeById.get(event.target.value) : null;
        onPatch({ volume_id: volume?.id ?? null, subject_id: volume?.subject_id ?? article.subject_id,
          volume_order: volume ? catalogue.snapshot.articles.filter((row) => row.volume_id === volume.id && row.id !== article.id)
            .reduce((highest, row) => Math.max(highest, row.volume_order + 1), 0) : 0 });
      }}>
        <option value="">Not in a volume</option>
        {volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}{volume.edition ? ` — ${volume.edition}` : ""}</option>)}
        <option value="__new">New volume…</option>
      </select>
    </Field>
    {error ? <p className="ct-error" role="alert">{error}</p> : null}
    <label className="ct-check"><input type="checkbox" checked={article.page_numbers} onChange={(event) => onPatch({ page_numbers: event.target.checked })} /> Page numbers</label>
    <label className="ct-check"><input type="checkbox" checked={article.running_header} onChange={(event) => onPatch({ running_header: event.target.checked })} /> Running header</label>
    <Field label="Library cover">
      <div className="ct-row">
        <button type="button" className="ws-button is-small" onClick={onCover}><ImagePlus size={14} /> {article.cover ? "Change image" : "Choose image"}</button>
        {article.cover ? <button type="button" className="ws-button is-small is-quiet" onClick={() => onPatch({ cover: null })}>Use the first page</button> : null}
      </div>
    </Field>
    <p className="ct-quiet ct-source">{article.source_kind === "notebook" ? <>Copied from the Notebook note <em>{article.source_label}</em>. Changes to that note do not affect this article.</>
      : article.source_kind === "docx" ? <>Imported from <em>{article.source_label}</em>.</> : <>Started as a blank article.</>} Created {formatDate(article.created_at)}.</p>
    <button type="button" className="ws-button is-small ct-danger" onClick={onDelete}><Trash2 size={14} /> Delete article</button>
  </aside>;
}
