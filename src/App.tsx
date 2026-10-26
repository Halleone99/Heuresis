import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArchiveRestore, BookOpen, ChevronDown, FolderTree, Home, Keyboard, LayoutDashboard, LibraryBig, Quote, Link2, LogOut, Maximize2,
  Feather, HardDriveDownload, NotebookPen, PanelLeftClose, PanelLeftOpen, Radio, RefreshCw, Search, Settings2, Trash2, TriangleAlert, X,
} from "lucide-react";
import ArchiveModal from "./components/ArchiveModal";
import AuthGate from "./components/AuthGate";
import CaptureInboxView from "./components/CaptureInboxView";
import CatalogueView from "./components/CatalogueView";
import CollectionsModal from "./components/CollectionsModal";
import HeuresisMark from "./components/HeuresisMark";
import LibraryView from "./components/LibraryView";
import PackView from "./components/PackView";
import RelatedCatalogueView from "./components/RelatedCatalogueView";
import SearchOverlay from "./components/SearchOverlay";
import SettingsModal from "./components/SettingsModal";
import TopicModal from "./components/TopicModal";
import { MistakeLog } from "./components/workspace/MistakeLog";
import { NotebookView } from "./components/workspace/NotebookView";
import { DetachedNoteWorkspace } from "./components/workspace/DetachedNoteWorkspace";
import { NotebookSidebarTree } from "./components/workspace/NotebookSidebarTree";
import { OverviewView } from "./components/workspace/OverviewView";
import { ReadingView } from "./components/workspace/ReadingView";
import { QuotationsView } from "./components/workspace/QuotationsView";
import { QQuickCapture } from "./components/workspace/QQuickCapture";
import { QQueuePage } from "./components/workspace/QQueuePage";
import TabletCaptureFab from "./components/TabletCaptureFab";
import { OfflineRecoveryDialog } from "./components/workspace/OfflineRecoveryDialog";
import { SyncStatusDialog } from "./components/workspace/SyncStatusDialog";
import { KnowledgeTrashDialog } from "./components/workspace/KnowledgeTrashDialog";
import { LessonCleanupDialog } from "./components/workspace/LessonCleanupDialog";
import { Kbd, MOD_KEY, Toaster } from "./components/workspace/ui";
import { WorkspaceProvider, useWorkspace } from "./components/workspace/WorkspaceContext";
import { WorkspaceSearch, type PaletteCommand } from "./components/workspace/WorkspaceSearch";
import { useHeuresisBackground, type BackgroundPageKey } from "./hooks/useHeuresisBackground";
import { listArchivedPacks } from "./lib/advanced";
import { openCaptureWindow } from "./lib/captureWindow";
import { showFloatingQuickCapture, type FloatingCaptureMode } from "./lib/quickCaptureWindow";
import { listCollections, listPacks, type Collection, type PackWithType } from "./lib/heuresis";
import { entryTitle, friendlyError, isRecallDue } from "./lib/knowledgeWorkspace";
import { isInboxTopic } from "./lib/lessonCleanup";
import { quickQueueKind } from "./lib/quickQueue";
import { useCaptureReviewIds } from "./lib/captureReviewQueue";
import { exportKnowledgeJson } from "./lib/knowledgeBackup";
import { ensureDailyLocalBackup, localBackupStatus, supportsLocalBackup } from "./lib/localBackup";
import { backupAgeNotice } from "./lib/backupFreshness";
import { getOfflineSyncState, subscribeOfflineSync } from "./lib/offlineFetch";
import { readSectionScroll, writeSectionScroll, type SectionScrollState } from "./lib/sectionScroll";
import { supabase } from "./lib/supabase";
import { synchroniseHeuresis } from "./lib/sync";
import { readSection, writeSection, type WorkspaceSection } from "./lib/workspaceMemory";

type View = "library" | "pack" | "catalogue" | "related" | "capture-inbox";
type SidebarMode = "full" | "rail" | "hidden";
function sidebarKey(userId: string) { return `heuresis.sidebar.mode.v1:${userId}`; }
function readSidebarMode(userId: string): SidebarMode {
  try {
    const value = localStorage.getItem(sidebarKey(userId));
    // A saved pinned-full sidebar should not defeat hover navigation on restart.
    // Touch users can still expand it temporarily with the accessible button.
    return value === "hidden" ? "hidden" : "rail";
  } catch { return "rail"; }
}

type BackgroundStyle = CSSProperties & {
  "--heuresis-background-image"?: string;
  "--heuresis-background-opacity"?: string;
  "--heuresis-background-veil"?: string;
  "--heuresis-background-blur"?: string;
  "--heuresis-background-position"?: string;
  "--heuresis-background-fit"?: string;
};

const SECTIONS: Array<{ id: WorkspaceSection; label: string; icon: typeof Home; key: string }> = [
  { id: "overview", label: "Overview", icon: LayoutDashboard, key: "1" },
  { id: "study", label: "Study", icon: BookOpen, key: "2" },
  { id: "notebook", label: "Notebook", icon: NotebookPen, key: "3" },
  { id: "mistakes", label: "Mistake Log", icon: TriangleAlert, key: "4" },
  { id: "reading", label: "Reading", icon: BookOpen, key: "5" },
  { id: "quotations", label: "Quotations", icon: Quote, key: "6" },
  { id: "reference", label: "Catalogue", icon: LibraryBig, key: "7" },
  { id: "queue", label: "Captures", icon: Feather, key: "8" },
];

/** A modal flow (a dialog, Review launcher, Sort, Settings…) owns the keyboard. */
function modalOpen() {
  return Boolean(document.querySelector('[aria-modal="true"], .modal-backdrop'));
}

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable));
}

