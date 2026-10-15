# Sort and Review, stage 3: exact test results (15 October 2026)

All results below are from the final tree delivered in this ZIP, run in sequence after the last code change.

Browser logs list one line per check (✓ passed, ✗ failed). The expected browser console noise is left out: refused connections in the "server unreachable" and offline scenarios.

**Environment:** Node 22.22.0; TypeScript 5.7.3; Vite 6.4.3; Chromium 141.0.7390.37 (Playwright 1.64.0); PostgreSQL 16.15; PostgREST 12.2.3. The database is a disposable local copy restored from `verification/sql` (showcase fixture) before each scenario, and the sign-in goes through `verification/gateway.mjs`.

## Summary

| Check | Result |
|---|---|
| TypeScript `tsc --noEmit` | 0 errors |
| TypeScript with `--noUnusedLocals --noUnusedParameters` | 0 errors |
| Static checks in `.github/workflows/check.yml` | 39 passed, 0 failed |
| `npm run build` | built (1,802 modules); the usual warning that one chunk is over 500 kB |
| Rendered appearance (`check-rendered-appearance.mjs`) | passed: Rendered Chrome: 8 palette/mode combinations passed for 11 header/dialog/disabled labels and Capture placeholder. Screenshots saved. |
| Browser: `verification/tests/review-v3.mjs` | 97 checks passed, 0 failed (exit 0, 137 s) |
| Browser: `verification/tests/regressions.mjs` | 57 checks passed, 0 failed (exit 0, 154 s) |
| Browser: `verification/tests/study-polish.mjs` | 32 checks passed, 0 failed (exit 0, 13 s) |
| Browser: `verification/tests/clarity.mjs` | 55 checks passed, 0 failed (exit 0, 83 s) |
| **Browser total** | **241 passed, 0 failed** |

## Unit checks of the review engine (`scripts/check-review-engine.mjs`)

These cover:
- results and importance labels;
- knowledge states: evidence, separate days, old evidence, partial history, results without a direction;
- recommendations: importance cannot dominate, new and familiar cards mix (including a large backlog), directions never adjacent, 10 more never repeats;
- typed-answer suggestions: Chinese numbered and toneless pinyin, German umlauts, articles and noun notation, Russian stress and ё, sentence fragments, free translations.

```
Review engine, knowledge states, importance levels and typed-answer suggestions: checks passed.
```

`scripts/check-offline-revision-chain.mjs` adds checks for the offline fix:
- client ids go on inserts only;
- a cached row keeps its id;
- updates queued by an older version lose the injected id and role.

```
Offline revision chaining helpers passed.
```

## Sort → Review → grading, Chinese input, offline recovery and the rest of the new suite (`review-v3.mjs`, complete output)

