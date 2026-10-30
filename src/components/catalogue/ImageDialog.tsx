import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ArrowLeft, ExternalLink, ImageUp, Search } from "lucide-react";
import { aspectValue, frameGeometry } from "../../lib/catalogue/crop";
import { uploadCatalogueImage, useCatalogueImage } from "../../lib/catalogue/media";
import { ASPECTS, type AspectChoice, type Attribution, type ImageRef } from "../../lib/catalogue/model";
import { catalogueError } from "../../lib/catalogue/store";
import { downloadCommonsImage, searchCommons, type CommonsResult } from "../../lib/catalogue/wikimedia";
import { ImageFrame } from "./ArticlePage";
import { useCatalogue } from "./CatalogueData";
import { imageRefFrom } from "./CreateArticleDialog";
import { Dialog, Field, Segmented } from "./parts";

type Props = {
  initial: ImageRef | null;
  /** A fixed frame proportion (covers); hides the proportion choice. */
  lockedAspect?: number;
  /** The proportion a page layout proposed for this frame, used for a new picture. */
  defaultAspect?: AspectChoice;
  caption?: string;
  showCaption?: boolean;
  title?: string;
  onApply: (image: ImageRef, caption?: string) => void;
  onClose: () => void;
};

const ASPECT_LABELS: Record<AspectChoice, string> = { original: "Original", "3:2": "3:2", "4:3": "4:3", "1:1": "Square", "4:5": "4:5", "2:3": "2:3", "16:9": "16:9" };

function CropEditor({ image, aspect, onChange }: { image: ImageRef; aspect: number; onChange: (patch: Partial<ImageRef>) => void }) {
  const { url } = useCatalogueImage(image.path);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; fx: number; fy: number } | null>(null);
  const geometry = frameGeometry(image, aspect);
  const view = { x: -geometry.left / geometry.width, y: -geometry.top / geometry.height, w: 100 / geometry.width, h: 100 / geometry.height };
  const ratio = image.width / image.height;
  const down = (event: ReactPointerEvent) => {
    if (image.fit === "fit") return;
    const rect = box.current?.getBoundingClientRect();
    if (!rect) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    let centre = { fx: view.x + view.w / 2, fy: view.y + view.h / 2 };
    // A press outside the visible window moves the window there first.
    if (!(event.target as HTMLElement).closest(".ct-crop-window")) {
      centre = { fx: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)), fy: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) };
      onChange({ focalX: centre.fx, focalY: centre.fy });
    }
    drag.current = { x: event.clientX, y: event.clientY, ...centre };
  };
  const move = (event: ReactPointerEvent) => {
    const start = drag.current;
    const rect = box.current?.getBoundingClientRect();
    if (!start || !rect) return;
    const dx = (event.clientX - start.x) / rect.width;
    const dy = (event.clientY - start.y) / rect.height;
    onChange({ focalX: Math.min(1, Math.max(0, start.fx + dx)), focalY: Math.min(1, Math.max(0, start.fy + dy)) });
  };
  return <div className="ct-crop-stage">
    <div ref={box} className={`ct-crop-image ${image.fit === "fit" ? "is-fit" : ""}`} style={{ aspectRatio: String(ratio), width: `min(100%, 560px, ${(44 * ratio).toFixed(2)}vh)` }}
      onPointerDown={down} onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 0.05 : 0.01;
        const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
        const delta = moves[event.key];
        if (!delta || image.fit === "fit") return;
        event.preventDefault();
        onChange({ focalX: Math.min(1, Math.max(0, view.x + view.w / 2 + delta[0])), focalY: Math.min(1, Math.max(0, view.y + view.h / 2 + delta[1])) });
      }}
      tabIndex={0} role="application" aria-label="Visible part of the image. Drag the frame or use the arrow keys to choose what is shown.">
      {url ? <img src={url} alt="" draggable={false} /> : <span className="ct-quiet">Loading image…</span>}
      {image.fit === "fill" ? <div className="ct-crop-window" style={{ left: `${view.x * 100}%`, top: `${view.y * 100}%`, width: `${view.w * 100}%`, height: `${view.h * 100}%` }} /> : null}
    </div>
  </div>;
}

