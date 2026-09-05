import { useEffect, useMemo, useState } from "react";
import AuthGate from "./AuthGate";
import CaptureView from "./CaptureView";
import { listCollections, listPacks, type Collection, type PackWithType } from "../lib/heuresis";

async function closeCaptureWindow() {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
    return;
  }
  window.close();
}

function CaptureWindowBody() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const requestedPackId = params.get("pack")?.trim() || "";
  const requestedCollectionId = params.get("collection")?.trim() || "";
  const [collections, setCollections] = useState<Collection[]>([]);
  const [packs, setPacks] = useState<PackWithType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    void Promise.all([listCollections(), listPacks()])
      .then(([nextCollections, nextPacks]) => {
        if (!alive) return;
        setCollections(nextCollections);
        setPacks(nextPacks);
      })
      .catch((loadError) => {
        if (!alive) return;
        setError(loadError instanceof Error ? loadError.message : "Could not open Capture.");
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const initialPack = useMemo(() => {
    if (requestedPackId) {
      const exact = packs.find((pack) => pack.id === requestedPackId);
      if (exact) return exact;
    }
    if (requestedCollectionId) {
      const inCollection = packs.find((pack) => pack.collection_id === requestedCollectionId);
      if (inCollection) return inCollection;
    }
    return packs[0] ?? null;
  }, [packs, requestedCollectionId, requestedPackId]);

  if (loading) return <div className="capture-window-state">Opening Capture…</div>;
  if (error) return <div className="capture-window-state error-state"><strong>Capture could not open.</strong><span>{error}</span><button onClick={() => void closeCaptureWindow()}>Close</button></div>;

  return (
    <div className="capture-window-host">
      <CaptureView
        collections={collections}
        packs={packs}
        initialPack={initialPack}
        onBack={() => void closeCaptureWindow()}
      />
    </div>
  );
}

export default function CaptureWindow() {
  return <AuthGate>{() => <CaptureWindowBody />}</AuthGate>;
}
