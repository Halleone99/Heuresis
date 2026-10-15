import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, BookOpen, Command, Folder, Layers, Search, X } from "lucide-react";
import { fieldByRole, fieldText, type PackWithType } from "../../lib/heuresis";
import { searchCards, type SearchCardResult } from "../../lib/search";
import { entryTitle, isLesson, normaliseSearch, plainLine, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { inlinePlain } from "../../lib/noteFormat";
import { commandScore, resultsFirst } from "../../lib/paletteRanking";
import { KindIcon, Kbd, entryKindLabel, relativeTime } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

export type PaletteCommand = { id: string; label: string; detail: string; keywords?: string; run: () => void };

/** Study card matches shown directly in the palette (the rest stay one row away). */
const INLINE_CARD_LIMIT = 5;

function cardLabel(hit: SearchCardResult, pack: PackWithType | undefined) {
  const term = fieldByRole(pack?.cardType, "term") ?? pack?.cardType?.field_schema[0] ?? null;
  const reading = fieldByRole(pack?.cardType, "reading");
  const meaning = fieldByRole(pack?.cardType, "meaning") ?? pack?.cardType?.field_schema[1] ?? null;
  // Keys starting with "_" hold internal data (sort marker, workspace blocks), never display text.
  const values = Object.entries(hit.data).filter(([key]) => !key.startsWith("_"))
    .flatMap(([, value]) => Array.isArray(value) ? value : [value]).filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  return {
    term: fieldText(hit.data, term?.key) || values[0] || "Untitled",
    reading: reading ? fieldText(hit.data, reading.key) : "",
    meaning: fieldText(hit.data, meaning?.key) || values[1] || "",
  };
}

type Result =
  | { type: "topic"; id: string; label: string; path: string; score: number }
  | { type: "entry"; entry: KnowledgeEntry; snippet: string; path: string; score: number };

function highlight(text: string, words: string[]): ReactNode {
  const lower = text.toLocaleLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const word of words) {
    if (!word) continue;
    let index = lower.indexOf(word);
    while (index >= 0 && ranges.length < 12) { ranges.push([index, index + word.length]); index = lower.indexOf(word, index + word.length); }
  }
  if (!ranges.length) return text;
  ranges.sort((a, b) => a[0] - b[0]);
  const parts: ReactNode[] = [];
  let cursor = 0;
  ranges.forEach(([start, end], index) => {
    if (start < cursor) return;
    parts.push(text.slice(cursor, start));
    parts.push(<mark key={index}>{text.slice(start, end)}</mark>);
    cursor = end;
  });
  parts.push(text.slice(cursor));
  return <>{parts}</>;
}

function snippetFor(entry: KnowledgeEntry, words: string[]) {
  const sources = entry.kind === "mistake" ? [entry.attempt, entry.correction, entry.explanation] : entry.body.split(/\r?\n/);
  for (const raw of sources) {
    const line = inlinePlain(plainLine(raw));
    if (line && words.some((word) => normaliseSearch(line).includes(word))) return line.length > 160 ? `${line.slice(0, 159)}…` : line;
  }
  if (entry.kind === "mistake") return [entry.attempt, entry.correction].filter(Boolean).join(" → ");
  const first = entry.body.split(/\r?\n/).map((line) => inlinePlain(plainLine(line))).find(Boolean) ?? "";
  return first.length > 160 ? `${first.slice(0, 159)}…` : first;
}

