# Local verification harness

Used to verify the learning workspace end to end without touching the real
Supabase project. It is **not** part of the app build and adds no app dependency.

What it runs against:

* **PostgreSQL 15+** with every migration in `../supabase/migrations/`, on top of a
  small stub of Supabase's platform (`sql/00_supabase_stub.sql`: API roles,
  `auth.uid()`, `auth.users`, storage tables, and the two Personal OS tables the
  app reads).
* **PostgREST 12** (the same server Supabase uses) with real row-level security,
  column grants, triggers and constraints.
* `gateway.mjs` — a tiny stand-in for Supabase Auth (password + refresh grants,
  `/user`, `/logout`) that also proxies `/rest/v1` to PostgREST. It can inject
  write failures via `/__test/fail-writes?n=1`.
* The real app (`npx vite`) in Chromium via Playwright.

## Run

```bash
cd verification
npm install                      # Playwright only
# put a PostgREST 12 binary at ./postgrest
PGBIN=/usr/lib/postgresql/16/bin ./setup.sh   # as a non-root user; UTF8, migrations in order
node gateway.mjs &               # http://localhost:54321
(cd .. && VITE_SUPABASE_URL=http://localhost:54321 VITE_SUPABASE_PUBLISHABLE_KEY=local npx vite --port 1421) &
node tests/regressions.mjs       # maintained suite (sign-in: thomas@example.test / heuresis)
./run-all.sh                     # older suites, see below
```

Database snapshots created by `setup.sh`:

| Snapshot | Contents |
| --- | --- |
| `heuresis_v1_baseline` | All migrations **before** `20261012090000_knowledge_workspace_v2.sql`, plus a small Study library |
| `heuresis_v2_baseline` | The same after the v2 migration (applied twice to prove idempotency) |
| `heuresis_showcase` | v2 plus notes, lessons, mistakes and practice history used for screenshots |

`./db.sh restore <snapshot>` resets the working database between suites.

## Suites

`tests/regressions.mjs` is the maintained suite and runs in CI
(`.github/workflows/e2e.yml`) on every pull request. Each scenario restores the
showcase database and drives the current interface:

| Scenario | Proves |
| --- | --- |
| offline edits all reach the server | several autosaves of one note made offline, plus typing during reconnection, all arrive; the queue drains |
| offline edit conflicting with another device | a newer edit made elsewhere is never overwritten; the refused edits are explained, listed in Offline recovery, and the note offers the device copy back |
| flashcards stay in the note's language | a Russian note is not filed in a Chinese topic; a Chinese note defaults to Chinese; Escape closes the dialog; Ctrl+K does not open underneath it |
| palette: Enter opens what was typed | a matching note outranks a command that merely contains the word; a command named by the query stays first |
| record mistake from a language tab | the mistake goes to that language's Inbox, not the first topic in the list |
| capture: choosing a mistake type | the visible choice is what is saved, even when Capture was opened from a custom mode |
| organise inbox | the Inbox of the language being worked in opens |
| capture while the notebook is still loading | no offer to create languages that already exist |
| progress keeps one colour per language | the same language has the same colour in every chart |
| tablet portrait / narrow window | the Notebook drawer is hidden when closed and opens at the sidebar edge; the icon rail closes after a click |
| long lists | lists render in pages; a mistake opened from search far down the list is still shown |
| undo | moving a note and marking a mistake understood are both undone in the database, including after leaving the page |
| server unreachable | the Notebook opens from the device copy; a capture is reported as kept on the device and uploads when the server returns |
| learning loop | Capture → Notebook → flashcard → Sort → Review → recorded grade |

Run one scenario with `node tests/regressions.mjs <part of its name>`.

`tests/clarity.mjs` (also in CI) covers the clarity pass of 15 October 2026: card
stages (Unsorted → Learning · Reference) agree in Library, topic, Sort, Browse and
Adjust; Study dialogs are never covered by the sidebar; the selected Review direction
stays readable on hover; Sort's four outcomes and keyboard keys; card Capture adds each card at once, ignores Escape
during IME composition and asks before closing with an unsaved card; Search opens a
Study card in its topic; Review keeps the prompt visible after reveal; a calm empty
Review state; Edit card keyboard (Esc / Ctrl+Enter); compact topic rows at tablet
width. Screenshots go to `screenshots/clarity/`.

`tests/review-v3.mjs` (also in CI) covers the Sort and Review evolution (learning
model v3, see `docs/SORT_REVIEW_V3.md`):

