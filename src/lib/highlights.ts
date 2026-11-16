import { supabase } from "./supabase";
import type { LanguageKey } from "./languages";

/** Shared Sort + Review formatting rules, stored per user with RLS. */
export type HighlightStyle = "mark" | "color" | "bold";
export type HighlightColor = "mk1" | "mk2" | "mk3" | "mk4" | "mk5" | (string & {});
export type HighlightRule = { id: string; lang: string; text: string; style: HighlightStyle; color: HighlightColor | null; whole_word: boolean; card_id: string | null };
export type HighlightTarget = { text: string; lang: string; whole_word: boolean; card_id: string | null };
export const HIGHLIGHT_COLORS: HighlightColor[] = ["mk1", "mk2", "mk3", "mk4", "mk5"];
export type AutoLayer = "tones" | "gender" | "stress" | "sep";
export const AUTO_LAYERS: Partial<Record<LanguageKey, { id: AutoLayer; name: string }[]>> = {
  zh: [{ id: "tones", name: "Tone colours" }],
  de: [{ id: "gender", name: "Gender colours" }, { id: "sep", name: "Separable verbs" }],
  ru: [{ id: "gender", name: "Gender colours" }, { id: "stress", name: "Stress" }],
};
const AUTO_DEFAULT: Record<AutoLayer, boolean> = { tones: true, gender: true, stress: true, sep: true };
const AUTO_KEY = "heuresis.highlights.auto.v1";
export function readAutoLayers(): Record<AutoLayer, boolean> {
  try { return { ...AUTO_DEFAULT, ...JSON.parse(localStorage.getItem(AUTO_KEY) || "{}") }; }
  catch { return { ...AUTO_DEFAULT }; }
}
export function applyAutoLayers(value = readAutoLayers()) {
  for (const id of Object.keys(AUTO_DEFAULT) as AutoLayer[]) document.body.classList.toggle("hl-" + id, !!value[id]);
}
export function writeAutoLayers(value: Record<AutoLayer, boolean>) {
  try { localStorage.setItem(AUTO_KEY, JSON.stringify(value)); } catch { /* local only */ }
  applyAutoLayers(value);
}

const strip = (s: string) => s.normalize("NFC").replace(/\u0301/g, "");
const escapeRe = (s: string) => s.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&");
const SKIP = ".py,.article,.chip,button,kbd,input,textarea,[contenteditable]";
export const colorValue = (c: string | null) => !c ? "var(--ws-ink)" : c.startsWith("#") ? c : "var(--hl-" + c + ")";
export const langOf = (el: Element) => (el.closest("[lang]")?.getAttribute("lang") || "en").slice(0, 2);
type Span = { node: Text; a: number; b: number };
function nodes(el: Element): Span[] {
  const out: Span[] = []; let pos = 0;
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
    acceptNode: n => n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  });
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node as Text;
    out.push({ node: t, a: pos, b: pos + t.length }); pos += t.length;
  }
  return out;
}
function expression(rule: HighlightRule) {
  const pat = [...strip(rule.text)].map(escapeRe).join("\\u0301?");
  return new RegExp(rule.whole_word ? "(?<![\\p{L}\\p{M}])" + pat + "(?![\\p{L}\\p{M}])" : pat, "giu");
}
function paint(el: Element, list: HighlightRule[], style: HighlightStyle) {
  const spans = nodes(el);
  const full = spans.map(x => x.node.data).join("");
  const hits: { a: number; b: number; r: HighlightRule }[] = [];
  for (const r of list) {
    const re = expression(r); let m: RegExpExecArray | null;
    while ((m = re.exec(full))) {
      if (!m[0]) { re.lastIndex++; continue; }
      hits.push({ a: m.index, b: m.index + m[0].length, r });
    }
  }
  hits.sort((x,y) => x.a - y.a || y.b - x.b);
  const accepted: typeof hits = []; let end = -1;
  for (const h of hits) if (h.a >= end) { accepted.push(h); end = h.b; }
  for (const h of accepted.reverse()) for (const span of [...spans].reverse()) {
    const a = Math.max(h.a, span.a), b = Math.min(h.b, span.b);
    if (a >= b) continue;
    const selected = span.node.splitText(a - span.a);
    selected.splitText(b - a);
    const mark = document.createElement("mark");
    mark.className = "hlx s-" + style; mark.dataset.rule = h.r.id;
    mark.style.setProperty("--hc", colorValue(h.r.color));
    selected.replaceWith(mark); mark.append(selected);
  }
}
/** Re-applying should never nest generated mark elements. */
export function clearHighlights(root: Element) {
  root.querySelectorAll("mark.hlx").forEach(m => {
    const parent = m.parentNode; if (!parent) return;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m); parent.normalize();
  });
}
export function applyHighlights(root: Element, rules: HighlightRule[], cardId: string) {
  clearHighlights(root);
  root.querySelectorAll("[data-hl]").forEach(el => {
    const applicable = rules.filter(r => r.lang === langOf(el) && (!r.card_id || r.card_id === cardId));
    for (const style of ["mark","color","bold"] as HighlightStyle[]) {
      const subset = applicable.filter(r => r.style === style);
      if (subset.length) paint(el, subset, style);
    }
  });
}
export function selectedText(range: Range, scope: Element): string {
  let selected = "";
  for (const part of nodes(scope)) {
    if (!range.intersectsNode(part.node)) continue;
    const a = range.startContainer === part.node ? range.startOffset : 0;
    const b = range.endContainer === part.node ? range.endOffset : part.node.length;
    selected += part.node.data.slice(a, b);
  }
  return strip(selected).trim();
}
export const sameTarget = (r: HighlightRule, t: HighlightTarget) =>
  r.lang === t.lang && strip(r.text).toLocaleLowerCase() === strip(t.text).toLocaleLowerCase()
  && (r.card_id || null) === (t.card_id || null);
