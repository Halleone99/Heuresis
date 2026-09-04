import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpen, LogOut, Plus, RefreshCw } from "lucide-react";
import AuthGate from "./components/AuthGate";
import CaptureView from "./components/CaptureView";
import LibraryView from "./components/LibraryView";
import PackView from "./components/PackView";
import { listCollections, listPacks, type Collection, type PackWithType } from "./lib/heuresis";
import { supabase } from "./lib/supabase";

type View = "library" | "capture" | "pack";

function HeuresisApp({ session }: { session: Session }) {
  const [view, setView] = useState<View>("library");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [activePackId, setActivePackId] = useState<string | null>(null);
  const [capturePack, setCapturePack] = useState<PackWithType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function reload(silent = false) {
    if (!silent) setLoading(true);
    setError("");
    try {
      const [nextCollections, nextPacks] = await Promise.all([listCollections(), listPacks()]);
      setCollections(nextCollections); setPacks(nextPacks);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "Could not load Heuresis data."); }
    finally { if (!silent) setLoading(false); }
  }

  useEffect(() => { void reload(); }, []);
  const activePack = useMemo(() => packs.find((pack) => pack.id === activePackId) ?? null, [activePackId, packs]);
  const activeCollection = useMemo(() => collections.find((collection) => collection.id === activePack?.collection_id) ?? null, [activePack?.collection_id, collections]);

  function openPack(pack: PackWithType) { setActivePackId(pack.id); setView("pack"); }
  function openCapture(pack: PackWithType | null = null) { setCapturePack(pack); setView("capture"); }
  function leaveCapture() { if (capturePack) { setActivePackId(capturePack.id); setView("pack"); } else setView("library"); }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark small">H</div><div><strong>Heuresis</strong><span>Desktop · 0.2</span></div></div>
        <nav><button className={view === "library" || view === "pack" ? "active" : ""} onClick={() => { setView("library"); setActivePackId(null); }}><BookOpen size={17} /> Library</button><button className={view === "capture" ? "active" : ""} onClick={() => openCapture()}><Plus size={17} /> Capture</button></nav>
        <div className="sidebar-bottom"><span className="account-line">{session.user.email || "Supabase account"}</span><button className="utility-button" onClick={() => void reload()}><RefreshCw size={15} /> Refresh</button><button className="utility-button" onClick={() => void supabase?.auth.signOut()}><LogOut size={15} /> Sign out</button></div>
      </aside>

      <main className="content-shell">
        {loading ? <div className="content-state">Loading the Heuresis database…</div> : null}
        {!loading && error ? <div className="content-state error-state"><strong>Database connection failed.</strong><span>{error}</span><button className="text-button" onClick={() => void reload()}>Try again</button></div> : null}
        {!loading && !error && view === "library" ? <LibraryView collections={collections} packs={packs} onOpen={openPack} onCapture={(pack) => openCapture(pack)} /> : null}
        {!loading && !error && view === "pack" && activePack ? <PackView pack={activePack} collection={activeCollection} onBack={() => { setView("library"); setActivePackId(null); }} onCapture={() => openCapture(activePack)} onChanged={() => void reload(true)} /> : null}
        {!loading && !error && view === "capture" ? <CaptureView collections={collections} packs={packs} initialPack={capturePack} onBack={leaveCapture} onSaved={() => void reload(true)} /> : null}
      </main>
    </div>
  );
}

export default function App() { return <AuthGate>{(session) => <HeuresisApp session={session} />}</AuthGate>; }
