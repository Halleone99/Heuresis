import { useEffect, useState } from "react";

export function BootScreen({ compact = false }: { compact?: boolean }) {
  return <div className={`heuresis-boot${compact ? " heuresis-boot--compact" : ""}`} role="status" aria-label="Heuresis is opening">
    <div className="heuresis-boot-inner"><div className="heuresis-boot-mark" aria-hidden="true">H</div>
      <div className="heuresis-boot-name">Heure<span>sis</span></div>
      <div className="heuresis-boot-status">Opening your library</div>
      <div className="heuresis-boot-dots" aria-hidden="true"><i/><i/><i/></div>
    </div></div>;
}

export default function LoadingState({ variant = "list" }: { variant?: "list" | "page" }) {
  const [visible, setVisible] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const reveal = window.setTimeout(() => setVisible(true), 250);
    const label = window.setTimeout(() => setSlow(true), 4000);
    return () => { window.clearTimeout(reveal); window.clearTimeout(label); };
  }, []);
  return <div className={`heuresis-loading heuresis-loading--${variant}`} role="status" aria-label="Loading">
    {visible ? <div className="heuresis-loading-shapes" aria-hidden="true">
      {Array.from({ length: variant === "page" ? 4 : 5 }, (_, n) => <div key={n} />)}
    </div> : null}{slow ? <span>Still loading…</span> : null}
  </div>;
}
