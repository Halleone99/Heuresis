# Sort and Review, stage 3: implementation report (15 October 2026)

**Base.** Commit `bdd65d03c46a2684735f1ab00dec19adff28dde3`, the supplied ZIP.
`heuresis-sort-review-v3-full.patch` is the complete unified diff against that commit.
It includes the clarity pass of the same day, which was delivered earlier as
`Heuresis-clarity-2026-10-15.zip` and is documented in `docs/CLARITY_PASS_2026-10-15.md`.

`heuresis-sort-review-v3-incremental.patch` contains only this stage, on top of the
clarity pass. Both patches apply with `git apply -p1` from the project root.

**Scope.**
- Sort, Review (the launcher, the Review window and the recommendations), knowledge
  states, importance, the topic page, Trash, and one offline bug found by the new tests.
- No database migration and no new dependency.
- Stored grade values (`again`, `hard`, `good`, `easy`) and the 1–5 `interest_rank`
  scale are unchanged.

---

## 1. What changed

### 1.1 Review is one click; Adjust holds the choices

- **Review starts at once.** The topic's **Review** button opens a recommended session
  immediately. There is no setup dialog.
  - It reuses the directions and session size last chosen in Adjust.
  - It is always *recommended*; the other Adjust choices apply when you start from Adjust.
  - A double click opens one window, not two.
- **Adjust**, next to Review (`StudyModal.tsx`), keeps every manual choice:
  - directions: both, or one;
  - cards: Recommended, All learning cards, Never reviewed, Favourites, Core, Often missed;
  - session size;
  - order: topic or random. When the cards are Recommended, the recommendation sets the
    order, and Adjust says so instead of showing a switch that does nothing.
- **Adjust remembers its choices per topic** (`src/lib/reviewPrefs.ts`, key
  `heuresis.review.prefs.v1:<topic id>`, kept on the device).
- **Default session: 20 cards.**
- **Review windows** stay separate desktop windows, as before. On Android, Review opens
  in the app.

### 1.2 Sort opens straight into the queue, with four outcomes

`SortModal.tsx` was rewritten.

- **No setup step.** Sort opens on the first unsorted card.
- **Filter** (top bar) narrows the queue by search, tags or a number of cards, and sets
  the order. Escape closes Filter first, even from its search field.
- **Learn it** has three levels: **Core / Useful / Peripheral**. Keys are C / U / P,
  and digits 1–5 still work. Each sends the card to Learning.
- **Reference**: keep it to look up, never reviewed (key R).
- **Discard**: recoverable (key D or Delete).
  - **Undo** bar and **Ctrl+Z** (also undoes Reference).
  - The pass summary says the card is "in Trash".
- **Later**: stays unsorted (key L or S).
- **Tags** sit behind one **Tags** control (key T). All tag functions remain.
- **End of a pass**: **Review now** opens the recommended session.
- **Favourite** is unchanged and separate from importance.
- **Input methods**: Enter in the filter search ignores input-method composition,
  checking both `isComposing` and keyCode 229, as WebKit sends on macOS and Linux.

### 1.3 Importance: Core / Useful / Peripheral

`src/lib/importance.ts` maps importance onto the existing 1–5 values.

| Shown | Stored when chosen | Existing values read as |
|---|---|---|
| Core | 5 | 4–5 |
| Useful | 3 | 3 |
| Peripheral | 1 | 1–2 |

- Existing 2s and 4s are kept until you change them. The card editor shows them as
  "Core (kept as 4 / 5)".
- **Where the levels appear:**
  - the topic table: column, filter and sort;
  - the card editor;
  - Browse: filter, order and card badge;
  - Settings, Sorting, which also lists the Sort keys.
- **Wording.** "Core" replaces "High interest" in Catalogue and in Adjust's card choices.

### 1.4 Direction-specific, explainable recommendations

The engine is `src/lib/recommend.ts`. It scores each card in each direction:

