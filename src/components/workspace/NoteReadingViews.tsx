import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Eye } from "lucide-react";
import { splitNoteSections } from "../../lib/noteSections";
import { RichText, type LinkResolver } from "./RichText";
import { NoteLessonView } from "./NoteLessonView";

export type NotebookReadMode = "document" | "canvas" | "study" | "lesson";
type Props = { text: string; mode: NotebookReadMode; resolve?: LinkResolver; rubyPinyin: boolean; columns: 2 | 3; onColumnsChange: (columns: 2 | 3) => void; foldStorageKey?: string; enhanced?: boolean };

const modes: { mode: NotebookReadMode; label: string }[] = [
  { mode: "document", label: "Document" },
  { mode: "canvas", label: "Panels" },
  { mode: "study", label: "Recall" },
];

export function NoteViewSwitcher({ mode, onChange, enhanced = false }: { mode: NotebookReadMode; onChange: (mode: NotebookReadMode) => void; enhanced?: boolean }) {
  return <label className="nb-view-switcher" title="Choose how to read this note">
    <span className="nb-view-label">View</span>
    <select aria-label="Reading view" value={mode} onChange={(event) => onChange(event.target.value as NotebookReadMode)}>
      {modes.map(({ mode: next, label }) => <option key={next} value={next}>{enhanced && next === "canvas" ? "Panels" : label}</option>)}
      {enhanced ? <option value="lesson">Lesson</option> : null}
    </select>
  </label>;
}

export function NoteReadingViews({ text, mode, resolve, rubyPinyin, columns, onColumnsChange, foldStorageKey, enhanced = false }: Props) {
  const sections = useMemo(() => mode === "canvas" || mode === "study" ? splitNoteSections(text) : [], [text, mode]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  useEffect(() => { setIndex(0); setRevealed(false); }, [mode, text]);
  const selected = sections[Math.min(index, sections.length - 1)];

  if (mode === "document") return <RichText key={foldStorageKey} text={text} resolve={resolve} className="nb-reading" rubyPinyin={rubyPinyin} collapsible foldStorageKey={foldStorageKey} showOutline enhanced={enhanced} />;

  if (mode === "lesson") return <NoteLessonView text={text} resolve={resolve} rubyPinyin={rubyPinyin}/>;

  if (mode === "canvas") return <div className="nb-canvas">
    <div className="nb-canvas-heading">
      {!enhanced ? <span>Panels follow your headings or large gaps in the note. Edit the original document to rearrange them.</span> : null}
      <div className="nb-canvas-columns" role="group" aria-label="Number of canvas columns" hidden={enhanced && sections.length < 2}>
        {([2, 3] as const).map((number) =>
          <button type="button" key={number} aria-pressed={columns === number}
            className={columns === number ? "is-active" : ""} onClick={() => onColumnsChange(number)}>{number} columns</button>)}
      </div>
    </div>
    <div className={`nb-canvas-grid nb-canvas-${columns} ${sections.length === 1 ? "is-single-panel" : ""}`}>
      {sections.map((section) => <section key={section.id} className="nb-canvas-panel" aria-label={section.title}>
        {section.named || sections.length > 1 ? <h2 className="nb-canvas-panel-title">{section.title}</h2> : null}
        {section.body ? <RichText text={section.body} resolve={resolve} rubyPinyin={rubyPinyin} className="nb-canvas-prose" enhanced={enhanced} /> : null}
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
        {selected.body ? <RichText text={selected.body} resolve={resolve} rubyPinyin={rubyPinyin} enhanced={enhanced} /> : <p>No content under this heading yet.</p>}
        <button type="button" onClick={() => setRevealed(false)}><Eye size={15}/> Hide answer</button>
      </div> : <button className="nb-study-reader-reveal" type="button" onClick={() => setRevealed(true)}>
        <Eye size={16}/> Reveal section
      </button>}
    </section> : null}
  </div>;
}
