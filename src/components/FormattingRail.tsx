import { useCallback, useEffect, useLayoutEffect, useState, type RefObject } from "react";
import { Bold, Eraser, Highlighter, List, Type } from "lucide-react";
import {
  AUTO_LAYERS, HIGHLIGHT_COLORS, addHighlightRule, applyAutoLayers, applyHighlights,
  deleteHighlightRule, listHighlightRules, readAutoLayers, targetFromSelection, toggleFormat,
  updateHighlightRule, writeAutoLayers, type HighlightRule, type HighlightStyle, type HighlightTarget,
  type AutoLayer, type HighlightColor,
} from "../lib/highlights";
import type { LanguageKey } from "../lib/languages";
import "./formatting-rail.css";

const MODE_KEY = "heuresis.cards.colourMode.v1";
const SCOPE_KEY = "heuresis.cards.formatScope.v1";
function defaultMode(): "color" | "mark" {
  try { return localStorage.getItem(MODE_KEY) === "mark" ? "mark" : "color"; }
  catch { return "color"; }
}
function defaultScope(): "card" | "all" {
  try { return localStorage.getItem(SCOPE_KEY) === "all" ? "all" : "card"; }
  catch { return "card"; }
}
export default function FormattingRail({
  rootRef, cardId, language, textVersion, onOpenFormatting,
}: {
  rootRef: RefObject<HTMLElement>; cardId: string; language: LanguageKey | null;
  textVersion?: string; onOpenFormatting?: () => void;
}) {
  const [rules, setRules] = useState<HighlightRule[]>([]);
  const [target, setTarget] = useState<HighlightTarget | null>(null);
  const [colourMode, setColourMode] = useState<"color" | "mark">(defaultMode);
  const [scope, setScope] = useState<"card" | "all">(defaultScope);
  const [auto, setAuto] = useState(readAutoLayers);
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [undoRules, setUndoRules] = useState<HighlightRule[]>([]);

  const load = useCallback(() => {
    void listHighlightRules().then(setRules).catch((err: unknown) =>
      setMessage(err instanceof Error ? err.message : "Formatting is unavailable until the database migration is applied."));
  }, []);
  useEffect(() => { load(); applyAutoLayers(); }, [load]);
  useEffect(() => {
    window.addEventListener("heuresis-highlights-updated", load);
    return () => window.removeEventListener("heuresis-highlights-updated", load);
  }, [load]);
  useEffect(() => { setTarget(null); setMessage(""); }, [cardId]);

  useLayoutEffect(() => {
    if (rootRef.current) applyHighlights(rootRef.current, rules, cardId);
  }, [rootRef, rules, cardId, textVersion]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const capture = () => setTarget(targetFromSelection(root, rules, cardId, scope));
    const pointer = () => capture();
    const keyboard = (e: KeyboardEvent) => {
      if (e.shiftKey) capture();
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b" && !e.isComposing
        && !(e.target instanceof Element && e.target.closest("input,textarea,[contenteditable]"))) {
        const next = targetFromSelection(root, rules, cardId, scope);
        if (next) { e.preventDefault(); setTarget(next); void change("bold", null, next); }
      }
    };
    root.addEventListener("pointerup", pointer);
    window.addEventListener("keyup", keyboard);
    window.addEventListener("keydown", keyboard);
    return () => {
      root.removeEventListener("pointerup", pointer);
      window.removeEventListener("keyup", keyboard);
      window.removeEventListener("keydown", keyboard);
    };
  }); // DOM selection changes independently of React state.

  function reportUpdate(next: HighlightRule[]) {
    setRules(next); window.dispatchEvent(new Event("heuresis-highlights-updated"));
  }
  function needTarget(t: HighlightTarget | null) {
    if (t) return true;
    setMessage("Select text on the card first.");
    return false;
  }
  async function change(style: HighlightStyle, color: HighlightColor | null, active = target) {
    if (!needTarget(active) || !active || pending) return;
    setPending(true); setMessage("");
    try { reportUpdate(await toggleFormat(rules, active, style, color)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save formatting."); }
    finally { setPending(false); }
  }
  async function changeScope(next: "card" | "all") {
    setScope(next);
    try { localStorage.setItem(SCOPE_KEY, next); } catch { /* local preference */ }
    if (!target || pending) return;
    const match = rules.filter(r => r.lang === target.lang
      && r.text.toLowerCase() === target.text.toLowerCase()
      && r.card_id === target.card_id);
    const moved: HighlightRule[] = []; setPending(true);
    try {
      for (const rule of match) {
        const newCardId = next === "card" ? cardId : null;
        const duplicate = rules.find(r => r.id !== rule.id && r.lang === rule.lang
          && r.text.toLowerCase() === rule.text.toLowerCase() && r.style === rule.style
          && r.card_id === newCardId);
        if (duplicate) { await deleteHighlightRule(rule.id); continue; }
        await updateHighlightRule(rule.id, { card_id: newCardId });
        moved.push({ ...rule, card_id: newCardId });
      }
      reportUpdate(rules.filter(r => !match.some(x => x.id === r.id)).concat(moved));
      setTarget({ ...target, card_id: next === "card" ? cardId : null });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not change scope."); load(); }
    finally { setPending(false); }
  }
  async function erase() {
    if (!needTarget(target) || !target || pending) return;
    const removed = rules.filter(r => r.lang === target.lang && r.text.toLowerCase() === target.text.toLowerCase()
      && r.card_id === target.card_id);
    if (!removed.length) return;
    setPending(true);
    try {
      for (const rule of removed) await deleteHighlightRule(rule.id);
      reportUpdate(rules.filter(r => !removed.some(x => x.id === r.id)));
      setUndoRules(removed); setMessage("Formatting cleared.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Could not clear formatting."); load(); }
    finally { setPending(false); }
  }
  async function undoErase() {
    if (!undoRules.length || pending) return;
    setPending(true);
    try {
      const restored: HighlightRule[] = [];
      for (const { id: _id, ...rule } of undoRules) restored.push(await addHighlightRule(rule));
      reportUpdate([...rules, ...restored]); setUndoRules([]); setMessage("Formatting restored.");
    } catch (err) { setMessage(err instanceof Error ? err.message : "Could not restore formatting."); load(); }
    finally { setPending(false); }
  }
  function mode(next: "mark" | "color") {
    setColourMode(next); try { localStorage.setItem(MODE_KEY,next); } catch { /* local preference */ }
  }
  function toggleAuto(layer: AutoLayer) {
    const next = { ...auto, [layer]: !auto[layer] };
    setAuto(next); writeAutoLayers(next);
  }
  return <aside className={"format-rail" + (target ? " has-target" : "")} aria-label="Text formatting"
    onMouseDown={event => event.preventDefault()}>
    <button type="button" className="format-icon format-bold" aria-label="Bold selected text" title="Bold (Ctrl+B)"
      aria-pressed={Boolean(target && rules.some(r => r.style === "bold" && r.lang === target.lang && r.text === target.text && r.card_id === target.card_id))}
      onClick={() => void change("bold", null)}><Bold size={17}/></button>
    <div className="format-switch" role="group" aria-label="Colour application">
      <button type="button" className={colourMode === "color" ? "on" : ""} aria-label="Text colour" title="Text colour"
        aria-pressed={colourMode === "color"} onClick={() => mode("color")}><Type size={15}/></button>
      <button type="button" className={colourMode === "mark" ? "on" : ""} aria-label="Highlight" title="Highlight"
        aria-pressed={colourMode === "mark"} onClick={() => mode("mark")}><Highlighter size={15}/></button>
    </div>
    <div className="format-dots" role="group" aria-label="Apply colour">
      {HIGHLIGHT_COLORS.map((colour,i) => <button type="button" key={colour}
        className={"format-dot format-dot-"+(i+1)} aria-label={"Colour "+(i+1)}
        title={"Apply "+colour+" to "+colourMode} onClick={() => void change(colourMode,colour)}>
        <span style={{background:"var(--hl-"+colour+")"}} /></button>)}
    </div>
    <div className="format-scope" role="group" aria-label="Formatting scope">
      <button type="button" className={scope === "card" ? "on" : ""} aria-pressed={scope === "card"}
        title="This card only" onClick={() => void changeScope("card")}>Card</button>
      <button type="button" className={scope === "all" ? "on" : ""} aria-pressed={scope === "all"}
        title="All cards in this language" onClick={() => void changeScope("all")}>All</button>
    </div>
    <button type="button" className="format-icon" aria-label="Clear formatting" title="Clear selected formatting"
      onClick={() => void erase()}><Eraser size={16}/></button>
    <div className="format-auto" aria-label="Automatic colouring">
      {(language && AUTO_LAYERS[language] || []).map(layer => <button type="button" key={layer.id}
        className={auto[layer.id] ? "on" : ""} aria-label={layer.name}
        aria-pressed={auto[layer.id]} title={layer.name} onClick={() => toggleAuto(layer.id)}>
        {layer.name}</button>)}
    </div>
    <button type="button" className="format-icon" aria-label="Formatting rules" title="Formatting list"
      onClick={onOpenFormatting}><List size={17}/></button>
    {message ? <div className="format-hint" role="status">{message}
      {undoRules.length ? <button type="button" onClick={() => void undoErase()}>Undo</button> : null}
    </div> : null}
  </aside>;
}
