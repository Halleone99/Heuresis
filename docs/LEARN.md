# Learn: five-exercise rounds (10 November 2026)

Heuresis has three connected stages that work on **one card row**:

```
NEW  ──To Learn──▶  LEARN  ──Move to Review──▶  REVIEW
 └──────────────To Review (direct)──────────────▶  │
                    ▲──────── Relearn ─────────────┘
```

| Stage | What it is | Where the state lives |
| --- | --- | --- |
| New | Unsorted cards; Sort classifies them and sends each to Learn or straight to Review | `heuresis_cards.data._sorted_at` (unchanged) |
| Learn | Initial acquisition: rounds of exactly five exercises | phase in `heuresis_cards.data._acquisition_v1` (unchanged key), rounds in the two new tables |
| Review | The existing spaced repetition, untouched | `heuresis_card_events`, `heuresis_card_stats` (unchanged) |

Moving a card between stages only changes its phase. No card is copied, no review
grade is written and no statistic or schedule is touched. A card sent straight from New
to Review arrives as an unreviewed card.

## A round

Each round has exactly five exercises, one per screen, from recognising to producing:

1. **Recognition** — choose the meaning (or the word) among other cards of the topic
2. **Reconstruction** — build the word, expression or sentence from shuffled pieces
3. **Completion** — the missing part: article (German nouns), preposition (German verbs),
   missing character (Chinese), stress (Russian, when the card marks it), missing letters
4. **Context** — the word in its example sentence, the sentence's meaning, the concept a
   description belongs to, or the definition put back in order
5. **Active recall** — type the answer from memory (a long sentence is built without help)

`src/lib/learnExercises.ts` builds the round from the card's own fields, its example
sentences (card field and Workspace example blocks) and the other cards of the topic as
distractors. Nothing is invented and no AI service is called. When a step has nothing
that fits the card, another exercise takes its place; a round always has five. A later
round rotates to other exercise types and other examples.

Answer checking reuses `src/lib/answerCheck.ts` (the Review rules): alternatives split on
`;` `/`, numbered pinyin read as tone marks, Russian stress and ё/е not counted as
spelling. Learn additionally accepts ae/oe/ue/ss for German and ignores capitals,
punctuation and spacing.

## Points and readiness

- Correct at the first attempt, without a hint: **+10**. Anything else: **0**. Maximum **50**.
- *Try again* and *Review mistakes* are practice. They are recorded (`corrected_at`) and
  never change the score.
- **Ready for Review** = at least 40/50 **and** the fifth exercise right without a hint.
- Otherwise the card stays in Learn, the summary says what is missing, and *Start another
  round* creates a new round with different exercises.
- Each round keeps its own score. The latest round decides readiness; earlier rounds stay
  as history.

## Database (migration `20261110120000_heuresis_learn_rounds.sql`)

Additive; no existing row is rewritten; safe to run more than once.

| Object | Purpose |
| --- | --- |
| `heuresis_learn_rounds` | one round: card, cycle, round number, the five exercises as shown (`plan`), status, score, readiness, timestamps |
| `heuresis_learn_attempts` | the first answer to each exercise: stage, exercise type, right/wrong, assisted, points, response, expected, `corrected_at` |
| `heuresis_learn_begin_round` | starts a round or returns the unfinished one (same round after a refresh, on another tab or device) |
| `heuresis_learn_record_attempt` | records one first answer; computes points and readiness |
| `heuresis_learn_mark_corrected` | notes that a wrong answer was practised afterwards |
| `heuresis_learn_overview` | Learning state of the given cards and activity per topic, in one request |
| `heuresis_learn_round_state` | one round with its answers |
| `heuresis_card_state_changes` | gains the kind `learning_phase`: every New → Learn, New → Review, Learn → Review and Review → Learn is logged with its time by the existing card trigger |

Why scoring cannot be duplicated:

- the tables are read-only to the client; only the functions write;
- an attempt's key is `(round_id, position)` with `position` 1–5, and positions must be
  recorded in order;
- the database, not the caller, decides the points
  (`points = 10` only when `correct and not assisted`, enforced by a constraint);
- a card has at most one unfinished round (partial unique index);
- so a double click, a refresh, a retry or a replayed offline request repeats the same
  key and changes nothing.

