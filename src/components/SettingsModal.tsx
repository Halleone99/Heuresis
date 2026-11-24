import { useDialogEscape } from "../hooks/useDialogEscape";
import { ImagePlus, RotateCcw, Trash2, X, ChevronDown, Check, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type DragEvent } from "react";
import { DEFAULT_BACKGROUND_SETTINGS, PAGE_BACKGROUND_CHOICES, type BackgroundPageKey, type BackgroundSettings } from "../hooks/useHeuresisBackground";
import { dimPercent, dimToLegacySettings } from "../lib/backgroundDim";
import { BACKGROUND_PRESETS, createBackgroundPresetImage, presetSwatch, type BackgroundPreset } from "../lib/backgroundPresets";
import type { Collection, PackWithType } from "../lib/heuresis";
import { useAppearance, type PalettePreference } from "../lib/theme";
import { useOverviewStyle } from "../lib/overviewStyle";
import { readNewCardQuota, saveNewCardQuota } from "../lib/newCardQuota";
import {
  availableSpeechVoices, readAutoPronunciation, readPreferredVoice, russianNeuralSpeechAvailable, speakReviewText,
  stopReviewAudio, writeAutoPronunciation, writePreferredVoice,
} from "../lib/reviewAudio";
import SortingSettings from "./SortingSettings";
import CardColoursEditor from "./CardColoursEditor";
import StructureSettings from "./StructureSettings";
import { BUILD_COMMIT, buildPlatform } from "../lib/buildInfo";

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

type Tab = "appearance" | "study" | "sorting" | "cards";
type Props = {
  backgrounds: Record<BackgroundPageKey, BackgroundApi>;
  packs: PackWithType[];
  collections: Collection[];
  onDataChanged: () => Promise<void> | void;
  onClose: () => void;
};

