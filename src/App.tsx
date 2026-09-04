import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpen, FolderTree, Link2, LogOut, Plus, RefreshCw, Search, Settings2 } from "lucide-react";
import ArchiveModal from "./components/ArchiveModal";
import AuthGate from "./components/AuthGate";
import CaptureView from "./components/CaptureView";
import CatalogueView from "./components/CatalogueView";
import CollectionsModal from "./components/CollectionsModal";
import LibraryView from "./components/LibraryView";
import PackView from "./components/PackView";
import RelatedCatalogueView from "./components/RelatedCatalogueView";
import SearchOverlay from "./components/SearchOverlay";
import SettingsModal from "./components/SettingsModal";
import TopicModal from "./components/TopicModal";
import { useHeuresisBackground } from "./hooks/useHeuresisBackground";
import { listArchivedPacks } from "./lib/advanced";
import { listCollections, listPacks, type Collection, type PackWithType } from "./lib/heuresis";
import { supabase } from "./lib/supabase";

type View = "library" | "capture" | "pack" | "catalogue" | "related";

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
  const [capturePack, setCapturePack] = useState<PackWithType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [collectionsOpen, setCollectionsOpen] = useState(false);
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
  const backgroundStyle: BackgroundStyle = {
    "--heuresis-background-image": background.imageUrl && background.settings.enabled ? `url("${background.imageUrl}")` : "none",
    "--heuresis-background-opacity": String(background.settings.opacity),
    "--heuresis-background-veil": String(background.settings.veil),
    "--heuresis-background-blur": `${background.settings.blur}px`,
    "--heuresis-background-position": background.settings.position,
    "--heuresis-background-fit": background.settings.fit,
  };

  function openLibrary() {
    setView("library"); setActivePackId(null); setCapturePack(null);
  }

  function openPack(pack: PackWithType) {
    setActivePackId(pack.id); setCapturePack(null); setView("pack");
  }

  function openCapture(pack: PackWithType | null = null) {
    setCapturePack(pack); setView("capture");
  }

  function leaveCapture() {
    if (capturePack) openPack(capturePack);
    else openLibrary();
  }

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

  return (
    <div className="heuresis-desktop" style={backgroundStyle} data-custom-background={background.imageUrl && background.settings.enabled ? "heuresis" : undefined}>
      <div className="heuresis-wallpaper" aria-hidden="true" />
      <div className="heuresis-veil" aria-hidden="true" />

      <header className="desktop-chrome">
        <button className="desktop-wordmark" onClick={openLibrary}>Heuresis<span>.</span></button>
        <span className="desktop-spacer" />
        <button className="desktop-action" onClick={() => setSearchOpen(true)}><Search size={14} /> Search</button>
        <button className={`desktop-action ${view === "catalogue" ? "active" : ""}`} onClick={() => { setView("catalogue"); setActivePackId(null); }}><BookOpen size={14} /> Catalogue</button>
        <button className={`desktop-action ${view === "related" ? "active" : ""}`} onClick={() => { setView("related"); setActivePackId(null); }}><Link2 size={14} /> Related</button>
        <button className="desktop-action" onClick={() => setCollectionsOpen(true)}><FolderTree size={14} /> Collections</button>
        <button className="desktop-action desktop-primary" onClick={() => openNewTopic(activeCollection?.id ?? null)}><Plus size={14} /> Topic</button>
        <button className={`desktop-action ${view === "capture" ? "active" : ""}`} onClick={() => openCapture()}><Plus size={14} /> Capture</button>
        <button className="desktop-action" onClick={() => setSettingsOpen(true)}><Settings2 size={14} /> Settings</button>
      </header>

      <div className="desktop-account-strip">
        <span>{session.user.email || "Supabase account"}</span>
        <button onClick={() => void reload(true).then(() => setNotice("Heuresis refreshed.")).catch(() => undefined)}><RefreshCw size={13} /> Refresh</button>
        <button onClick={() => void supabase?.auth.signOut()}><LogOut size={13} /> Sign out</button>
      </div>

      {notice ? <div className="desktop-notice"><span>{notice}</span><button onClick={() => setNotice("")}>×</button></div> : null}

      <main className="desktop-content">
        {loading ? <div className="content-state">Opening the Heuresis database…</div> : null}
        {!loading && error ? <div className="content-state error-state"><strong>Database connection failed.</strong><span>{error}</span><button className="secondary-button" onClick={() => void reload()}>Try again</button></div> : null}
        {!loading && !error && view === "library" ? <LibraryView collections={collections} packs={packs} archivedCount={archivedPacks.length} onOpen={openPack} onCapture={openCapture} onEditPack={openTopicSettings} onArchive={() => setArchiveOpen(true)} /> : null}
        {!loading && !error && view === "catalogue" ? <CatalogueView collections={collections} packs={packs} onBack={openLibrary} onOpenPack={openPack} /> : null}
        {!loading && !error && view === "related" ? <RelatedCatalogueView packs={packs} onBack={openLibrary} onOpenPack={openPack} /> : null}
        {!loading && !error && view === "pack" && activePack ? <PackView pack={activePack} collection={activeCollection} onBack={openLibrary} onCapture={() => openCapture(activePack)} onSettings={() => openTopicSettings(activePack)} onChanged={() => void reload(true).catch(() => undefined)} /> : null}
        {!loading && !error && view === "capture" ? <CaptureView collections={collections} packs={packs} initialPack={capturePack} onBack={leaveCapture} onSaved={() => void reload(true).catch(() => undefined)} /> : null}
      </main>

      {searchOpen ? <SearchOverlay packs={packs} onClose={() => setSearchOpen(false)} onOpen={openPack} /> : null}
      {settingsOpen ? <SettingsModal background={background} onClose={() => setSettingsOpen(false)} /> : null}
      {collectionsOpen ? <CollectionsModal collections={collections} packs={packs} onClose={() => setCollectionsOpen(false)} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {archiveOpen ? <ArchiveModal packs={archivedPacks} onClose={() => setArchiveOpen(false)} onChanged={() => reload(true).then(() => undefined)} /> : null}
      {topicModalOpen ? <TopicModal collections={collections} pack={topicModalPack} preferredCollectionId={topicPreferredCollectionId} onClose={() => { setTopicModalOpen(false); setTopicModalPack(null); }} onChanged={afterTopicChange} /> : null}
    </div>
  );
}

export default function App() {
  return <AuthGate>{(session) => <HeuresisApp session={session} />}</AuthGate>;
}
