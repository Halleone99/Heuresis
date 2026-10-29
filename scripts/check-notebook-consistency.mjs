import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(p)=>readFileSync(p,"utf8");
const icons=read("src/components/workspace/ui.tsx");
const entries=read("src/lib/knowledgeWorkspace.ts");
const overview=read("src/components/workspace/OverviewView.tsx");
const notebook=read("src/components/workspace/NotebookView.tsx");
const mistakes=read("src/components/workspace/MistakeLog.tsx");
const capture=read("src/components/workspace/QuickCapture.tsx");
const progress=read("src/components/workspace/ProgressView.tsx");
const css=read("src/components/workspace/workspace.css");

// #66: The actual stored category remains "phrase" for compatibility.
assert.match(entries, /phrase: "Expression"/);
assert.match(icons,/entry\.category === "grammar"\) return <Puzzle/);
assert.match(icons,/entry\.category === "vocabulary"\) return <BookOpen/);
assert.match(icons,/entry\.category === "phrase"\) return <MessageSquareQuote/);
assert.match(icons,/if \(isLesson\(entry\)\) return <GraduationCap/);
assert.match(icons,/entry\.kind === "mistake"\) return <AlertTriangle/);
assert.doesNotMatch(entries,/Block of meaning/);

// #65: Short non-recent dates, genuine "yesterday" over midnight and
// past-week date labels from one formatter, no negative relative text.
assert.match(icons,/new Intl\.DateTimeFormat\("en-GB", \{ day: "numeric", month: "short" \}\)/);
assert.match(icons,/if \(days === 1\) return "yesterday";/);
assert.match(icons,/if \(days <= 6\) return `\$\{days\} days ago`;/);
assert.match(icons,/if \(elapsed < -60_000\) return formatDay\(value\);/);
assert.match(overview,/summarise\(selected \? reviews\.filter/, "Overview reports selected Study topic review history");
assert.doesNotMatch(overview,/formatLongDay\(/);

// #13: Zero counts keep keyboard navigation and search, just lose prominence.
assert.match(notebook,/counts\[key\] === 0 \? "is-zero"/);
assert.doesNotMatch(mistakes,/counts\[key\] === 0 \? "is-zero"/, "Mistake Log no longer requires practice-stage filters");
assert.match(css,/\.ws-segmented button\.is-zero:not\(\.is-active\)/);
assert.match(progress,/total === 0 \? <div className="pg-empty-chart" role="status">No activity in this period/);
assert.match(css,/\.pg-empty-chart \{/);

// #14: Consistent visible language terminology across user-facing surfaces.
assert.match(notebook,/aria-label="Subjects and topics"/);
assert.match(notebook,/label="Subject name"/);
assert.match(capture,/label="Subject name"/);
assert.match(icons,/New subject/);
assert.doesNotMatch(mistakes,/ml-languages-tabs/, "Corrections apply to every subject without language tabs");
assert.match(progress,/<h2>By language<\/h2>/);

// #19: Notebook owns its gutters; content under identical maximum width.
assert.match(css,/\.ml-page, \.ov-page, \.pg-page \{ max-width: 1120px;/);
assert.match(css,/\.heuresis-desktop\[data-section="notebook"\] \.nb-scope \{/);
assert.match(css,/max-width: calc\(1120px \+ 2 \* clamp\(20px, 3\.2vw, 48px\)\)/);
assert.match(css,/padding: 26px clamp\(20px, 3\.2vw, 48px\) 80px;/);
console.log("Notebook consistency: type icons, dates, empty states, language labels and page alignment passed.");