```
score = (0.62 × need[state] + 0.38 × time) × importance
need:        Needs work 1.0 · Not tried 0.70 · Developing 0.65 · Holding 0.30 · Strong 0.12
time:        log(1 + days) / log(46), capped at 1 (days since this direction was last
             answered); 0.5 for directions never tried; evidence, never a deadline
importance:  Core 1.00 · Useful 0.95 · unset 0.92 · Peripheral 0.88 (at most a 12 % nudge)
```

- **Importance cannot dominate.** A Peripheral card that needs work, scoring about 0.69,
  outranks a Core card that is Developing, scoring about 0.56.
- **New and familiar cards mix without a fixed ratio.**
  - Each new card chosen makes the next new card about 14 % less attractive.
  - Each familiar card chosen makes the next familiar card about 8 % less attractive.
  - Weak cards still come first, but a large familiar backlog can no longer shut new
    cards out.
  - With 40 untried cards beside 40 other cards, a 20-card session holds:

    | The other 40 cards | New cards in the session |
    |---|---|
    | Developing, last answered 3 days ago | 9 |
    | Developing, last answered 10 days ago | 7 |
    | Developing, last answered 40 days ago | 6 |
    | Need work | 6 |
    | Strong | 16 |

- **Opposite directions are kept apart.**
  - The second direction of a card already chosen is discounted (× 0.55).
  - The two directions are placed at least three positions apart when possible, and
    never side by side unless nothing else is left.
  - This also holds across "10 more" and "Retry missed": the next round never starts
    with the card just answered.
- **Why? explains each card in plain sentences.** Examples:
  - "Missed last time in Chinese → English."
  - "Not tried in English → Chinese yet."
  - "Peripheral, but included because the results are weak."
  - "Marked Core."
- **Which directions are recommended.** Recommended sessions use the topic's default
  direction and its reverse when one exists, or the directions chosen in Adjust.
- **Where the evidence comes from.** `src/lib/reviewEvidence.ts` reads up to the 4,000
  most recent graded events of the topic, plus results waiting in the offline queue.
  When the history cannot be read, for example offline before it was ever loaded, the
  stored counts are used instead.

### 1.5 Knowledge states, per direction and from evidence only

`src/lib/knowledgeState.ts` assigns each direction one state:

| State | Rule |
|---|---|
| **Not tried** | no result in this direction |
| **Needs work** | last result Missed, or less than half successful after two or more tries |
| **Developing** | anything in between |
| **Holding** | ≥ 3 results, ≥ 70 % successful, the last two successful, successes on ≥ 2 separate days |
| **Strong** | ≥ 5 results, ≥ 85 % successful, the last three successful, successes on ≥ 3 separate days |

- **Successes on the same day count once** towards Holding and Strong, so repetition is
  not mistaken for knowledge.
- **Old evidence is less certain.** If the latest evidence is more than 120 days old,
  Strong and Holding drop one step. The tooltip says why.
- **Without the full event history**, the stored counts decide, and never beyond
  Holding. This applies offline and to history older than the 4,000-event window. A new
  success therefore never lowers a state.
- **Partial counts as half a success. Secure is a success, not mastery.**
- **Older results without a direction.** Results recorded by older sessions without a
  direction (`template_id` null) count for the topic's **default direction only**. The
  other direction honestly shows **Not tried**. This avoids resetting existing history
  to "Not tried".

### 1.6 The Review session (`CosmosWindow.tsx`, `RetentionPractice.tsx`)

- **Results are named Missed / Partial / Recalled / Secure**, with keys 1–4. The
  stored values are unchanged, so all existing history stays as it is.
- **The way you answer is a session setting**, changeable in the top bar and remembered:
  - in my head;
  - saying it aloud;
  - typing it;
  - writing it by hand;
  - listening first: the prompt is read aloud.

  When the method is saying, typing or writing, it is recorded once per card as
  practice, and that method is not offered again as an extra on the same card.
