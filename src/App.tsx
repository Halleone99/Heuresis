import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArchiveRestore, BarChart3, BookOpen, ChevronDown, FolderTree, Home, Keyboard, LayoutDashboard, Link2, LogOut, Maximize2,
  NotebookPen, PanelLeftClose, PanelLeftOpen, Plus, Radio, RefreshCw, Search, Settings2, Trash2, TriangleAlert, X,
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
import { OverviewView } from "./components/workspace/OverviewView";
import { ProgressView } from "./components/workspace/ProgressView";
import { QuickCapture } from "./components/workspace/QuickCapture";
import { OfflineRecoveryDialog } from "./components/workspace/OfflineRecoveryDialog";
import { KnowledgeTrashDialog } from "./components/workspace/KnowledgeTrashDialog";
import { Kbd, MOD_KEY, Toaster } from "./components/workspace/ui";
import { WorkspaceProvider, useWorkspace } from "./components/workspace/WorkspaceContext";
import { WorkspaceSearch } from "./components/workspace/WorkspaceSearch";
import { useHeuresisBackground } from "./hooks/useHeuresisBackground";
import { listArchivedPacks } from "./lib/advanced";
import { openCaptureWindow } from "./lib/captureWindow";
import { listCollections, listPacks, type Collection, type PackWithType } from "./lib/heuresis";
import { entryTitle, isRecallDue } from "./lib/knowledgeWorkspace";
import { getOfflineSyncState, subscribeOfflineSync } from "./lib/offlineFetch";
import { supabase } from "./lib/supabase";
import { synchroniseHeuresis } from "./lib/sync";
import { readSection, writeSection, type WorkspaceSection } from "./lib/workspaceMemory";

type View = "library" | "pack" | "catalogue" | "related" | "capture-inbox";
type SidebarMode = "full" | "rail" | "hidden";
function sidebarKey(userId: string) { return `heuresis.sidebar.mode.v1:${userId}`; }
function readSidebarMode(userId: string): SidebarMode {
  try {
    const value = localStorage.getItem(sidebarKey(userId));
    return value === "full" || value === "rail" || value === "hidden" ? value : "full";
  } catch { return "full"; }
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
  { id: "progress", label: "Progress", icon: BarChart3, key: "5" },
];

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable));
}

/**
 * Each section keeps its own scroll position while the app is open. A section opened for the
 * first time, or showing a different page than when it was left (e.g. a note opened from
 * search), starts at the top.
 */