| Scenario | Proves |
|---|---|
| sort → review → grading | C / P store Core 5 / Peripheral 1; “Review now” opens a recommended session at once; “Why?” explains it; Missed / Partial / Recalled / Secure; the question stays above the answer; every result is recorded with its direction; no card+direction twice, opposite directions never adjacent; summary in words incl. recognition vs production; Retry missed; summary counts each card once after a retry |
| ten more | “10 more” continues with new recommendations and never repeats the first round |
| discard | D discards (kept in the database); Undo and Ctrl+Z restore; topic and Library counts leave it out; Trash restores it (and Escape still closes Trash); Delete permanently after confirmation |
| typed Chinese answers | IME Enter (isComposing / keyCode 229) never reveals; IME-committed characters and numbered pinyin are suggested Recalled, toneless pinyin Partial, a wrong word Missed, an empty answer nothing; revealing records nothing; the learner's own choice is recorded |
| offline recovery | Sort (Core) and Discard offline, shown offline, on the server after reconnecting; Review results offline wait on the device and arrive with their directions |
| Adjust | remembers direction, cards and size; one-click Review stays recommended with the remembered direction |
| topic states | Unsorted / Learning / Reference counts and Reference filter; per-direction states (results recorded before directions existed count for the default direction); importance badges; Move to Learning |
| retry keeps practice | a retried card neither removes nor duplicates the practice recorded earlier in the session |
| review window | answering method changeable and remembered; D opens the Details drawer; a pinned drawer stays open |

Run one scenario with `node tests/review-v3.mjs <part of its name>`; screenshots go to
`screenshots/review-v3/`.

`tests/android-tablet.mjs` (also in CI) runs the app the way the Android APK (MagicPad)
runs it: Android WebView user agent, touch input only, a 1200×768 / 768×1200 / 1500×960
tablet screen, and a stand-in for Tauri's Android runtime that records every IPC call and
blanks the page if the app ever closes its only window (`tests/android-lib.mjs`). Every
tap first checks that the control is on screen and not covered.

| Scenario | Proves |
|---|---|
| Sort by touch (landscape, portrait) | Sort fills the screen above the app header and touch navigation; close and progress visible; importance, Save & next, Keep as reference, Undo by tapping; with the keyboard open the quick note and Save & next stay reachable; decisions and the note are saved |
| Sort → Review now → Done | the whole loop by touch, in one WebView |
| Review by touch (landscape, portrait, wide) | side panels never cover the card; the session fits the screen; every card revealed and answered by tapping without scrolling; results reach the server; finger-sized result buttons; Done returns to the topic without closing the app's window; the session is closed |
| closing Review mid-session | the close button returns to the topic; the answer given is saved; the session is closed |
| side panels / Notes drawer | Context and Notes open and close by tapping and never block the results |
| Adjust → Start review | the chosen session opens in the app; closing keeps the app alive |
| typed answers | the answer field and Show answer stay reachable with the keyboard open |
| Browse by touch | Browse's controls are above the app header |

`tests/catalogue.mjs` (also in CI) covers the Catalogue — the editorial studio that is
separate from the Notebook (see `docs/CATALOGUE.md`). The gateway stands in for Supabase
Storage (files under `verification/storage/`, git-ignored); PDF checks use `pdftotext`,
`pdfinfo` and `pdftoppm` from poppler-utils when they are installed. Wikimedia Commons is
answered by a recorded response (`page.route`), so the suite needs no network.