/**
 * Each section keeps its own scroll position while the app is open. A section opened for the
 * first time, or showing a different page than when it was left (e.g. a note opened from
 * search), starts at the top.
 */
function useSectionScroll(section: WorkspaceSection, page: string, userId: string) {
  const positions = useRef<SectionScrollState>(readSectionScroll(userId));
  const shown = useRef({ section, page });
  const restored = useRef(false);

  useEffect(() => {
    let pending: number | null = null;
    const persist = () => {
      if (pending !== null) window.clearTimeout(pending);
      pending = null;
      writeSectionScroll(userId, positions.current);
    };
    const record = () => {
      positions.current[shown.current.section] = {
        page: shown.current.page, y: Math.max(0, window.scrollY),
      };
      if (pending === null) pending = window.setTimeout(persist, 200);
    };
    window.addEventListener("scroll", record, { passive: true });
    // Save on page departure as well as every debounced scroll.
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("scroll", record);
      window.removeEventListener("pagehide", persist);
      record(); persist();
    };
  }, [userId]);

  useLayoutEffect(() => {
    if (!restored.current) {
      restored.current = true;
      const saved = positions.current[section];
      window.scrollTo(0, saved?.page === page ? saved.y : 0);
      return;
    }
    const previous = shown.current;
    if (previous.section === section && previous.page === page) return;
    positions.current[previous.section] = { page: previous.page, y: Math.max(0, window.scrollY) };
    shown.current = { section, page };
    const saved = positions.current[section];
    window.scrollTo(0, saved?.page === page ? saved.y : 0);
  }, [page, section]);
}

function HeuresisApp({ session }: { session: Session }) {
  const [section, setSection] = useState<WorkspaceSection>(readSection);
  useEffect(() => { writeSection(section); }, [section]);
  return <WorkspaceProvider userId={session.user.id} section={section} onSection={setSection}>
    <HeuresisShell session={session} section={section} setSection={setSection} />
  </WorkspaceProvider>;
}

