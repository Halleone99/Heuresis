import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const pack = read("src/components/PackView.tsx");
const review = read("src/components/StudyModal.tsx");
const sort = read("src/components/SortModal.tsx");
const enrichment = read("src/components/SortEnrichmentPanel.tsx");
const enrichmentCss = read("src/components/sort-enrichment.css");

assert.match(pack, /<SortModal\s+pack=/, "Topic must open the Sort workflow");
assert.match(pack, /onClick=\{\(\) => setSortOpen\(true\)\}/, "Topic needs a working Sort action");
assert.match(pack, /<StudyModal\s+pack=/, "Review must still open its launcher");
assert.doesNotMatch(review, /mode:\s*["']sort["']|setMode\(["']sort["']\)|startSort\(/,
  "Review launcher must not offer a second Sort workflow");
assert.doesNotMatch(review, /Sort or review|study-mode-card sort|Sort cards<\/h2>/,
  "Review launcher must be review-only");
assert.match(review, /mode: "review"/, "Review session must still launch");

assert.match(sort, /completeCardSort\(/, "Keep interest scoring");
assert.match(sort, /setSortTags\(/, "Keep per-card tag editing");
assert.doesNotMatch(sort, /setCardRetention\(card\.id, "reference"\)|keepReference\(/, "Sorting has no redundant Reference action");
assert.match(sort, /<SkipForward size=\{14\}\/> Later/, "New cards retains a later decision");
assert.match(sort, /Discard/, "Sorting retains recoverable Discard");
assert.match(sort, /function beginSort\(/, "One sort setup must select its queue");
assert.match(sort, /useState\\(!startCardId\\)/, "New opens setup before showing unsorted cards");
assert.match(sort, /selection\\.slice\\(0, selectedCount\\)/, "Chosen quantity limits the actual queue");
assert.match(sort, /type="checkbox" checked=\\{selectedTags\\.includes\\(tag\\.id\\)\\}/, "Tags can be selected at setup");
assert.match(sort, /const candidates = useMemo\(/, "Sort setup must retain search/tag filtering");
assert.match(sort, /const \[randomOrder/, "Sort setup must retain card ordering");
assert.match(sort, /const \[count/, "Sort setup must retain a batch-size choice");

assert.match(pack, /aria-label="Card workflow and status filter"/, "Workflow stages are the status filter");
assert.doesNotMatch(pack, /status-menu-popover|StatusFilter = [^;]*favourite/,
  "Do not duplicate stage filters in the filter toolbar");
assert.match(pack, /aria-pressed=\{favouriteOnly\}/, "Favourite-only filter must remain accessible");
assert.match(pack, /if \(favouriteOnly && !card\.favourite\)/, "Favourites must combine with stage selections");
assert.match(pack, /setFavouriteOnly\(false\)/, "Clear filters must clear Favourites too");

assert.match(sort, /<SortEnrichmentPanel key=/, "Sort must show the enrichment rail for each card");
assert.match(sort, /aria-label="Complete flashcard"/, "Sort must retain the central flashcard");
assert.match(sort, /onBlockedChange=/, "Sort must guard unsaved enrichment");
assert.match(enrichment, /patchCardData/, "Enrichment must save to the original card");
assert.match(enrichment, /_workspace_blocks/, "Enrichment must reuse the Cosmos card knowledge format");
assert.match(enrichment, /addRelatedWord/, "Sort must still add linked vocabulary");
assert.match(enrichment, /removeRelatedRelation/, "Sort must still unlink vocabulary");
assert.match(enrichmentCss, /grid-template-columns/, "Sort needs a three-column desktop layout");
assert.match(enrichmentCss, /max-width: 600px/, "Sort must adapt to phones");

assert.match(pack, /aria-label="Card sessions: New or Review"/, "New and Review share one control");
assert.match(pack, /<Plus size=\{15\} \/> Add/, "Creating a card is labelled Add");
assert.match(pack, /topic-filter-picker/, "All card filters share one panel");
console.log("New / Review and topic-filter checks passed.");