export function targetFromSelection(root: Element, rules: HighlightRule[], cardId: string, defaultScope: "card" | "all"): HighlightTarget | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0), anchor = range.commonAncestorContainer;
  const el = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement;
  if (!el || !root.contains(el) || el.closest("[contenteditable],input,textarea")) return null;
  const scope = el.closest("[data-hl]");
  if (!scope) return null;
  const text = selectedText(range, scope);
  if (!text || text.length > 80) return null;
  const lang = langOf(scope);
  const before = range.startContainer.nodeType === Node.TEXT_NODE ? (range.startContainer as Text).data[range.startOffset - 1] || " " : " ";
  const after = range.endContainer.nodeType === Node.TEXT_NODE ? (range.endContainer as Text).data[range.endOffset] || " " : " ";
  const whole_word = lang !== "zh" && !/\p{L}/u.test(before) && !/\p{L}/u.test(after);
  const target = { text, lang, whole_word, card_id: cardId };
  const onCard = rules.some(r => sameTarget(r, target));
  const onAll = rules.some(r => sameTarget(r, { ...target, card_id: null }));
  return { ...target, card_id: onCard ? cardId : onAll ? null : defaultScope === "card" ? cardId : null };
}
function db() { if (!supabase) throw new Error("Supabase is not configured."); return supabase; }
const FIELDS = "id,lang,text,style,color,whole_word,card_id";
export async function listHighlightRules(): Promise<HighlightRule[]> {
  const { data, error } = await db().from("heuresis_highlight_rules").select(FIELDS).order("created_at");
  if (error) throw error; return (data || []) as HighlightRule[];
}
export async function addHighlightRule(rule: Omit<HighlightRule,"id">): Promise<HighlightRule> {
  const { data, error } = await db().from("heuresis_highlight_rules").insert({ ...rule, text: strip(rule.text).trim() }).select(FIELDS).single();
  if (error) throw error; return data as HighlightRule;
}
export async function updateHighlightRule(id: string, patch: Partial<Pick<HighlightRule, "color" | "card_id">>) {
  const { error } = await db().from("heuresis_highlight_rules").update(patch).eq("id", id);
  if (error) throw error;
}
export async function deleteHighlightRule(id: string) {
  const { error } = await db().from("heuresis_highlight_rules").delete().eq("id", id);
  if (error) throw error;
}
export async function toggleFormat(rules: HighlightRule[], target: HighlightTarget, style: HighlightStyle, color: HighlightColor | null): Promise<HighlightRule[]> {
  const previous = rules.find(r => sameTarget(r,target) && r.style === style);
  if (style === "bold" || (previous && previous.color === color)) {
    if (previous) { await deleteHighlightRule(previous.id); return rules.filter(r => r.id !== previous.id); }
    const added = await addHighlightRule({ ...target, style, color: null }); return [...rules, added];
  }
  if (previous) {
    await updateHighlightRule(previous.id, { color });
    return rules.map(r => r.id === previous.id ? { ...r, color } : r);
  }
  const added = await addHighlightRule({ ...target, style, color }); return [...rules, added];
}
