import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { MoreHorizontal, X } from "lucide-react";
import { PAGE_HEIGHT_PX, PAGE_WIDTH_PX, type ArticlePage, type CatalogueArticle } from "../../lib/catalogue/model";
import { Portal, usePopover } from "../workspace/ui";
import { ArticlePageView, DesignerContext } from "./ArticlePage";

/** A modal dialog in the application's own style; Escape and the backdrop close it. */
export function Dialog({ title, onClose, children, actions, wide = false, label }: {
  title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode; wide?: boolean | "xl"; label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const first = ref.current?.querySelector<HTMLElement>("[autofocus], input, select, textarea, button:not(.ct-dialog-close)");
    first?.focus({ preventScroll: true });
    return () => { if (previous && document.contains(previous)) previous.focus({ preventScroll: true }); };
  }, []);
  return <Portal><div className="ws-dialog-backdrop ct-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className={`ws-dialog ct-dialog ${wide === "xl" ? "is-xl" : wide ? "is-wide" : ""}`} role="dialog" aria-modal="true" aria-label={label ?? (typeof title === "string" ? title : undefined)}
      onKeyDown={(event) => { if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <div className="ws-dialog-head"><h2>{title}</h2>
        <button type="button" className="ws-icon-button ct-dialog-close" aria-label="Close" onClick={onClose}><X size={16} /></button></div>
      {children}
      {actions ? <div className="ws-dialog-actions">{actions}</div> : null}
    </div>
  </div></Portal>;
}

export type MenuItem = { label: string; icon?: ReactNode; run: () => void; danger?: boolean; disabled?: boolean } | "divider";

export function Menu({ label, items, trigger, align = "right", className = "" }: {
  label: string; items: MenuItem[]; trigger?: ReactNode; align?: "left" | "right"; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = usePopover(open, close);
  return <div className={`ct-menu ${className}`} ref={ref}>
    <button type="button" className={trigger ? "ct-menu-trigger has-label" : "ws-icon-button ct-menu-trigger"} aria-label={label} aria-haspopup="menu" aria-expanded={open}
      onClick={(event) => { event.stopPropagation(); setOpen((value) => !value); }}>{trigger ?? <MoreHorizontal size={16} />}</button>
    {open ? <div className={`ct-menu-list is-${align}`} role="menu">
      {items.map((item, index) => item === "divider" ? <hr key={`d${index}`} /> :
        <button type="button" role="menuitem" key={item.label} disabled={item.disabled} className={item.danger ? "is-danger" : ""}
          onClick={(event) => { event.stopPropagation(); setOpen(false); item.run(); }}>{item.icon}{item.label}</button>)}
    </div> : null}
  </div>;
}

export function Segmented<T extends string | number>({ value, options, onChange, label, className = "" }: {
  value: T; options: Array<{ value: T; label: ReactNode; title?: string }>; onChange: (value: T) => void; label: string; className?: string;
}) {
  return <div className={`ct-segmented ${className}`} role="radiogroup" aria-label={label}>
    {options.map((option) => <button key={String(option.value)} type="button" role="radio" aria-checked={value === option.value}
      title={option.title} aria-label={option.title} className={value === option.value ? "is-on" : ""}
      onMouseDown={(event) => event.preventDefault()} onClick={() => onChange(option.value)}>{option.label}</button>)}
  </div>;
}

/** A real page, scaled down: the cover of a card or a page in the page list. */
export function PageThumb({ article, page, pageIndex, width, kicker, runningTitle }: {
  article: CatalogueArticle; page: ArticlePage; pageIndex: number; width: number; kicker?: string; runningTitle?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [actual, setActual] = useState(width);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => { const next = element.clientWidth || width; setActual((current) => Math.abs(current - next) > 0.5 ? next : current); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);
  const scale = actual / PAGE_WIDTH_PX;
  return <div ref={ref} className="ct-thumb" style={{ width: "100%", maxWidth: width, aspectRatio: `${PAGE_WIDTH_PX} / ${PAGE_HEIGHT_PX}` }} aria-hidden="true">
    <div className="ct-thumb-inner">
      <DesignerContext.Provider value={null}>
        <ArticlePageView article={article} page={page} pageIndex={pageIndex} pageCount={article.pages.length} kicker={kicker} runningTitle={runningTitle} mode="read" scale={scale} />
      </DesignerContext.Provider>
    </div>
  </div>;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return <label className="ct-field"><span>{label}</span>{children}{hint ? <small>{hint}</small> : null}</label>;
}

export function formatDate(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00` : value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
