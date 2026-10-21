import { useEffect, useMemo, useState } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Eye, FileText, LayoutGrid } from "lucide-react";
import { splitNoteSections } from "../../lib/noteSections";
import { RichText, type LinkResolver } from "./RichText";

export type NotebookReadMode = "document" | "canvas" | "study";
type Props = { text: string; mode: NotebookReadMode; resolve?: LinkResolver; rubyPinyin: boolean; columns: 2 | 3; onColumnsChange: (columns: 2 | 3) => void; foldStorageKey?: string };

const modes: { mode: NotebookReadMode; label: string; description: string; icon: typeof FileText }[] = [
  { mode: "document", label: "Document", description: "Continuous Word-like page", icon: FileText },
  { mode: "canvas", label: "Canvas", description: "OneNote-style panels in columns", icon: LayoutGrid },
  { mode: "study", label: "Study", description: "Review sections one at a time", icon: BookOpen },
];

export function NoteViewSwitcher({ mode, onChange }: { mode: NotebookReadMode; onChange: (mode: NotebookReadMode) => void }) {
  return <div className="nb-view-switcher" role="group" aria-label="Note layout">
    {modes.map(({ mode: next, label, description, icon: Icon }) =>
      <button type="button" key={next} onClick={() => onChange(next)} aria-pressed={mode === next}
        title={description} className={mode === next ? "is-active" : ""}>
        <Icon size={14} aria-hidden="true"/><span>{label}</span>
      </button>)}
  </div>;
}

export function NoteReadingViews({ text, mode, resolve, rubyPinyin, columns, onColumnsChange, foldStorageKey }: Props) {
  const sections = useMemo(() => splitNoteSections(text), [text]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setIndex(0); setRevealed(false); }, [mode, text]);
  const selected = sections[Math.min(index, sections.length - 1)];

  if (mode === "document") return <RichText key={foldStorageKey} text={text} resolve={resolve} className="nb-reading" rubyPinyin={rubyPinyin} collapsible foldStorageKey={foldStorageKey} />;

  if (mode === "canvas") return <div className="nb-canvas">
    <div className="nb-canvas-heading">
      <span>Panels follow your headings or large gaps in the note. Edit the original document to rearrange them.</span>
      <div className="nb-canvas-columns" role="group" aria-label="Number of canvas columns">
        {([2, 3] as const).map((number) =>
          <button type="button" key={number} aria-pressed={columns === number}
            className={columns === number ? "is-active" : ""} onClick={() => onColumnsChange(number)}>{number} columns</button>)}
      </div>
    </div>
    <div className={"nb-canvas-grid nb-canvas-" + columns}>
      {sections.map((section) => <section key={section.id} className="nb-canvas-panel" aria-label={section.title}>
        {section.named || sections.length > 1 ? <h2 className="nb-canvas-panel-title">{section.title}</h2> : null}
        {section.body ? <RichText text={section.body} resolve={resolve} rubyPinyin={rubyPinyin} className="nb-canvas-prose" /> : null}
      </section>)}
    </div>
  </div>;

  return <div className="nb-study-reader">
    <div className="nb-study-reader-nav">
      <span role="status" aria-live="polite">Section {Math.min(index + 1, sections.length)} of {sections.length}</span>
      <div className="nb-study-reader-buttons">
        <button type="button" disabled={index === 0} onClick={() => { setIndex((value) => Math.max(0, value - 1)); setRevealed(false); }}>
          <ChevronLeft size={15}/> Previous</button>
        <button type="button" disabled={index >= sections.length - 1} onClick={() => { setIndex((value) => Math.min(sections.length - 1, value + 1)); setRevealed(false); }}>
          Next <ChevronRight size={15}/></button>
      </div>
    </div>
    {selected ? <section className="nb-study-reader-card" aria-label="Section to review">
      <span className="nb-study-reader-kicker">Recall before revealing</span>
      <h2>{selected.named ? selected.title : sections.length === 1 ? "Review this note" : selected.title}</h2>
      {revealed ? <div className="nb-study-reader-answer">
        {selected.body ? <RichText text={selected.body} resolve={resolve} rubyPinyin={rubyPinyin} /> : <p>No content under this heading yet.</p>}
        <button type="button" onClick={() => setRevealed(false)}><Eye size={15}/> Hide answer</button>
      </div> : <button className="nb-study-reader-reveal" type="button" onClick={() => setRevealed(true)}>
        <Eye size={16}/> Reveal section
      </button>}
    </section> : null}
  </div>;
}
