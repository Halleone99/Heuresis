# Applied Review — implementation notes (17 November 2026)

## Scope

This is a targeted addition to the supplied **Applied v2** codebase. No schema changes
were made. The normal Review queue, SRS grade records, template/direction identity,
review history, offline event queue and existing non-Applied review flow remain in place.

For Applied cards with sufficient material, Review now presents one real question using
Applied Learn's deterministic builders. Most visits use a short case/condition/sequence
question, and every third visit prioritises unaided written recall with self-check.
If no suitable practical question exists, the current conventional Review is used.

## UI behaviour

- **Choice:** select one answer, Check, read the solution, then grade.
- **Sequence:** tap steps in order, Check, then grade.
- **Written answer:** write before revealing the checklist, tick only points genuinely
  included, confirm, then grade.
- Correct answers permit **Hard**, **Good** or **Easy**. Incorrect answers permit only
  **Again** or **Hard**. No question can be silently graded before its result exists.
- The global grade keyboard shortcuts continue, with the same checks on permitted grades.
- No additional points or parallel scheduling system was introduced.

## Attribution correction

The old neighbouring-rule question has been reframed as **Does [target rule] apply here?**
The learner identifies a target-rule boundary and the governing alternative. It no longer
silently counts a completely unrelated neighbour-only identification as target-card evidence.
Applied Review itself never selects such an unanchored neighbour question.

## Verification

- TypeScript/TSX files parse and transpile with TypeScript 5.x.
- A local standalone logic harness checked **132 questions** (22 Applied fixtures,
  six successive reviews each): no missing questions, invalid correct-answer checks,
  unsupported formats or wrong-card identification. These fixtures cover Incoterms,
  export control, procedures, IFRS 15 and a sample travel expense policy.
- The repository has a repeatable `verification/tests/applied-review.mjs` suite.
- The full project type check, Vite build, browsers, live Supabase, Windows and Android
  **have not been verified** in this environment because project dependencies were not
  available. Perform these checks before deploying.

## Required integration order

Merge the **Applied v2** changes and migrations first; then integrate the change set.
Do not deploy this independently on the older GitHub `main` that lacks `appliedExercises.ts`.
No additional database migration is required by this Review extension.
