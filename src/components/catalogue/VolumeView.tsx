import { useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, BookOpen, FileDown, ImagePlus, ListPlus, Pencil, Plus, Trash2, X } from "lucide-react";
import { articleExcerpt, articleTitle, roman, volumeArticles, type CatalogueArticle, type CatalogueVolume, type ImageRef } from "../../lib/catalogue/model";
import { catalogueError } from "../../lib/catalogue/store";
import { useConfirm } from "../workspace/ui";
import { useWorkspace } from "../workspace/WorkspaceContext";
import { ImageFrame } from "./ArticlePage";
import { useCatalogue } from "./CatalogueData";
import { CreateArticleDialog } from "./CreateArticleDialog";
import { ExportDialog } from "./ExportDialog";
import { ImageDialog } from "./ImageDialog";
import { Dialog, Field, Menu, formatDate } from "./parts";

const VOLUME_COVER_ASPECT = 1 / 1.414;

export function VolumeDialog({ volume, subjectId, onClose, onSaved }: {
  volume: CatalogueVolume | null; subjectId: string | null; onClose: () => void; onSaved?: (volume: CatalogueVolume, created: boolean) => void;
}) {
  const catalogue = useCatalogue();
  const sameSubject = catalogue.snapshot.volumes.filter((row) => row.subject_id === (volume?.subject_id ?? subjectId)).length;
  const [title, setTitle] = useState(volume?.title ?? "");
  const [subtitle, setSubtitle] = useState(volume?.subtitle ?? "");
  const [edition, setEdition] = useState(volume?.edition ?? `Volume ${roman(sameSubject + 1)}`);
  const [date, setDate] = useState(volume?.edition_date ?? "");
  const [subject, setSubject] = useState(volume?.subject_id ?? subjectId ?? "");
  const [cover, setCover] = useState<ImageRef | null>(volume?.cover ?? null);
  const [choosing, setChoosing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const input = { title, subtitle, edition, edition_date: date || null, subject_id: subject || null, cover };
      const saved = volume ? await catalogue.changeVolume(volume, input) : await catalogue.addVolume(input);
      onSaved?.(saved, !volume);
      onClose();
    } catch (cause) { setError(catalogueError(cause)); }
    finally { setBusy(false); }
  }
  return <Dialog title={volume ? "Edit volume" : "New volume"} onClose={onClose} wide
    actions={<><button type="button" className="ws-button" onClick={onClose}>Cancel</button>
      <button type="button" className="ws-button is-primary" disabled={!title.trim() || busy} onClick={() => void save()}>{volume ? "Save" : "Create volume"}</button></>}>
    {choosing ? <ImageDialog initial={cover} lockedAspect={VOLUME_COVER_ASPECT} title="Volume cover" onClose={() => setChoosing(false)} onApply={(image) => { setCover(image); setChoosing(false); }} /> : null}
    <form className="ct-volume-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <div className="ct-volume-form-fields">
        <Field label="Title"><input autoFocus maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Empires and Kingdoms" /></Field>
        <Field label="Subtitle"><input maxLength={300} value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="Optional" /></Field>
        <div className="ct-row ct-row-fields">
          <Field label="Edition"><input maxLength={80} value={edition} onChange={(event) => setEdition(event.target.value)} placeholder="Volume I" /></Field>
          <Field label="Date"><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></Field>
        </div>
        <Field label="Subject">
          <select value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="">None</option>
            {catalogue.snapshot.subjects.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
          </select>
        </Field>
      </div>
      <div className="ct-volume-form-cover">
        <span className="ct-field-label">Cover</span>
        <button type="button" className="ct-volume-cover-pick" onClick={() => setChoosing(true)} aria-label={cover ? "Change cover image" : "Choose cover image"}>
          {cover ? <ImageFrame image={cover} aspect={VOLUME_COVER_ASPECT} /> : <span><ImagePlus size={20} strokeWidth={1.4} /> Cover image</span>}
        </button>
        {cover ? <button type="button" className="ws-button is-small is-quiet" onClick={() => setCover(null)}><X size={13} /> Remove</button> : null}
      </div>
    </form>
    {error ? <p className="ct-error" role="alert">{error}</p> : null}
  </Dialog>;
}

