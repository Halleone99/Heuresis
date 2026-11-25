# Applied knowledge: kinds, kind-specific Learn, the knowledge curve

Revised 25 November 2026. Builds on `APPLIED.md` (rules) and `APPLIED-REVIEW-IMPLEMENTATION.md`.
No database migration. Language topics are unchanged.

## Why

An Applied topic such as "02 · Documentation" is mostly **definitions** (CMR consignment note,
bill of lading, packing list), not rules. Before this change such a card:

- showed the **Language** panel in New (In context · Nearby words · Parts · Grammar);
- did not show the Rule card type's own fields (conditions, exceptions, steps, case, source) in New at all;
- got the rule library in Learn with nothing to work on, so it fell back to **wording** exercises
  (word order, a missing word, type the name): language flashcards in disguise;
- was reviewed **every day until Mastered**, like vocabulary.

## 1. The kind of knowledge (`src/lib/knowledgeKinds.ts`)

| Kind | Holds | Learn and Review practise |
| --- | --- | --- |
| Definition | a term and what it means | recognise · tell apart · define |
| Rule | what applies, when, what follows | identify · scope · apply to cases (unchanged) |
| Procedure | steps in order | order · next step · missing step · steps from memory |
| Figure | a value, limit, rate or deadline | which value · what it refers to · type the value |
| Question | a direct question and its answer | recall · explain (unchanged) |

- Stored on the card in the existing key `_applied_kind` ("knowledge" | "question" before).
  Older clients read every value other than "question" as "knowledge": nothing breaks for them.
- A card nobody classified gets a **suggested** kind from its content: three steps → procedure;
  a short answer built around a value → figure; conditions, exceptions or cases → rule; a sentence
  written like a definition ("A consignment note used for …", not "Every …", no "must/shall") →
  definition; anything else → rule (what every Applied card was before).
- The suggestion is shown with a dashed outline on the card; choosing confirms it. When a card is
  sorted (Learn / Review in New) the kind it was sorted as is stored, so adding a case later does
  not silently turn a definition into a rule.
- Whether a topic is Applied at all is still decided by its card type (`teachingShape.ts`).

## 2. New, Capture and the card editors

- **Kind chip** on the card in New (`KnowledgeKindChip`), segments in Capture, Edit card and
  Modify (`KnowledgeKindSegments`). Field labels follow the kind (Term / Definition, Rule / What it
  requires, Procedure / What it achieves, What it measures / Value, Question / Answer).
- **Structure** panel replaces Language for Applied cards (`SortEnrichmentPanel`):
  Key features · Examples or Cases · Not to be confused with · Key terms, plus the Rule type's own
  fields Applies when · Unless · Steps (edited in place, one per line). The Knowledge panel holds
  Source · Key figures · Memory hook · Picture · My note. Empty "+ …" offers follow the kind.
- Same storage as before (`_workspace_blocks` text blocks with dims structure, examples,
  neighbours, components, origin, facts): every client keeps reading and writing them.
- The card face shows the case or example (situation → what follows) instead of a sentence with a
  translation, and the kind's most useful addition ("+ Key features", "+ Case", "+ Steps").
- One quiet line under the card says what Learn can do with it and what would help most
  ("Learn: Recognise · Tell apart · Name the term · Define — Add what it is not to be confused with…").
- Capture's palette for Applied topics: Key features, Example or case, Not to be confused with,
  Source, Key figure, Key terms, Note (all saved as text blocks New can read).
- Fixed on the way: Modify no longer cuts an Applied case ("situation\n→ outcome") to its first
  line; the empty "Automatic" formatting row is hidden when the language has no layers.

## 3. Learn by kind (`src/lib/appliedExercises.ts`)

Same five positions, points and Ready rule. What differs is the library.

