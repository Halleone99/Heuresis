import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, FileDown, Minus, Pencil, Plus } from "lucide-react";
import { PAGE_HEIGHT_PX, PAGE_WIDTH_PX, articleTitle, volumeArticles, type CatalogueArticle } from "../../lib/catalogue/model";
import { registerCatalogueFonts } from "../../lib/catalogue/fonts";
import { Portal } from "../workspace/ui";
import { ArticlePageView } from "./ArticlePage";
import { useCatalogue, type CatalogueRoute } from "./CatalogueData";
import { ExportDialog } from "./ExportDialog";
import { pageOverflowPx } from "./stage";

/**
 * A distraction-free reader: the article's real A4 pages, one after another.
 * As the designer's Preview it is given the article being edited, exactly as it is
 * on screen (saved or not), and closes back into the designer.
 */
export function ArticleReader({ articleId, from, preview }: {
  articleId: string; from?: CatalogueRoute; preview?: { article: CatalogueArticle; onClose: () => void };
}) {
  const catalogue = useCatalogue();
  const article = preview?.article ?? catalogue.articleById.get(articleId) ?? null;
  const scroller = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0.8);
  const [zoom, setZoom] = useState<number | null>(null);
  const [current, setCurrent] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [overflowing, setOverflowing] = useState<number[]>([]);
  const scale = zoom ?? fit;
  registerCatalogueFonts();

  useLayoutEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => setFit(Math.max(0.28, Math.min(1.15, (element.clientWidth - (window.innerWidth < 700 ? 16 : 64)) / PAGE_WIDTH_PX)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [article !== null]);

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  useEffect(() => {
    const element = scroller.current;
    if (!element || !article) return;
    const timer = window.setTimeout(() => {
      const pages = Array.from(element.querySelectorAll<HTMLElement>(".ap-page"));
      setOverflowing(pages.map((page, index) => pageOverflowPx(page) > 1 ? index : -1).filter((index) => index >= 0));
    }, 500);
    return () => window.clearTimeout(timer);
  }, [article, scale]);

  const onScroll = useCallback(() => {
    const element = scroller.current;
    if (!element) return;
    const pageHeight = (PAGE_HEIGHT_PX * scale) + 28;
    setCurrent(Math.min((article?.pages.length ?? 1) - 1, Math.max(0, Math.round((element.scrollTop - 24) / pageHeight))));
  }, [article?.pages.length, scale]);

  const goToPage = useCallback((index: number) => {
    const element = scroller.current?.querySelectorAll<HTMLElement>(".ct-read-slot")[index];
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const back = useCallback(() => {
    if (preview) preview.onClose();
    else if (from) catalogue.navigate(from);
    else catalogue.navigate(article?.volume_id ? { view: "volume", id: article.volume_id } : { view: "library" });
  }, [article?.volume_id, catalogue, from, preview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (document.querySelector(".ws-dialog-backdrop")) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "Escape") { event.preventDefault(); back(); }
      else if (event.key === "ArrowRight" || event.key === "PageDown") { event.preventDefault(); goToPage(current + 1); }
      else if (event.key === "ArrowLeft" || event.key === "PageUp") { event.preventDefault(); goToPage(Math.max(0, current - 1)); }
      else if (event.key === "Home") { event.preventDefault(); goToPage(0); }
      else if (event.key === "End" && article) { event.preventDefault(); goToPage(article.pages.length - 1); }
      else if ((event.key === "+" || event.key === "=") && !event.ctrlKey) { event.preventDefault(); setZoom(Math.min(2.5, scale + 0.15)); }
      else if (event.key === "-" && !event.ctrlKey) { event.preventDefault(); setZoom(Math.max(0.3, scale - 0.15)); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [article, back, current, goToPage, scale]);

  if (!article) return <Portal><div className="ct-reader" role="dialog" aria-modal="true" aria-label="Reader">
    <div className="ct-studio-missing"><p>This article is no longer in the Catalogue.</p><button type="button" className="ws-button" onClick={() => catalogue.navigate({ view: "library" })}>Back to Catalogue</button></div>
  </div></Portal>;

  const labels = catalogue.labelFor(article);
  const volume = article.volume_id ? catalogue.volumeById.get(article.volume_id) ?? null : null;
  const sequence = volume && !preview ? volumeArticles(catalogue.snapshot.articles, volume.id).filter((row) => row.status === "published") : [];
  const position = sequence.findIndex((row) => row.id === article.id);
  const previous = position > 0 ? sequence[position - 1] : null;
  const next = position >= 0 && position < sequence.length - 1 ? sequence[position + 1] : null;
  const keepFrom = from;
  const isPreview = Boolean(preview);

  return <Portal><div className="ct-reader" role="dialog" aria-modal="true" aria-label={`Reading ${articleTitle(article)}`}>
    {exporting ? <ExportDialog articles={[article]} title={articleTitle(article)} onClose={() => setExporting(false)} /> : null}
    <header className="ct-reader-bar">
      <button type="button" className="ct-bar-back" onClick={back}><ArrowLeft size={17} /><span>{isPreview ? "Designer" : volume ? volume.title : "Catalogue"}</span></button>
      <div className="ct-reader-title"><strong>{articleTitle(article)}</strong>{isPreview ? <small>Preview{article.status === "draft" ? " · draft" : ""}</small> : volume ? <small>{volume.edition || volume.title}</small> : null}</div>
      <span className="ct-reader-page" aria-live="polite">{current + 1} / {article.pages.length}</span>
      <div className="ct-zoom is-inline" role="group" aria-label="Zoom">
        <button type="button" aria-label="Zoom out" onClick={() => setZoom(Math.max(0.3, Math.round((scale - 0.1) * 10) / 10))}><Minus size={14} /></button>
        <button type="button" className="ct-zoom-value" title="Fit the width" onClick={() => setZoom(null)}>{zoom === null ? "Fit" : `${Math.round(scale * 100)}%`}</button>
        <button type="button" aria-label="Zoom in" onClick={() => setZoom(Math.min(2.5, Math.round((scale + 0.1) * 10) / 10))}><Plus size={14} /></button>
      </div>
      {!isPreview ? <button type="button" className="ws-button is-small ct-bar-button" onClick={() => catalogue.navigate({ view: "design", id: article.id, from: { view: "read", id: article.id, from: keepFrom } })}><Pencil size={14} /><span>Edit</span></button> : null}
      <button type="button" className="ws-button is-small ct-bar-button" onClick={() => setExporting(true)}><FileDown size={14} /><span>Export PDF</span></button>
    </header>
    {overflowing.length ? <div className="ct-notice" role="status"><p>Page {overflowing.map((index) => index + 1).join(", ")} {overflowing.length === 1 ? "has" : "have"} more content than fits; the excess is not shown. Edit the article to move it onto the next page.</p></div> : null}
    <div className="ct-reader-scroll" ref={scroller} onScroll={onScroll}>
      <div className="ct-reader-column" style={{ width: PAGE_WIDTH_PX * scale }}>
        {article.pages.map((page, index) => <div key={page.id} className="ct-read-slot" style={{ width: PAGE_WIDTH_PX * scale, height: PAGE_HEIGHT_PX * scale }}>
          <ArticlePageView article={article} page={page} pageIndex={index} pageCount={article.pages.length} kicker={labels.kicker} runningTitle={labels.runningTitle} mode="read" scale={scale} />
        </div>)}
        {previous || next ? <nav className="ct-reader-next" aria-label="In this volume">
          {previous ? <button type="button" onClick={() => catalogue.navigate({ view: "read", id: previous.id, from: keepFrom })}><ArrowLeft size={15} /><span><small>Previous</small>{articleTitle(previous)}</span></button> : <span />}
          {next ? <button type="button" className="is-next" onClick={() => catalogue.navigate({ view: "read", id: next.id, from: keepFrom })}><span><small>Next</small>{articleTitle(next)}</span><ArrowRight size={15} /></button> : null}
        </nav> : null}
      </div>
    </div>
  </div></Portal>;
}
