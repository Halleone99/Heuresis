import { Pin } from "lucide-react";
import { entryTitle, type KnowledgeEntry } from "../../lib/knowledgeWorkspace";
import { KindIcon, ShowMore, useProgressiveList } from "./ui";

export function ReferenceNoteList({ notes, activeId, onChoose, detail, resetKey }: {
  notes: KnowledgeEntry[];
  activeId?: string;
  onChoose: (entry: KnowledgeEntry) => void;
  detail?: (entry: KnowledgeEntry) => string;
  resetKey: string;
}) {
  const { visible, remaining, showMore } = useProgressiveList(notes, resetKey, 40);
  return <div className="nb-v2-note-list">
    {[true, false].map((pinned) => {
      const group = visible.filter((entry) => entry.pinned === pinned);
      if (!group.length) return null;
      const label = pinned ? "Pinned" : "Notes";
      return <section key={label} aria-label={label}>
        <h3>{pinned ? <Pin size={13} aria-hidden="true"/> : null}{label}</h3>
        <ul>
          {group.map((entry) => {
            const subtitle = detail?.(entry);
            return <li key={entry.id}>
              <button type="button" aria-current={entry.id === activeId ? "true" : undefined} onClick={() => onChoose(entry)}>
                <span className="nb-v2-note-icon" aria-hidden="true">{entry.icon || <KindIcon entry={entry} size={16}/>}</span>
                <span><strong>{entryTitle(entry)}</strong>{subtitle ? <small>{subtitle}</small> : null}</span>
              </button>
            </li>;
          })}
        </ul>
      </section>;
    })}
    <ShowMore remaining={remaining} onMore={showMore} label="notes"/>
  </div>;
}
