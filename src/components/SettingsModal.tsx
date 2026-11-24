import { activeWallpaper, PageWallpaper } from "./PageWallpaper";
import { useDialogEscape } from "../hooks/useDialogEscape";
import { useTopicBrowserOptions } from "../lib/topicBrowserPrefs";
import { ImagePlus, RotateCcw, Trash2, X, ChevronDown, Check, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type DragEvent } from "react";
import { DEFAULT_BACKGROUND_SETTINGS, PAGE_BACKGROUND_CHOICES, type BackgroundPageKey, type BackgroundSettings } from "../hooks/useHeuresisBackground";
import { dimPercent, dimToLegacySettings } from "../lib/backgroundDim";
import { BACKGROUND_PRESETS, createBackgroundPresetImage, presetSwatch, type BackgroundPreset } from "../lib/backgroundPresets";
import type { Collection, PackWithType } from "../lib/heuresis";
import { DESIGNS, PALETTES, useAppearance } from "../lib/theme";
import { useOverviewStyle } from "../lib/overviewStyle";
import { readNewCardQuota, saveNewCardQuota } from "../lib/newCardQuota";
import {
  availableSpeechVoices, readAutoPronunciation, readPreferredVoice, russianNeuralSpeechAvailable, speakReviewText,
  stopReviewAudio, writeAutoPronunciation, writePreferredVoice,
} from "../lib/reviewAudio";
import SortingSettings from "./SortingSettings";
import { SegmentedChoice } from "./SegmentedChoice";
import { useStudyMode, writeStudyMode } from "../lib/studyMode";
import CardColoursEditor from "./CardColoursEditor";
import StructureSettings from "./StructureSettings";
import { BUILD_COMMIT, buildPlatform } from "../lib/buildInfo";

type BackgroundApi = {
  imageUrl: string | null;
  hasImage: boolean;
  settings: BackgroundSettings;
  loading: boolean;
  syncing: boolean;
  syncError: string;
  updateSettings: (patch: Partial<BackgroundSettings>) => void;
  chooseImage: (file: File) => Promise<void>;
  removeImage: () => Promise<void>;
};

const SETTINGS_SECTIONS = [
  { id: "appearance", label: "Appearance" },
  { id: "backgrounds", label: "Backgrounds" },
  { id: "study", label: "Study" },
  { id: "audio", label: "Audio" },
  { id: "sorting", label: "Sorting" },
  { id: "cards", label: "Cards & directions" },
] as const;

type Tab = (typeof SETTINGS_SECTIONS)[number]["id"];
type Props = {
  backgrounds: Record<BackgroundPageKey, BackgroundApi>;
  packs: PackWithType[];
  collections: Collection[];
  onDataChanged: () => Promise<void> | void;
  onClose: () => void;
};

