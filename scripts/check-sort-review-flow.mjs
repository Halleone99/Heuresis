import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const pack = read("src/components/PackView.tsx");
const review = read("src/components/StudyModal.tsx");
const sort = read("src/components/SortModal.tsx");
const enrichment = read("src/components/SortEnrichmentPanel.tsx");
const sessionCss = read("src/components/sort-session.css");

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
assert.match(sort, /onClick=\{\(\) => void later\(\)\}/, "New cards retains a Later decision");
assert.match(sort, /onClick=\{\(\) => chooseImportance\(level\)\}/, "Importance selection is separate from committing a card");
assert.match(sort, /onClick=\{\(\) => void learn\(IMPORTANCE_RANK\[importance\], "learning"\)\}/, "Learn sends selected importance through original save path");
assert.match(sort, /onClick=\{\(\) => void learn\(IMPORTANCE_RANK\[importance\], "review"\)\}/, "Review sends selected importance through original save path");
assert.match(sort, /IMPORTANCE_KEY = "heuresis.sort.lastImportance.v1"/, "Selected importance persists");
assert.match(sort, /Discard/, "Sorting retains recoverable Discard");
assert.match(sort, /function beginSort\(/, "One sort setup must select its queue");
assert.match(sort, /useState\(!startCardId && !fastStart\)/, "Normal New opens setup; daily quota quick-start bypasses it");
assert.match(sort, /selection\.slice\(0, selectedCount\)/, "Chosen quantity limits the actual queue");
assert.match(sort, /type="checkbox" checked=\{selectedTags\.includes\(tag\.id\)\}/, "Tags can be selected at setup");
assert.match(sort, /const candidates = useMemo\(/, "Sort setup must retain search/tag filtering");
assert.match(sort, /const \[randomOrder/, "Sort setup must retain card ordering");
assert.match(sort, /const \[count/, "Sort setup must retain a batch-size choice");

assert.match(pack, /aria-label="Card progress"/, "Compact progress strip remains available");
assert.doesNotMatch(pack, /status-menu-popover|StatusFilter = [^;]*favourite/,
  "Do not duplicate stage filters in the filter toolbar");
assert.match(pack, /aria-pressed=\{favouriteOnly\}/, "Favourite-only filter must remain accessible");
assert.match(pack, /if \(favouriteOnly && !card\.favourite\)/, "Favourites must combine with stage selections");
assert.match(pack, /setFavouriteOnly\(false\)/, "Clear filters must clear Favourites too");

assert.match(sort, /<SortEnrichmentPanel key=/, "Sort must show the enrichment rail for each card");
assert.match(sort, /aria-label="New flashcard"/, "Sort must retain the central flashcard");
assert.match(sort, /onBlockedChange=/, "Sort must guard unsaved enrichment");
assert.match(enrichment, /patchCardData/, "Enrichment must save to the original card");
assert.match(enrichment, /_workspace_blocks/, "Enrichment must reuse the Cosmos card knowledge format");
assert.match(enrichment, /addRelatedWord/, "Sort must still add linked vocabulary");
assert.match(enrichment, /removeRelatedRelation/, "Sort must still unlink vocabulary");
assert.match(sessionCss, /width:min\(780px/, "New cards must have a centred, readable card");
assert.match(sessionCss, /max-width:1180px/, "Details must adapt to narrow screens");
assert.match(sessionCss, /max-width:760px/, "New decisions must adapt to phones");

assert.match(pack, /aria-label="Card sessions"/, "New and Review share one compact control");
assert.match(pack, /<Plus size=\{15\} \/> Add/, "Creating a card is labelled Add");
assert.match(pack, /inline-filter-importance[\s\S]*inline-filter-state[\s\S]*inline-filter-tags/, "Importance, State and Tags use independent inline dropdowns");
console.log("New / Review and topic-filter checks passed.");