```
— sort → review → grading: one click, recommended, explained and summarised
  ✓ C learns 马上 as Core (stored as 5)
  ✓ P learns 最近 as Peripheral (stored as 1)
  ✓ the pass ends with a summary of the decisions
  ✓ Review starts a recommended session without a setup step
  ✓ the session covers both directions of the seven Learning cards (default 20, here 14)
  ✓ "Why?" explains the recommendation (“Not tried in Chinese → English yet. Marked Core.”)
  ✓ results are Missed / Partial / Recalled / Secure
  ✓ the question stays visible above the revealed answer
  ✓ every result is recorded (14)
  ✓ every result is recorded with its direction
  ✓ no card and direction is asked twice in one session
  ✓ the opposite direction of a card never follows it immediately
  ✓ both directions are recommended
  ✓ the summary states the results in words
  ✓ the summary compares recognition and production
  ✓ the summary names the missed word
  ✓ 10 more is not offered when nothing else is left to recommend
  ✓ Retry missed asks only the missed card
  ✓ in the same direction it was missed
  ✓ after a retry the summary still counts each card once and reports the retry separately
  ✓ after the retry only Done remains
  ✓ no page errors
— ten more continues with new recommendations and never repeats
  ✓ 10 more is offered at the end of a session
  ✓ the next round has the five remaining recommendations (got 5)
  ✓ no card and direction from the first round is repeated
  ✓ no page errors
— discard is recoverable through undo and trash
  ✓ D discards 最近 (kept in the database)
  ✓ an Undo bar names the discarded card
  ✓ Undo restores it
  ✓ and brings it back as the current card
  ✓ Ctrl+Z also undoes a discard
  ✓ the summary says where discarded cards went
  ✓ a discarded card leaves the topic
  ✓ the topic count leaves it out
  ✓ the Library count leaves it out too (“6 CARDS · 1 UNSORTED”)
  ✓ the card left for later is still unsorted
  ✓ Trash lists the discarded card
  ✓ Restore in Trash brings it back
  ✓ Escape still closes Trash after the restored row disappears
  ✓ the restored card is back in the topic
  ✓ Delete permanently (after confirmation) removes it for good
  ✓ no page errors
— typed chinese answers get suggested results and input-method enter never reveals
  ✓ Typing it shows an answer field in the session
  ✓ Enter during IME composition does not reveal the answer
  ✓ revealing records no result by itself (以后)
  ✓ the suggested result is highlighted, not chosen
  ✓ revealing records no result by itself (已经)
  ✓ the suggested result is highlighted, not chosen
  ✓ revealing records no result by itself (刚才)
  ✓ the suggested result is highlighted, not chosen
  ✓ revealing records no result by itself (以前)
  ✓ the suggested result is highlighted, not chosen
  ✓ revealing records no result by itself (的时候)
  ✓ the characters committed by an IME are Recalled (以后: Recalled)
  ✓ numbered pinyin is Recalled (已经: Recalled)
  ✓ pinyin without tones is Partial (刚才: Partial)
  ✓ a wrong word is Missed (以前: Missed)
  ✓ an empty answer gets no suggestion
  ✓ the learner's own choice (Secure) is what is recorded, not the suggestion
  ✓ no page errors
— offline recovery: sort, discard and review results made offline reach the server
  ✓ Sort keeps working offline
  ✓ without error messages
  ✓ nothing has reached the server yet
  ✓ the offline topic shows both decisions
  ✓ the card discarded offline is hidden
  ✓ after reconnecting the Core decision is on the server
  ✓ and so is the discard
  ✓ Review continues offline
  ✓ offline results wait on the device
  ✓ after reconnecting all three results reach the server
  ✓ with their directions
  ✓ no page errors
— adjust remembers choices and review reuses them in one click
  ✓ Adjust starts the session it describes
  ✓ Adjust remembers One direction
  ✓ and which direction
  ✓ and which cards
  ✓ one-click Review stays recommended and uses the remembered direction
  ✓ the session shows that direction
  ✓ no page errors
— topic shows unsorted, learning and reference, evidence states and importance
  ✓ stages read Unsorted 0 → Learning 6 · Reference 1 (got 0/6/1)
  ✓ the Reference filter shows the reference card
  ✓ a new Learning card is Not tried in both directions
  ✓ and shows its importance as Useful
  ✓ results recorded before directions existed still count for the default direction (“RECOGNISE Strong PRODUCE Not tried”)
  ✓ while the other direction is honestly Not tried
  ✓ a reference card can be moved to Learning from its editor (into Learning, not back to Unsorted)
  ✓ no page errors
— retry keeps the practice already recorded in the session
  ✓ saying the answer aloud is recorded once per card
  ✓ retrying the missed card neither removes nor duplicates that record
  ✓ no page errors
— review window: answering method and details drawer
  ✓ the answering method can be changed during Review
  ✓ the session method (said aloud) is recorded for the card without a second click
  ✓ and is not offered again as an extra
  ✓ D opens one Details drawer instead of seven tabs
  ✓ a pinned drawer stays open on the next card
  ✓ the answering method is remembered for the next session
  ✓ no page errors
```