- **Typed answers get a suggested result, never a final one** (`src/lib/answerCheck.ts`).
  - The suggested button is highlighted. The learner clicks or presses the result, and
    revealing records nothing by itself.
  - **Recalled**: an exact match with any accepted answer. For example, when typing a
    meaning such as "when; while; at the time of", "while" is accepted.
  - **Partial**: only tone marks or accents differ, a German article is missing
    ("Hund" for "der Hund"), or one or two letters are off.
  - **Missed**: otherwise.
  - **No verdict** for a free translation of a long sentence.
  - **Chinese**: numbered pinyin ("yi3hou4") is read as tone marks; spaces in pinyin and
    Chinese are ignored; characters committed by an input method are checked like any
    other text.
  - **Russian**: stress marks are ignored, and ё equals е.
  - **German**: umlauts count as accents. Noun notation ("der Hund, -e") accepts
    "der Hund".
  - **Alternatives.** These separators split alternatives in every field: `;` `；` `|`
    `/` and numbered senses. Commas split them only in the meaning of a word card, and
    only when the meaning reads as a list of short glosses. Terms and sentences are never
    split on commas, so "Ja" is not accepted for "Ja, ich weiß.".
  - **Enter** submits the answer, never during input-method composition (`isComposing`
    or keyCode 229).
- **The question stays visible** above the revealed answer, in a quieter style.
- **Details drawer** (D, or the Details button) replaces the seven card-information
  tabs.
  - Sections: examples, related words, parts, grammar/structure, origin, facts, notes.
  - Empty sections collapse into one "Add" row.
  - It can be pinned open for every card.
- **End of a session**: **Retry missed**, **10 more** (when something is left to
  recommend) and **Done**.
- **The summary is in words**:
  - the results;
  - recognition compared with production, with the direction names;
  - the missed words;
  - how many cards moved up or down a state;
  - how a retry went.

  Each card is counted once even after a retry.

### 1.7 The topic page (`PackView.tsx`)

- **Stage bar: Unsorted → Learning · Reference.** Each stage is a filter. Reference
  cards stay reachable here and in the card editor.
- **A line of knowledge states** sits under the stage bar. It shows the weakest
  direction per card, and each state is a filter.
- **The STATE column** shows each direction's state with a coloured dot, for example
  "Recognise · Holding / Produce · Not tried". Reference and unsorted cards show their
  stage instead. The column was widened so the importance column no longer overlaps it.
- **The card editor** offers **Keep as reference / Move to Learning**. Moving to
  Learning now marks the card as sorted, so it goes to Learning and Review rather than
  back to Unsorted.
- **Counts leave out discarded cards**, in the topic header and in Library.
  `listPacks()` subtracts them.

### 1.8 Discard and Trash

- **How a discard is stored.** A discard writes `_discarded_at` into the card's data,
  through the existing `heuresis_patch_card_data` RPC. No migration was needed, and the
  card keeps its id and history.
- **Where discarded cards are hidden:** `listAllCards`, `listCards`, card search, topic
  counts and Library counts.
- **Trash** (account menu → Trash & export) lists discarded cards from every topic,
  archived ones included.
  - **Restore** returns the card to Unsorted with its history.
  - **Delete permanently** asks for confirmation first.
  - Restoring updates an open topic at once.
  - Escape still closes Trash after a restored row disappears.

---

## 2. Bugs found and fixed while testing this stage

1. **Offline updates were replayed with a new primary key** (`offlineFetch.ts`). This
   bug existed before this stage.
   - **Cause.** The offline queue added a client id and `role: "main"` to *every*
     queued write, including PATCH updates.
   - **On reconnecting** the server was asked to change the card's id. It answered 409,
     so an importance decision made offline was lost and the sync showed a held item.
   - **Offline**, the cached card was re-keyed, so later offline edits of the same card
     missed it.
   - **Fix.** Client ids are added to inserts only, and a cached row keeps its id.
   - **Updates queued by an older version** have the injected id and role removed
     before they are sent (`withoutInjectedIds`, covered by
     `scripts/check-offline-revision-chain.mjs`).
2. **The offline cache did not understand JSON-path filters** such as
   `data->>_discarded_at`. It does now, so Trash and the counts also work from the
   device copy.
3. **Escape did nothing in Sort's filter search.** Fixed.
4. **The Sort top bar stacked Filter above Close.** Fixed.
5. **Restoring a card from Trash did not refresh an open topic.** Fixed: the topic now
   listens for `heuresis:study-changed`.
