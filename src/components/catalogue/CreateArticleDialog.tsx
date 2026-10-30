import { useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, FileUp, NotebookPen, Search } from "lucide-react";
import { entryTitle, isDocument, normaliseSearch as normaliseNoteSearch, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { illustratedLayout } from "../../lib/catalogue/compositions";
import { noteToBlocks, type ConversionReport } from "../../lib/catalogue/convert";
import { importDocx } from "../../lib/catalogue/docx";
import { uploadCatalogueImage } from "../../lib/catalogue/media";
import { blankArticle, newPage, type ArticlePage, type Block, type CatalogueArticle, type ImageRef } from "../../lib/catalogue/model";
import { catalogueError } from "../../lib/catalogue/store";
import { relativeTime } from "../workspace/ui";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { useCatalogue } from "./CatalogueData";
import { setDesignerNotice } from "./notices";
import { Dialog, Field, Segmented } from "./parts";
import { flowOverflow } from "./stage";

type Step = "choose" | "notebook";
type Layout = "illustrated" | "text";
const LAYOUT_KEY = "heuresis.catalogue.layout.v1";

export function imageRefFrom(stored: { path: string; width: number; height: number; mime: string }, alt = "", attribution: ImageRef["attribution"] = null): ImageRef {
  return { ...stored, alt, aspect: "original", fit: "fill", zoom: 1, focalX: 0.5, focalY: 0.5, attribution };
}

export function CreateArticleDialog({ onClose, defaultSubjectId = null, defaultVolumeId = null }: { onClose: () => void; defaultSubjectId?: string | null; defaultVolumeId?: string | null }) {
  const catalogue = useCatalogue();
  const workspace = useWorkspace();
  const [step, setStep] = useState<Step>("choose");
  const [subjectId, setSubjectId] = useState<string>(defaultSubjectId ?? (defaultVolumeId ? catalogue.volumeById.get(defaultVolumeId)?.subject_id ?? "" : ""));
  const [volumeId, setVolumeId] = useState<string>(defaultVolumeId ?? "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [layout, setLayoutState] = useState<Layout>(() => {
    try { return localStorage.getItem(LAYOUT_KEY) === "text" ? "text" : "illustrated"; } catch { return "illustrated"; }
  });
  const setLayout = (value: Layout) => { setLayoutState(value); try { localStorage.setItem(LAYOUT_KEY, value); } catch { /* optional */ } };
  const fileInput = useRef<HTMLInputElement>(null);
  const volumes = catalogue.snapshot.volumes.filter((volume) => (subjectId ? volume.subject_id === subjectId : true));

  const notes = useMemo(() => workspace.snapshot.entries
    .filter((entry) => isDocument(entry) && (entry.title.trim() || entry.body.trim()))
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at)), [workspace.snapshot.entries]);
  const search = normaliseNoteSearch(query);
  const shownNotes = useMemo(() => (search ? notes.filter((entry) => normaliseNoteSearch(`${entryTitle(entry)} ${workspace.pathLabel(entry.topic_id)} ${entry.description}`).includes(search)
    || normaliseNoteSearch(entry.body.slice(0, 4000)).includes(search)) : notes).slice(0, 200), [notes, search, workspace]);

  function base(title = ""): CatalogueArticle {
    const volume = volumeId ? catalogue.volumeById.get(volumeId) : null;
    const article = blankArticle(catalogue.userId, { title, subject_id: (volume?.subject_id ?? subjectId) || null, volume_id: volume?.id ?? null });
    if (volume) article.volume_order = catalogue.snapshot.articles.filter((row) => row.volume_id === volume.id)
      .reduce((highest, row) => Math.max(highest, row.volume_order + 1), 0);
    return article;
  }

  /** The converted blocks as pages: as they are, or arranged as an illustrated article. */
  function arrange(blocks: Block[]): { pages: ArticlePage[]; notice: string[] } {
    if (layout === "text") return { pages: [newPage(blocks)], notice: [] };
    const { cover, body, frames } = illustratedLayout(blocks);
    return {
      pages: [newPage([cover]), newPage(body)],
      notice: [`Illustrated layout: a cover and ${frames - 1 === 0 ? "no further picture frames" : frames - 1 === 1 ? "one picture frame" : `${frames - 1} picture frames`} where the text breaks naturally. Click a frame to choose a picture from your files or Wikimedia Commons. Empty frames are left out when reading and in the PDF.`],
    };
  }

  async function finish(article: CatalogueArticle, notice?: string[]) {
    setBusy("Laying out the pages…");
    const flowed = await flowOverflow(article).catch(() => null);
    const ready = flowed?.changed ? { ...article, pages: flowed.pages } : article;
    setBusy("Saving the draft…");
    const created = await catalogue.addArticle(ready);
    if (notice?.length) setDesignerNotice(created.id, notice);
    onClose();
    catalogue.navigate({ view: "design", id: created.id, from: catalogue.route.view === "volume" ? catalogue.route : { view: "library" } });
  }

  async function run(job: () => Promise<void>) {
    if (busy) return;
    setError("");
    try { await job(); }
    catch (cause) { setError(catalogueError(cause)); }
    finally { setBusy(""); }
  }

  const fromNote = (entry: KnowledgeEntry) => run(async () => {
    setBusy("Copying the note…");
    const title = entryTitle(entry);
    const report: ConversionReport = { skippedHandwriting: 0 };
    const { blocks, subtitle } = noteToBlocks(title, entry.description ?? "", entry.body, report);
    const arranged = arrange(blocks);
    const article: CatalogueArticle = {
      ...base(title), subtitle: subtitle.slice(0, 300), pages: arranged.pages,
      source_kind: "notebook", source_note_id: entry.id, source_label: `${workspace.pathLabel(entry.topic_id)} › ${title}`.slice(0, 300),
    };
    const notice = [`A copy of the note “${title}”. The note itself is unchanged, and later edits to it do not change this article.`, ...arranged.notice];
    if (report.skippedHandwriting) notice.push(`${report.skippedHandwriting} handwritten sketch${report.skippedHandwriting === 1 ? " was" : "es were"} not copied; add them as images if needed.`);
    await finish(article, notice);
  });

  const blank = () => run(async () => {
    setBusy("Creating the article…");
    await finish(base());
  });

  const fromDocx = (file: File) => run(async () => {
    setBusy("Reading the document…");
    const imported = await importDocx(file);
    const article: CatalogueArticle = {
      ...base(imported.title || file.name.replace(/\.docx$/i, "")), subtitle: imported.subtitle.slice(0, 300),
      pages: [newPage(imported.blocks)], source_kind: "docx", source_label: file.name.slice(0, 300),
    };
    const warnings = [...imported.warnings];
    let placed = 0;
    for (const image of imported.images) {
      const block = imported.imageKeys.get(image.key);
      if (!block) continue;
      if (!/^image\/(png|jpe?g|gif|webp)$/i.test(image.contentType)) continue;
      setBusy(`Adding images (${placed + 1} of ${imported.imageKeys.size})…`);
      try {
        const stored = await uploadCatalogueImage(catalogue.userId, new Blob([image.bytes], { type: image.contentType === "image/jpg" ? "image/jpeg" : image.contentType }));
        block.image = imageRefFrom(stored, image.alt, { provider: "docx", title: file.name });
        placed += 1;
      } catch (cause) {
        warnings.push(`An image could not be added: ${catalogueError(cause)}`);
      }
    }
    // Image blocks whose picture could not be placed are removed rather than left empty.
    const arranged = arrange(article.pages.flatMap((page) => page.blocks).filter((block) => block.type !== "image" || block.image));
    article.pages = arranged.pages;
    await finish(article, [`Imported from ${file.name}.`, ...warnings, ...arranged.notice]);
  });

  const placement = <div className="ct-placement">
    <Field label="Subject">
      <select value={subjectId} onChange={(event) => { setSubjectId(event.target.value); setVolumeId(""); }}>
        <option value="">None for now</option>
        {catalogue.snapshot.subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
      </select>
    </Field>
    <Field label="Volume">
      <select value={volumeId} onChange={(event) => setVolumeId(event.target.value)} disabled={!volumes.length}>
        <option value="">{volumes.length ? "Not in a volume" : "No volumes"}</option>
        {volumes.map((volume) => <option key={volume.id} value={volume.id}>{volume.title}{volume.edition ? ` — ${volume.edition}` : ""}</option>)}
      </select>
    </Field>
  </div>;

  return <Dialog title={step === "notebook" ? "From Notebook" : "Create Article"} onClose={() => { if (!busy) onClose(); }} wide label="Create article">
    {busy ? <div className="ct-busy" role="status"><span className="ws-spinner" /> {busy}</div> : step === "choose" ? <>
      <div className="ct-choices">
        <button type="button" className="ct-choice" onClick={() => setStep("notebook")}>
          <NotebookPen size={22} strokeWidth={1.4} /><strong>From Notebook</strong><span>Copy a note into a new draft. The note stays as it is.</span>
        </button>
        <button type="button" className="ct-choice" onClick={() => void blank()}>
          <FileText size={22} strokeWidth={1.4} /><strong>Blank Article</strong><span>An empty A4 page with a title.</span>
        </button>
        <button type="button" className="ct-choice" onClick={() => fileInput.current?.click()}>
          <FileUp size={22} strokeWidth={1.4} /><strong>Import DOCX</strong><span>Headings, lists, emphasis, quotations and pictures from Word.</span>
        </button>
        <input ref={fileInput} type="file" hidden accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          aria-label="Word document to import"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void fromDocx(file); }} />
      </div>
      <div className="ct-layout-choice">
        <Segmented label="Layout of a converted note or document" value={layout} onChange={setLayout}
          options={[{ value: "illustrated", label: "Illustrated" }, { value: "text", label: "Text only" }]} />
        <p className="ct-quiet">{layout === "illustrated"
          ? "A cover, a drop initial and picture frames placed where the text breaks naturally. You choose every picture."
          : "The text as it is, on as many pages as it needs."}</p>
      </div>
      {placement}
    </> : <div className="ct-note-picker">
      <div className="ct-note-search">
        <button type="button" className="ws-icon-button" aria-label="Back to the choices" onClick={() => setStep("choose")}><ArrowLeft size={16} /></button>
        <label className="ct-search"><Search size={15} aria-hidden="true" />
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a note" aria-label="Find a note" /></label>
      </div>
      {workspace.loading && !notes.length ? <p className="ct-quiet">Opening your Notebook…</p>
        : !notes.length ? <p className="ct-quiet">Your Notebook has no notes yet.</p>
          : <ul className="ct-note-list" aria-label="Notes">
            {shownNotes.map((entry) => <li key={entry.id}><button type="button" onClick={() => void fromNote(entry)}>
              <strong>{entryTitle(entry)}</strong>
              <small>{workspace.pathLabel(entry.topic_id)} · {relativeTime(entry.updated_at)}{entry.category === "reference" ? " · Reference" : ""}</small>
            </button></li>)}
            {!shownNotes.length ? <li className="ct-quiet">No note matches.</li> : null}
          </ul>}
      {placement}
    </div>}
    {error ? <p className="ct-error" role="alert">{error}</p> : null}
  </Dialog>;
}
