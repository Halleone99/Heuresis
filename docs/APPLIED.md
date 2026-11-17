# Applied: rules, regulations, procedures and practical decisions

Revised 18 November 2026. Applied uses the same **New → Learn → Review** stages, the same
five-position Learn rounds, 10 points per exercise, the same Ready-for-Review rule (40/50 and
the last exercise right without help), the same stored rounds, Review scheduling, progress and
Mistake Log as Languages. What differs is how the five exercises are chosen.

## Which cards are Applied

A property of the **card type**: `heuresis_card_types.teaching_shape = 'rule'`
(`src/lib/teachingShape.ts`). It is never guessed from field names, titles or the collection's
knowledge mode. Before migration `20261118090000_heuresis_card_type_teaching_shape.sql` is applied,
the built-in **Rule — Applied** type is recognised by its fixed id. Customising a topic's fields
keeps its teaching shape. A language type with a "Source" field stays a language type.

The collection's mode only decides where a collection is shown and which card type is offered
first for a new topic. One collection may hold Applied and vocabulary topics.

General and Concepts will be further values (`fact`, `idea`), each with its own small library
module on the same engine; an unknown value is taught as standard until then.

## The card

Two fields are required: **Rule or procedure** and **What it requires**. When a card is
captured, **a case** (a realistic situation, and what follows in it) is shown as the most useful
optional addition; conditions, exceptions, steps and source stay under *More fields*. While the
card is written, one quiet line says what would help most ("Add a case…", "One more case lets
Learn keep one back…", "Rules it could be confused with…"). The round summary shows the same line.

- **Lists** (conditions, exceptions, steps): one per line, or separated by `;`.
- **What follows, and why**: a reason after a colon, a dash or "because" becomes a separate
  point when the case is solved ("The seller bears the loss: risk passes only on delivery").
- **More cases**: in the card window under *Cases* — the situation, then a line starting with
  `→` for what follows.
- **Provenance**: fields and notes are the user's own; *Source* records where a rule comes from;
  a case marked `origin: "generated"` (for example an AI suggestion, not built yet) is used only
  once it is marked `verified: true`.

## How a round is chosen (`src/lib/appliedExercises.ts`)

A small library, grouped by the ability it trains, always run from recognising to producing:

| Skill | Exercises | Needs |
| --- | --- | --- |
| Identify | Which rule applies here? (a case) · Which rule says this? · What does this rule require? | other rules, or a case |
| Scope | Which condition is missing? · This rule does not apply when… · Which value completes the rule? | conditions, exceptions, an amount or deadline |
| Sequence | Put the steps in order | three or more steps |
| Apply | What follows here? · Which situation does this rule cover? | cases with outcomes |
| Solve | What follows, and why? (a case kept back) · List the steps · State the rule | two cases, three steps, or nothing |
| Wording | word order, a key word, the rule's name | only when nothing above fits |

1. **Position 5** is the unaided answer: a case kept back from the round when the card has two or
   more cases with outcomes; otherwise the steps of a procedure; otherwise the rule itself.
   With both cases and steps, rounds alternate.
2. **Position 1** identifies the rule from its own material.
3. **Positions 2–4** follow the card's structure: steps → Sequence; cases → Apply; conditions,
   exceptions or amounts → Scope; neighbours with cases → an interleaved Identify. The last
   round's weak skill comes first. Wording exercises are used only when nothing else fits.

Rules that keep the questions honest (all checked by `verification/tests/learn-applied.mjs`):

- **Interleaving without misattribution.** When a neighbouring rule's case appears, the prompt
  explicitly asks whether *this card's rule* applies. Choosing the right alternative tests the
  target rule's boundary; it is never an unrelated neighbour-only question credited to this card.
  Neighbours are the most similar rules (shared key words) in the same collection.
- **No case twice in a round**; the case to solve is never shown or offered earlier, and it
  alternates between rounds.
- **Names hidden** where they would answer the question ("＿＿＿ Hamburg container terminal …").
- **Wrong options are real confusions**: the rule's own exception offered as a condition (and
  the reverse), the outcome of the rule's other cases, the same outcome with the parties swapped
  (seller ↔ buyer, employer ↔ employee …), neighbours' statements, conditions and cases, and
  nearby amounts that keep the unit and number format. Nothing else is invented.
