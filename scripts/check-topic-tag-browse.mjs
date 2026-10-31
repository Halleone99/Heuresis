import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const pack = readFileSync("src/components/PackView.tsx", "utf8");
const main = readFileSync("src/main.tsx", "utf8");
const css = readFileSync("src/topic-tag-first.css", "utf8");

assert.match(pack, /const \[allCardsExpanded, setAllCardsExpanded\] = useState\(false\)/, "Opening a topic must not expand the full list");
assert.match(pack, /const showCardList = allCardsExpanded \|\| activeFilterCount > 0/, "Searching and filtering open results; unfiltered topic stays compact");
assert.match(pack, /!loading && !error && \(showCardList \|\| visibleTotal === 0\)/, "The table renders only on request, except the useful empty state");
assert.match(pack, /onClick=\{\(\) => \{ clearFilters\(\); setAllCardsExpanded\(true\); \}\}>Show all/, "All cards remain one deliberate click away");
assert.match(pack, /const source = \[\.\.\.cards, \.\.\.referenceCards\]/, "All means learning and reference cards");
assert.match(pack, /setAllCardsExpanded\(true\);\s*setQuery\(""\); setStatusFilters\(isReference/, "Opening a card from Search still reveals it");
assert.match(pack, /const tagFacets = useMemo\(\(\) => \{/, "Counts are derived from actual card assignments");
assert.match(pack, /for \(const card of \[\.\.\.cards, \.\.\.referenceCards\]\)/, "Tag counts include reference cards");
assert.match(pack, /const lessonTags = useMemo\(\(\) => tagFacets/, "Lesson choices are scoped to this topic");
assert.match(pack, /const otherTags = useMemo\(\(\) => tagFacets/, "Other tag choices are scoped to this topic");
assert.match(pack, /Untagged <small>\{untaggedCount\}/, "Unassigned cards are visible as a group");
assert.match(pack, /setQuery\(""\);\s*setStatusFilters\(\[\]\)/, "Overview clears search and filters");
assert.match(main, /import "\.\/topic-tag-first\.css";/, "The focused browser stylesheet is loaded");
assert.match(css, /\.topic-browse-hub/, "The compact card browser has a styled layout");
assert.match(pack, /selectedTagIds\.includes\(tag\.id\)/, "Multiple tags can be ticked independently");
assert.match(pack, /tagSelectionActive/, "Tag selections narrow card results");
assert.match(pack, /tagSearch/, "Tag choices are searchable at scale");
assert.match(pack, /aria-label="Filter by importance"/, "Importance is available alongside tags");
assert.match(pack, /aria-label="Filter by review state"/, "Card state is available alongside tags");
console.log("Tag-first topic browsing checks passed.");
