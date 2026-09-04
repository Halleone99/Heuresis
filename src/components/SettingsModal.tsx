import { ImagePlus, RotateCcw, Trash2, X } from "lucide-react";
import { useRef, useState } from "react";
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from "../hooks/useHeuresisBackground";

type BackgroundApi = {
  imageUrl: string | null;
  hasImage: boolean;
  settings: BackgroundSettings;
  syncing: boolean;
  syncError: string;
  updateSettings: (patch: Partial<BackgroundSettings>) => void;
  chooseImage: (file: File) => Promise<void>;
  removeImage: () => Promise<void>;
};

type Props = { background: BackgroundApi; onClose: () => void };

export default function SettingsModal({ background, onClose }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");

  async function choose(file: File | undefined) {
    if (!file) return;
    setNotice("");
    try {
      await background.chooseImage(file);
      setNotice("Background saved to your Heuresis account.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save the background.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="modal-backdrop settings-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="settings-modal" role="dialog" aria-modal="true" aria-label="Heuresis settings">
        <header className="settings-head">
          <div><p className="eyebrow">HEURESIS SETTINGS</p><h2>Appearance</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={17} /></button>
        </header>

        <div className="settings-copy"><strong>Heuresis background</strong><span>This uses the same Supabase-backed Heuresis wallpaper as Personal OS, so changes can follow you between the browser and desktop app.</span></div>
        <input ref={fileRef} className="hidden-file" type="file" accept="image/*" onChange={(event) => void choose(event.target.files?.[0])} />

        <div className="background-preview">
          {background.imageUrl ? <img src={background.imageUrl} alt="Current Heuresis background" /> : <div className="background-empty" />}
          <span>{background.hasImage ? "Current account background" : "No Heuresis background has been synced yet."}</span>
        </div>

        <div className="settings-actions">
          <button className="secondary-button" disabled={background.syncing} onClick={() => fileRef.current?.click()}><ImagePlus size={14} /> {background.hasImage ? "Replace image" : "Choose image"}</button>
          {background.hasImage ? <button className="secondary-button" disabled={background.syncing} onClick={() => void background.removeImage()}><Trash2 size={14} /> Remove</button> : null}
          <button className="secondary-button" onClick={() => background.updateSettings({ ...DEFAULT_BACKGROUND_SETTINGS, enabled: background.hasImage })}><RotateCcw size={14} /> Reset appearance</button>
        </div>

        <div className="settings-controls">
          <label><span>Image opacity</span><input type="range" min="0.2" max="1" step="0.05" value={background.settings.opacity} onChange={(event) => background.updateSettings({ opacity: Number(event.target.value) })} /><em>{Math.round(background.settings.opacity * 100)}%</em></label>
          <label><span>Readability veil</span><input type="range" min="0" max="1" step="0.05" value={background.settings.veil} onChange={(event) => background.updateSettings({ veil: Number(event.target.value) })} /><em>{Math.round(background.settings.veil * 100)}%</em></label>
          <label><span>Blur</span><input type="range" min="0" max="12" step="1" value={background.settings.blur} onChange={(event) => background.updateSettings({ blur: Number(event.target.value) })} /><em>{background.settings.blur}px</em></label>
          <div className="setting-choice"><span>Position</span><div>{(["top", "center", "bottom"] as const).map((position) => <button key={position} aria-pressed={background.settings.position === position} onClick={() => background.updateSettings({ position })}>{position === "center" ? "Centre" : position[0].toUpperCase() + position.slice(1)}</button>)}</div></div>
          <div className="setting-choice"><span>Fit</span><div>{(["cover", "contain"] as const).map((fit) => <button key={fit} aria-pressed={background.settings.fit === fit} onClick={() => background.updateSettings({ fit })}>{fit[0].toUpperCase() + fit.slice(1)}</button>)}</div></div>
        </div>

        {background.syncError ? <div className="settings-note error">{background.syncError}</div> : null}
        {notice ? <div className="settings-note">{notice}</div> : null}
      </section>
    </div>
  );
}
