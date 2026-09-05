import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpen, ChevronDown, FolderTree, Home, Link2, LogOut, Plus, RefreshCw, Search, Settings2 } from "lucide-react";
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
import { useHeuresisBackground } from "./hooks/useHeuresisBackground";
import { listArchivedPacks } from "./lib/advanced";
import { openCaptureWindow } from "./lib/captureWindow";
import { listCollections, listPacks, type Collection, type PackWithType } from "./lib/heuresis";
import { supabase } from "./lib/supabase";

type View = "library" | "pack" | "catalogue" | "related" | "capture-inbox";

type BackgroundStyle = CSSProperties & {
  "--heuresis-background-image"?: string;
  "--heuresis-background-opacity"?: string;
  "--heuresis-background-veil"?: string;
  "--heuresis-background-blur"?: string;
  "--heuresis-background-position"?: string;
  "--heuresis-background-fit"?: string;
};

function isTypingTarget(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;
  return Boolean(element && (element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.tagName === "SELECT" || element.isContentEditable));
}

function HeuresisApp({ session }: { session: Session }) {
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

  useEffect(() => { void reload().catch(() => undefined); }, []);

  useEffect(() => {
    const refreshOnFocus = () => { void reload(true).catch(() => undefined); };
    window.addEventListener("focus", refreshOnFocus);
    return () => window.removeEventListener("focus", refreshOnFocus);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (event.key === "/" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k")) {
        event.preventDefault(); setSearchOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activePack = useMemo(() => packs.find((pack) => pack.id === activePackId) ?? null, [activePackId, packs]);
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === activePack?.collection_id) ?? null, [activePack?.collection_id, collections]);
  const relatedCollection = useMemo(() => collections.find((collection) => collection.id === relatedCollectionId) ?? null, [collections, relatedCollectionId]);
  const captureInboxCollection = useMemo(() => collections.find((collection) => collection.id === captureInboxCollectionId) ?? null, [collections, captureInboxCollectionId]);
  const accountLabel = session.user.email || "Supabase account";
  const accountInitial = accountLabel.slice(0, 1).toUpperCase();
  const backgroundStyle: BackgroundStyle = {
    "--heuresis-background-image": background.imageUrl && background.settings.enabled ? `url("${background.imageUrl}")` : "none",
    "--heuresis-background-opacity": String(background.settings.opacity),
    "--heuresis-background-veil": String(background.settings.veil),
    "--heuresis-background-blur": `${background.settings.blur}px`,
    "--heuresis-background-position": background.settings.position,
    "--heuresis-background-fit": background.settings.fit,
  };

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
    setNotice("Topic created from New words.");
  }

  return (
    <div className="heuresis-desktop" style={backgroundStyle} data-custom-background={background.imageUrl && background.settings.enabled ? "heuresis" : undefined}>
      <div className="heuresis-wallpaper" aria-hidden="true" />
      <div className="heuresis-veil" aria-hidden="true" />
      <header className="desktop-chrome">
        <button className="desktop-wordmark" onClick={openLibrary} aria-label="Open library"><span className="desktop-mark-wrap"><HeuresisMark /></span><span className="desktop-wordmark-name">Heuresis<span>.</span></span></button>
        <nav className="desktop-nav-group" aria-label="Primary navigation">
          <button className={`desktop-nav-item ${view === "library" || view === "pack" || view === "capture-inbox" ? "active" : ""}`} onClick={openLibrary}><Home size={14} /> Library</button>
          <button className={`desktop-nav-item ${view === "catalogue" ? "active" : ""}`} onClick={() => { setView("catalogue"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><BookOpen size={14} /> Catalogue</button>
          <button className={`desktop-nav-item ${view === "related" ? "active" : ""}`} onClick={() => { setView("related"); setActivePackId(null); setRelatedCollectionId(null); setCaptureInboxCollectionId(null); }}><Link2 size={14} /> Related</button>
          <button className="desktop-nav-item" onClick={() => openCollections(false)}><FolderTree size={14} /> Collections</button>
        </nav>
        <span className="desktop-spacer" />
        <div className="desktop-header-actions">
          <button className="desktop-action desktop-search-action" onClick={() => setSearchOpen(true)}><Search size={14} /><span>Search</span><kbd>⌘K</kbd></button>
          <button className="desktop-action desktop-topic-action" onClick={() => openNewTopic(activeCollection?.id ?? relatedCollection?.id ?? captureInboxCollection?.id ?? null)}><Plus size={14} /> Topic</button>
          <button className="desktop-action desktop-primary" onClick={() => openCapture()}><Plus size={14} /> Capture</button>
          <details className="desktop-account-menu">
            <summary aria-label="Account menu"><span className="desktop-account-avatar">{accountInitial}</span><ChevronDown size={13} /></summary>
            <div className="desktop-account-popover">
              <div className="desktop-account-identity"><span>ACCOUNT</span><strong>{accountLabel}</strong></div>
              <button onClick={() => void reload(true).then(() => setNotice("Heuresis refreshed.")).catch(() => undefined)}><RefreshCw size={14} /> Refresh data</button>
              <button onClick={() => setSettingsOpen(true)}><Settings2 size={14} /> Settings</button>
              <div className="desktop-account-divider" />
              <button onClick={() => void supabase?.auth.signOut()}><LogOut size={14} /> Sign out</button>
            </div>
          </details>
        </div>
      </header>
      {notice ? <div className="desktop-notice"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div> : null}
      <main className="desktop-content">
        {loading ? <div className="content-state">Opening the Heuresis database…</div> : null}
        {!loading && error ? <div className="content-state error-state"><strong>Database connection failed.</strong><span>{error}</span><button className="secondary-button" onClick={() => void reload()}>Try again</button></div> : null}
        {!loading && !error && view === "library" ? <LibraryView collections={collections} packs={packs} archivedCount={archivedPacks.length} onOpen={openPack} onCapture={openCapture} onOpenCaptureInbox={openCaptureInbox} onEditPack={openTopicSettings} onOpenNewWords={openNewWords} onArchive={() => setArchiveOpen(true)} onNewCollection={() => openCollections(true)} /> : null}
        {!loading && !error && view === "catalogue" ? <CatalogueView collections={collections} packs={packs} onBack={openLibrary} onOpenPack={openPack} /> : null}
        {!loading && !error && view === "related" ? <RelatedCatalogueView packs={packs} collection={relatedCollection} onBack={openLibrary} onOpenPack={openPack} onTopicCreated={afterRelatedTopicCreated} /> : null}
        {!loading && !error && view === "capture-inbox" ? <CaptureInboxView packs={packs} collection={captureInboxCollection} onBack={openLibrary} onOpenPack={openPack} onOpenCapture={(pack) => openCapture(pack)} /> : null}
        {!loading && !error && view === "pack" && activePack ? <PackView pack={activePack} collection={activeCollection} onBack={openLibrary} onCapture={() => openCapture(activePack)} onSettings={() => openTopicSettings(activePack)} onChanged={() => void reload(true).catch(() => undefined)} /> : null}
      </main>
      {searchOpen ? <SearchOverlay packs={packs} onClose={() => setSearchOpen(false)} onOpen={openPack} /> : null}
      {settingsOpen ? <SettingsModal background={background} packs={packs} collections={collections} onDataChanged={() => reload(true).then(() => undefined)} onClose={() => setSettingsOpen(false)} /> : null}
      {collectionsOpen ? <CollectionsModal collections={collections} packs={packs} startNew={collectionsStartNew} onClose={closeCollections} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {archiveOpen ? <ArchiveModal packs={archivedPacks} onClose={() => setArchiveOpen(false)} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {topicModalOpen ? <TopicModal collections={collections} pack={topicModalPack} preferredCollectionId={topicPreferredCollectionId} onClose={() => { setTopicModalOpen(false); setTopicModalPack(null); }} onChanged={afterTopicChange} /> : null}
    </div>
  );
}

export default function App() { return <AuthGate>{(session) => <HeuresisApp session={session} />}</AuthGate>; }