## Existing suites

### `regressions.mjs`: learning loop and offline scenarios

```
— offline edits all reach the server
  ✓ three offline autosaves are queued
  ✓ every offline edit and the edit typed on reconnecting are on the server
  ✓ the offline queue is empty
  ✓ no permanent sync problem
  ✓ no conflict error while typing during reconnection
  ✓ no page errors
— offline edit conflicting with another device is held, not overwritten
  ✓ the other device's edit is not overwritten
  ✓ the sync dialog explains the refused edits
  ✓ every refused edit is listed for review (2)
  ✓ the note offers to restore the unsynced text from this device
  ✓ no page errors
— server unreachable: the device copy is shown and captures are not called stored
  ✓ the Notebook opens from the device copy
  ✓ the capture is reported as kept on this device (“Saved on this device — will sync to German › Inbox.”)
  ✓ it reaches the server once the server is back
  ✓ no page errors
— learning loop: capture → flashcard → sort → review
  ✓ the card is in the Chinese topic with its meaning
  ✓ Sort button tells the user exactly how many cards are prepared
  ✓ Sort shows extra card details with keyboard Enter
  ✓ Sort hides extra details with keyboard Space
  ✓ sorting stores importance (Core) and completion
  ✓ the review grade is recorded with its direction
  ✓ no page errors
```

### `regressions.mjs`: all scenarios

```
— offline edits all reach the server
  ✓ three offline autosaves are queued
  ✓ every offline edit and the edit typed on reconnecting are on the server
  ✓ the offline queue is empty
  ✓ no permanent sync problem
  ✓ no conflict error while typing during reconnection
  ✓ no page errors
— offline edit conflicting with another device is held, not overwritten
  ✓ the other device's edit is not overwritten
  ✓ the sync dialog explains the refused edits
  ✓ every refused edit is listed for review (2)
  ✓ the note offers to restore the unsynced text from this device
  ✓ no page errors
— flashcards stay in the note's language
  ✓ a Russian note is not preselected into a Chinese or German topic
  ✓ the dialog says why nothing is preselected
  ✓ Escape closes the flashcard dialog
  ✓ a Chinese note defaults to a Chinese topic
  ✓ Ctrl+K does not open the palette underneath an open dialog
  ✓ no page errors
— palette: Enter opens what was typed
  ✓ a note whose title matches opens instead of “Capture a note”
  ✓ a command named by the query stays first
  ✓ no page errors
— record mistake from a language tab files it in that language's Inbox
  ✓ destination is German › Inbox (was “German › Inbox”)
  ✓ no page errors
— capture: choosing a mistake type replaces the custom mode
  ✓ the custom mode is shown in Capture
  ✓ the visible choice (Grammar) is what is saved (got grammar|none)
  ✓ no page errors
— organise inbox uses the language being worked in
  ✓ the German Inbox opens while working in German (got “German › Inbox”)
  ✓ no page errors
— capture while the notebook is still loading does not offer to create languages
  ✓ no “Where should your notes live?” prompt while languages are loading
  ✓ the three languages appear once loaded
  ✓ no page errors
— progress keeps one colour per language
  ✓ Chinese has the same colour in every chart
  ✓ no page errors
— tablet portrait: the Notebook drawer neither peeks out nor opens displaced
  ✓ the closed drawer is hidden behind the sidebar (right edge -24, sidebar 60)
  ✓ the open drawer starts at the sidebar edge (60 vs 60)
  ✓ no page errors
— narrow window: the icon rail closes again after choosing a section
  ✓ the rail does not stay expanded over the page (60px)
  ✓ no page errors
— long lists render in pages and still reach old records
  ✓ the first 120 mistakes render at once
  ✓ Show more adds the next page
  ✓ a mistake opened from search is rendered and highlighted, even far down the list
  ✓ no page errors
— undo restores a move and a status change, even after leaving the page
  ✓ the note moved
  ✓ Undo after leaving the note moves it back
  ✓ marked as understood
  ✓ Undo restores both the status and the recall date
  ✓ no page errors
— server unreachable: the device copy is shown and captures are not called stored
  ✓ the Notebook opens from the device copy
  ✓ the capture is reported as kept on this device (“Saved on this device — will sync to German › Inbox.”)
  ✓ it reaches the server once the server is back
  ✓ no page errors
— learning loop: capture → flashcard → sort → review
  ✓ the card is in the Chinese topic with its meaning
  ✓ Sort button tells the user exactly how many cards are prepared
  ✓ Sort shows extra card details with keyboard Enter
  ✓ Sort hides extra details with keyboard Space
  ✓ sorting stores importance (Core) and completion
  ✓ the review grade is recorded with its direction
  ✓ no page errors
```

