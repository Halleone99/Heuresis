import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Command, Folder, Layers, Search, X } from "lucide-react";
import { entryTitle, isLesson, normaliseSearch, plainLine, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { inlinePlain } from "../../lib/noteFormat";
import { KindIcon, Kbd, entryKindLabel, relativeTime } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

export type PaletteCommand = { id: string; label: string; detail: string; keywords?: string; run: () => void };

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

export function WorkspaceSearch({ onClose, onSearchCards, commands = [] }: { onClose: () => void; onSearchCards: (query: string) => void; commands?: PaletteCommand[] }) {
  const workspace = useWorkspace();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const words = normaliseSearch(query).split(" ").filter(Boolean);
  const rawWords = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);

  const results = useMemo<Result[]>(() => {
    if (!words.length) {
      return workspace.memory.recentDocs.map((id) => workspace.entryById.get(id)).filter((entry): entry is KnowledgeEntry => Boolean(entry))
        .slice(0, 8).map((entry) => ({ type: "entry" as const, entry, snippet: "", path: workspace.pathLabel(entry.topic_id), score: 0 }));
    }
    const list: Result[] = [];
    for (const topic of workspace.snapshot.topics) {
      const path = workspace.pathLabel(topic.id);
      const hay = normaliseSearch(path);
      if (words.every((word) => hay.includes(word))) list.push({ type: "topic", id: topic.id, label: topic.name, path, score: normaliseSearch(topic.name).startsWith(words[0]) ? 30 : 20 });
    }
    for (const entry of workspace.snapshot.entries) {
      const path = workspace.pathLabel(entry.topic_id);
      const title = normaliseSearch(entryTitle(entry));
      const hay = normaliseSearch([entry.title, entry.body, entry.attempt, entry.correction, entry.explanation, path].join(" "));
      if (!words.every((word) => hay.includes(word))) continue;
      let score = 10;
      if (words.every((word) => title.includes(word))) score += 25;
      if (title.startsWith(words[0])) score += 10;
      if (isLesson(entry)) score += 3;
      list.push({ type: "entry", entry, snippet: snippetFor(entry, words), path, score });
    }
    return list.sort((a, b) => b.score - a.score || (b.type === "entry" && a.type === "entry" ? b.entry.updated_at.localeCompare(a.entry.updated_at) : 0)).slice(0, 40);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, workspace.snapshot, workspace.memory.recentDocs]);

  const matchedCommands = commands.filter((command) => words.every((word) =>
    normaliseSearch([command.label, command.detail, command.keywords ?? ""].join(" ")).includes(word))).slice(0, words.length ? 12 : 9);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  const commandCount = matchedCommands.length;
  const total = commandCount + results.length + (query.trim() ? 1 : 0);
  function open(index: number) {
    if (index < commandCount) {
      matchedCommands[index].run();
      onClose();
      return;
    }
    const result = results[index - commandCount];
    if (!result) { if (query.trim()) { onSearchCards(query.trim()); onClose(); } return; }
    if (result.type === "topic") workspace.openTopic(result.id);
    else if (result.entry.kind === "mistake") workspace.openMistake(result.entry.id);
    else workspace.openDocument(result.entry.id);
    onClose();
  }

  return <div className="ws-dialog-backdrop is-top" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="ws-palette" role="dialog" aria-modal="true" aria-label="Search Heuresis and run commands"
      onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); onClose(); }
        if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(total - 1, value + 1)); }
        if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); }
        if (event.key === "Enter") { event.preventDefault(); open(active); }
      }}>
      <label className="ws-palette-input"><Search size={17} />
        <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search or type a command…" aria-label="Search" />
        {query ? <button type="button" className="ws-icon-button" aria-label="Clear" onClick={() => setQuery("")}><X size={14} /></button> : <Kbd>Esc</Kbd>}
      </label>
      <div className="ws-palette-list" ref={listRef} role="listbox">
        {matchedCommands.length ? <span className="ws-eyebrow ws-palette-group">Actions</span> : null}
        {matchedCommands.map((command, index) => <button type="button" role="option" aria-selected={index === active}
          key={command.id} data-index={index} className={`ws-palette-row is-command ${index === active ? "is-active" : ""}`}
          onMouseMove={() => setActive(index)} onClick={() => open(index)}>
          <span className="ws-palette-icon"><Command size={15} /></span>
          <span className="ws-palette-text"><strong>{highlight(command.label, rawWords)}</strong><small>{command.detail}</small></span>
          {index === active ? <ArrowRight size={14} className="ws-palette-go" /> : null}
        </button>)}
        {!query.trim() && results.length ? <span className="ws-eyebrow ws-palette-group">Recently opened</span> : null}
        {results.map((result, index) => <button type="button" role="option" aria-selected={commandCount + index === active} key={result.type === "topic" ? `t-${result.id}` : result.entry.id}
          data-index={commandCount + index} className={`ws-palette-row ${commandCount + index === active ? "is-active" : ""}`} onMouseMove={() => setActive(commandCount + index)} onClick={() => open(commandCount + index)}>
          <span className="ws-palette-icon">{result.type === "topic" ? <Folder size={15} /> : <KindIcon entry={result.entry} size={15} />}</span>
          <span className="ws-palette-text">
            <strong>{result.type === "topic" ? highlight(result.label, rawWords) : highlight(entryTitle(result.entry), rawWords)}</strong>
            {result.type === "entry" && result.snippet ? <span>{highlight(result.snippet, rawWords)}</span> : null}
            <small>{result.type === "topic" ? `Topic · ${result.path}` : `${entryKindLabel(result.entry)} · ${result.path} · ${relativeTime(result.entry.updated_at)}`}</small>
          </span>
          {commandCount + index === active ? <ArrowRight size={14} className="ws-palette-go" /> : null}
        </button>)}
        {query.trim() ? <button type="button" role="option" aria-selected={active === commandCount + results.length} data-index={commandCount + results.length}
          className={`ws-palette-row is-cards ${active === commandCount + results.length ? "is-active" : ""}`} onMouseMove={() => setActive(commandCount + results.length)} onClick={() => open(commandCount + results.length)}>
          <span className="ws-palette-icon"><Layers size={15} /></span>
          <span className="ws-palette-text"><strong>Search Study cards for “{query.trim()}”</strong><small>Flashcards and vocabulary in Study</small></span>
        </button> : null}
        {query.trim() && !results.length && !matchedCommands.length ? <p className="ws-muted ws-palette-empty">No notes or commands match. You can still search Study cards below.</p> : null}
        {!query.trim() && !results.length && !matchedCommands.length ? <p className="ws-muted ws-palette-empty">Search Heuresis, or choose an action.</p> : null}
      </div>
      <div className="ws-palette-foot"><span><Kbd>↑</Kbd><Kbd>↓</Kbd> move</span><span><Kbd>↵</Kbd> open</span><span><Kbd>Esc</Kbd> close</span></div>
    </div>
  </div>;
}