export function ImageDialog({ initial, lockedAspect, defaultAspect, caption = "", showCaption = false, title, onApply, onClose }: Props) {
  const catalogue = useCatalogue();
  const [step, setStep] = useState<"source" | "adjust">(initial ? "adjust" : "source");
  const [tab, setTab] = useState<"upload" | "search">("upload");
  const [image, setImage] = useState<ImageRef | null>(initial);
  const [text, setText] = useState(caption);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CommonsResult[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [chosen, setChosen] = useState<CommonsResult | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchAbort = useRef<AbortController | null>(null);
  useEffect(() => () => searchAbort.current?.abort(), []);

  const patch = (value: Partial<ImageRef>) => setImage((current) => current ? { ...current, ...value } : current);
  const aspect = lockedAspect ?? (image ? aspectValue(image.aspect, image) : 1.5);

  async function upload(file: File) {
    setError(""); setBusy("Uploading the image…");
    try {
      const stored = await uploadCatalogueImage(catalogue.userId, file);
      setImage({ ...imageRefFrom(stored, file.name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ").slice(0, 120), { provider: "upload" }), aspect: defaultAspect ?? "original" });
      setStep("adjust");
    } catch (cause) { setError(catalogueError(cause)); }
    finally { setBusy(""); }
  }

  async function runSearch(offset = 0) {
    if (!query.trim()) return;
    searchAbort.current?.abort();
    const controller = new AbortController();
    searchAbort.current = controller;
    setError(""); setBusy(offset ? "" : "Searching Wikimedia Commons…");
    try {
      const found = await searchCommons(query, offset, controller.signal);
      setResults((current) => offset && current ? [...current, ...found.results] : found.results);
      setNextOffset(found.nextOffset);
      if (!offset) setChosen(null);
    } catch (cause) {
      if ((cause as Error)?.name !== "AbortError") setError(cause instanceof Error ? cause.message : String(cause));
    } finally { setBusy(""); }
  }

  async function useResult(result: CommonsResult) {
    setError(""); setBusy("Downloading the image from Wikimedia Commons…");
    try {
      const blob = await downloadCommonsImage(result);
      setBusy("Saving a copy to your Catalogue…");
      const stored = await uploadCatalogueImage(catalogue.userId, blob);
      setImage({ ...imageRefFrom(stored, result.description || result.title, result.attribution), aspect: defaultAspect ?? "original" });
      if (showCaption && !text.trim()) setText(result.title);
      setStep("adjust");
    } catch (cause) { setError(catalogueError(cause)); }
    finally { setBusy(""); }
  }

  const attribution = image?.attribution ?? null;
  const setAttribution = (value: Partial<Attribution>) => patch({ attribution: { provider: attribution?.provider ?? "upload", ...attribution, ...value } });

  return <Dialog title={title ?? (step === "adjust" ? "Image" : "Add Image")} onClose={() => { if (!busy) onClose(); }} wide="xl" label="Image"
    actions={step === "adjust" && image ? <>
      {!initial || initial.path !== image.path ? <button type="button" className="ws-button is-quiet ct-actions-left" onClick={() => { setStep("source"); }}><ArrowLeft size={14} /> Choose another</button>
        : <button type="button" className="ws-button is-quiet ct-actions-left" onClick={() => { setStep("source"); }}>Replace image</button>}
      <button type="button" className="ws-button" onClick={onClose}>Cancel</button>
      <button type="button" className="ws-button is-primary" onClick={() => onApply(image, showCaption ? text : undefined)}>{initial ? "Apply" : "Insert"}</button>
    </> : undefined}>
    {busy ? <div className="ct-busy" role="status"><span className="ws-spinner" /> {busy}</div> : null}
    {step === "source" && !busy ? <>
      <Segmented label="Image source" value={tab} onChange={setTab} options={[{ value: "upload", label: "Upload image" }, { value: "search", label: "Search images" }]} />
      {tab === "upload" ? <div className={`ct-dropzone ${dragging ? "is-over" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)}
        onDrop={(event) => { event.preventDefault(); setDragging(false); const file = event.dataTransfer.files?.[0]; if (file) void upload(file); }}>
        <ImageUp size={26} strokeWidth={1.3} />
        <p>Drop an image here, or</p>
        <button type="button" className="ws-button is-primary" onClick={() => fileInput.current?.click()}>Choose a file</button>
        <small>JPEG, PNG, WebP, GIF or AVIF · up to 20 MB</small>
        <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden aria-label="Image file"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      </div> : <div className="ct-commons">
        <form className="ct-commons-search" onSubmit={(event) => { event.preventDefault(); void runSearch(); }}>
          <label className="ct-search"><Search size={15} aria-hidden="true" />
            <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Teutoburg Forest, Magna Carta, Baltic coast…" aria-label="Search Wikimedia Commons" /></label>
          <button type="submit" className="ws-button is-primary" disabled={!query.trim()}>Search</button>
        </form>
        <p className="ct-quiet ct-commons-note">Openly licensed images from Wikimedia Commons. The licence and author are kept with the image and can be printed under it.</p>
        {chosen ? <div className="ct-commons-chosen">
          <img src={chosen.thumbUrl} alt="" />
          <div>
            <h3>{chosen.title}</h3>
            {chosen.description ? <p>{chosen.description}</p> : null}
            <dl>
              <dt>Author</dt><dd>{chosen.attribution.author || "Not stated"}</dd>
              <dt>Licence</dt><dd>{chosen.attribution.licenceUrl ? <a href={chosen.attribution.licenceUrl} target="_blank" rel="noreferrer">{chosen.attribution.licence}</a> : chosen.attribution.licence}</dd>
              <dt>Size</dt><dd>{chosen.width} × {chosen.height} px</dd>
            </dl>
            <div className="ct-row">
              <button type="button" className="ws-button" onClick={() => setChosen(null)}><ArrowLeft size={14} /> Results</button>
              <a className="ws-button" href={chosen.pageUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Source page</a>
              <button type="button" className="ws-button is-primary" onClick={() => void useResult(chosen)}>Use this image</button>
            </div>
          </div>
        </div> : results ? results.length ? <>
          <ul className="ct-commons-grid" aria-label="Search results">
            {results.map((result) => <li key={result.pageUrl}><button type="button" onClick={() => setChosen(result)} title={result.title}>
              <img src={result.thumbUrl} alt={result.title} loading="lazy" />
              <span><strong>{result.title}</strong><small>{result.attribution.licence}{result.attribution.author ? ` · ${result.attribution.author}` : ""}</small></span>
            </button></li>)}
          </ul>
          {nextOffset !== null ? <button type="button" className="ws-button ct-more" onClick={() => void runSearch(nextOffset)}>More results</button> : null}
        </> : <p className="ct-quiet">No openly licensed images found. Try other words.</p> : null}
      </div>}
    </> : null}
    {step === "adjust" && image && !busy ? <div className="ct-adjust">
      <div className="ct-adjust-main">
        <CropEditor image={image} aspect={aspect} onChange={patch} />
        <div className="ct-adjust-controls">
          {!lockedAspect ? <Field label="Proportion">
            <div className="ct-chips" role="radiogroup" aria-label="Proportion">
              {ASPECTS.map((choice) => <button key={choice} type="button" role="radio" aria-checked={image.aspect === choice}
                className={image.aspect === choice ? "is-on" : ""} onClick={() => patch({ aspect: choice })}>{ASPECT_LABELS[choice]}</button>)}
            </div>
          </Field> : null}
          <Field label="Framing">
            <Segmented label="Framing" value={image.fit} onChange={(fit) => patch({ fit })} options={[
              { value: "fill", label: "Fill the frame" }, { value: "fit", label: "Show whole image" },
            ]} />
          </Field>
          <Field label={`Zoom · ${Math.round(image.zoom * 100)}%`}>
            <input type="range" min={1} max={4} step={0.01} value={image.zoom} disabled={image.fit === "fit"}
              aria-label="Zoom" onChange={(event) => patch({ zoom: Number(event.target.value) })} />
          </Field>
          <button type="button" className="ws-button is-small" onClick={() => patch({ zoom: 1, focalX: 0.5, focalY: 0.5 })}>Reset crop</button>
        </div>
      </div>
      <div className="ct-adjust-side">
        <div className={`ct-adjust-preview ap-colour-warm`}><ImageFrame image={image} aspect={aspect} /></div>
        {showCaption ? <Field label="Caption"><textarea rows={2} maxLength={600} value={text} onChange={(event) => setText(event.target.value)} placeholder="Shown under the image" /></Field> : null}
        <Field label="Description" hint="Read aloud by screen readers; not printed."><input maxLength={300} value={image.alt} onChange={(event) => patch({ alt: event.target.value })} /></Field>
        <fieldset className="ct-attribution">
          <legend>Credit</legend>
          <Field label="Author"><input maxLength={200} value={attribution?.author ?? ""} onChange={(event) => setAttribution({ author: event.target.value || undefined })} placeholder="Photographer or artist" /></Field>
          <Field label="Licence"><input maxLength={120} value={attribution?.licence ?? ""} onChange={(event) => setAttribution({ licence: event.target.value || undefined })} placeholder="e.g. CC BY-SA 4.0, Public domain" /></Field>
          {attribution?.sourceUrl ? <a className="ct-link" href={attribution.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Source</a> : null}
        </fieldset>
      </div>
    </div> : null}
    {error ? <p className="ct-error" role="alert">{error}</p> : null}
  </Dialog>;
}