**Definitions** — 1 recognise (which term is defined here, its name, acronym and distinctive words
hidden; or what it is) · 2–4 from: which feature is true of it, the odd one out (only a neighbour's
*opposite* statement, never something that could be true of both), tell it apart from the term named
under "Not to be confused with" (or the nearest term of the same kind), which term an example
illustrates, which example belongs to it, type the term, complete the definition · 5 define it in
your own words (what it is = essential; the rest of the definition and its features = details), or
on even rounds: how it differs from the term it is confused with.

**Procedures** — which procedure is this / first step · order the steps · what comes next · which
step is missing (never the same step as "what comes next" in one round) · a case if there is one ·
the steps from memory (a kept-back case on even rounds).

**Figures** — what the value refers to · which value is right (wrong values keep the unit and come
from neighbouring figures first: 7 days vs 21 days) · when it applies · type the value, checked
**as a number** (8.33, 8,33 and "8.33 SDR" are right; 833 and 8.3 are not).

**Rules** — unchanged: 324 of 324 fixture rounds are byte-identical to the previous engine
(snapshot in `verification/tests/applied-rule-rounds.snapshot.json`). Rivals of a rule are still
rules and procedures only, so a definition is never offered as "Which rule says this?".

Wrong options are never invented. They come from the card and its neighbours (same collection).
A neighbour's negative ("Does not state prices") is used only where it contradicts the card.

## 4. The knowledge curve (`src/lib/knowledgeCurve.ts`)

Applied cards in Review follow widening gaps instead of "every day until Mastered":

| Rung | Next review | Review asks |
| --- | --- | --- |
| 0 | now | **Recognise** — choose it among similar ones |
| 1 | 1 day | **Recall** — produce it from a cue (type the term or value, tell apart, next step) |
| 2 | 3 days | **Explain** — define it, state the rule, list the steps |
| 3 | 7 days | **Apply** — use it on an example or a case |
| 4–6 | 16 · 35 · 80 days, then ×2 up to 180 | **Long-term** — rotates Apply / Explain / Recall |

- Again: two rungs down, due again today. Hard: same rung, half the gap. Good: one up. Easy: two up, gap × 1.3.
- One climb per calendar day; answering before the due day is practice and never climbs.
- From Learn ("ready") a card starts at Recall, due tomorrow; sent straight from New it starts at Recognise.
- **No new storage:** the curve is replayed from the grades Review already records. Without
  history it is estimated from the card's counts and marked as estimated.
- Cards are not retired: a long-term card simply comes back rarely.
- In Review: one direction per Applied card (no second question for the same card), the question
  is chosen for the card's stage, each grade button shows when the card returns ("Good · 2 wk"),
  the header names the kind ("Definition") instead of the direction, typed answers are supported.
- Study home → Review → Quality shows the curve for Applied scopes: estimated recall now, cards by
  stage, and how many are due in the next 7 days.
- Language cards: unchanged (`packCardProgress(false, …)` is the old `cardBarProgress`).

## Verification (local, 25 November 2026)

| Check | Result |
| --- | --- |
| `verification/tests/learn-knowledge-kinds.mjs` (new: kinds, 7 definitions × 4 rounds, figures, procedures, rule snapshot, curve, Review ladder, 77 Review questions) | all pass |
| `learn-applied.mjs`, `applied-review.mjs`, `learn-exercises.mjs` | all pass |
| `scripts/check-*.mjs` | 60 pass on both the uploaded original and this version; the same 3 fail on both here (they need a browser build / the real `pinyin-pro`) |
| Type check of the changed files (TypeScript 6, stubbed React/lucide/Supabase types) | no new errors compared with the original tree |
| Real `SortModal`, `LearningSession`, `CosmosWindow` in Chrome at 427 × 933 (Honor Magic6 Pro), in-memory data | New, kind menu, Structure panel, a full Learn round and Applied Review render and work; no console errors |

Not verified: `npm run build` with the project's own dependencies, live Supabase, Personal OS,
Tauri desktop and Android builds. Run them before release, and release all clients together
(an older client editing a card writes "knowledge" back over a chosen kind; the kind is then
suggested again from the content).
