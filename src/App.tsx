import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { BookOpen, LogOut, Plus, RefreshCw } from "lucide-react";
import AuthGate from "./components/AuthGate";
import CaptureView from "./components/CaptureView";
import LibraryView from "./components/LibraryView";
import { listCollections, listPacks, type Collection, type PackWithType } from "./lib/heuresis";
import { supabase } from "./lib/supabase";

type View = "library" | "capture";

function HeuresisApp({ session }: { session: Session }) {
  const [view, setView] = useState<View>("library");
  const [collections, setCollections] = useState<Collection[]>([]);
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [capturePack, setCapturePack] = useState<PackWithType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function reload() {
    setLoading(true);
    setError("");
    try {
      const [nextCollections, nextPacks] = await Promise.all([listCollections(), listPacks()]);
      setCollections(nextCollections);
      setPacks(nextPacks);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load Heuresis data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void reload(); }, []);

  function openCapture(pack: PackWithType | null = null) {
    setCapturePack(pack);
    setView("capture");
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><div className="brand-mark small">H</div><div><strong>Heuresis</strong><span>Desktop · 0.1</span></div></div>
        <nav>
          <button className={view === "library" ? "active" : ""} onClick={() => setView("library")}><BookOpen size={17} /> Library</button>
          <button className={view === "capture" ? "active" : ""} onClick={() => openCapture()}><Plus size={17} /> Capture</button>
        </nav>
        <div className="sidebar-bottom">
          <span className="account-line">{session.user.email || "Supabase account"}</span>
          <button className="utility-button" onClick={() => void reload()}><RefreshCw size={15} /> Refresh</button>
          <button className="utility-button" onClick={() => void supabase?.auth.signOut()}><LogOut size={15} /> Sign out</button>
        </div>
      </aside>

      <main className="content-shell">
        {loading ? <div className="content-state">Loading the Heuresis database…</div> : null}
        {!loading && error ? <div className="content-state error-state"><strong>Database connection failed.</strong><span>{error}</span><button className="text-button" onClick={() => void reload()}>Try again</button></div> : null}
        {!loading && !error && view === "library" ? <LibraryView collections={collections} packs={packs} onCapture={(pack) => openCapture(pack)} /> : null}
        {!loading && !error && view === "capture" ? <CaptureView collections={collections} packs={packs} initialPack={capturePack} onBack={() => setView("library")} /> : null}
      </main>
    </div>
  );
}

export default function App() {
  return <AuthGate>{(session) => <HeuresisApp session={session} />}</AuthGate>;
}