function AddExistingDialog({ volume, onClose }: { volume: CatalogueVolume; onClose: () => void }) {
  const catalogue = useCatalogue();
  const workspace = useWorkspace();
  const candidates = catalogue.snapshot.articles.filter((article) => article.volume_id !== volume.id);
  // Added articles go to the end of the table of contents.
  const nextOrder = catalogue.snapshot.articles.filter((article) => article.volume_id === volume.id)
    .reduce((highest, article) => Math.max(highest, article.volume_order + 1), 0);
  return <Dialog title="Add an article to this volume" onClose={onClose} wide>
    {candidates.length ? <ul className="ct-note-list">{candidates.map((article) => <li key={article.id}><button type="button" onClick={() => {
      void catalogue.patchArticle(article, { volume_id: volume.id, subject_id: volume.subject_id ?? article.subject_id, volume_order: nextOrder })
        .then(() => { workspace.toast(`“${articleTitle(article)}” added to ${volume.title}.`); onClose(); })
        .catch((cause) => workspace.toast(catalogueError(cause), { tone: "error" }));
    }}><strong>{articleTitle(article)}</strong><small>{article.status === "draft" ? "Draft · " : ""}{article.volume_id ? `In ${catalogue.volumeById.get(article.volume_id)?.title ?? "another volume"}` : "Not in a volume"}</small></button></li>)}</ul>
      : <p className="ct-quiet">Every article is already in this volume.</p>}
  </Dialog>;
}