### `study-polish.mjs`

```
✓ Header Search opens the single global palette
  ✓ Study header Search offers full-card search in the same palette
  ✓ Topic has four main actions: Sort, Review (with Adjust beside it), Browse and New card
  ✓ No redundant New card in the header of an open topic
  ✓ Import and Connections live inside one More menu
  ✓ Review cannot open until a card is in Learning
  ✓ A recommended session sets its own order (no misleading order switch)
  ✓ Review heading is not repeated
  ✓ One accessible direction switch
  ✓ Directions have an understandable two-way label
  ✓ Directions have an understandable one-way label
  ✓ One accessible order switch
  ✓ No duplicate 10/20/50 amount buttons
  ✓ One start action
  ✓ Escape dismisses Review
  ✓ Sort is correctly unavailable when the fixture has no unsorted cards (covered by Capture → Sort → Review test)
  ✓ No browser errors on Study controls
  ✓ All five workspace sections have one bottom bar
  ✓ Old Study bottom bar is not stacked over it
  ✓ Bottom targets are finger-sized
  ✓ Study still exposes all four sub-pages
  ✓ Tablet Catalogue navigation works
  ✓ Capture handle has a 44px+ touch target
  ✓ Dragging Capture to the left snaps it to the edge
  ✓ Dragging Capture does not accidentally open it
  ✓ Capture remembers its snapped edge after restart
  ✓ Capture stays attached to its edge on rotation
  ✓ Arrow keys can reposition Capture without opening it
  ✓ Moving Capture by keyboard does not activate it
  ✓ Movable Capture shortcut opens real Capture
  ✓ Capture closes without trapping tablet navigation
  ✓ No tablet page errors
Study actions and tablet navigation: browser checks complete.
```

### `clarity.mjs`

