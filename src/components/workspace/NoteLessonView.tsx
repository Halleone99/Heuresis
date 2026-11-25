import { useDeferredValue, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { filterReferenceGroups, referenceGroups, referenceTerms } from "../../lib/noteReference";
import { RichText, type LinkResolver } from "./RichText";

export function NoteLessonView({ text, resolve, rubyPinyin, suggestedQuery = "" }: {
  text: string;
  resolve?: LinkResolver;
  rubyPinyin?: boolean;
  suggestedQuery?: string;
}) {
  const [input, setInput] = useState<string | null>(null);
  const groups = useMemo(() => referenceGroups(text), [text]);
  const suggestion = useMemo(() => suggestedQuery && filterReferenceGroups(groups, referenceTerms(suggestedQuery)).length
    ? suggestedQuery : "", [groups, suggestedQuery]);
  const query = input ?? suggestion;
  const deferred = useDeferredValue(query);
  const results = useMemo(() => filterReferenceGroups(groups, referenceTerms(deferred)), [deferred, groups]);

  if (!groups.length) return <p className="nb-v2-empty">This note is empty.</p>;
  return <div className="nb-v2-lesson">
    <div className="nb-v2-lesson-tools">
      <div className="nb-v2-search">
        <Search size={16} aria-hidden="true"/>
        <input type="search" aria-label="Find in this note" placeholder="Find in this note…" value={query}
          onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === "Escape" && query && !event.nativeEvent.isComposing) {
              event.preventDefault();
              setInput("");
            }
          }}/>
        {query ? <button type="button" aria-label="Clear note search" onClick={() => setInput("")}><X size={14}/></button> : null}
      </div>
      {deferred.trim() ? <span className="nb-v2-count" role="status">{results.length} {results.length === 1 ? "match" : "matches"}</span> : null}
    </div>
    {results.length ? <div className="nb-v2-lesson-groups">
      {results.map((group) => {
        const type = group.blocks[0].type;
        const className = group.phrase ? "nb-v2-phrase" : /^h[234]$/.test(type) ? "nb-v2-lesson-heading" : "nb-v2-lesson-block";
        return <RichText key={group.id} blocks={group.blocks} resolve={resolve} rubyPinyin={rubyPinyin} className={className} enhanced/>;
      })}
    </div> : <p className="nb-v2-empty">No matches in this note.</p>}
  </div>;
}