function AppearanceSettings() {
  const { mode, palette, design, chooseMode, choosePalette, chooseDesign } = useAppearance();
  const { style: overviewStyle, chooseStyle: chooseOverviewStyle } = useOverviewStyle();

  return <section className="appearance-settings" aria-label="Appearance preferences">
    <div className="settings-theme-head">
      <h3>Theme</h3>
      <SegmentedChoice label="Colour mode" className="appearance-mode" value={mode} onChange={chooseMode}
        options={[{ value: "system", label: "Auto" }, { value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
    </div>
    <div className="appearance-palettes" role="group" aria-label="Theme">
      {PALETTES.map((option) => <button key={option.id} className="appearance-palette" type="button"
        aria-label={option.label} aria-pressed={palette === option.id} onClick={() => choosePalette(option.id)}>
        <span className="appearance-palette-swatch" data-palette-preview={option.id} aria-hidden="true">
          <span className="appearance-palette-chrome" />
          <span className="appearance-palette-card"><i>Aa</i><b /><em /></span>
        </span>
        <strong>{option.label}{palette === option.id ? <Check size={14} aria-hidden="true" /> : null}</strong>
        <span className="appearance-palette-detail">{option.detail}</span>
      </button>)}
    </div>
    <div className="appearance-designs">
      <h3>Interface design</h3>
      <div className="appearance-design-options" role="group" aria-label="Design style">
        {DESIGNS.map((option) => <button key={option.id} className="appearance-palette appearance-design" type="button"
          aria-pressed={design === option.id} onClick={() => chooseDesign(option.id)}>
          <span className="appearance-design-preview" data-design-preview={option.id} aria-hidden="true">
            <span className="design-preview-header"><i /><b /><b /></span>
            <span className="design-preview-rail"><i /><i /><i /></span>
            <span className="design-preview-content"><strong>Aa</strong><i /><i /></span>
          </span>
          <strong>{option.label}{design === option.id ? <Check size={14} aria-hidden="true" /> : null}</strong>
          <span className="appearance-palette-detail">{option.detail}</span>
        </button>)}
      </div>
    </div>
    <div className="settings-row">
      <div className="settings-row-label"><strong>Overview layout</strong></div>
      <SegmentedChoice label="Overview layout" className="appearance-mode" value={overviewStyle} onChange={chooseOverviewStyle}
        options={[{ value: "serif", label: "Serif" }, { value: "panel", label: "Panel" }]} />
    </div>
    <details className="settings-disclosure">
      <summary>Card colours <ChevronDown size={16} aria-hidden="true" /></summary>
      <CardColoursEditor embedded />
    </details>
  </section>;
}

function backgroundError(error: unknown, fallback: string) {
  if (error && typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return fallback;
}

function BackgroundSettingsPanel({ backgrounds }: { backgrounds: Props["backgrounds"] }) {
  const [selectedPage, setSelectedPage] = useState<BackgroundPageKey>("heuresis");
  const background = backgrounds[selectedPage];
  const fileRef = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [applyingPreset, setApplyingPreset] = useState<string | null>(null);
  const busy = background.loading || background.syncing || Boolean(applyingPreset);

  async function remove() {
    setNotice(""); setError("");
    try { await background.removeImage(); setNotice("Background removed."); }
    catch (error) { setError(backgroundError(error, "Could not remove the image.")); }
  }

  async function choose(file: File | undefined) {
    if (!file || busy) return;
    setNotice(""); setError("");
    try { await background.chooseImage(file); setNotice("Background saved to your Heuresis account."); }
    catch (error) { setError(backgroundError(error, "Could not save the background.")); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  const selectedLabel = PAGE_BACKGROUND_CHOICES.find((choice) => choice.key === selectedPage)?.label ?? "This page";
  const studyWallpaper = selectedPage === "heuresis-new-cards" && activeWallpaper(backgrounds["heuresis-study"]);
  const fallback = studyWallpaper || (selectedPage !== "heuresis" ? activeWallpaper(backgrounds.heuresis) : undefined);
  const fallbackLabel = studyWallpaper ? "Study" : "All pages";
  const customWallpaper = activeWallpaper(background);
  const shownWallpaper = customWallpaper ?? fallback;
  const dim = dimPercent(background.settings.opacity, background.settings.veil);
  const looks = [
    { label: "Natural", dim: 20, blur: 0 },
    { label: "Balanced", dim: 40, blur: 0 },
    { label: "Soft", dim: 55, blur: 3 },
    { label: "Dreamy", dim: 70, blur: 7 },
  ] as const;
  async function usePreset(preset: BackgroundPreset) {
    setApplyingPreset(preset.id); setNotice(""); setError("");
    try {
      await background.chooseImage(await createBackgroundPresetImage(preset));
      setNotice(preset.label + " saved for " + selectedLabel + ".");
    } catch (error) {
      setError(backgroundError(error, "Could not save this atmosphere."));
    } finally { setApplyingPreset(null); }
  }
  function dropImage(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    void choose(event.dataTransfer.files?.[0]);
  }

  function setFocal(event: MouseEvent<HTMLButtonElement>) {
    if (!customWallpaper || busy) return;
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

  return <section className="pb-studio" aria-label="Page backgrounds">
      <div className="settings-row-label">
        <h3>Page backgrounds</h3>
        <span>Set a shared image, or choose one for an individual page.</span>
      </div>
      <div className="pb-toolbar">
        <div className="pb-page-picker">
          <label htmlFor="pb-page-select">Page</label>
          <select id="pb-page-select" value={selectedPage} disabled={background.syncing || Boolean(applyingPreset)} onChange={(event) => {
            setSelectedPage(event.target.value as BackgroundPageKey); setNotice(""); setError("");
          }}>
            {PAGE_BACKGROUND_CHOICES.map((choice) => <option key={choice.key} value={choice.key}>
              {choice.label}{backgrounds[choice.key].hasImage && choice.key !== "heuresis" ? " • customised" : ""}
            </option>)}
          </select>
          <span className="pb-page-status">
            {background.loading ? "Loading…" : customWallpaper
              ? selectedPage === "heuresis" ? "Shared background" : "Custom background"
              : fallback ? "Using " + fallbackLabel : "No background"}
          </span>
        </div>
        <div className="pb-toolbar-actions">
          <button type="button" className="pb-upload-primary" disabled={busy}
            onClick={() => fileRef.current?.click()}><ImagePlus size={16} />
            {background.syncing ? "Saving…" : background.hasImage ? "Change image" : "Upload image"}</button>
          {background.hasImage ? <button type="button" className="pb-quiet-action"
            disabled={busy} onClick={() => void remove()}
            title={fallback ? "Restore the " + fallbackLabel + " background" : "Remove background"}>
            <Trash2 size={14} /> {fallback ? "Use " + fallbackLabel : "Remove"}</button> : null}
        </div>
      </div>
      <input ref={fileRef} className="hidden-file" type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        aria-label={"Upload background image for " + selectedLabel}
        onChange={(event) => void choose(event.target.files?.[0])}/>
      <div className="pb-studio-grid">
        <div className="pb-visual">
          <div className="background-preview-live"
            onDragOver={(event) => event.preventDefault()} onDrop={dropImage}>
            <button type="button" className="background-preview-canvas"
              disabled={busy || !customWallpaper}
              aria-label={"Preview " + selectedLabel + " background"}
              onClick={setFocal}>
              <PageWallpaper wallpaper={shownWallpaper} />
              <span className="background-preview-example" aria-hidden="true">
                <small>{selectedLabel.toUpperCase()}</small>
                <strong>Ich stelle fest, dass …</strong>
                <span>To notice or establish something</span>
                <em>{selectedPage === "heuresis-new-cards" ? "Learn" : "Review · Remember"}</em>
              </span>
            </button>
            <span className="background-preview-caption">
              {customWallpaper ? "Click the preview to set the image position."
                : shownWallpaper ? "Previewing the " + fallbackLabel + " background."
                  : "Choose an atmosphere or upload an image."}
            </span>
          </div>
        </div>
        <div className="pb-customise">
          <div className="pb-presets-panel">
            <div className="pb-panel-heading"><strong>Atmospheres</strong></div>
            <div className="pb-preset-grid">
              {BACKGROUND_PRESETS.map((preset) => <button type="button" key={preset.id}
                className="pb-preset" disabled={busy}
                onClick={() => void usePreset(preset)} title={preset.description}>
                <span className="pb-preset-art" style={{ background: presetSwatch(preset) }}>
                  {applyingPreset === preset.id ? <span className="pb-preset-saving">Saving…</span> : null}
                </span>
                <span>{preset.label}</span>
              </button>)}
            </div>
          </div>
          {customWallpaper ? <fieldset className="pb-tuning" disabled={busy}>
            <legend>Image effects</legend>
            <div className="pb-look-options" role="group" aria-label="Background appearance presets">
              {looks.map((look) => <button key={look.label} type="button"
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
                  onClick={() => background.updateSettings({ ...DEFAULT_BACKGROUND_SETTINGS, enabled: true })}>
                  <RotateCcw size={14}/> Reset adjustments</button>
              </div>
            </details>
          </fieldset> : null}
        </div>
      </div>
      {error || background.syncError ? <div className="settings-note error" role="alert">{error || background.syncError}</div> : null}
      {notice ? <div className="settings-note" role="status">{notice}</div> : null}
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
      <strong>Pronunciation voice</strong>
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
      {options.map((voice) =>
        <div className="heuresis-voice-row" key={voice.id}>
          <button type="button" className="heuresis-voice-select" aria-pressed={active === voice.id}
            disabled={voice.provider === "azure" && russianNeuralReady !== true}
            onClick={() => choose(voice.id)}>
            <span className="heuresis-voice-indicator">{active === voice.id ? <Check size={13} /> : null}</span>
            <span className="heuresis-voice-description">
              <strong>{voice.name}</strong>
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
      ? <p className="heuresis-voice-footnote">Microsoft neural voices require Azure Speech setup.</p>
      : null}
    {options.length === 0
      ? <p className="heuresis-voice-alert" role="status">No alternative {current.label.toLowerCase()} voices were found. The system default may still work. Install or enable language voices in your device's text-to-speech settings, then refresh.</p>
      : null}
    {notice ? <p className="heuresis-voice-alert" role="alert">{notice}</p> : null}
    <button type="button" className="heuresis-voice-refresh" onClick={() => setRevision((value) => value + 1)}>
      <RotateCcw size={13} /> Refresh available voices
    </button>
  </div>;
}

function StudySettings() {
  const [dailyTarget, setDailyTarget] = useState<number | "">(readNewCardQuota);
  const { options: browserOptions, choose: chooseBrowserOption } = useTopicBrowserOptions();
  const studyMode = useStudyMode();

  return <section className="settings-rows" aria-label="Study preferences">
    <div className="settings-row">
      <div className="settings-row-label"><strong>Study mode</strong><span>Layout for New cards and Review.</span></div>
      <SegmentedChoice label="Study mode" className="appearance-mode" value={studyMode} onChange={writeStudyMode}
        options={[{ value: "classic", label: "Classic" }, { value: "2.1", label: "2.1" }]} />
    </div>
    <label className="settings-row">
      <span className="settings-row-label"><strong>Daily new cards</strong><span>New cards to introduce each day, from 1 to 50.</span></span>
      <input className="settings-number" type="number" min={1} max={50} step={1} value={dailyTarget}
        aria-label="Daily new cards target"
        onChange={(event) => {
          const value = event.currentTarget.valueAsNumber;
          setDailyTarget(Number.isFinite(value) ? saveNewCardQuota(value) : "");
        }}
        onBlur={() => setDailyTarget(readNewCardQuota())} />
    </label>
    <div className="settings-group">
      <h3>Topic browser</h3>
      <label className="settings-row">
        <span className="settings-row-label"><strong>Remember filters per topic</strong></span>
        <input className="settings-toggle" type="checkbox" checked={browserOptions.rememberFilters}
          onChange={(event) => chooseBrowserOption("rememberFilters", event.currentTarget.checked)} />
      </label>
      <label className="settings-row">
        <span className="settings-row-label"><strong>Multiple-card selection</strong></span>
        <input className="settings-toggle" type="checkbox" checked={browserOptions.cardManagement}
          onChange={(event) => chooseBrowserOption("cardManagement", event.currentTarget.checked)} />
      </label>
    </div>
  </section>;
}

function AudioSettings() {
  const [autoPronunciation, setAutoPronunciation] = useState(readAutoPronunciation);

  return <section className="settings-rows" aria-label="Audio preferences">
    <label className="settings-row">
      <span className="settings-row-label"><strong>Automatic pronunciation</strong>
        <span>Play the correct word or sentence after checking or revealing an answer.</span>
      </span>
      <input className="settings-toggle" type="checkbox" checked={autoPronunciation} onChange={(event) => {
        const next = event.currentTarget.checked;
        setAutoPronunciation(next);
        writeAutoPronunciation(next);
      }} />
    </label>
    <VoiceSettings />
  </section>;
}

export default function SettingsModal({ backgrounds, packs, collections, onDataChanged, onClose }: Props) {
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem("heuresis.settings.tab.v1");
      return SETTINGS_SECTIONS.find((item) => item.id === saved)?.id ?? "appearance";
    } catch { /* optional */ }
    return "appearance";
  });
  useEffect(() => { try { localStorage.setItem("heuresis.settings.tab.v1", tab); } catch { /* optional */ } }, [tab]);
  const dialogRef = useDialogEscape(onClose, tab !== "cards" && tab !== "sorting");
  return (
    <div className="modal-backdrop settings-layer" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section ref={dialogRef} className="settings-modal settings-modal-wide" role="dialog" aria-modal="true" aria-label="Heuresis settings">
        <header className="settings-head"><h2>Settings</h2><button type="button" className="icon-button" autoFocus onClick={onClose} aria-label="Close settings"><X size={19} /></button></header>
        <nav className="settings-tabs" aria-label="Settings sections">
          {SETTINGS_SECTIONS.map((item) => <button key={item.id} type="button" aria-pressed={tab === item.id}
            onClick={() => setTab(item.id)}>{item.label}</button>)}
        </nav>
        <div key={tab} className="settings-body">
          {tab === "appearance" ? <AppearanceSettings /> : null}
          {tab === "backgrounds" ? <BackgroundSettingsPanel backgrounds={backgrounds} /> : null}
          {tab === "study" ? <StudySettings /> : null}
          {tab === "audio" ? <AudioSettings /> : null}
          {tab === "sorting" ? <SortingSettings /> : null}
          {tab === "cards" ? <StructureSettings packs={packs} collections={collections} onChanged={onDataChanged} /> : null}
        </div>
        <footer className="heuresis-build-meta">
          {buildPlatform()} · source <code title={BUILD_COMMIT}>{BUILD_COMMIT === "unknown" ? "unknown revision" : BUILD_COMMIT.slice(0, 8)}</code>
        </footer>
      </section>
    </div>
  );
}