```
— study stages agree in Library, topic, Sort, Browse and Review
  ✓ Library counts the two unsorted cards (“7 CARDS · 2 UNSORTED”)
  ✓ topic stages are Unsorted 2 → Learning 5 · Reference 0 (got 2 / 5 / 0)
  ✓ Sort opens on the first of the two unsorted cards, never reviewed ones
  ✓ Browse uses the same stages (2 unsorted, 5 reviewed)
  ✓ Browse filters by Core / Useful / Peripheral, not 1–5
  ✓ Adjust counts the five Learning cards (“5 learning 0 never reviewed 5 reviewed”)
  ✓ Review can start from Adjust
  ✓ no page errors
— study dialogs are never covered by the sidebar
  ✓ Sort covers the sidebar instead of sitting under it
  ✓ the Sort title is visible (not hidden behind the sidebar)
  ✓ Edit card covers the sidebar
  ✓ no page errors
— selected review direction stays readable while hovered
  ✓ hovered selected option has readable contrast (9.92:1)
  ✓ no page errors
— sort keeps its four outcomes together and works from the keyboard
  ✓ Sort opens straight into the queue (no setup step)
  ✓ Learn is offered as Core / Useful / Peripheral in the decision group
  ✓ Reference is in the same group
  ✓ Discard is in the same group
  ✓ Later is in the same group
  ✓ tags are behind one secondary control
  ✓ R keeps the first card (马上) as reference
  ✓ U sends the second card (最近) to Learning as Useful (stored as 3)
  ✓ the pass ends with a summary
  ✓ no page errors
— card capture adds each card at once and asks before closing with an unsaved card
  ✓ the card sides are called Front and Back
  ✓ Enter on the last field adds the card to the topic immediately
  ✓ the footer confirms what was added
  ✓ the form is cleared for the next card
  ✓ Escape during IME composition does not try to close Capture
  ✓ closing with a complete, unsaved card asks first
  ✓ Add and close adds the card
  ✓ no page errors
— search opens a Study card directly in its topic
  ✓ full card search is still one row away
  ✓ the topic opens with that card selected (“已经”)
  ✓ no page errors
— review keeps the prompt visible after reveal
  ✓ the prompt stays above the answer (“以后 yǐhòu”)
  ✓ the answer is shown below it
  ✓ no page errors
— empty review selection is explained, not reported as a failure
  ✓ calm empty state (“Nothing to review here.”)
  ✓ no page errors
— edit card works from the keyboard
  ✓ Escape closes Edit card
  ✓ Ctrl+Enter saves the card
  ✓ and closes the editor
  ✓ no page errors
— one pin icon whose fill shows the state
  ✓ Keep open is a labelled toggle
  ✓ no crossed-out pin that reads as an action
  ✓ the toggle reports its new state
  ✓ no page errors
— notebook counts read naturally
  ✓ singular and plural are right (“1 topic · 1 note · 0 lessons”)
  ✓ no page errors
— only one sidebar toggle is visible at a time
  ✓ with the full sidebar, only its own collapse button shows
  ✓ with the icon rail, the header toggle brings the sidebar back
  ✓ no page errors
— tablet: topic rows stay compact
  ✓ each card row is at most 110px tall (tallest 95px)
  ✓ no page errors
```

### Static checks

```
PASS scripts/check-architecture.mjs
PASS scripts/check-capture-parse.mjs
PASS scripts/check-pinyin-unicode.mjs
PASS scripts/check-study-session-counts.mjs
PASS scripts/check-progress-tooltips.mjs
PASS scripts/check-progress-layout.mjs
PASS scripts/check-progress-languages.mjs
PASS scripts/check-mistake-journey.mjs
PASS scripts/check-progress-study-error.mjs
PASS scripts/check-notebook-consistency.mjs
PASS scripts/check-mistake-filter-row.mjs
PASS scripts/check-capture-to-flashcard.mjs
PASS scripts/check-study-flashcard-integration.mjs
PASS scripts/check-redesign-batch-a.mjs
PASS scripts/check-command-palette.mjs
PASS scripts/check-true-loading-states.mjs
PASS scripts/check-shell-accessibility.mjs
PASS scripts/check-navigation-polish.mjs
PASS scripts/check-lesson-cleanup.mjs
PASS scripts/check-native-quick-capture.mjs
PASS scripts/check-capture-context.mjs
PASS scripts/check-sort-review-flow.mjs
PASS scripts/check-workspace-noise.mjs
PASS scripts/check-workspace-signal.mjs
PASS scripts/check-notebook-controls.mjs
PASS scripts/check-notebook-sidebar.mjs
PASS scripts/check-save-feedback.mjs
PASS scripts/check-rejected-capture-recovery.mjs
PASS scripts/check-chinese-reading.mjs
PASS scripts/check-accent-consistency.mjs
PASS scripts/check-overview-compact.mjs
PASS scripts/check-background-controls.mjs
PASS scripts/check-appearance.mjs
PASS scripts/check-languages.mjs
PASS scripts/check-palette-ranking.mjs
PASS scripts/check-offline-revision-chain.mjs
PASS scripts/check-study-workflow-polish.mjs
PASS scripts/check-final-clarity.mjs
PASS scripts/check-review-engine.mjs
```