export function WorkspaceSearch({ onClose, onSearchCards, onOpenCard, packs = [], commands = [] }: {
  onClose: () => void;
  onSearchCards: (query: string) => void;
  /** Opens the topic containing a Study card, with that card selected. */
  onOpenCard?: (hit: SearchCardResult) => void;
  packs?: PackWithType[];
  commands?: PaletteCommand[];
}) {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [cardHits, setCardHits] = useState<SearchCardResult[]>([]);
  const packMap = useMemo(() => new Map(packs.map((pack) => [pack.id, pack])), [packs]);

  // Study cards live in the database (and its offline copy), not in the Notebook
  // snapshot, so they are looked up after a short pause in typing.
  useEffect(() => {
    const term = query.trim();
    if (!onOpenCard || term.length < 2) { setCardHits([]); return; }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void searchCards(term).then((hits) => { if (!cancelled) setCardHits(hits.filter((hit) => packMap.has(hit.pack_id))); })
        .catch(() => { if (!cancelled) setCardHits([]); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [onOpenCard, packMap, query]);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const words = normaliseSearch(query).split(" ").filter(Boolean);
  const rawWords = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);

  // Normalised text is computed once per Notebook snapshot, not on every keystroke:
  // with a few thousand notes, re-normalising every body made typing visibly lag.
  const index = useMemo(() => ({
    topics: workspace.snapshot.topics.map((topic) => {
      const path = workspace.pathLabel(topic.id);
      return { topic, path, hay: normaliseSearch(path), name: normaliseSearch(topic.name) };
    }),
    entries: workspace.snapshot.entries.map((entry) => {
      const path = workspace.pathLabel(entry.topic_id);
      return { entry, path, title: normaliseSearch(entryTitle(entry)),
        hay: normaliseSearch([entry.title, entry.body, entry.attempt, entry.correction, entry.explanation, path].join(" ")) };
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [workspace.snapshot]);

  const results = useMemo<Result[]>(() => {
    if (!words.length) {
      return workspace.memory.recentDocs.map((id) => workspace.entryById.get(id)).filter((entry): entry is KnowledgeEntry => Boolean(entry))
        .slice(0, 8).map((entry) => ({ type: "entry" as const, entry, snippet: "", path: workspace.pathLabel(entry.topic_id), score: 0 }));
    }
    const list: Result[] = [];
    for (const { topic, path, hay, name } of index.topics) {
      // A topic named exactly what was typed is what was meant ("Inbox", "Grammar").
      if (words.every((word) => hay.includes(word))) list.push({ type: "topic", id: topic.id, label: topic.name, path, score: name === words.join(" ") ? 46 : name.startsWith(words[0]) ? 30 : 20 });
    }
    for (const { entry, path, title, hay } of index.entries) {
      if (!words.every((word) => hay.includes(word))) continue;
      let score = 10;
      if (words.every((word) => title.includes(word))) score += 25;
      if (title.startsWith(words[0])) score += 10;
      if (isLesson(entry)) score += 3;
      list.push({ type: "entry", entry, snippet: "", path, score });
    }
    // Snippets only for what is shown.
    return list.sort((a, b) => b.score - a.score || (b.type === "entry" && a.type === "entry" ? b.entry.updated_at.localeCompare(a.entry.updated_at) : 0)).slice(0, 40)
      .map((result) => result.type === "entry" ? { ...result, snippet: snippetFor(result.entry, words) } : result);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, index, workspace.memory.recentDocs]);

  const matchedCommands = commands.map((command) => ({ command, score: commandScore(command, words) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, words.length ? 12 : 9);

  // One ordered list drives the keyboard index, the highlight and Enter, so they
  // can never disagree about which row is selected.
  type Row = { kind: "command"; command: PaletteCommand } | { kind: "result"; result: Result } | { kind: "card"; hit: SearchCardResult } | { kind: "cards" };
  const commandRows: Row[] = matchedCommands.map(({ command }) => ({ kind: "command", command }));
  const resultRows: Row[] = results.map((result) => ({ kind: "result", result }));
  const notesFirst = resultsFirst(matchedCommands[0]?.score ?? 0, results[0]?.score ?? 0, words.length > 0);
  const cardRows: Row[] = query.trim() ? cardHits.slice(0, INLINE_CARD_LIMIT).map((hit) => ({ kind: "card", hit })) : [];
  const rows: Row[] = [...(notesFirst ? [...resultRows, ...commandRows] : [...commandRows, ...resultRows]),
    ...cardRows,
    ...(query.trim() ? [{ kind: "cards" } as Row] : [])];

  useEffect(() => { setActive(0); }, [query]);
  // Card matches arrive after the first rows; keep the highlighted row in range.
  useEffect(() => { setActive((value) => Math.min(value, Math.max(0, rows.length - 1))); }, [rows.length]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  function open(index: number) {
    const row = rows[index];
    if (!row) return;
    if (row.kind === "command") { row.command.run(); onClose(); return; }
    if (row.kind === "cards") { onSearchCards(query.trim()); onClose(); return; }
    if (row.kind === "card") { onOpenCard?.(row.hit); onClose(); return; }
    const { result } = row;
    if (result.type === "topic") workspace.openTopic(result.id);
    else if (result.entry.kind === "mistake") workspace.openMistake(result.entry.id);
    else workspace.openDocument(result.entry.id);
    onClose();
  }

  const renderRow = (row: Row, index: number) => {
    const selected = index === active;
    const common = { type: "button" as const, role: "option", "aria-selected": selected, "data-index": index,
      onMouseMove: () => setActive(index), onClick: () => open(index) };
    if (row.kind === "command") return <button {...common} key={`c-${row.command.id}`} className={`ws-palette-row is-command ${selected ? "is-active" : ""}`}>
      <span className="ws-palette-icon"><Command size={15} /></span>
      <span className="ws-palette-text"><strong>{highlight(row.command.label, rawWords)}</strong><small>{row.command.detail}</small></span>
      {selected ? <ArrowRight size={14} className="ws-palette-go" /> : null}
    </button>;
    if (row.kind === "cards") return <button {...common} key="cards" className={`ws-palette-row is-cards ${selected ? "is-active" : ""}`}>
      <span className="ws-palette-icon"><Layers size={15} /></span>
      <span className="ws-palette-text"><strong>{cardHits.length > INLINE_CARD_LIMIT ? `All ${cardHits.length >= 40 ? "40+" : cardHits.length} Study cards for “${query.trim()}”` : `Search Study cards for “${query.trim()}”`}</strong><small>Full card search across every topic</small></span>
    </button>;
    if (row.kind === "card") {
      const pack = packMap.get(row.hit.pack_id);
      const label = cardLabel(row.hit, pack);
      return <button {...common} key={`card-${row.hit.id}`} className={`ws-palette-row is-card ${selected ? "is-active" : ""}`}>
        <span className="ws-palette-icon"><BookOpen size={15} /></span>
        <span className="ws-palette-text">
          <strong>{highlight(label.term, rawWords)}{label.reading ? <em className="ws-palette-reading"> {label.reading}</em> : null}</strong>
          {label.meaning ? <span>{highlight(label.meaning, rawWords)}</span> : null}
          <small>Study card · {pack?.title ?? "Topic"}{row.hit.role === "related" ? " · Discovery" : ""}</small>
        </span>
        {selected ? <ArrowRight size={14} className="ws-palette-go" /> : null}
      </button>;
    }
    const { result } = row;
    return <button {...common} key={result.type === "topic" ? `t-${result.id}` : result.entry.id} className={`ws-palette-row ${selected ? "is-active" : ""}`}>
      <span className="ws-palette-icon">{result.type === "topic" ? <Folder size={15} /> : <KindIcon entry={result.entry} size={15} />}</span>
      <span className="ws-palette-text">
        <strong>{result.type === "topic" ? highlight(result.label, rawWords) : highlight(entryTitle(result.entry), rawWords)}</strong>
        {result.type === "entry" && result.snippet ? <span>{highlight(result.snippet, rawWords)}</span> : null}
        <small>{result.type === "topic" ? `Topic · ${result.path}` : `${entryKindLabel(result.entry)} · ${result.path} · ${relativeTime(result.entry.updated_at)}`}</small>
      </span>
      {selected ? <ArrowRight size={14} className="ws-palette-go" /> : null}
    </button>;
  };
  const groupLabel = (row: Row) => row.kind === "command" ? "Actions" : row.kind === "cards" ? null : row.kind === "card" ? "Study cards" : query.trim() ? "Notes and topics" : "Recently opened";

  return <div className="ws-dialog-backdrop is-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ws-palette" role="dialog" aria-modal="true" aria-label="Search Heuresis and run commands"
      onKeyDown={(event) => {
        // Arrow and Enter keys also drive Chinese/Japanese input methods; while a
        // composition is open they belong to the IME, not to the result list.
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(rows.length - 1, value + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
        if (event.key === "Enter") { event.preventDefault(); open(active); }
      }}>
      <label className="ws-palette-input"><Search size={17} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or type a command…" aria-label="Search" />
        {query ? <button type="button" className="ws-icon-button" aria-label="Clear" onClick={() => setQuery("")}><X size={14} /></button> : <Kbd>Esc</Kbd>}
      </label>
      <div className="ws-palette-list" ref={listRef} role="listbox">
        {rows.map((row, index) => {
          const label = groupLabel(row);
          const previous = index > 0 ? groupLabel(rows[index - 1]) : undefined;
          return <Fragment key={index}>
            {label && label !== previous ? <span className="ws-eyebrow ws-palette-group">{label}</span> : null}
            {renderRow(row, index)}
          </Fragment>;
        })}
        {query.trim() && !results.length && !matchedCommands.length && !cardRows.length ? <p className="ws-muted ws-palette-empty">No notes, cards or commands match yet.</p> : null}
        {!query.trim() && !results.length && !matchedCommands.length ? <p className="ws-muted ws-palette-empty">Search Heuresis, or choose an action.</p> : null}
      </div>
      <div className="ws-palette-foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span><span><Kbd>Esc</Kbd> close</span></div>
    </div>
  </div>;
}