Row-level security limits every row to its owner. Until the migration is applied, Learn
says that a database update is needed; New and Review work as before.

## Interface

- `src/components/LearningSession.tsx` — the session: header (exit, context, five-segment
  progress, points), one exercise, feedback and Continue, round summary, end-of-session
  screen. Keyboard: `1–9` choose / pick a piece, letters fill gaps, `Backspace`, `Enter`
  check / continue, `Esc` exit. Respects `prefers-reduced-motion`.
- `src/components/TodayStudyPanel.tsx` — the **New | Learn | Review** selector. Counts:
  New cards · Learning · Ready for Review · Exercises today · exercises and
  right-first-time rate over seven days · reviews completed. The three stages never overlap.
- `src/components/SortModal.tsx` — *To Learn* / *To Review*.
- `src/components/CosmosWindow.tsx` — *Relearn* on any revealed card; after two missed or
  partial results in the last five reviews it becomes *Missed repeatedly · Return to Learn*.
  The Mistake Log rule (only repeated mistakes) is unchanged.
- An unfinished round is resumed at the same exercise after leaving or refreshing. A small
  device copy lets answers given while the server is unreachable be sent later.

## Earlier ten-exercise Learning

Cards that were in the earlier Learning keep their phase. Their recorded exercises stay in
the card's history and still count as Learning activity. A card that had completed all ten
exercise types stays Ready for Review; any other card starts five-exercise rounds.

## Tests

- `verification/tests/learn.mjs` — the real app in Chromium against PostgreSQL + PostgREST
  with row-level security: 13 scenarios.
- `verification/tests/learn-exercises.mjs` — exercise generation and answer checking,
  without a browser.
- `verification/tests/learn-migration.sh` — the migration on a database that already holds
  data, applied twice.

What each scenario proves is listed in `verification/README.md`.

### Verified on 10 November 2026 (local harness only)

| Check | Result |
| --- | --- |
| `tsc --noEmit` and `vite build` | pass |
| `learn.mjs` | 13 scenarios, 195 checks, all pass |
| `learn-exercises.mjs` | all pass |
| `learn-migration.sh` | all pass (30 existing tables and the policy list unchanged; second run changes nothing) |
| `regressions`, `study-polish`, `clarity`, `review-v3`, `android-tablet` | identical, check by check, to the same suites run on the supplied archive (see below) |

The five existing suites already fail in places on the supplied archive, because they look
for controls that earlier interface changes renamed or moved (for example
`.topic-browse-actions button:has-text("Show all")`, which stops every `android-tablet`
scenario at its first step, and `.review-command`, which now matches two buttons). They
were run on the archive and on this version: 53/3, 2/0, 58/7, 63/6 and 0/14 passed/failed
in both, with the same checks passing and failing. They therefore show no regression, but
they also do not exercise everything they were written for. The regression comparison was
made before the last Learn-only edits (two extra exercise types, the emphasised stressed
vowel, and two function names added to the read-timeout list in `src/lib/supabase.ts`);
`learn.mjs`, the exercise checks and the build were run after them.

### Not verified

- Nothing was applied to, or run against, the real Supabase project. The migration has
  only been applied to local PostgreSQL 16 built from this repository's migrations.
- The Tauri desktop build (Windows) and the Android APK were not built or run; the tablet
  scenario uses the Android WebView stand-in in Chromium.
- Personal OS, which shares the database, was not tested. It does not know the new tables;
  it reads and writes `_acquisition_v1` on cards exactly as before.
- Starting Learn while the server is unreachable (answers given offline inside a round
  that was started online are covered).
- Real input methods (a Chinese IME, a Russian keyboard layout) on a device; composition
  events are respected in code and typed answers were entered programmatically.

### Known limits

- Exercises use only what the card and its topic contain. A card with no example sentence
  gets no sentence exercise; German conjugation, Russian aspect and cases are asked only
  as far as the card's own text carries them (an aspect pair written `читать / прочитать`,
  a stress mark, an inflected form in the example).
- A topic with one or two cards cannot supply distractors, so its rounds lean on building,
  gap-filling and typing. A very short word alone in a topic can repeat an exercise type.
- Returning a card to Learn after repeated Review mistakes is offered in one click; it is
  not done silently.