6. **Escape could not close Trash once the focused row had been restored.** Fixed.
7. **"Retry missed" and "10 more" could delete practice recorded earlier in the
   session.** The practice RPC toggles per session and card, and the client forgot what
   it had already recorded. Fixed.
8. **The summary counted a retried card twice.** Fixed.
9. **The card editor ignored Escape and Ctrl+Enter only during `isComposing`, not
   keyCode 229.** Fixed.
10. **Wording left over from Again and High interest** in Catalogue and Browse. Fixed.

## 3. Independent challenge

A separate review agent read the full diff against the base, without having written any
of it, and tried to break the rules of this stage with throwaway scripts. It reported
12 findings, of which 8 were confirmed by reading or running:

| # | Finding | Outcome |
|---|---|---|
| 1 | Retry / 10 more could delete practice recorded earlier in the session | Fixed. Browser test "retry keeps practice". |
| 2 | Typed answers accepted fragments ("Ja" for "Ja, ich weiß.", "e" for "der Hund, -e", "der Wand" for "an der Wand") | Fixed with field-aware alternatives. 14 new unit checks. |
| 3 | The summary was wrong after a retry | Fixed. Browser test. |
| 4 | Opposite directions could be adjacent when avoidable; Retry and 10 more were not spaced | Fixed. Unit and browser tests. |
| 5 | A success could lower a state when the history was partial | Fixed. Unit test. |
| 6 | New cards were shut out by a large familiar backlog | Fixed with the familiar damping. Unit tests. |
| 7 | Sort filter Enter during WebKit composition | Fixed. |
| 8 | Move to Learning put the card into Unsorted | Fixed. Browser test. |
| 9 | A double click on Review opened two windows | Fixed with a guard. |
| 10 | Counts included discarded cards; Trash missed archived topics; Trash hid load errors; leftover wording | Fixed. |
| 11 | Updates queued by an older version keep the injected id | Fixed (`withoutInjectedIds`). |
| 12 | "Cafe" for "Café" was explained as a tone difference | Fixed: the wording now names accents. |

The new browser suite found five problems before that review:
- the offline primary-key bug;
- Escape in Sort's filter search;
- Escape in Trash after a restore;
- Restore in Trash not refreshing the topic;
- Library counts.

## 4. Data and compatibility

- **No migrations; nothing is rewritten in the database.**
- **Stored values are unchanged:** grade values, `interest_rank`, `retention`,
  `_sorted_at`, events and statistics.
- **One new data key**, `_discarded_at`, written only by Discard. Restore sets it to
  JSON null.
- **Kept on the device only:**
  - `heuresis.review.method.v1`
  - `heuresis.review.prefs.v1:<topic>`
  - `heuresis.review.detailsPinned.v1`
  - `heuresis.sort.order.v1`
- **Offline:**
  - Sort decisions (importance included), Discard and Undo work offline and are
    synchronised later; the browser test covers this. Restore from Trash uses the same
    offline path but was not browser-tested offline.
  - Review results go to the existing study-event queue.
- **Languages.** German, Russian and Chinese input, pinyin conversion and composition
  guards are covered by unit and browser tests.

## 5. Not done, or only partly done

- **Personal OS** (a separate app) does not know about `_discarded_at`, so it still
  shows discarded cards. The fix belongs in Personal OS: hide cards whose
  `data._discarded_at` is set.
- **Explored percentage.** The server view's `encountered_cards` still includes
  discarded cards that had been seen, so "% explored" can be slightly high. Correcting
  it properly needs a view change, which was left out to avoid a migration.
- **The legacy "Sort" mode of the Review window** still shows Interest 1–5. It can only
  be opened by URL; no button reaches it. It was left as it is.
- **Undo after Learn.** Sort's Undo covers Discard and Reference. To change a Learn
  decision, open the card editor (importance, Keep as reference). Undoing Learn would
  also need `_sorted_at` and tags rolled back, so it was left for a later stage.
