import { ImagePlus, RotateCcw, Trash2, X } from "lucide-react";
import { useRef, useState, type MouseEvent } from "react";
import { DEFAULT_BACKGROUND_SETTINGS, type BackgroundSettings } from "../hooks/useHeuresisBackground";
import { dimPercent, dimToLegacySettings } from "../lib/backgroundDim";
import type { Collection, PackWithType } from "../lib/heuresis";
import { useAppearance, type PalettePreference } from "../lib/theme";
import SortingSettings from "./SortingSettings";
import StructureSettings from "./StructureSettings";

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

type Tab = "appearance" | "sorting" | "cards";
type Props = {
  background: BackgroundApi;
  packs: PackWithType[];
  collections: Collection[];
  onDataChanged: () => Promise<void> | void;
  onClose: () => void;
};

function AppearanceSettings({ background }: { background: BackgroundApi }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const { mode, palette, chooseMode, choosePalette } = useAppearance();
  const palettes: Array<{ id: PalettePreference; label: string }> = [
    { id: "slate", label: "Slate" }, { id: "forest", label: "Forest" },
    { id: "sepia", label: "Sepia" }, { id: "neutral", label: "Neutral" },
  ];

  async function choose(file: File | undefined) {
    if (!file) return;
    setNotice("");
    try { await background.chooseImage(file); setNotice("Background saved to your Heuresis account."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save the background."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const dim = dimPercent(background.settings.opacity, background.settings.veil);
  function setFocal(event: MouseEvent<HTMLButtonElement>) {
    if (!background.imageUrl) return;
    const choices = ["top", "center", "bottom"] as const;
    if (!event.detail) {
      const index = choices.indexOf(background.settings.position);
      background.updateSettings({ position: choices[(index + 1) % choices.length] });
      return;
    }
    const box = event.currentTarget.getBoundingClientRect();
    const fraction = Math.max(0, Math.min(1, (event.clientY - box.top) / Math.max(box.height, 1)));
    background.updateSettings({ position: fraction < 1 / 3 ? "top" : fraction > 2 / 3 ? "bottom" : "center" });
  }

  return <section className="appearance-settings">
    <div className="appearance-choice" aria-label="Heuresis appearance">
      <div className="settings-copy"><strong>Appearance</strong><span>Choose a mode and a colour palette. The setting also applies to Capture and Review windows.</span></div>
      <div className="appearance-mode" role="group" aria-label="Appearance mode">
        {([{ id: "system", label: "Auto" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }] as const).map((option) =>
          <button key={option.id} type="button" aria-pressed={mode === option.id} onClick={() => chooseMode(option.id)}>{option.label}</button>)}
      </div>
      <div className="appearance-palettes" role="group" aria-label="Colour palette">
        {palettes.map((option) => <button key={option.id} className="appearance-palette" type="button"
          aria-label={option.label} aria-pressed={palette === option.id} onClick={() => choosePalette(option.id)}>
          <span className="appearance-palette-preview" data-palette-preview={option.id}><i /><b /><em /></span>
          <span>{option.label}</span>
        </button>)}
      </div>
    </div>
    <div className="settings-rule" />
    <div className="settings-copy"><strong>Study background</strong>
      <span>See how your image looks behind a learning card. Your choice follows your account across devices.</span></div>
    <input ref={fileRef} className="hidden-file" type="file" accept="image/*"
      onChange={(event) => void choose(event.target.files?.[0])}/>
    <div className="background-preview background-preview-live">
      <button type="button" className="background-preview-canvas"
        disabled={!background.imageUrl}
        title="Click top, middle or bottom to set the image focal area. Enter cycles these positions."
        aria-label={`Preview background; focal area ${background.settings.position}. Click to move focus or press Enter to cycle.`}
        onClick={setFocal}>
        {background.imageUrl ? <img src={background.imageUrl} alt=""
          style={{ opacity: background.settings.opacity, filter: `blur(${background.settings.blur}px)`,
            objectFit: "cover", objectPosition: `center ${background.settings.position}` }}/> : <span className="background-empty" aria-hidden="true"/>}
        <span className="background-preview-veil" style={{ opacity: background.settings.veil }} aria-hidden="true"/>
        <span className="background-preview-example" aria-hidden="true">
          <small>GERMAN · GRAMMAR</small>
          <strong>Ich stelle fest, dass …</strong>
          <span>To notice or establish something</span>
          <em>Review · Remember</em>
        </span>
      </button>
      <span className="background-preview-caption">{background.hasImage
        ? `Live preview · focal area: ${background.settings.position}`
        : "Choose an image to preview its appearance."}</span>
    </div>
    <div className="settings-actions">
      <button type="button" className="secondary-button" disabled={background.syncing}
        onClick={() => fileRef.current?.click()}><ImagePlus size={14}/>
        {background.hasImage ? "Replace image" : "Choose image"}</button>
      {background.hasImage ? <button type="button" className="secondary-button"
        disabled={background.syncing} onClick={() => void background.removeImage()}>
        <Trash2 size={14}/> Remove image</button> : null}
      <button type="button" className="secondary-button" title="Restore default appearance settings but keep your image"
        onClick={() => background.updateSettings({ ...DEFAULT_BACKGROUND_SETTINGS, enabled: background.hasImage })}>
        <RotateCcw size={14}/> Use default</button>
    </div>
    <div className="settings-controls">
      <label><span>Dim</span><input type="range" min="0" max="95" step="5" value={dim}
        onChange={(event) => background.updateSettings(dimToLegacySettings(Number(event.target.value)))}
        aria-label="Background dimming"/><em>{dim}%</em></label>
      <label><span>Blur</span><input type="range" min="0" max="12" step="1"
        value={background.settings.blur}
        onChange={(event) => background.updateSettings({ blur: Number(event.target.value) })}/>
        <em>{background.settings.blur}px</em></label>
      <p className="background-focal-hint">Click the preview to focus the top, centre or bottom of the image.</p>
    </div>
    {background.syncError ? <div className="settings-note error" role="alert">{background.syncError}</div> : null}
    {notice ? <div className="settings-note" role="status">{notice}</div> : null}</section>;
}

export default function SettingsModal({ background, packs, collections, onDataChanged, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("appearance");
  return (
    <div className="modal-backdrop settings-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="settings-modal settings-modal-wide" role="dialog" aria-modal="true" aria-label="Heuresis settings">
        <header className="settings-head"><div><p className="eyebrow">PREFERENCES</p><h2>Settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={17} /></button></header>
        <nav className="settings-tabs"><button aria-pressed={tab === "appearance"} onClick={() => setTab("appearance")}>Appearance</button><button aria-pressed={tab === "sorting"} onClick={() => setTab("sorting")}>Sorting</button><button aria-pressed={tab === "cards"} onClick={() => setTab("cards")}>Cards & directions</button></nav>
        <div className="settings-body">{tab === "appearance" ? <AppearanceSettings background={background} /> : null}{tab === "sorting" ? <SortingSettings /> : null}{tab === "cards" ? <StructureSettings packs={packs} collections={collections} onChanged={onDataChanged} /> : null}</div>
      </section>
    </div>
  );
}
