import { useCallback, useMemo, useState } from "react";
import { Check, SmilePlus } from "lucide-react";
import type { EntryPatch, KnowledgeEntry, MistakeAccent } from "../../lib/knowledgeWorkspace";
import { KindIcon, usePopover } from "./ui";
import { useWorkspace } from "./WorkspaceContext";

const PRESETS = [
  { name: "Study", icons: ["📚", "📖", "📝", "✍️", "🧠", "🎓", "📐", "🔤"] },
  { name: "Conversation", icons: ["💬", "🗣️", "🎧", "❓", "💡", "✅", "📌", "⭐"] },
  { name: "Languages & themes", icons: ["🇨🇳", "🇩🇪", "🇷🇺", "🇫🇷", "🇬🇧", "🌍", "📅", "🔎"] },
] as const;
const ACCENTS: Array<{ id: MistakeAccent | null; label: string }> = [
  { id: null, label: "No colour" },
  { id: "red", label: "Red" },
  { id: "amber", label: "Amber" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "violet", label: "Violet" },
];

/** Edits a note's saved appearance without changing its title or body. */
export function NoteIdentityPicker({ entry }: { entry: KnowledgeEntry }) {
  const workspace = useWorkspace();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = usePopover(open, close);
  const common = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of workspace.snapshot.entries) {
      if (row.kind !== "note" || !row.icon) continue;
      counts.set(row.icon, (counts.get(row.icon) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 8).map(([icon]) => icon);
  }, [workspace.snapshot.entries]);

  async function save(patch: EntryPatch) {
    if (busy || !workspace.writable) return;
    setBusy(true);
    try { await workspace.patchEntry(entry.id, patch); }
    catch (error) { workspace.toast(error instanceof Error ? error.message : "Could not save note appearance.", { tone: "error" }); }
    finally { setBusy(false); }
  }
  function choose(icon: string | null) {
    void save({ icon });
  }
  return <div className="nb-identity" ref={ref}>
    <button type="button" className={`nb-identity-trigger nb-accent-${entry.accent_color ?? "none"}`}
      onClick={() => setOpen((value) => !value)} title="Choose note icon and colour" aria-label={`Choose icon and colour for ${entry.title || "note"}`}
      aria-expanded={open} aria-haspopup="dialog">
      {entry.icon ? <span className="nb-identity-emoji" aria-hidden="true">{entry.icon}</span> : <KindIcon entry={entry} size={16} />}
    </button>
    {open ? <div className="nb-identity-popover" role="dialog" aria-label="Note icon and colour">
      <div className="nb-identity-head"><strong>Identify this note</strong><button type="button" onClick={close} className="nb-identity-done">Done</button></div>
      {common.length ? <div className="nb-identity-section">
        <span className="nb-identity-caption">Used in your notebook</span>
        <div className="nb-identity-grid">
          {common.map((icon) => <button key={icon} type="button" disabled={busy} aria-label={`Use ${icon}`} aria-pressed={entry.icon === icon}
            className={entry.icon === icon ? "is-selected" : ""} onClick={() => choose(icon)}>{icon}</button>)}
        </div>
      </div> : null}
      {PRESETS.map((set) => <div className="nb-identity-section" key={set.name}>
        <span className="nb-identity-caption">{set.name}</span>
        <div className="nb-identity-grid">
          {set.icons.map((icon) => <button key={icon} type="button" disabled={busy} aria-label={`Use ${icon}`} aria-pressed={entry.icon === icon}
            className={entry.icon === icon ? "is-selected" : ""} onClick={() => choose(icon)}>{icon}</button>)}
        </div>
      </div>)}
      <form className="nb-identity-custom" onSubmit={(event) => { event.preventDefault(); if (custom.trim()) { choose(custom.trim()); setCustom(""); } }}>
        <input aria-label="Custom emoji or symbol" placeholder="Or paste an emoji / symbol" maxLength={32} value={custom}
          onChange={(event) => setCustom(event.target.value)} />
        <button type="submit" disabled={busy || !custom.trim()} aria-label="Use custom symbol"><SmilePlus size={16} /></button>
        <button type="button" disabled={busy || !entry.icon} onClick={() => choose(null)} title="Remove icon">Clear</button>
      </form>
      <div className="nb-identity-section">
        <span className="nb-identity-caption">Colour</span>
        <div className="nb-identity-colours">
          {ACCENTS.map((accent) => <button key={accent.id ?? "none"} type="button" disabled={busy}
            title={accent.label} aria-label={accent.label} aria-pressed={(entry.accent_color ?? null) === accent.id}
            className={`nb-swatch nb-swatch-${accent.id ?? "none"} ${entry.accent_color === accent.id ? "is-selected" : ""}`}
            onClick={() => void save({ accent_color: accent.id })}>
            {entry.accent_color === accent.id ? <Check size={13} /> : null}
          </button>)}
        </div>
      </div>
    </div> : null}
  </div>;
}