function AppearanceSettings({ backgrounds }: { backgrounds: Record<BackgroundPageKey, BackgroundApi> }) {
  const [selectedPage, setSelectedPage] = useState<BackgroundPageKey>("heuresis");
  const background = backgrounds[selectedPage];
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  const { mode, palette, design, chooseMode, choosePalette, chooseDesign } = useAppearance();
  const { style: overviewStyle, chooseStyle: chooseOverviewStyle } = useOverviewStyle();
  const palettes: Array<{ id: PalettePreference; label: string }> = [
    { id: "slate", label: "Slate" }, { id: "forest", label: "Forest" },
    { id: "sepia", label: "Sepia" }, { id: "neutral", label: "Neutral" },
  ];

  async function remove() {
    setNotice("");
    try { await background.removeImage(); setNotice("Image removed for this page."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not remove the image."); }
  }

  async function choose(file: File | undefined) {
    if (!file) return;
    setNotice("");
    try { await background.chooseImage(file); setNotice("Background saved to your Heuresis account."); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save the background."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const selectedLabel = PAGE_BACKGROUND_CHOICES.find((choice) => choice.key === selectedPage)?.label ?? "This page";
  const studyBackground = backgrounds["heuresis-study"];
  const inheritsStudy = selectedPage === "heuresis-new-cards" && studyBackground.hasImage && studyBackground.settings.enabled;
  const fallbackLabel = inheritsStudy ? "Study" : "All pages";
  const shownBackground = background.hasImage ? background : inheritsStudy ? studyBackground : backgrounds.heuresis;
  const shownImage = shownBackground.imageUrl;
  const dim = dimPercent(background.settings.opacity, background.settings.veil);
  const looks = [
    { label: "Natural", dim: 20, blur: 0 },
    { label: "Balanced", dim: 40, blur: 0 },
    { label: "Soft", dim: 55, blur: 3 },
    { label: "Dreamy", dim: 70, blur: 7 },
  ] as const;
  async function usePreset(preset: BackgroundPreset) {
    setApplyingPreset(preset.id); setNotice("");
    try {
      await background.chooseImage(await createBackgroundPresetImage(preset));
      setNotice(preset.label + " saved for " + selectedLabel + ".");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not save this atmosphere.");
    } finally { setApplyingPreset(null); }
  }
  function dropImage(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!background.syncing && !applyingPreset) void choose(event.dataTransfer.files?.[0]);
  }

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
    <div className="appearance-choice" aria-label="Design">
      <div className="settings-copy"><strong>Design</strong><span>Visual style only. Your palette and study preferences stay the same.</span></div>
      <div className="heuresis-design-options" role="group" aria-label="Design style">
        {(["classic", "refined"] as const).map((option) => <button key={option} type="button" aria-pressed={design === option} onClick={() => chooseDesign(option)}>
          <span className="heuresis-design-preview" data-preview={option} aria-hidden="true"><i/><b/><em/></span>
          {option === "classic" ? "Classic" : "Refined"}
        </button>)}
      </div>
    </div>
    <div className="appearance-choice" aria-label="Heuresis appearance">
      <div className="settings-copy"><strong>Theme</strong><span>Also used in Capture and Review.</span></div>
      <div className="appearance-controls">
        <div className="appearance-mode" role="group" aria-label="Appearance mode">
          {([{ id: "system", label: "Auto" }, { id: "light", label: "Light" }, { id: "dark", label: "Dark" }] as const).map((option) =>
            <button key={option.id} type="button" aria-pressed={mode === option.id} onClick={() => chooseMode(option.id)}>{option.label}</button>)}
        </div>
        <div className="appearance-palettes" role="group" aria-label="Colour palette">
          {palettes.map((option) => <button key={option.id} className="appearance-palette" type="button"
            aria-label={option.label} aria-pressed={palette === option.id} onClick={() => choosePalette(option.id)}>
            <span className="appearance-palette-swatch" data-palette-preview={option.id}><i /><b /></span>
            <span>{option.label}</span>
          </button>)}
        </div>
      </div>
    </div>

    <div className="appearance-choice ov-overview-setting" aria-label="Overview layout">
      <div className="settings-copy"><strong>Overview layout</strong><span>Choose the presentation of the Overview page. The statistics stay the same.</span></div>
      <div className="appearance-mode" role="group" aria-label="Overview layout">
        <button type="button" aria-pressed={overviewStyle === "serif"} onClick={() => chooseOverviewStyle("serif")}>Serif</button>
        <button type="button" aria-pressed={overviewStyle === "panel"} onClick={() => chooseOverviewStyle("panel")}>No. 3 · Panel</button>
      </div>
    </div>
    <div className="pb-studio">
      <div className="settings-copy pb-heading"><strong>Page backgrounds</strong>
        <span>Set one background for everything, or choose a different one for a page.</span></div>
      <div className="pb-toolbar">
        <div className="pb-page-picker">
          <label htmlFor="pb-page-select">Page</label>
          <select id="pb-page-select" value={selectedPage} onChange={(event) => {
            setSelectedPage(event.target.value as BackgroundPageKey); setNotice("");
          }}>
            {PAGE_BACKGROUND_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>
              {choice.label}{backgrounds[choice.key].hasImage && choice.key !== "heuresis" ? " • customised" : ""}
            </option>)}
          </select>
          <span className="pb-page-status">
            {selectedPage === "heuresis" ? (background.hasImage ? "Shared background" : "No shared background")
              : background.hasImage ? "Custom background" : shownImage ? "Using " + fallbackLabel : "No background"}
          </span>
        </div>
        <div className="pb-toolbar-actions">
          <button type="button" className="pb-upload-primary" disabled={background.syncing || Boolean(applyingPreset)}
            onClick={() => fileRef.current?.click()}><ImagePlus size={16} />
            {background.syncing ? "Saving…" : background.hasImage ? "Change image" : "Upload image"}</button>
          {background.hasImage ? <button type="button" className="pb-quiet-action"
            disabled={background.syncing || Boolean(applyingPreset)} onClick={() => void remove()}
            title={selectedPage === "heuresis" ? "Remove shared image" : "Restore the " + fallbackLabel + " background"}>
            <Trash2 size={14} /> {selectedPage === "heuresis" ? "Remove" : "Use " + fallbackLabel}</button> : null}
        </div>
      </div>
      <input ref={fileRef} className="hidden-file" type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        aria-label={"Upload background image for " + selectedLabel}
        onChange={(event) => void choose(event.target.files?.[0])}/>
      <div className="pb-studio-grid">
        <div className="pb-visual">
          <div className="background-preview background-preview-live"
            onDragOver={(event) => event.preventDefault()} onDrop={dropImage}>
            <button type="button" className="background-preview-canvas"
              disabled={!background.imageUrl}
              title={background.hasImage ? "Click top, middle or bottom to move the picture's focus." : "Shared background preview"}
              aria-label={"Preview " + selectedLabel + " background, focal area " + shownBackground.settings.position}
              onClick={setFocal}>
              {shownImage ? <img src={shownImage} alt="" style={{
                opacity: shownBackground.settings.opacity, filter: "blur(" + shownBackground.settings.blur + "px)",
                objectFit: shownBackground.settings.fit, objectPosition: "center " + shownBackground.settings.position
              }}/> : <span className="background-empty" aria-hidden="true"/>}
              <span className="background-preview-veil" style={{ opacity: shownBackground.settings.veil }} aria-hidden="true"/>
              <span className="background-preview-example" aria-hidden="true">
                <small>{selectedLabel.toUpperCase()}</small>
                <strong>Ich stelle fest, dass …</strong>
                <span>To notice or establish something</span>
                <em>{selectedPage === "heuresis-new-cards" ? "Learn" : "Review · Remember"}</em>
              </span>
            </button>
            <span className="background-preview-caption">
              {background.hasImage ? "Preview · click the image to adjust its focus"
                : shownImage ? "Previewing the " + fallbackLabel + " background"
                  : "Choose an atmosphere or upload an image"}
            </span>
          </div>
        </div>
        <div className="pb-customise">
          <div className="pb-presets-panel">
            <div className="pb-panel-heading"><strong>Atmospheres</strong><span>Click to apply</span></div>
            <div className="pb-preset-grid">
              {BACKGROUND_PRESETS.map((preset) => <button type="button" key={preset.id}
                className="pb-preset" disabled={background.syncing || Boolean(applyingPreset)}
                onClick={() => void usePreset(preset)} title={preset.description}>
                <span className="pb-preset-art" style={{ background: presetSwatch(preset) }}>
                  {applyingPreset === preset.id ? <span className="pb-preset-saving">Saving…</span> : null}
                </span>
                <span>{preset.label}</span>
              </button>)}
            </div>
          </div>
          {background.hasImage ? <div className="pb-tuning">
            <div className="pb-panel-heading"><strong>Appearance</strong></div>
            <div className="pb-look-options" role="group" aria-label="Background appearance presets">
              {looks.map((look) => <button key={look.label} type="button"
                disabled={background.syncing}
                aria-pressed={dim === look.dim && background.settings.blur === look.blur}
                onClick={() => background.updateSettings({ ...dimToLegacySettings(look.dim), blur: look.blur })}>
                {dim === look.dim && background.settings.blur === look.blur ? <Check size={12}/> : null}{look.label}
              </button>)}
            </div>
            <details className="pb-advanced">
              <summary>More adjustments <ChevronDown size={15}/></summary>
              <div className="pb-tune-content">
                <div className="settings-controls pb-sliders">
                  <label><span>Dim</span><input type="range" min="0" max="95" step="5" value={dim}
                    onChange={(event) => background.updateSettings(dimToLegacySettings(Number(event.target.value)))}
                    aria-label="Background dimming"/><em>{dim}%</em></label>
                  <label><span>Blur</span><input type="range" min="0" max="20" step="1"
                    value={background.settings.blur}
                    onChange={(event) => background.updateSettings({ blur: Number(event.target.value) })}/>
                    <em>{background.settings.blur}px</em></label>
                </div>
                <div className="pb-setting-line"><span>Position</span>
                  <div className="pb-segments" role="group" aria-label="Background position">
                    {(["top", "center", "bottom"] as const).map((position) => <button key={position}
                      type="button" aria-pressed={background.settings.position === position}
                      onClick={() => background.updateSettings({ position })}>{position === "center" ? "Centre" : position === "top" ? "Top" : "Bottom"}</button>)}
                  </div>
                </div>
                <div className="pb-setting-line"><span>Fit</span>
                  <div className="pb-segments" role="group" aria-label="Background fit">
                    {(["cover", "contain"] as const).map((fit) => <button key={fit} type="button"
                      aria-pressed={background.settings.fit === fit}
                      onClick={() => background.updateSettings({ fit })}>{fit === "cover" ? "Fill" : "Fit"}</button>)}
                  </div>
                </div>
                <button type="button" className="pb-quiet-action" title="Reset adjustments without removing the image"
                  disabled={background.syncing}
                  onClick={() => background.updateSettings({ ...DEFAULT_BACKGROUND_SETTINGS, enabled: background.hasImage })}>
                  <RotateCcw size={14}/> Reset adjustments</button>
              </div>
            </details>
          </div> : selectedPage !== "heuresis" && shownImage ? <div className="pb-inherited">
            This page uses <strong>All pages</strong>. Choose an atmosphere or upload an image to customise it.
          </div> : null}
        </div>
      </div>
      {background.syncError ? <div className="settings-note error" role="alert">{background.syncError}</div> : null}
      {notice ? <div className="settings-note" role="status">{notice}</div> : null}
    </div>
    <CardColoursEditor />
  </section>;
}


const VOICE_LANGUAGES = [
  { locale: "zh-CN", label: "Chinese", sample: "你好，今天我们一起练习中文发音。" },
  { locale: "en-GB", label: "English", sample: "Good morning. Let's practise a few useful words together." },
  { locale: "ru-RU", label: "Russian", sample: "Здравствуйте! Сегодня мы будем учить новые слова." },
  { locale: "de-DE", label: "German", sample: "Guten Morgen! Heute üben wir gemeinsam die Aussprache." },
] as const;
type VoiceLocale = (typeof VOICE_LANGUAGES)[number]["locale"];

/** One shortlist per language. A row selects; its separate loudspeaker plays a sample. */
function VoiceSettings() {
  const [locale, setLocale] = useState<VoiceLocale>("zh-CN");
  const [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  const [russianNeuralReady, setRussianNeuralReady] = useState<boolean | null>(null);
  const [selected, setSelected] = useState<Record<string, string | null>>(() =>
    Object.fromEntries(VOICE_LANGUAGES.map(({ locale: id }) => [id, readPreferredVoice(id)])));
  const options = useMemo(() => availableSpeechVoices(locale), [locale, revision, selected]);
  const current = VOICE_LANGUAGES.find((option) => option.locale === locale)!;
  const active = selected[locale] ?? null;
  const missing = active && !options.some((option) => option.id === active);

  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    window.addEventListener("heuresis-speech-ready", refresh);
    window.speechSynthesis?.addEventListener?.("voiceschanged", refresh);
    return () => {
      window.removeEventListener("heuresis-speech-ready", refresh);
      window.speechSynthesis?.removeEventListener?.("voiceschanged", refresh);
      stopReviewAudio();
    };
  }, []);

  useEffect(() => {
    if (locale !== "ru-RU") return;
    let active = true;
    setRussianNeuralReady(null);
    void russianNeuralSpeechAvailable().then((ready) => {
      if (active) setRussianNeuralReady(ready);
    });
    return () => { active = false; };
  }, [locale, revision]);

  function choose(id: string | null) {
    writePreferredVoice(locale, id);
    setSelected((old) => ({ ...old, [locale]: id }));
    setNotice("");
    stopReviewAudio();
  }
  function sample(id: string | null) {
    const queued = speakReviewText(current.sample, locale, undefined, id, (message) => setNotice(message));
    setNotice(queued ? "" : "This voice could not start. Check the speech voices installed on your device.");
  }

  return <div className="heuresis-voice-settings">
    <div className="settings-section-heading">
      <strong>Choose a voice</strong>
      <span>Listen before choosing. Device voices are free; Russian neural voices need a configured Azure Speech resource.</span>
    </div>
    <div className="heuresis-voice-languages" role="group" aria-label="Pronunciation language">
      {VOICE_LANGUAGES.map((language) =>
        <button key={language.locale} type="button" aria-pressed={language.locale === locale}
          onClick={() => { stopReviewAudio(); setLocale(language.locale); setNotice(""); }}>
          {language.label}
        </button>)}
    </div>
    <div className="heuresis-voice-list" aria-label={current.label + " speech voices"}>
      <div className="heuresis-voice-row">
        <button type="button" className="heuresis-voice-select" aria-pressed={!active}
          onClick={() => choose(null)}>
          <span className="heuresis-voice-indicator">{!active ? <Check size={13} /> : null}</span>
          <span className="heuresis-voice-description"><strong>System default</strong><small>Use the device's preferred voice</small></span>
        </button>
        <button type="button" className="heuresis-voice-play" aria-label={"Test system default in " + current.label}
          title="Listen to a sample" onClick={() => sample(null)}><Volume2 size={17} /></button>
      </div>
      {options.map((voice, index) =>
        <div className="heuresis-voice-row" key={voice.id}>
          <button type="button" className="heuresis-voice-select" aria-pressed={active === voice.id}
            disabled={voice.provider === "azure" && russianNeuralReady !== true}
            onClick={() => choose(voice.id)}>
            <span className="heuresis-voice-indicator">{active === voice.id ? <Check size={13} /> : null}</span>
            <span className="heuresis-voice-description">
              <strong>Voice {index + 1}<span className="heuresis-voice-name"> · {voice.name}</span></strong>
              <small>{voice.provider === "azure"
                ? russianNeuralReady === true ? "Microsoft neural · Online" : "Microsoft neural · Setup required"
                : voice.lang + " · " + (voice.offline ? "Works offline" : "Requires a connection") + (voice.quality >= 400 ? " · High quality" : "")}</small>
            </span>
          </button>
          <button type="button" className="heuresis-voice-play" aria-label={"Test " + voice.name + " in " + current.label}
            disabled={voice.provider === "azure" && russianNeuralReady !== true}
            title="Listen to a sample" onClick={() => sample(voice.id)}><Volume2 size={17} /></button>
        </div>)}
    </div>
    {missing ? <p className="heuresis-voice-alert" role="status">Your previously chosen voice is not available here. Playback will use the system default until you choose another.</p> : null}
    {locale === "ru-RU" && russianNeuralReady === false
      ? <p className="heuresis-voice-footnote">To unlock Svetlana, Dariya and Dmitry, configure AZURE_SPEECH_KEY and AZURE_SPEECH_REGION in Supabase Edge Function secrets. Device voices continue working.</p>
      : null}
    {options.length === 0
      ? <p className="heuresis-voice-alert" role="status">No alternative {current.label.toLowerCase()} voices were found. The system default may still work. Install or enable language voices in your device's text-to-speech settings, then refresh.</p>
      : options.length < 5
        ? <p className="heuresis-voice-footnote">{options.length} alternative {options.length === 1 ? "voice" : "voices"} available on this device. Up to five are shown when installed.</p>
        : <p className="heuresis-voice-footnote">The five highest-ranked voices available on this device are shown. Availability differs between devices.</p>}
    {notice ? <p className="heuresis-voice-alert" role="alert">{notice}</p> : null}
    <button type="button" className="heuresis-voice-refresh" onClick={() => setRevision((value) => value + 1)}>
      <RotateCcw size={13} /> Refresh available voices
    </button>
  </div>;
}

function StudySettings() {
  const [dailyTarget, setDailyTarget] = useState(readNewCardQuota);
  const [autoPronunciation, setAutoPronunciation] = useState(readAutoPronunciation);

  return <section className="heuresis-study-settings" aria-label="Study preferences">
    <div className="settings-section-heading">
      <strong>Daily new cards</strong>
      <span>Choose how many new cards you want to introduce each day. This does not limit reviews already due.</span>
    </div>
    <label className="heuresis-study-target">
      <span>Daily target</span>
      <input type="number" min={1} max={50} step={1} value={dailyTarget}
        aria-label="Daily new cards target"
        onChange={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value)) setDailyTarget(saveNewCardQuota(value));
        }} />
      <small>1–50 new cards per day</small>
    </label>
    <div className="settings-section-heading">
      <strong>Language audio</strong>
      <span>Hear the correct word or sentence after checking or revealing an answer. Manual playback remains available.</span>
    </div>
    <label className="heuresis-study-target">
      <span>Automatic pronunciation</span>
      <input type="checkbox" checked={autoPronunciation} onChange={(event) => {
        const next = event.currentTarget.checked;
        setAutoPronunciation(next); writeAutoPronunciation(next);
      }} />
    </label>
    <VoiceSettings />
    <p className="heuresis-study-device-note">Saved on this device. Your study progress and review history are still saved in your account.</p>
  </section>;
}

