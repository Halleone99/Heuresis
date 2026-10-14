import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const pack = read("src/components/PackView.tsx");
const review = read("src/components/StudyModal.tsx");
const sort = read("src/components/SortModal.tsx");

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
assert.match(sort, /setCardRetention\(card\.id, "reference"\)/, "Keep reference action");
assert.match(sort, /function beginSort\(/, "One sort setup must select its queue");
assert.match(sort, /const candidates = useMemo\(/, "Sort setup must retain search/tag filtering");
assert.match(sort, /const \[randomOrder/, "Sort setup must retain card ordering");
assert.match(sort, /const \[count/, "Sort setup must retain a batch-size choice");

assert.match(pack, /aria-label="Card workflow and status filter"/, "Workflow stages are the status filter");
assert.doesNotMatch(pack, /status-menu-popover|StatusFilter = [^;]*favourite/,
  "Do not duplicate stage filters in the filter toolbar");
assert.match(pack, /aria-pressed=\{favouriteOnly\}/, "Favourite-only filter must remain accessible");
assert.match(pack, /if \(favouriteOnly && !card\.favourite\)/, "Favourites must combine with stage selections");
assert.match(pack, /setFavouriteOnly\(false\)/, "Clear filters must clear Favourites too");

console.log("One Sort / Review and topic-filter checks passed.");