function useSectionScroll(section: WorkspaceSection, page: string) {
  const positions = useRef(new Map<WorkspaceSection, { page: string; y: number }>());
  const shown = useRef({ section, page });
  useEffect(() => {
    const record = () => { positions.current.set(shown.current.section, { page: shown.current.page, y: window.scrollY }); };
    window.addEventListener("scroll", record, { passive: true });
    return () => window.removeEventListener("scroll", record);
  }, []);
  useLayoutEffect(() => {
    const sectionChanged = shown.current.section !== section;
    shown.current = { section, page };
    if (!sectionChanged) return;
    const saved = positions.current.get(section);
    window.scrollTo(0, saved && saved.page === page ? saved.y : 0);
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
  const notebookPage = workspace.memory.notebook;
  useSectionScroll(section, section === "notebook" ? `${notebookPage.docId ?? ""}|${notebookPage.topicId ?? ""}|${notebookPage.subjectId ?? ""}` : "");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [cardQuery, setCardQuery] = useState("");
  const [view, setView] = useState<View>("library");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [archivedPacks, setArchivedPacks] = useState<PackWithType[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
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
  const [trashOpen, setTrashOpen] = useState(false);
  const accountMenuRef = useRef<HTMLDetailsElement>(null);
  const restoredStudy = useRef(false);
  const background = useHeuresisBackground();

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
      const result = await synchroniseHeuresis();
      await reload(true);
      if (!silent) setNotice(`Synced ${result.cards} cards to this device.`);
    } catch (syncError) {
      if (!silent) setNotice(syncError instanceof Error ? syncError.message : "Could not synchronise Heuresis.");
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
      if (mod && event.shiftKey && !event.altKey && ["KeyN", "KeyM", "KeyL"].includes(event.code)) {
        event.preventDefault();
        workspace.openCapture({ mode: event.code === "KeyN" ? "note" : event.code === "KeyM" ? "mistake" : "lesson" });
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.code === "KeyK") {
        event.preventDefault();
        if (section === "study") setSearchOpen(true); else openPalette();
        return;
      }
      if (isTypingTarget(event.target) || document.querySelector(".modal-backdrop, .ws-dialog-backdrop")) return;
      if (event.key === "/" && !mod && !event.altKey) {
        event.preventDefault();
        if (section === "study") setSearchOpen(true); else openPalette();
        return;
      }
      if (event.altKey && !mod && /^Digit[1-5]$/.test(event.code)) {
        event.preventDefault();
        setSection(SECTIONS[Number(event.code.slice(5)) - 1].id);
        return;
      }
      if (event.key === "?" && !mod) { event.preventDefault(); setShortcutsOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openPalette, section, setSection, toggleFocus, toggleSidebar, workspace]);

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
  const studySummary = useMemo(() => ({
    cards: packs.reduce((sum, pack) => sum + (pack.card_count ?? 0), 0),
    collections: collections.length,
    topics: packs.length,
  }), [collections.length, packs]);
  const dueCount = workspace.snapshot.entries.filter((entry) => isRecallDue(entry)).length;

  function openLibrary() { setView("library"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }
  function openPack(pack: PackWithType) { setActivePackId(pack.id); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); setView("pack"); }
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
    setNotice("Topic created from Raw.");
  }


  const workspaceNotice = workspace.schema !== "v2" && section !== "study" ? <div className="ws-schema-notice" role="status">
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
        <button className="desktop-wordmark" onClick={() => { if (section === "study") openLibrary(); else setSection("overview"); }} aria-label={section === "study" ? "Open Study library" : "Heuresis — Overview"}><span className="desktop-mark-wrap"><HeuresisMark /></span><span className="desktop-wordmark-name">Heuresis<span>.</span></span></button>
        {section === "study" ? <nav className="desktop-nav-group" aria-label="Study navigation">
          <button className={`desktop-nav-item ${view === "library" || view === "pack" || view === "capture-inbox" ? "active" : ""}`} onClick={openLibrary}><Home size={14} /> Library</button>
          <button className={`desktop-nav-item ${view === "catalogue" ? "active" : ""}`} onClick={() => { setView("catalogue"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><BookOpen size={14} /> Catalogue</button>
          <button className={`desktop-nav-item ${view === "related" ? "active" : ""}`} onClick={() => { setView("related"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><Link2 size={14} /> Connections</button>
          <button className="desktop-nav-item" onClick={() => openCollections(false)}><FolderTree size={14} /> Collections</button>
        </nav> : null}
        <span className="desktop-spacer" />
        <div className="desktop-header-actions">
          <button type="button" className="desktop-action hw-sidebar-header-toggle" onClick={toggleSidebar}
            title={actualSidebarMode === "hidden" ? "Show sidebar (Ctrl+\\)" : "Toggle sidebar (Ctrl+\\)"}
            aria-label={actualSidebarMode === "hidden" ? "Show navigation sidebar" : "Toggle navigation sidebar"}
            aria-expanded={actualSidebarMode === "full"}>
            <PanelLeftOpen size={16}/>
          </button>
          <button className="desktop-action" title={syncTitle}
            onClick={() => syncState.legacyPending ? setRecoveryOpen(true) : void runSync(false)}>
            {syncState.legacyPending ? <TriangleAlert size={14}/> : <RefreshCw size={14}/>}
            <span>{syncLabel}</span></button>
          {section === "study"
            ? <button className="desktop-action desktop-search-action" onClick={() => setSearchOpen(true)}><Search size={14} /><span>Search cards</span><kbd>{MOD_KEY} K</kbd></button>
            : <button className="desktop-action desktop-search-action" onClick={openPalette}><Search size={14} /><span>Search notes</span><kbd>{MOD_KEY} K</kbd></button>}
          {section === "study" ? <button className="desktop-action desktop-topic-action" onClick={() => openNewTopic(activeCollection?.id ?? relatedCollection?.id ?? captureInboxCollection?.id ?? null)}><Plus size={14} /> Topic</button> : null}
          {section === "study" ? <button className="desktop-action desktop-primary" onClick={() => openCapture()}><Plus size={14} /> Card</button> : null}
          <button className="desktop-action hw-capture-button" onClick={() => workspace.openCapture({ mode: "note" })} title={`Quick capture (${MOD_KEY}+Shift+N)`}><NotebookPen size={14} /> <span>Capture</span></button>
          <details className="desktop-account-menu" ref={accountMenuRef}>
            <summary aria-label="Account menu"><span className="desktop-account-avatar">{accountInitial}</span><ChevronDown size={13} /></summary>
            <div className="desktop-account-popover">
              <div className="desktop-account-identity"><span>ACCOUNT</span><strong>{accountLabel}</strong></div>
              <button onClick={() => void runSync(false)}><RefreshCw size={14} /> Synchronise offline copy</button>
              <button onClick={() => { setRecoveryOpen(true); if (accountMenuRef.current) accountMenuRef.current.open = false; }}>
                <ArchiveRestore size={14}/> Offline recovery{syncState.legacyPending ? ` (${syncState.legacyPending})` : ""}
              </button>
              <button onClick={() => { setTrashOpen(true); if (accountMenuRef.current) accountMenuRef.current.open = false; }}>
                <Trash2 size={14}/> Trash & knowledge export
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
      {notice ? <div className="desktop-notice"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss">×</button></div> : null}
      <div className="heuresis-workspace-layout">
        <aside className="heuresis-section-sidebar" aria-label="Sections">
          <div className="hw-sidebar-header">
            <span className="hw-sidebar-heading">Navigation</span>
            <button type="button" className="hw-sidebar-collapse" onClick={toggleSidebar}
              title={actualSidebarMode === "full" ? "Collapse sidebar (Ctrl+\\)" : "Expand sidebar (Ctrl+\\)"}
              aria-label={actualSidebarMode === "full" ? "Collapse sidebar" : "Expand sidebar"}>
              {actualSidebarMode === "full" ? <PanelLeftClose size={16}/> : <PanelLeftOpen size={16}/>}
            </button>
          </div>
          <nav className="hw-sections">
            {SECTIONS.map(({ id, label, icon: Icon, key }) => <button key={id} type="button" className={section === id ? "active" : ""} aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)} title={`${label} (Alt+${key})`}>
              <Icon size={16} /><span>{label}</span>
              {id === "mistakes" && dueCount ? <small className="hw-badge" title={`${dueCount} due for recall`}>{dueCount}</small> : null}
            </button>)}
          </nav>
          {workspace.currentLesson ? <div className="hw-lesson">
            <span className="hw-lesson-label"><Radio size={12} /> In lesson</span>
            <button type="button" className="hw-lesson-title" onClick={() => workspace.openDocument(workspace.currentLesson!.id)} title="Open the lesson page">{entryTitle(workspace.currentLesson)}</button>
            <button type="button" className="hw-lesson-end" onClick={() => workspace.endLesson()} aria-label="End lesson" title="End lesson — captures stop attaching to it"><X size={13} /></button>
          </div> : null}
          <button type="button" className="hw-capture-hint" onClick={() => workspace.openCapture({ mode: "note" })}>
            <span>Quick capture</span><Kbd>{MOD_KEY} ⇧ N</Kbd>
          </button>
        </aside>
        <main className={`desktop-content ${section === "study" ? "is-study" : "is-workspace"}`}>
          {workspaceNotice}
          {section !== "study" && workspace.error ? <div className="ws-error-panel" role="alert">
            <strong>{getOfflineSyncState().online ? "The Notebook could not be loaded." : "This device has no offline copy of the Notebook yet."}</strong>
            <span>{workspace.error}</span>
            <button type="button" className="ws-button" onClick={() => void workspace.reload()}>Try again</button>
          </div> : null}
          {section === "overview" ? <OverviewView study={studySummary} onOpenStudy={() => setSection("study")} /> : null}
          {section === "notebook" ? <NotebookView /> : null}
          {section === "mistakes" ? <MistakeLog /> : null}
          {section === "progress" ? <ProgressView /> : null}
          {section === "study" && loading ? <div className="content-state">Opening Heuresis…</div> : null}
          {section === "study" && !loading && error ? <div className="content-state error-state"><strong>{syncState.online ? "Database connection failed." : "This device has no synchronised copy yet."}</strong><span>{error}</span><button className="secondary-button" onClick={() => void reload()}>Try again</button></div> : null}
          {section === "study" && !loading && !error && view === "library" ? <LibraryView collections={collections} packs={packs} archivedCount={archivedPacks.length} onOpen={openPack} onCapture={openCapture} onOpenCaptureInbox={openCaptureInbox} onEditPack={openTopicSettings} onOpenNewWords={openNewWords} onArchive={() => setArchiveOpen(true)} onNewCollection={() => openCollections(true)} /> : null}
          {section === "study" && !loading && !error && view === "catalogue" ? <CatalogueView collections={collections} packs={packs} onBack={openLibrary} onOpenPack={openPack} /> : null}
          {section === "study" && !loading && !error && view === "related" ? <RelatedCatalogueView packs={packs} collections={collections} collection={relatedCollection} onBack={openLibrary} onOpenPack={openPack} onTopicCreated={afterRelatedTopicCreated} /> : null}
          {section === "study" && !loading && !error && view === "capture-inbox" ? <CaptureInboxView packs={packs} collection={captureInboxCollection} onBack={openLibrary} onOpenPack={openPack} onOpenCapture={(pack) => openCapture(pack)} /> : null}
          {section === "study" && !loading && !error && view === "pack" && activePack ? <PackView pack={activePack} collection={activeCollection} onBack={openLibrary} onCapture={() => openCapture(activePack)} onSettings={() => openTopicSettings(activePack)} onChanged={() => void reload(true).catch(() => undefined)} /> : null}
        </main>
      </div>
      <QuickCapture />
      {recoveryOpen ? <OfflineRecoveryDialog userId={session.user.id} onClose={() => setRecoveryOpen(false)} onSync={() => runSync(false)} /> : null}
      {trashOpen ? <KnowledgeTrashDialog onClose={() => setTrashOpen(false)} /> : null}
      <Toaster />
      {paletteOpen ? <WorkspaceSearch onClose={() => setPaletteOpen(false)} onSearchCards={(query) => { setCardQuery(query); setSection("study"); setSearchOpen(true); }} /> : null}
      {shortcutsOpen ? <ShortcutsDialog onClose={() => setShortcutsOpen(false)} /> : null}
      {searchOpen ? <SearchOverlay packs={packs} initialQuery={cardQuery} onClose={() => { setSearchOpen(false); setCardQuery(""); }} onOpen={(pack) => { setSection("study"); openPack(pack); }} /> : null}
      {settingsOpen ? <SettingsModal background={background} packs={packs} collections={collections} onDataChanged={() => reload(true).then(() => undefined)} onClose={() => setSettingsOpen(false)} /> : null}
      {collectionsOpen ? <CollectionsModal collections={collections} packs={packs} startNew={collectionsStartNew} onClose={closeCollections} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {archiveOpen ? <ArchiveModal packs={archivedPacks} onClose={() => setArchiveOpen(false)} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {topicModalOpen ? <TopicModal collections={collections} pack={topicModalPack} preferredCollectionId={topicPreferredCollectionId} onClose={() => { setTopicModalOpen(false); setTopicModalPack(null); }} onChanged={afterTopicChange} /> : null}
    </div>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const rows: Array<[string, string]> = [
    [`${MOD_KEY} ⇧ N`, "Quick note (from anywhere, even while typing)"],
    [`${MOD_KEY} ⇧ M`, "Record a mistake"],
    [`${MOD_KEY} ⇧ L`, "Start a lesson"],
    [`${MOD_KEY} ↵`, "Save the capture · finish editing"],
    [`${MOD_KEY} K  or  /`, "Search notes (in Study: search cards)"],
    [`${MOD_KEY} \\`, "Toggle full sidebar and icon rail"],
    [`${MOD_KEY} ⇧ \\`, "Focus mode: hide or restore the sidebar"],
    ["Alt 1 – 5", "Overview · Study · Notebook · Mistake Log · Progress"],
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
  return <AuthGate>{(session) => <HeuresisApp session={session} />}</AuthGate>;
}