export function VolumeView({ volumeId }: { volumeId: string }) {
  const catalogue = useCatalogue();
  const workspace = useWorkspace();
  const volume = catalogue.volumeById.get(volumeId) ?? null;
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [confirmElement, confirm] = useConfirm();
  if (!volume) return <div className="ct-volume"><p className="ct-quiet">This volume no longer exists.</p>
    <button type="button" className="ws-button" onClick={() => catalogue.navigate({ view: "library" })}>Back to Catalogue</button></div>;
  const articles = volumeArticles(catalogue.snapshot.articles, volume.id);
  const published = articles.filter((article) => article.status === "published");
  const subject = volume.subject_id ? catalogue.subjectById.get(volume.subject_id) : null;
  const from = { view: "volume", id: volume.id } as const;

  async function reorder(article: CatalogueArticle, delta: -1 | 1) {
    const index = articles.findIndex((row) => row.id === article.id);
    const other = articles[index + delta];
    if (!other) return;
    try {
      // Normalise every position so equal or missing orders cannot get stuck.
      const ordered = [...articles];
      [ordered[index], ordered[index + delta]] = [ordered[index + delta], ordered[index]];
      for (let position = 0; position < ordered.length; position += 1) {
        if (ordered[position].volume_order !== position) await catalogue.patchArticle(ordered[position], { volume_order: position });
      }
    } catch (cause) { workspace.toast(catalogueError(cause), { tone: "error" }); }
  }
  async function removeVolume() {
    if (!volume) return;
    if (!await confirm({ title: `Delete the volume “${volume.title}”?`, confirmLabel: "Delete volume", danger: true,
      body: "Its articles are kept and stay in their subject; only the volume and its table of contents are removed." })) return;
    try { await catalogue.removeVolume(volume.id); catalogue.navigate({ view: "library" }); workspace.toast("Volume deleted. Its articles are kept."); }
    catch (cause) { workspace.toast(catalogueError(cause), { tone: "error" }); }
  }

  return <div className="ct-volume">
    {confirmElement}
    {editing ? <VolumeDialog volume={volume} subjectId={volume.subject_id} onClose={() => setEditing(false)} /> : null}
    {creating ? <CreateArticleDialog onClose={() => setCreating(false)} defaultVolumeId={volume.id} /> : null}
    {adding ? <AddExistingDialog volume={volume} onClose={() => setAdding(false)} /> : null}
    {exporting ? <ExportDialog articles={published} volume={volume} title={[volume.title, volume.edition].filter(Boolean).join(" — ")} onClose={() => setExporting(false)} /> : null}
    <nav className="ct-crumbs"><button type="button" onClick={() => catalogue.navigate({ view: "library" })}><ArrowLeft size={15} /> Catalogue</button></nav>
    <header className="ct-volume-head">
      <div className="ct-volume-cover is-large">
        {volume.cover ? <span className="ct-volume-image"><ImageFrame image={volume.cover} aspect={VOLUME_COVER_ASPECT} /></span> : null}
        <span className="ct-volume-plate"><small>{subject?.name ?? "Volume"}</small><strong>{volume.title}</strong>{volume.edition ? <em>{volume.edition}</em> : null}</span>
      </div>
      <div className="ct-volume-intro">
        <span className="ct-kicker">{[subject?.name, volume.edition].filter(Boolean).join(" · ") || "Volume"}</span>
        <h1>{volume.title}</h1>
        {volume.subtitle ? <p className="ct-volume-subtitle">{volume.subtitle}</p> : null}
        {volume.edition_date ? <p className="ct-volume-date">{formatDate(volume.edition_date)}</p> : null}
        <div className="ct-row ct-volume-actions">
          {published.length ? <button type="button" className="ws-button is-primary" onClick={() => catalogue.navigate({ view: "read", id: published[0].id, from })}><BookOpen size={15} /> Read</button> : null}
          {published.length ? <button type="button" className="ws-button" onClick={() => setExporting(true)}><FileDown size={15} /> Export volume PDF</button> : null}
          <Menu label="Volume actions" items={[
            { label: "New article in this volume", icon: <Plus size={14} />, run: () => setCreating(true) },
            { label: "Add an existing article", icon: <ListPlus size={14} />, run: () => setAdding(true) },
            { label: "Edit volume", icon: <Pencil size={14} />, run: () => setEditing(true) },
            "divider",
            { label: "Delete volume", icon: <Trash2 size={14} />, danger: true, run: () => void removeVolume() },
          ]} />
        </div>
      </div>
    </header>
    <section className="ct-toc" aria-label="Contents">
      <h2>Contents</h2>
      {articles.length ? <ol>
        {articles.map((article, index) => <li key={article.id} className={article.status === "draft" ? "is-draft" : ""}>
          <span className="ct-toc-number">{roman(index + 1)}</span>
          <button type="button" className="ct-toc-entry" onClick={() => catalogue.navigate(article.status === "published" ? { view: "read", id: article.id, from } : { view: "design", id: article.id, from })}>
            <strong>{articleTitle(article)}</strong>
            {article.subtitle || articleExcerpt(article, 120) ? <span>{article.subtitle || articleExcerpt(article, 120)}</span> : null}
          </button>
          <span className="ct-toc-meta">{article.status === "draft" ? <em>Draft</em> : null}{article.pages.length} {article.pages.length === 1 ? "page" : "pages"}</span>
          <span className="ct-toc-order">
            <button type="button" className="ws-icon-button" aria-label={`Move ${articleTitle(article)} up`} disabled={index === 0} onClick={() => void reorder(article, -1)}><ArrowUp size={14} /></button>
            <button type="button" className="ws-icon-button" aria-label={`Move ${articleTitle(article)} down`} disabled={index === articles.length - 1} onClick={() => void reorder(article, 1)}><ArrowDown size={14} /></button>
            <Menu label={`Actions for ${articleTitle(article)}`} items={[
              { label: "Edit", icon: <Pencil size={14} />, run: () => catalogue.navigate({ view: "design", id: article.id, from }) },
              { label: "Remove from volume", icon: <X size={14} />, run: () => void catalogue.patchArticle(article, { volume_id: null }).catch((cause) => workspace.toast(catalogueError(cause), { tone: "error" })) },
            ]} />
          </span>
        </li>)}
      </ol> : <div className="ct-toc-empty">
        <p className="ct-quiet">No articles in this volume yet.</p>
        <div className="ct-row">
          <button type="button" className="ws-button is-primary" onClick={() => setCreating(true)}><Plus size={14} /> New article</button>
          {catalogue.snapshot.articles.length ? <button type="button" className="ws-button" onClick={() => setAdding(true)}><ListPlus size={14} /> Add an existing article</button> : null}
        </div>
      </div>}
    </section>
  </div>;
}