- **Difficulty across rounds.** The first round (or one after a weak round, under 30/50) names
  the rule in "What follows here?"; later rounds leave the learner to recognise it, and Scope
  starts from exceptions.

## Free answers

The learner writes, presses **Compare**, ticks what the answer contains, and **Confirm**s.
Points are short and come from the card: the outcome, the reason, the rule; or each step; or what
the rule requires (essential) with its conditions and exceptions (details). An answer counts as
right with **every essential point and at least half of the details**; a partly right answer is
told what is missing. A tick whose point the written answer does not seem to mention (no shared
key word) gets an advisory note. Self-assessment remains self-assessment; an AI check against the
same points is a possible next step.

## Compatibility

- Migration `20261118090000_heuresis_card_type_teaching_shape.sql`: one nullable column with a
  format check, the Rule type marked `rule`, clearer labels for its two case fields, and
  `heuresis_customize_pack_structure` replaced by the same function that also copies the
  teaching shape. Additive, idempotent; no card, template, pack or other card type changes.
- The teaching shape is read by a separate request, so the existing card-type request and its
  offline copy are unchanged. Offline before that request was ever made, customised Applied
  topics are taught as standard until the next online start (the built-in type is unaffected).
- Learn tables are unchanged (`exercise_type` is free text, `plan` is JSON). Exercises carry an
  optional `uses` list (the cases they show) and judge points an optional `essential` flag.
  An older client that meets a free-answer exercise rebuilds the round for display; release all
  clients together.
- The previous round of a card is read through the existing `heuresis_learn_round_state`
  function, best effort; Learn never waits on it.

## Not yet: Review for Applied

After Learn, Review still shows an Applied card as a flashcard (**Rule → What it requires**, or
**Case → Outcome** for the single case field). Long-term practice therefore drifts back to
recall. Options, in order of value and effort:

1. **Review from the library**: a due Applied card gets one exercise (Identify or Apply on a case
   not seen recently, Solve on the scheduled days), scored automatically or by the self-check and
   recorded as Again/Good through the existing review events. Best for transfer; touches the
   Review window and the grade mapping, so it should be agreed first.
2. **Case → Outcome as the default direction** where a card has a case: cheap, but the same single
   case every time becomes familiarity, and cards without a case would need the fallback.
3. Keep Review as it is and rely on Relearn for applied practice (current behaviour).

## Verified (local, 18 November 2026)

| Check | Result |
| --- | --- |
| Language and knowledge rounds (181) before vs after | byte-identical |
| `verification/tests/learn-exercises.mjs` | all pass |
| `verification/tests/learn-applied.mjs` (22 rules from Incoterms, EU export control, procedures, IFRS 15, an example expense policy; 4 rounds each) | all pass |
| `scripts/check-*.mjs` (59) | same result as the uploaded original: 56 pass; the 3 that need a browser build fail in both |
| Migration on PostgreSQL 16 after every earlier migration (with the first Rule type), twice; customise function | passes; existing data byte-identical; customised Applied topic stays `rule`, customised language topic stays standard |
| Real `LearningSession` in Chromium at 412 × 915, three fields | full rounds, no console errors |

Not verified: the real Supabase project and Personal OS; the full `tsc && vite build` with the
project's own dependencies; Tauri and Android builds; the browser suites in `verification/tests`
that need the local database harness. Before applying the migration, compare the live
`heuresis_customize_pack_structure` with the version in
`20260821170020_heuresis_pack_custom_card_fields.sql`; the new migration replaces it.

## Applied Review — one practical question (local implementation)

Due Applied cards now receive **one** practical question rather than a definition-only flip,
when the card contains enough reliable material. `src/lib/appliedReview.ts` reuses the same
pure question builders as Learn, selecting a relevant case outcome, condition, exception,
threshold, ordered procedure or (periodically) independent written recall. It never selects
an unrelated neighbour's identification question and falls back to normal Review for a
sparse or malformed card.

Choice/sequence answers are checked before the explanation appears; written answers show
reference points and require an honest self-check. An incorrect answer can only receive
**Again** or **Hard**, while a correct answer can receive **Hard**, **Good** or **Easy**.
Review still records exactly one ordinary grade on the card's existing template direction;
there is no new scheduling algorithm, point system, migration or duplicate review history.

This extension needs a real build and Android/desktop smoke test before production release.