| Scenario | Proves |
|---|---|
| empty catalogue | with 14 Notebook notes the Catalogue is empty: title, one-line description, one Create Article |
| blank article | A4 page (794 × 1123 CSS px), title and text typed, saved as a draft |
| notebook note → copy | the article records its source; the note is byte-for-byte unchanged; editing, soft-deleting and hard-deleting the note never changes the article |
| DOCX import | title, subtitle, headings, bold/italic, lists, table, quotation with attribution, picture with caption, English/German/Russian/Chinese; underline reported as not kept; never published |
| pages | Add Page with seven layouts, insert before, duplicate, move, drag to reorder, delete (asks only when the page holds words or pictures) |
| overflow | a page that is too full is marked; "Move overflow to next page" keeps every word and marks the continuation; when the two parts of a divided paragraph meet on one page again they are joined |
| presets | Classical/Warm by default; Literary/Dark and Modern Archive/White saved; the app's own theme is untouched |
| images | upload, crop (proportion, fill/fit, zoom, focal point), caption, reopen and re-frame; the stored file is unchanged |
| image search | Wikimedia Commons: unlicensed results hidden, licence and author shown, credit printed, licence/source stored |
| undo and redo | typing and structural changes |
| drafts / published | drafts stay on the Drafts shelf; published articles are shelved and readable |
| subjects and volumes | Volume I suggested, contents order, reorder, removing a subject keeps its articles |
| reader | pages, folios, arrow keys, zoom, Esc; no editing controls |
| PDF export | A4 pages in order, selectable text in four scripts, embedded fonts and pictures |
| PDF overflow | export refuses to clip; after moving the overflow it succeeds |
| offline | an edit made offline is saved after reconnecting |
| Notebook unchanged | Reference notes stay in the Notebook and are not shown in the Catalogue |
| preview | Preview shows unsaved words at once, ignores editing keys, and closes back into the same designer |
| reopening quickly | an article reopened while its last save is still running waits for it: last words shown, no false conflict |
| publishing | an overflowing page stops publishing until the overflow is moved; empty picture frames are pointed out; empty frames are not shown to readers |
| acceptance | an essay from Word (`fixtures/gulf-stream.docx`) becomes an illustrated four-page Warm/Classical article: cover, drop initial, picture frames filled, no broken paragraph after reflowing, published, exported as a 4-page PDF |
| change on another device | a save never overwrites a newer version: the designer says so, keeps the edits as a separate draft and opens the other version |
| showcase | every block type in an illustrated, multilingual article in a volume; reader, designer, article PDF; volume PDF with title page, contents (start pages), page numbers running on, drafts left out |
| phone and tablet layouts | 390 × 844 and 820 × 1180: no sideways scrolling; library, designer and reader fit |

Run one scenario with `node tests/catalogue.mjs <part of its name>`; screenshots and
PDFs go to `screenshots/catalogue/`. The acceptance and showcase scenarios also compare
the PDF word by word with the page on screen (`pdftotext -bbox-layout`).

`tests/catalogue-migration.sh` (also in CI) applies the Catalogue migration to a database
that already holds Notebook and Study data, and proves that every existing table, row and
policy is byte-for-byte unchanged, that a second run changes nothing, and that articles and
images are visible and changeable only by their owner.

`tests/desktop-unchanged.mjs` is the matching proof for Windows: it captures the same
Study screens (topic, Sort, Adjust, Browse, Review before and after reveal) in this build
and in a reference build, for a 1440 px and a 1200 px Windows window and a Windows
touchscreen, and compares them pixel by pixel. Serve both as production builds
(`vite build`, then any static server), because the dev server's font paths can differ
between checkouts:
`HEURESIS_URL=http://localhost:1431/ HEURESIS_REFERENCE_URL=http://localhost:1432/ node tests/desktop-unchanged.mjs`.

The older suites below were written for the first workspace version. Most of
them now stop at selectors that no longer exist (e.g. the in-page topic tree);
they are kept as a record and should be ported scenario by scenario.

| File | Covers |
| --- | --- |
| `tests/e2e1.mjs` | Workflows 1–10: sign-in, five sections, subject/topic/sub-topic, Ctrl+Shift+N capture while typing elsewhere, draft survival across restart, open/edit/autosave, lesson via Ctrl+Shift+L, captures attached to the lesson, reopen after restart |
| `tests/e2e2.mjs` | Workflows 11–17: mistake without correction → clarify later, recall with same-day protection, search → exact note, Back, delete + confirmation + undo, Study library/topic/card search/restore after restart, six window sizes, offline capture → reconnect → server |
| `tests/e2e3.mjs` | Wiki links and backlinks, make-a-flashcard through `createCard`, move a note, rename/delete topics (non-empty refused), organise lesson captures, Overview links, Alt+digit, theme persistence |
| `tests/e2e4.mjs` | Capturing from inside the editor returns focus and caret; empty new note discarded; first save of a new note then continued editing (no duplicates) |
| `tests/e2e5.mjs` | Editor: `#`/`-`/`1.` shortcuts, Example block, exiting a block, italic, multi-line paste with lists, source view round trip |
| `tests/e2e6.mjs` | Continuity: a remembered note moved or deleted on another device while the app was closed; 30 rapid section switches |
| `tests/v1mode.mjs` | Behaviour before the v2 migration: read-only Notebook with a notice, legacy notes readable, nothing written, Study unaffected |
| `tests/format.mjs` | Markdown ⇄ editor HTML round trip for representative notes |
| `tests/tour.mjs` | Screenshots: `node tests/tour.mjs <dir> <width> <height> <light|dark>` |
| `sql/mig_checks.sql` | Direct SQL checks of the v2 constraints, triggers, grants and RLS (instructions in the file header) |

Set `CHROMIUM_PATH` to use a specific Chromium build.