export default function SettingsModal({ backgrounds, packs, collections, onDataChanged, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem("heuresis.settings.tab.v1");
      if (saved === "study" || saved === "sorting" || saved === "cards") return saved;
    } catch { /* optional */ }
    return "appearance";
  });
  useEffect(() => { try { localStorage.setItem("heuresis.settings.tab.v1", tab); } catch { /* optional */ } }, [tab]);
  const dialogRef = useDialogEscape(onClose, tab === "appearance" || tab === "study");
  return (
    <div className="modal-backdrop settings-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={dialogRef} className="settings-modal settings-modal-wide" role="dialog" aria-modal="true" aria-label="Heuresis settings">
        <header className="settings-head"><div><p className="eyebrow">PREFERENCES</p><h2>Settings</h2></div><button className="icon-button" onClick={onClose} aria-label="Close settings"><X size={17} /></button></header>
        <nav className="settings-tabs"><button aria-pressed={tab === "appearance"} onClick={() => setTab("appearance")}>Appearance</button><button aria-pressed={tab === "study"} onClick={() => setTab("study")}>Study</button><button aria-pressed={tab === "sorting"} onClick={() => setTab("sorting")}>Sorting</button><button aria-pressed={tab === "cards"} onClick={() => setTab("cards")}>Cards & directions</button></nav>
        <div className="settings-body">{tab === "appearance" ? <AppearanceSettings backgrounds={backgrounds} /> : null}{tab === "study" ? <StudySettings /> : null}{tab === "sorting" ? <SortingSettings /> : null}{tab === "cards" ? <StructureSettings packs={packs} collections={collections} onChanged={onDataChanged} /> : null}</div>
        <footer className="heuresis-build-meta" style={{ padding: "0 24px 15px", fontSize: 11, opacity: 0.65 }}>
          {buildPlatform()} · source <code title={BUILD_COMMIT}>{BUILD_COMMIT === "unknown" ? "unknown revision" : BUILD_COMMIT.slice(0, 8)}</code>
        </footer>
      </section>
    </div>
  );
}
