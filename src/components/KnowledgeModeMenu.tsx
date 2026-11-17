import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { Collection } from "../lib/heuresis";
import { KNOWLEDGE_MODES, type KnowledgeMode } from "../lib/studyKnowledgeMode";

type Props = {
  mode: KnowledgeMode;
  /** All collections, to show how many each mode holds. */
  collections: Collection[];
  onChange: (mode: KnowledgeMode) => void;
};

/**
 * The knowledge-mode badge beside "Study." and its small menu.
 *
 * The menu is drawn in a portal at a fixed position, so no panel of the Study page (several of
 * which are blurred glass with their own stacking) can cover or clip it. It behaves as a
 * listbox: arrows move, Enter or Space chooses, Escape closes and returns to the badge.
 */
export default function KnowledgeModeMenu({ mode, collections, onChange }: Props) {
  /** Where the open menu sits; null while it is closed. It is placed when it opens, in the same render. */
  const [place, setPlace] = useState<{ left: number; top: number; width: number } | null>(null);
  const open = place !== null;
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const options = useRef<Array<HTMLButtonElement | null>>([]);
  const current = KNOWLEDGE_MODES.find((entry) => entry.id === mode) ?? KNOWLEDGE_MODES[0];

  function setOpen(next: boolean | ((value: boolean) => boolean)) {
    const wanted = typeof next === "function" ? next(open) : next;
    if (!wanted || !trigger.current) { setPlace(null); return; }
    const rect = trigger.current.getBoundingClientRect();
    // On a phone the menu spans the screen, so every description stays whole.
    const narrow = window.innerWidth < 480;
    const width = narrow ? window.innerWidth - 24 : 320;
    setPlace({ left: narrow ? 12 : Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)), top: rect.bottom + 10, width });
  }

  useEffect(() => {
    if (!open) return;
    const index = Math.max(0, KNOWLEDGE_MODES.findIndex((entry) => entry.id === mode));
    options.current[index]?.focus({ preventScroll: true });
    const away = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    // The menu is placed once; a moved page closes it rather than leaving it adrift.
    const close = () => setOpen(false);
    document.addEventListener("pointerdown", away);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", away);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open, mode]);

  function choose(next: KnowledgeMode) {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
    if (next !== mode) onChange(next);
  }

  function onOptionKey(event: ReactKeyboardEvent<HTMLButtonElement>, index: number) {
    const last = KNOWLEDGE_MODES.length - 1;
    const move = (to: number) => { event.preventDefault(); options.current[to]?.focus(); };
    if (event.key === "ArrowDown") move(index === last ? 0 : index + 1);
    else if (event.key === "ArrowUp") move(index === 0 ? last : index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(last);
    else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus(); }
    else if (event.key === "Tab") setOpen(false);
  }

  const count = (id: KnowledgeMode) => collections.filter((collection) => collection.study_mode === id).length;

  return <div className="study-knowledge-select" data-open={open || undefined}>
    <button ref={trigger} type="button" className="study-knowledge-trigger" aria-label={`Choose knowledge mode, ${current.label} selected`}
      aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((value) => !value)}
      onKeyDown={(event) => { if ((event.key === "ArrowDown" || event.key === "ArrowUp") && !open) { event.preventDefault(); setOpen(true); } }}>
      <span className="study-knowledge-dot" aria-hidden="true" />
      <span className="study-knowledge-label">{current.label}</span>
      <ChevronDown size={12} strokeWidth={2.2} aria-hidden="true" />
    </button>
    {place ? createPortal(<div ref={menu} className="study-knowledge-menu" role="listbox" aria-label="Choose knowledge mode"
      style={{ left: place.left, top: place.top, width: place.width }}>
      <p className="study-knowledge-eyebrow" aria-hidden="true">Knowledge mode</p>
      {KNOWLEDGE_MODES.map((entry, index) => {
        const total = count(entry.id);
        return <button key={entry.id} ref={(node) => { options.current[index] = node; }} type="button" role="option"
          aria-selected={entry.id === mode} className="study-knowledge-option"
          onClick={() => choose(entry.id)} onKeyDown={(event) => onOptionKey(event, index)}>
          <span className="study-knowledge-mark" aria-hidden="true">{entry.mark}</span>
          <span className="study-knowledge-copy"><strong>{entry.label}</strong><span>{entry.description}</span></span>
          <span className="study-knowledge-meta">
            <span>{total ? `${total} ${total === 1 ? "collection" : "collections"}` : "Empty"}</span>
            <Check size={14} strokeWidth={2.2} aria-hidden="true" />
          </span>
        </button>;
      })}
    </div>, document.body) : null}
  </div>;
}