- **Long histories.** History beyond the 4,000 most recent graded events per topic is
  read from the stored counts. Cards whose events fall outside that window can show at
  most Holding.
- **Recommendations ignore** tags, the Mistake Log and related words. These could be
  added as further plain-language reasons.
- **Typed-answer checking is heuristic.**
  - Free translations of long sentences get no suggestion.
  - Handwriting and speech are recorded as practice, not recognised.
  - Listening uses the system's text-to-speech voices.
- **Not run here:** the Tauri desktop build (separate Review windows), the Android
  build, and real WebKit input methods.
  - Composition handling was tested in Chromium with synthetic `isComposing` and
    keyCode 229 events.
  - Tauri and Android builds need their toolchains.

## 6. How to test by hand

1. Open a topic that has unsorted cards and press **Sort**.
   - It opens on a card.
   - Try **C / U / P**, **R**, **D** then **Undo**, **L** and **T**.
   - Open **Filter** and press **Escape**: Filter closes, Sort stays open.
2. Finish the pass and press **Review now**. Check that:
   - a Review window opens;
   - **Why?** explains the card;
   - opposite directions are never consecutive;
   - **1–4** record Missed / Partial / Recalled / Secure.
3. In the Review window, set **Answering → Typing it**. On an English → Chinese card:
   - type with a pinyin input method: Enter only confirms candidates;
   - type numbered pinyin (`yi3hou4`), then toneless pinyin, and compare the suggestions;
   - pick a different result than suggested: your choice is recorded.
4. Press **D** after revealing to open Details, and pin it.
5. At the end, check the summary, then try **Retry missed**, **10 more** and **Done**.
6. On the topic page, check:
   - the Unsorted → Learning · Reference stages and the per-direction states;
   - the Importance filter;
   - **Adjust**: change directions and size, close, and reopen to see them remembered.
7. Account menu → **Trash & export**: **Restore** and **Delete permanently** discarded
   cards.
8. Offline: disconnect, sort a card (Core) and discard another, then review three cards.
   Reconnect: everything reaches the server.

## 7. Automated checks

Run from the project root, and from `verification/` for the browser suites:

```
npx tsc --noEmit -p .                                   # TypeScript
npx tsc --noEmit -p . --noUnusedLocals --noUnusedParameters
for s in $(grep -oE "scripts/check-[a-z0-9-]+\.mjs" .github/workflows/check.yml); do node $s; done
npm run build
cd verification && node tests/regressions.mjs && node tests/study-polish.mjs \
  && node tests/clarity.mjs && node tests/review-v3.mjs
```

Results for the delivered tree. The full check-by-check output is in
`docs/SORT_REVIEW_V3_TEST_RESULTS.md`.

| Check | Result |
|---|---|
| `tsc --noEmit` (also with `--noUnusedLocals --noUnusedParameters`) | 0 errors |
| Static checks (`check.yml`), including `check-review-engine.mjs` | 39 / 39 passed |
| `npm run build` | built |
| Rendered appearance, 8 palette/mode pairs | passed |
| `review-v3.mjs` (new): Sort → Review → grading, 10 more, Discard / Undo / Trash, Chinese typed answers and IME, offline recovery, Adjust, topic states, retry practice, Review window | 97 / 97 |
| `regressions.mjs`, including the learning loop and offline scenarios | 57 / 57 |
| `study-polish.mjs` | 32 / 32 |
| `clarity.mjs` | 55 / 55 |
| **Browser total** | **241 passed, 0 failed** |

Existing tests changed because the intended flow changed; none was removed:
- **`regressions.mjs` learning loop:** Sort opens on the queue, so Filter is used to
  narrow it. Key 4 now means Core, stored as 5. Review opens from **Review now**, and
  the grade must carry its direction.
- **`study-polish.mjs`:** the launcher checks moved to **Adjust**, and Sort's order
  control is checked inside Filter.
- **`clarity.mjs`:** stages are Unsorted / Learning / Reference, Sort shows "1 / 2",
  Adjust counts "5 learning", and Sort has four outcomes with the levels C / U / P.