function HeuresisShell({ session, section, setSection }: { session: Session; section: WorkspaceSection; setSection: (section: WorkspaceSection) => void }) {
  const workspace = useWorkspace();
  const qReviewIds = useCaptureReviewIds(session.user.id);
  const inboxIds = new Set(workspace.snapshot.topics.filter(isInboxTopic).map((topic) => topic.id));
  const qCount = workspace.snapshot.entries.filter((entry) => inboxIds.has(entry.topic_id) && (quickQueueKind(entry) || qReviewIds.has(entry.id))).length;
  // A newly launched app should not reopen yesterday's last viewed document
  // merely because Notebook was the previously selected section.
  const startupNotebook = useRef(section === "notebook");
  useEffect(() => {
    if (!startupNotebook.current) return;
    startupNotebook.current = false;
    workspace.goTo("notebook");
  }, [workspace.goTo]);
  const notebookPage = workspace.memory.notebook;
  useSectionScroll(section, section === "notebook" ? `${notebookPage.docId ?? ""}|${notebookPage.topicId ?? ""}|${notebookPage.subjectId ?? ""}` : "", session.user.id);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cardQuery, setCardQuery] = useState("");
  const [view, setView] = useState<View>("library");
  const [quoteSourceBookId, setQuoteSourceBookId] = useState<string | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [archivedPacks, setArchivedPacks] = useState<PackWithType[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  // A card chosen in Search: its topic opens with that card selected and in view.
  const [focusCardId, setFocusCardId] = useState<string | null>(null);
  const [relatedCollectionId, setRelatedCollectionId] = useState<string | null>(null);
  const [captureInboxCollectionId, setCaptureInboxCollectionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
  const [collectionsStartNew, setCollectionsStartNew] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [topicModalOpen, setTopicModalOpen] = useState(false);
  const [topicModalPack, setTopicModalPack] = useState<PackWithType | null>(null);
  const [topicPreferredCollectionId, setTopicPreferredCollectionId] = useState<string | null>(null);
  const [syncState, setSyncState] = useState(getOfflineSyncState());
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(() => readSidebarMode(session.user.id));
  const [narrowWindow, setNarrowWindow] = useState(() => window.innerWidth <= 1100);
  const [narrowExpanded, setNarrowExpanded] = useState(false);
  const previousSidebarMode = useRef<"full" | "rail">("full");
  const actualSidebarMode: SidebarMode = sidebarMode === "hidden" ? "hidden"
    : narrowWindow && !narrowExpanded ? "rail" : sidebarMode;
  useEffect(() => {
    try { localStorage.setItem(sidebarKey(session.user.id), sidebarMode); } catch { /* optional */ }
  }, [session.user.id, sidebarMode]);
  useEffect(() => {
    const onResize = () => {
      setNarrowWindow(window.innerWidth <= 1100);
      if (window.innerWidth > 1100) setNarrowExpanded(false);
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const toggleSidebar = useCallback(() => {
    if (narrowWindow && actualSidebarMode !== "hidden") {
      const expand = actualSidebarMode === "rail";
      setSidebarMode(expand ? "full" : "rail");
      setNarrowExpanded(expand);
      return;
    }
    setSidebarMode((current) => current === "hidden" ? previousSidebarMode.current
      : current === "full" ? "rail" : "full");
  }, [actualSidebarMode, narrowWindow]);
  const toggleFocus = useCallback(() => {
    setSidebarMode((current) => {
      if (current !== "hidden") { previousSidebarMode.current = current; return "hidden"; }
      return previousSidebarMode.current;
    });
  }, []);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const restoredStudy = useRef(false);
  // One stable background per section; the original Heuresis image is the shared fallback.
  const backgrounds = {
    heuresis: useHeuresisBackground("heuresis"),
    "heuresis-overview": useHeuresisBackground("heuresis-overview"),
    "heuresis-study": useHeuresisBackground("heuresis-study"),
    "heuresis-notebook": useHeuresisBackground("heuresis-notebook"),
    "heuresis-mistakes": useHeuresisBackground("heuresis-mistakes"),
    "heuresis-reading": useHeuresisBackground("heuresis-reading"),
    "heuresis-quotations": useHeuresisBackground("heuresis-quotations"),
    "heuresis-reference": useHeuresisBackground("heuresis-reference"),
    "heuresis-queue": useHeuresisBackground("heuresis-queue"),
  } satisfies Record<BackgroundPageKey, ReturnType<typeof useHeuresisBackground>>;
  const specificBackground = backgrounds[`heuresis-${section}` as BackgroundPageKey];
  const background = specificBackground?.hasImage && specificBackground.settings.enabled
    ? specificBackground : backgrounds.heuresis;
  const [localBackupNotice, setLocalBackupNotice] = useState("");
  const [localBackupAgeNotice, setLocalBackupAgeNotice] = useState<string | null>(null);

  async function reload(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [nextCollections, nextPacks, nextArchived] = await Promise.all([listCollections(), listPacks(), listArchivedPacks()]);
      setCollections(nextCollections);
      setPacks(nextPacks);
      setArchivedPacks(nextArchived);
      return { collections: nextCollections, packs: nextPacks, archivedPacks: nextArchived };
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Could not load Heuresis data.";
      setError(message);
      throw loadError;
    } finally { if (!silent) setLoading(false); }
  }

  async function runSync(silent = false) {
    try {
      await synchroniseHeuresis();
      await reload(true);
    } catch (syncError) {
      if (!silent) setNotice(syncError instanceof Error ? syncError.message : "Could not synchronise Heuresis.");
    } finally {
      // A failed replay may contain a held edit. The PC backup can now keep
      // a separate copy of those edits rather than blocking every snapshot.
      if (supportsLocalBackup() && navigator.onLine) void runLocalBackup(false);
    }
  }

  useEffect(() => { void reload().catch(() => undefined); }, []);
  useEffect(() => subscribeOfflineSync(setSyncState), []);

  useEffect(() => {
    const onOnline = () => { if (!getOfflineSyncState().syncing) void runSync(true); };
    window.addEventListener("online", onOnline);
    const interval = window.setInterval(() => {
      if (navigator.onLine && !getOfflineSyncState().syncing) void runSync(true);
    }, 5 * 60 * 1000);
    if (navigator.onLine) void runSync(true);
    return () => {
      window.removeEventListener("online", onOnline);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    const refreshOnFocus = () => { void reload(true).catch(() => undefined); };
    const studyChanged = () => { void reload(true).catch(() => undefined); };
    window.addEventListener("focus", refreshOnFocus);
    window.addEventListener("heuresis:study-changed", studyChanged);
    return () => { window.removeEventListener("focus", refreshOnFocus); window.removeEventListener("heuresis:study-changed", studyChanged); };
  }, []);

  // Reopen the Study topic that was open when Heuresis was last closed.
  useEffect(() => {
    if (restoredStudy.current || loading || error) return;
    restoredStudy.current = true;
    const saved = workspace.memory.study;
    if (saved.view === "pack" && saved.packId && packs.some((pack) => pack.id === saved.packId)) { setActivePackId(saved.packId); setView("pack"); }
    else if (saved.view === "catalogue" || saved.view === "related") setView(saved.view);
  }, [error, loading, packs, workspace.memory.study]);
  useEffect(() => {
    if (!restoredStudy.current) return;
    const studyView = view === "capture-inbox" ? "library" : view;
    workspace.updateMemory((current) => current.study.view === studyView && current.study.packId === activePackId ? current : { ...current, study: { view: studyView, packId: activePackId } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePackId, view]);

  const openPalette = useCallback(() => { setPaletteOpen(true); }, []);

  const openNotebookCapture = useCallback((mode: FloatingCaptureMode) => {
    void showFloatingQuickCapture(mode).then((opened) => {
      if (!opened) workspace.openCapture({ mode });
    }).catch((error) => {
      workspace.openCapture({ mode });
      setNotice(error instanceof Error ? error.message : "Could not open floating Capture; using inline capture.");
    });
  }, [workspace]);

  async function runLocalBackup(manual = false) {
    if (!supportsLocalBackup()) return;
    try {
      // Native export is deduplicated across automatic and manual callers.
      const result = await ensureDailyLocalBackup(session.user.id);
      if (manual) setLocalBackupNotice(`PC backup ${result.alreadyExists ? "already saved" : "saved"}: ${result.path}`);
    } catch (error) {
      // A background attempt is a quiet retry, not an interruption or warning
      // banner. The error remains available if the user requests a manual copy.
      if (manual) setLocalBackupNotice(`Backup not completed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      // Only account-menu text; no toast/banner for an ordinary retry.
      try {
        const status = await localBackupStatus(session.user.id);
        setLocalBackupAgeNotice(status ? backupAgeNotice(status.latest_day) : "PC backup status unavailable.");
      } catch {
        setLocalBackupAgeNotice("PC backup status unavailable.");
      }
    }
  }

  // The native Windows app makes one complete copy per local calendar day,
  // on launch, reconnection or while left running. Browser/Android are untouched.
  useEffect(() => {
    if (!supportsLocalBackup()) return;
    let lastAttempt = 0;
    const check = () => {
      if (Date.now() - lastAttempt < 30_000) return;
      lastAttempt = Date.now();
      void runLocalBackup(false);
    };
    const start = window.setTimeout(check, 3000);
    const interval = window.setInterval(check, 60 * 60_000);
    window.addEventListener("online", check);
    const onFocus = () => { if (document.visibilityState === "visible") check(); };
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("focus", onFocus);
    };
    // One scheduler per signed-in account. Individual attempts are deduplicated.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  async function downloadKnowledge() {
    try {
      const contents = await exportKnowledgeJson(session.user.id);
      const url = URL.createObjectURL(new Blob([contents], { type: "application/json;charset=utf-8" }));
      try {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `heuresis-knowledge-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(anchor);
        try { anchor.click(); } finally { anchor.remove(); }
      } finally { window.setTimeout(() => URL.revokeObjectURL(url), 20_000); }
      workspace.toast("Knowledge export requested. Check your downloads.");
    } catch (error) { workspace.toast(friendlyError(error), { tone: "error" }); }
  }

  /** The Inbox of the language being worked in, not simply the first one in the list. */
  function inboxForContext() {
    const { snapshot, memory, topicById, entryById } = workspace;
    const inboxes = snapshot.topics.filter(isInboxTopic);
    if (!inboxes.length) return null;
    const docTopic = memory.notebook.docId ? entryById.get(memory.notebook.docId)?.topic_id : null;
    const contextSubjects = [
      section === "notebook" ? topicById.get(docTopic ?? memory.notebook.topicId ?? "")?.subject_id ?? memory.notebook.subjectId : null,
      workspace.currentLesson ? topicById.get(workspace.currentLesson.topic_id)?.subject_id : null,
      memory.capture.subjectId,
    ].filter((id): id is string => Boolean(id));
    for (const subjectId of contextSubjects) {
      const inbox = inboxes.find((topic) => topic.subject_id === subjectId);
      if (inbox) return inbox.id;
    }
    // Otherwise the Inbox with the most waiting captures.
    const waiting = (id: string) => snapshot.entries.filter((entry) => entry.topic_id === id && entry.kind !== "lesson").length;
    return [...inboxes].sort((a, b) => waiting(b.id) - waiting(a.id))[0].id;
  }

  /** Section buttons always open their section's landing page; deep links use openPack instead. */
  function navigateSection(target: WorkspaceSection) {
    if (target === "study") openLibrary();
    if (target === "quotations") setQuoteSourceBookId(null);
    workspace.goTo(target);
  }

  const paletteCommands: PaletteCommand[] = [
    ...SECTIONS.map((item) => ({ id: `go-${item.id}`, label: `Go to ${item.label}`, detail: `Navigate to ${item.label} · Alt+${item.key}`, keywords: "section navigate", run: () => navigateSection(item.id) })),
    { id: "capture-note", label: "Capture a note", detail: "Quick note · Ctrl+Shift+N", keywords: "create write capture", run: () => openNotebookCapture("note") },
    { id: "capture-mistake", label: "Record a mistake", detail: "Quick correction · Ctrl+Shift+M", keywords: "mistake recall", run: () => openNotebookCapture("mistake") },
    { id: "practise-due", label: "Practise due mistakes", detail: "Start a recall session", keywords: "review test recall", run: () => {
      const due = workspace.snapshot.entries.filter((entry) => entry.kind === "mistake" && isRecallDue(entry));
      if (due.length) workspace.openMistake(due[0].id, { practise: true, ids: due.map((entry) => entry.id) });
      else workspace.toast("No mistakes are due for recall.");
    } },
    { id: "organise-inbox", label: "Organise Inbox captures", detail: "Review captured notes and file them", keywords: "sort tidy cleanup", run: () => {
      const topicId = inboxForContext();
      if (topicId) workspace.openCleanup({ kind: "inbox", id: topicId });
      else workspace.toast("No Notebook Inbox is available yet.");
    } },
    { id: "settings", label: "Open Settings", detail: "Appearance, sorting and Study directions", keywords: "preferences", run: () => setSettingsOpen(true) },
    { id: "sidebar", label: "Toggle sidebar", detail: "Full sidebar or icon rail", keywords: "navigation collapse", run: toggleSidebar },
    { id: "focus", label: "Toggle focus mode", detail: "Hide or restore navigation", keywords: "fullscreen distraction", run: toggleFocus },
    { id: "sync", label: "Sync now", detail: "Synchronise your Study and Notebook data", keywords: "refresh offline", run: () => void runSync(false) },
    { id: "trash", label: "Open Trash", detail: "Restore deleted notes, lessons and mistakes", keywords: "deleted recovery", run: () => setTrashOpen(true) },
    ...(supportsLocalBackup() ? [{ id: "local-backup", label: "Create local Heuresis backup", detail: "Save the complete library and images to Documents on this PC", keywords: "backup local windows files offline", run: () => void runLocalBackup(true) }] : []),
    { id: "export", label: "Export Notebook as JSON", detail: "Download your Notebook and recall history", keywords: "backup archive download", run: () => void downloadKnowledge() },
  ];

  // Global shortcuts. Modifier combinations work even while typing (they never
  // produce text), and use physical key codes so they also work with Russian,
  // German or Chinese keyboard layouts active.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && !event.altKey && event.code === "Backslash") {
        event.preventDefault();
        if (event.shiftKey) toggleFocus(); else toggleSidebar();
        return;
      }
      if (mod && event.shiftKey && !event.altKey && ["KeyN", "KeyM"].includes(event.code)) {
        event.preventDefault();
        openNotebookCapture(event.code === "KeyN" ? "note" : "mistake");
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.code === "KeyK") {
        event.preventDefault();
        // Opening the palette over another dialog put it underneath that dialog's
        // backdrop: visible, typed into, but impossible to click.
        if (!modalOpen()) openPalette();
        return;
      }
      if (isTypingTarget(event.target) || modalOpen() || document.querySelector(".ws-dialog-backdrop")) return;
      if (event.key === "/" && !mod && !event.altKey) {
        event.preventDefault();
        openPalette();
        return;
      }
      if (event.altKey && !mod && /^Digit[1-8]$/.test(event.code)) {
        event.preventDefault();
        navigateSection(SECTIONS[Number(event.code.slice(5)) - 1].id);
        return;
      }
      if (event.key === "?" && !mod) { event.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openNotebookCapture, openPalette, section, setSection, toggleFocus, toggleSidebar, workspace]);

  const activePack = useMemo(() => packs.find((pack) => pack.id === activePackId) ?? null, [activePackId, packs]);
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === activePack?.collection_id) ?? null, [activePack?.collection_id, collections]);
  const relatedCollection = useMemo(() => collections.find((collection) => collection.id === relatedCollectionId) ?? null, [collections, relatedCollectionId]);
  const captureInboxCollection = useMemo(() => collections.find((collection) => collection.id === captureInboxCollectionId) ?? null, [collections, captureInboxCollectionId]);
  const accountLabel = session.user.email || "Supabase account";
  const accountInitial = accountLabel.slice(0, 1).toUpperCase();
  const syncLabel = syncState.legacyPending
    ? `Older unsynced · ${syncState.legacyPending}`
    : syncState.error && syncState.pending && syncState.online
    ? `Sync problem · ${syncState.pending}`
    : syncState.syncing
    ? "Syncing…"
    : !syncState.online
      ? syncState.pending ? `Offline · ${syncState.pending}` : "Offline"
      : syncState.pending
        ? `Sync · ${syncState.pending}`
        : syncState.lastSyncedAt ? "Synced" : "Sync";
  const syncTone = syncState.legacyPending || (syncState.pending && !syncState.online)
    ? "attention" : syncState.error ? "error" : syncState.syncing ? "syncing"
    : !syncState.online ? "offline" : syncState.pending ? "attention"
    : syncState.lastSyncedAt ? "synced" : "unknown";
  const syncTitle = syncState.legacyPending
    ? `${syncState.legacyPending} unowned offline changes from an older Heuresis version were kept safely but cannot be replayed automatically across accounts. Do not clear this app's local storage.`
    : syncState.error && syncState.pending
    ? `${syncState.error} The unsent changes remain on this device. Do not clear local app data.`
    : !syncState.online
    ? "Heuresis is using the local copy on this device. Changes will upload when internet returns."
    : syncState.lastSyncedAt
      ? `Last synchronised ${new Date(syncState.lastSyncedAt).toLocaleString()}`
      : "Download the full library to this device for offline use.";
  const backgroundStyle: BackgroundStyle = {
    "--heuresis-background-image": background.imageUrl && background.settings.enabled ? `url("${background.imageUrl}")` : "none",
    "--heuresis-background-opacity": String(background.settings.opacity),
    "--heuresis-background-veil": String(background.settings.veil),
    "--heuresis-background-blur": `${background.settings.blur}px`,
    "--heuresis-background-position": background.settings.position,
    "--heuresis-background-fit": background.settings.fit,
  };
  function openLibrary() { setView("library"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }
  function openPack(pack: PackWithType, cardId: string | null = null) { setActivePackId(pack.id); setFocusCardId(cardId); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); setView("pack"); }
  function openCapture(pack: PackWithType | null = null, collectionId: string | null = null) {
    void openCaptureWindow({ packId: pack?.id ?? null, collectionId: collectionId ?? pack?.collection_id ?? null })
      .catch((captureError) => setNotice(captureError instanceof Error ? captureError.message : "Could not open Capture."));
  }
  function openNewWords(collection: Collection) { setRelatedCollectionId(collection.id); setCaptureInboxCollectionId(null); setActivePackId(null); setView("related"); }
  function openCaptureInbox(collection: Collection) { setCaptureInboxCollectionId(collection.id); setRelatedCollectionId(null); setActivePackId(null); setView("capture-inbox"); }
  function openCollections(startNew = false) { setCollectionsStartNew(startNew); setCollectionsOpen(true); }
  function closeCollections() { setCollectionsOpen(false); setCollectionsStartNew(false); }

  function openNewTopic(preferredCollectionId: string | null = null) {
    setTopicModalPack(null); setTopicPreferredCollectionId(preferredCollectionId); setTopicModalOpen(true);
  }

  function openTopicSettings(pack: PackWithType) {
    setTopicModalPack(pack); setTopicPreferredCollectionId(pack.collection_id); setTopicModalOpen(true);
  }

  async function afterTopicChange(createdId?: string) {
    const next = await reload(true);
    if (createdId) {
      const created = next.packs.find((pack) => pack.id === createdId);
      if (created) openPack(created);
      setNotice("Topic created.");
      return;
    }
    if (activePackId && !next.packs.some((pack) => pack.id === activePackId)) openLibrary();
  }

  async function afterRelatedTopicCreated(packId: string) {
    const next = await reload(true);
    const created = next.packs.find((pack) => pack.id === packId);
    if (created) openPack(created);
    setNotice("Topic created from Discoveries.");
  }


  const workspaceNotice = workspace.schema !== "v2" && section !== "study" && section !== "reading" && section !== "quotations" ? <div className="ws-schema-notice" role="status">
    <TriangleAlert size={16} />
    <span>{workspace.schema === "missing"
      ? <>The Notebook tables do not exist in this database yet. Apply the two Knowledge migrations in <code>supabase/migrations/</code> to start writing notes. Study is unaffected.</>
      : <>The Notebook is read-only until the database update <code>20261012090000_knowledge_workspace_v2.sql</code> is applied. Your existing notes are shown; Study is unaffected.</>}</span>
    <button type="button" className="ws-button is-small" onClick={() => void workspace.reload()}>Check again</button>
  </div> : null;

  return (
    <div className="heuresis-desktop" data-section={section} data-sidebar={actualSidebarMode} style={backgroundStyle} data-custom-background={background.imageUrl && background.settings.enabled ? "heuresis" : undefined}>
      <div className="heuresis-wallpaper" aria-hidden="true" />
      <div className="heuresis-wallpaper-lower" aria-hidden="true" />
      <div className="heuresis-veil" aria-hidden="true" />
      <header className="desktop-chrome">
        <button className="desktop-wordmark" onClick={() => navigateSection("overview")} aria-label="Heuresis — go to Overview" title="Go to Overview">
          <span className="desktop-brand-mark" aria-hidden="true"><HeuresisMark /></span>
          <span className="desktop-wordmark-name">Heuresis</span>
        </button>
        <button type="button" className="desktop-action hw-sidebar-header-toggle" onClick={toggleSidebar}
            title={actualSidebarMode === "hidden" ? "Show sidebar (Ctrl+\\)" : "Toggle sidebar (Ctrl+\\)"}
            aria-label={actualSidebarMode === "hidden" ? "Show navigation sidebar" : "Toggle navigation sidebar"}
            aria-expanded={actualSidebarMode === "full"}>
            <PanelLeftOpen size={16}/>
          </button>
        {section === "study" ? <nav className="desktop-nav-group" aria-label="Study navigation">
          <button className={`desktop-nav-item ${view === "library" || view === "pack" || view === "capture-inbox" ? "active" : ""}`} onClick={openLibrary}><Home size={14} /> Library</button>
          <button className={`desktop-nav-item ${view === "catalogue" ? "active" : ""}`} onClick={() => { setView("catalogue"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><BookOpen size={14} /> Catalogue</button>
          <button className={`desktop-nav-item ${view === "related" ? "active" : ""}`} onClick={() => { setView("related"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><Link2 size={14} /> Connections</button>
          <button className="desktop-nav-item" onClick={() => openCollections(false)}><FolderTree size={14} /> Collections</button>
        </nav> : null}
        <span className="desktop-spacer" />
        <div className="desktop-header-actions">
          <button type="button" className="desktop-action hw-sync-indicator" data-sync-tone={syncTone}
            title={syncTitle} aria-label={`Synchronisation: ${syncLabel}. Show details.`}
            onClick={() => setSyncOpen(true)}>
            <span className="hw-sync-dot" aria-hidden="true"/>
          </button>
          <button type="button" className="desktop-action desktop-search-action" onClick={openPalette}
            title={`Search notes, Study cards and commands (${MOD_KEY}+K)`} aria-label={`Search everywhere (${MOD_KEY}+K)`}>
            <Search size={17} aria-hidden="true" />
          </button>
          <details className="desktop-account-menu" ref={accountMenuRef}>
            <summary aria-label="Account menu"><span className="desktop-account-avatar">{accountInitial}</span><ChevronDown size={13} /></summary>
            <div className="desktop-account-popover">
              <div className="desktop-account-identity"><span>ACCOUNT</span><strong>{accountLabel}</strong></div>
              <button onClick={() => void runSync(false)}><RefreshCw size={14} /> Sync now</button>
              {supportsLocalBackup() ? <button title="Automatic daily PC backups while Heuresis is open and online"
                onClick={() => { setLocalBackupNotice("Checking PC backup…"); void runLocalBackup(true); }}>
                <HardDriveDownload size={14} /> Check PC backup
              </button> : null}
              {supportsLocalBackup() && localBackupNotice ? <small className="desktop-backup-detail">{localBackupNotice}</small> : null}
              {supportsLocalBackup() && !localBackupNotice && localBackupAgeNotice ? <small className="desktop-backup-detail">{localBackupAgeNotice}</small> : null}
              <button onClick={() => { setRecoveryOpen(true); if (accountMenuRef.current) accountMenuRef.current.open = false; }}>
                <ArchiveRestore size={14}/> Offline recovery{syncState.legacyPending + syncState.held ? ` (${syncState.legacyPending + syncState.held})` : ""}
              </button>
              <button onClick={() => { setTrashOpen(true); if (accountMenuRef.current) accountMenuRef.current.open = false; }}>
                <Trash2 size={14}/> Trash & export
              </button>
              <button onClick={() => { void reload(true).then(() => setNotice("Heuresis refreshed.")).catch(() => undefined); void workspace.reload(true); }}><RefreshCw size={14} /> Refresh data</button>
              <button onClick={() => { toggleFocus(); if (accountMenuRef.current) accountMenuRef.current.open = false; }}>
                <Maximize2 size={14}/> {sidebarMode === "hidden" ? "Leave focus mode" : "Focus mode · hide sidebar"}
              </button>
              <button onClick={() => { setShortcutsOpen(true); if (accountMenuRef.current) accountMenuRef.current.open = false; }}><Keyboard size={14} /> Keyboard shortcuts</button>
              <button onClick={() => { setSettingsOpen(true); if (accountMenuRef.current) accountMenuRef.current.open = false; }}><Settings2 size={14} /> Settings & appearance</button>
              <div className="desktop-account-divider" />
              <button onClick={() => void supabase?.auth.signOut()}><LogOut size={14} /> Sign out</button>
            </div>
          </details>
        </div>
      </header>
      {section === "study" ? <nav className="mobile-study-subnav" aria-label="Study pages">
        <button type="button" aria-current={view === "library" || view === "pack" || view === "capture-inbox" ? "page" : undefined}
          onClick={openLibrary}><Home size={15} /> Library</button>
        <button type="button" aria-current={view === "catalogue" ? "page" : undefined}
          onClick={() => { setView("catalogue"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><BookOpen size={15} /> Catalogue</button>
        <button type="button" aria-current={view === "related" ? "page" : undefined}
          onClick={() => { setView("related"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><Link2 size={15} /> Connections</button>
        <button type="button" onClick={() => openCollections(false)}><FolderTree size={15} /> Collections</button>
      </nav> : null}
      {notice ? <div className="desktop-notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div> : null}
      <div className="heuresis-workspace-layout">
        <aside className="heuresis-section-sidebar" aria-label="Sections">
          <nav className="hw-sections">
            {SECTIONS.map(({ id, label, icon: Icon, key }) => <button key={id} type="button" className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined}
              onClick={() => navigateSection(id)} title={`${label} (Alt+${key})`}>
              {id === "queue" ? <span className="capture-mark" aria-hidden="true">C</span> : <Icon size={16}/>}<span>{label}</span>{id === "queue" && qCount > 0 ? <span className="q-nav-badge">{qCount}</span> : null}
            </button>)}
          </nav>
          {section === "notebook" && !workspace.loading && !workspace.error ? <NotebookSidebarTree /> : null}
          {workspace.currentLesson ? <div className="hw-lesson">
            <span className="hw-lesson-label"><Radio size={12} /> In lesson</span>
            <button type="button" className="hw-lesson-title" onClick={() => workspace.openDocument(workspace.currentLesson!.id)} title="Open the lesson page">{entryTitle(workspace.currentLesson)}</button>
            <button type="button" className="hw-lesson-end" onClick={() => workspace.endLesson()} aria-label="End lesson" title="End lesson — captures stop attaching to it"><X size={13} /></button>
          </div> : null}
          <div className="hw-sidebar-capture-position">
            <button type="button" className="hw-sidebar-capture" onClick={() => openNotebookCapture("note")}
              title={`Quick Capture (${MOD_KEY}+Shift+N)`}
              aria-label="Open Quick Capture">
              <Feather size={27} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </aside>
        <main className={`desktop-content ${section === "study" ? "is-study" : "is-workspace"}`}>
          {workspaceNotice}
          {section !== "study" && section !== "reading" && section !== "quotations" && workspace.error ? <div className="ws-error-panel" role="alert">
            <strong>{getOfflineSyncState().online ? "The Notebook could not be loaded." : "This device has no offline copy of the Notebook yet."}</strong>
            <span>{workspace.error}</span>
            <button type="button" className="ws-button" onClick={() => void workspace.reload()}>Try again</button>
          </div> : null}
          {section !== "study" && section !== "reading" && section !== "quotations" && workspace.loading && !workspace.error ? <div className="ws-loading" role="status"><span className="ws-spinner" /> Loading your Notebook and recall history…</div> : null}
          {section === "overview" && !workspace.loading && !workspace.error ? <OverviewView onOpenStudy={() => navigateSection("study")} /> : null}
          {section === "notebook" && !workspace.loading && !workspace.error ? <NotebookView /> : null}
          {section === "mistakes" && !workspace.loading && !workspace.error ? <MistakeLog /> : null}
          {section === "queue" && !workspace.loading && !workspace.error ? <QQueuePage onCapture={() => openNotebookCapture("note")} /> : null}
          {section === "reading" ? <ReadingView userId={session.user.id} onOpenQuotations={(bookId) => { setQuoteSourceBookId(bookId); setSection("quotations"); }} /> : null}
          {section === "quotations" ? <QuotationsView userId={session.user.id} sourceBookId={quoteSourceBookId} onOpenReading={() => setSection("reading")} /> : null}
          {section === "reference" && !workspace.loading && !workspace.error
            ? <NotebookView key="knowledge-catalogue" referenceOnly onExitReference={() => setSection("notebook")} /> : null}
          {section === "study" && loading ? <div className="content-state">Opening Heuresis…</div> : null}
          {section === "study" && !loading && error ? <div className="content-state error-state"><strong>{syncState.online ? "Database connection failed." : "This device has no synchronised copy yet."}</strong><span>{error}</span><button className="secondary-button" onClick={() => void reload()}>Try again</button></div> : null}
          {section === "study" && !loading && !error && view === "library" ? <LibraryView collections={collections} packs={packs} archivedCount={archivedPacks.length} onOpen={openPack} onOpenCaptureInbox={openCaptureInbox} onNewTopic={openNewTopic} onEditPack={openTopicSettings} onOpenNewWords={openNewWords} onArchive={() => setArchiveOpen(true)} onNewCollection={() => openCollections(true)} /> : null}
          {section === "study" && !loading && !error && view === "catalogue" ? <CatalogueView collections={collections} packs={packs} onBack={openLibrary} onOpenPack={openPack} /> : null}
          {section === "study" && !loading && !error && view === "related" ? <RelatedCatalogueView packs={packs} collections={collections} collection={relatedCollection} onBack={openLibrary} onOpenPack={openPack} onTopicCreated={afterRelatedTopicCreated} /> : null}
          {section === "study" && !loading && !error && view === "capture-inbox" ? <CaptureInboxView packs={packs} collection={captureInboxCollection} onBack={openLibrary} onOpenPack={openPack} onOpenCapture={(pack) => openCapture(pack)} /> : null}
          {section === "study" && !loading && !error && view === "pack" && activePack ? <PackView pack={activePack} collection={activeCollection} focusCardId={focusCardId} onFocusCardShown={() => setFocusCardId(null)} onBack={openLibrary} onCapture={() => openCapture(activePack)} onSettings={() => openTopicSettings(activePack)} onChanged={() => void reload(true).catch(() => undefined)} /> : null}
        </main>
      </div>
      <nav className="mobile-workspace-nav" aria-label="Heuresis sections">
        <div className="q-mobile-scroll">
          {SECTIONS.filter((item) => item.id !== "queue").map(({ id, label, icon: Icon }) => <button type="button" key={id}
            aria-current={section === id ? "page" : undefined} className={section === id ? "is-active" : ""}
            onClick={() => navigateSection(id)}>
            <Icon size={20} aria-hidden="true" /><span>{label === "Mistake Log" ? "Mistakes" : label}</span>
          </button>)}
        </div>
        <button type="button" className={`q-mobile-pinned ${section === "queue" ? "is-active" : ""}`}
          aria-current={section === "queue" ? "page" : undefined} onClick={() => navigateSection("queue")}>
          <span className="capture-mark" aria-hidden="true">C</span><span>Captures</span>
          {qCount > 0 ? <b className="q-nav-badge">{qCount}</b> : null}
        </button>
      </nav>
      <TabletCaptureFab onCapture={() => openNotebookCapture("note")} />
      <QQuickCapture />
      {workspace.cleanupTarget ? <LessonCleanupDialog target={workspace.cleanupTarget} onClose={workspace.closeCleanup} /> : null}
      {recoveryOpen ? <OfflineRecoveryDialog userId={session.user.id} onClose={() => setRecoveryOpen(false)} onSync={() => runSync(false)} /> : null}
      {syncOpen ? <SyncStatusDialog state={syncState} onClose={() => setSyncOpen(false)}
        onRecovery={() => { setSyncOpen(false); setRecoveryOpen(true); }}
        onSync={() => { void runSync(false); }} /> : null}
      {trashOpen ? <KnowledgeTrashDialog onClose={() => setTrashOpen(false)} /> : null}
      <Toaster />
      {paletteOpen ? <WorkspaceSearch onClose={() => setPaletteOpen(false)} commands={paletteCommands} packs={packs}
        onOpenCard={(hit) => { const pack = packs.find((item) => item.id === hit.pack_id); if (!pack) return; setSection("study"); openPack(pack, hit.role === "main" ? hit.id : null); }}
        onSearchCards={(query) => { setCardQuery(query); setSection("study"); setSearchOpen(true); }} /> : null}
      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {searchOpen ? <SearchOverlay packs={packs} initialQuery={cardQuery} onClose={() => { setSearchOpen(false); setCardQuery(""); }} onOpen={(pack, cardId) => { setSection("study"); openPack(pack, cardId ?? null); }} /> : null}
      {settingsOpen ? <SettingsModal backgrounds={backgrounds} packs={packs} collections={collections} onDataChanged={() => reload(true).then(() => undefined)} onClose={() => setSettingsOpen(false)} /> : null}
      {collectionsOpen ? <CollectionsModal collections={collections} packs={packs} startNew={collectionsStartNew} onClose={closeCollections} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {archiveOpen ? <ArchiveModal packs={archivedPacks} onClose={() => setArchiveOpen(false)} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {topicModalOpen ? <TopicModal collections={collections} pack={topicModalPack} preferredCollectionId={topicPreferredCollectionId} onClose={() => { setTopicModalOpen(false); setTopicModalPack(null); }} onChanged={afterTopicChange} /> : null}
    </div>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    ["Ctrl Alt Space", "Floating Notebook Capture (system-wide, desktop)"],
    [`${MOD_KEY} ⇧ N`, "Quick note (from anywhere, even while typing)"],
    [`${MOD_KEY} ⇧ M`, "Record a mistake"],
    [`${MOD_KEY} ↵`, "Save the capture · finish editing"],
    [`${MOD_KEY} K  or  /`, "Search notes, Study cards and run commands"],
    [`${MOD_KEY} \\`, "Toggle full sidebar and icon rail"],
    [`${MOD_KEY} ⇧ \\`, "Focus mode: hide or restore the sidebar"],
    ["Alt 1 – 7", "Overview · Study · Notebook · Mistake Log · Reading · Quotations · Catalogue"],
    ["E", "Edit the open note"],
    ["Alt ←", "Back in the Notebook"],
    [`${MOD_KEY} B · I · ⇧H`, "Bold · italic · highlight while editing"],
    [`${MOD_KEY} Alt 1 · 2`, "Heading · subheading while editing"],
    ["# · - · 1. · >", "Type at the start of a line for a heading, list, numbered list or quotation"],
    ["Esc", "Close a panel — Quick capture keeps your draft"],
  ];
  return <div className="ws-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ws-dialog is-wide" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); onClose(); } }}>
      <div className="ws-dialog-head"><h2 id="shortcuts-title"><Keyboard size={17} /> Keyboard shortcuts</h2>
        <button type="button" className="ws-icon-button" autoFocus aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      <dl className="ws-shortcuts">{rows.map(([keys, label]) => <div key={keys}><dt><Kbd>{keys}</Kbd></dt><dd>{label}</dd></div>)}</dl>
      <p className="ws-muted">Shortcuts use physical key positions, so they keep working with a Russian, German or Chinese input method active.</p>
    </div>
  </div>;
}

export default function App() {
  // Detachable Notebook windows share authentication and persistence but no
  // global navigation or capture overlay: they are genuine writing surfaces.
  const detachedNote = new URLSearchParams(window.location.search).get("noteWindow") === "1";
  return <AuthGate>{(session) => detachedNote
    ? <DetachedNoteWorkspace userId={session.user.id} />
    : <HeuresisApp session={session} />}</AuthGate>;
}
