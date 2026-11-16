import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const overview = read("src/components/workspace/OverviewView.tsx");
const app = read("src/App.tsx");
const reading = read("src/lib/readingBridge.ts");
const activity = read("src/lib/activity.ts");
const css = read("src/components/workspace/overview-serif.css");
const settings = read("src/components/SettingsModal.tsx");
const preference = read("src/lib/overviewStyle.ts");

for (const label of ["Flashcards", "Notes", "Quotations", "Articles"]) {
  assert.match(overview, new RegExp('label: "' + label + '"'), label + " is an Overview section");
}
assert.doesNotMatch(overview, /key: "reading", label: "Reading"/, "Reading is now represented by Quotations on Overview");
assert.match(overview, /loadStudyInventory/, "Study inventory still loads");
assert.match(overview, /loadStudyActivity/, "Study activity still loads");
assert.match(overview, /catalogue_articles/, "Article metadata still loads");
assert.match(overview, /workspace\.snapshot\.entries\.filter\(\(entry\) => entry\.kind === "note"\)/, "Notes use the live Notebook");
assert.match(overview, /const quotes = reading\.quotes/, "Quotations use the shared Reading library");
assert.match(overview, /quote\.createdAt/, "Quote activity uses actual save dates");
assert.match(overview, /quote\.attribution\.trim\(\)\.toLowerCase\(\)/, "Author count uses distinct non-empty attributions");
assert.match(overview, /inLast30\(row\.updated_at\) && wasEdited\(row\)/, "Articles count actual edits, not publications");
assert.doesNotMatch(overview, /Published \(30 d\)/, "Published is not a proxy for edited");
assert.match(overview, /role="tablist" aria-label="Activity type"/, "Activity uses accessible tabs");
assert.match(overview, /aria-selected=\{kind === value\}/, "Current tab is announced to assistive technology");
assert.match(overview, /Last 26 weeks/, "Overview retains 26-week calendar");
assert.match(overview, /role="img"/, "Mini bars and heatmap have descriptions");
assert.match(overview, /className="ov-card-link"[^\\n]+onClick=\{open\}/, "Cards use accessible navigation buttons");
assert.match(overview, /open: onOpenStudy/, "Flashcards card opens Study");
assert.match(overview, /goTo\("notebook"\)/, "Notes card opens Notebook");
assert.match(overview, /goTo\("quotations"\)/, "Quotations card opens quotation section");
assert.match(overview, /goTo\("reference"\)/, "Articles card opens Catalogue");
assert.match(app, /section === "quotations" \? "quotations" : "library"/, "Reading shell supports quotation destination");
assert.match(overview, /retrySection\("quotes"\)|retrySection\(key as ActivityKind\)/, "Cards can retry their own failed data");
assert.match(overview, /reading\.reload\(\)/, "Quotations Retry reloads the shared library");
assert.match(overview, /workspace\.reload\(\)/, "Notes Retry reloads the Notebook");
assert.match(activity, /pack_id,card_id,session_id/, "Review records preserve their source identity");
assert.match(reading, /export function useReadingLibrary/, "Shared reading hook is unchanged");
assert.match(css, /\.ov-cards\{display:grid/, "Serif cards have layout styles");
assert.match(css, /grid-template-columns:repeat\(26,minmax\(0,1fr\)\)/, "All 26 weeks scale proportionally");
assert.match(css, /\.ov\[data-style="panel"\] \.ov-cards/, "No. 3 Panel styles are scoped");
assert.match(settings, /chooseOverviewStyle\("serif"\)/, "Appearance offers Serif");
assert.match(settings, /chooseOverviewStyle\("panel"\)/, "Appearance offers No. 3 Panel");
assert.match(preference, /heuresis\.overview\.style\.v1/, "Overview choice persists on this device");
assert.ok(!app.includes("<ProgressView"), "Inactive Progress screen stays hidden");
console.log("Overview Serif and No. 3 Panel: live data, navigation, activity, accessible tabs and settings passed.");
