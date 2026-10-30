import { useEffect, useRef, useState } from "react";
import { Download, FileCheck2, TriangleAlert } from "lucide-react";
import { articleTitle, emptyPictureFrames, type CatalogueArticle, type CatalogueVolume } from "../../lib/catalogue/model";
import { safeFileName, savePdfFile } from "../../lib/catalogue/save";
import { catalogueError } from "../../lib/catalogue/store";
import { useCatalogue } from "./CatalogueData";
import { Dialog, formatDate } from "./parts";
import { layoutForExport, layoutVolumeFrontMatter } from "./stage";

type Phase =
  | { kind: "working"; message: string }
  | { kind: "overflow"; items: Array<{ article: CatalogueArticle; pages: number[] }> }
  | { kind: "missing"; count: number }
  | { kind: "title-overflow" }
  | { kind: "done"; where: string; pages: number; warnings: string[]; bytes: Uint8Array; fileName: string }
  | { kind: "error"; message: string };

/**
 * Exports one article, or several in order (a volume), as an A4 PDF. A volume opens
 * with its title page and contents, and its page numbers run on through the articles.
 * Refuses rather than clipping: a page whose content runs past its margin, or an
 * image not available on this device, stops the export with an explanation.
 */
export function ExportDialog({ articles, title, author, volume, onClose, onFixOverflow }: {
  articles: CatalogueArticle[]; title: string; author?: string; volume?: CatalogueVolume; onClose: () => void;
  onFixOverflow?: (article: CatalogueArticle, firstPage: number) => void;
}) {
  const catalogue = useCatalogue();
  const [phase, setPhase] = useState<Phase>({ kind: "working", message: "Preparing the pages…" });
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const { pagesToPdf, mergePdfs } = await import("../../lib/catalogue/pdf/export");
        const parts: Uint8Array[] = [];
        const warnings = new Set<string>();
        const overflow: Array<{ article: CatalogueArticle; pages: number[] }> = [];
        let total = 0;
        let starts: Map<string, number> | null = null;
        if (volume && articles.length) {
          setPhase({ kind: "working", message: "Laying out the title page and contents…" });
          const look = { typography_preset: articles[0].typography_preset, colour_preset: articles[0].colour_preset };
          const subject = volume.subject_id ? catalogue.snapshot.subjects.find((row) => row.id === volume.subject_id)?.name ?? "" : "";
          const front = await layoutVolumeFrontMatter(volume, articles, look, catalogue.userId, { kicker: subject, date: formatDate(volume.edition_date) });
          try {
            if (front.missingImages) { setPhase({ kind: "missing", count: front.missingImages }); return; }
            if (front.overflowing) { setPhase({ kind: "title-overflow" }); return; }
            const result = await pagesToPdf(front.pages, { title, author, keywords: ["Heuresis", "Catalogue"] });
            parts.push(result.bytes);
            total += result.pageCount;
            result.warnings.forEach((warning) => warnings.add(warning));
            starts = front.starts;
          } finally {
            front.stage.destroy();
          }
        }
        for (let index = 0; index < articles.length; index += 1) {
          const article = articles[index];
          setPhase({ kind: "working", message: articles.length > 1 ? `Laying out “${articleTitle(article)}” (${index + 1} of ${articles.length})…` : "Laying out the pages…" });
          const folioOffset = starts ? (starts.get(article.id) ?? 1) - 1 : 0;
          const layout = await layoutForExport(article, { ...catalogue.labelFor(article), folioOffset });
          try {
            if (layout.overflowing.length) { overflow.push({ article, pages: layout.overflowing }); continue; }
            if (layout.missingImages) { setPhase({ kind: "missing", count: layout.missingImages }); return; }
            if (overflow.length) continue;
            const result = await pagesToPdf(layout.pages, {
              title: articleTitle(article), author: article.author || author, subject: article.subtitle || undefined,
              keywords: ["Heuresis", "Catalogue"],
            }, (done, count) => setPhase({ kind: "working", message: `Writing page ${done} of ${count}${articles.length > 1 ? ` of “${articleTitle(article)}”` : ""}…` }));
            parts.push(result.bytes);
            total += result.pageCount;
            result.warnings.forEach((warning) => warnings.add(warning));
          } finally {
            layout.stage.destroy();
          }
        }
        if (overflow.length) { setPhase({ kind: "overflow", items: overflow }); return; }
        const empty = articles.reduce((sum, article) => sum + emptyPictureFrames(article), 0);
        if (empty) warnings.add(empty === 1 ? "An empty picture frame was left out." : `${empty} empty picture frames were left out.`);
        const bytes = parts.length === 1 ? parts[0] : await mergePdfs(parts, { title, author });
        const fileName = safeFileName(title);
        setPhase({ kind: "working", message: "Saving the PDF…" });
        const saved = await savePdfFile(bytes, fileName);
        setPhase({ kind: "done", where: saved.where, pages: total, warnings: Array.from(warnings), bytes, fileName });
      } catch (cause) {
        setPhase({ kind: "error", message: catalogueError(cause) });
      }
    })();
  }, [articles, author, catalogue, title, volume]);

  const busy = phase.kind === "working";
  return <Dialog title="Export PDF" onClose={() => { if (!busy) onClose(); }} label="Export PDF"
    actions={busy ? undefined : <>
      {phase.kind === "done" ? <button type="button" className="ws-button" onClick={() => void savePdfFile(phase.bytes, phase.fileName)}><Download size={14} /> Save again</button> : null}
      <button type="button" className={`ws-button ${phase.kind === "done" ? "is-primary" : ""}`} onClick={onClose}>{phase.kind === "done" ? "Done" : "Close"}</button>
    </>}>
    {phase.kind === "working" ? <div className="ct-busy" role="status"><span className="ws-spinner" /> {phase.message}</div> : null}
    {phase.kind === "done" ? <div className="ct-export-result" role="status">
      <FileCheck2 size={22} strokeWidth={1.5} />
      <div>
        <p><strong>{phase.fileName}</strong></p>
        <p>{phase.pages} A4 {phase.pages === 1 ? "page" : "pages"} · saved to {phase.where}.</p>
        {phase.warnings.map((warning) => <p key={warning} className="ct-warning"><TriangleAlert size={13} /> {warning}</p>)}
      </div>
    </div> : null}
    {phase.kind === "overflow" ? <div className="ct-export-problem" role="alert">
      <p>Some pages have more content than fits above their bottom margin. The PDF was not made, so nothing is cut off.</p>
      <ul>{phase.items.map((item) => <li key={item.article.id}>{articles.length > 1 ? <strong>{articleTitle(item.article)}: </strong> : null}
        {item.pages.length === 1 ? "page" : "pages"} {item.pages.map((page) => page + 1).join(", ")}
        {onFixOverflow ? <button type="button" className="ws-button is-small is-primary" onClick={() => { onFixOverflow(item.article, item.pages[0]); onClose(); }}>Move overflow to the following pages</button> : null}
      </li>)}</ul>
      {!onFixOverflow ? <p className="ct-quiet">Open the article in the designer to move the extra content onto the next page.</p> : null}
    </div> : null}
    {phase.kind === "missing" ? <div className="ct-export-problem" role="alert">
      <p>{phase.count} {phase.count === 1 ? "image is" : "images are"} not available on this device yet. Connect to the internet and export again, so that no picture is missing from the PDF.</p>
    </div> : null}
    {phase.kind === "title-overflow" ? <div className="ct-export-problem" role="alert">
      <p>The volume's title page has more text than fits on it. Shorten the volume's title or subtitle and export again.</p>
    </div> : null}
    {phase.kind === "error" ? <p className="ct-error" role="alert">{phase.message}</p> : null}
  </Dialog>;
}
