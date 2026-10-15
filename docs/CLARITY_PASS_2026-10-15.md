# Clarity pass — 15 October 2026

Scope: Study (Library, topic, Sort, Review, Browse, Edit card), card Capture, Search,
Quick Capture, Notebook. No database migration, no new dependency, no change to the
offline layer or to how existing data is stored.

## Bugs fixed

1. **Study dialogs opened underneath the sidebar.** Sort, Edit card, Browse, Import and
   the Review launcher render inside the content column, whose stacking context sat below
   the sidebar, so their left edge (including the Sort title) was hidden behind it.
   `workspace.css` lifts the content column above the sidebar while a dialog is open.
2. **Card stages disagreed between screens.** Library, topic table, Sort, Browse and the
   Review launcher each computed Unsorted / Ready / Reviewed differently. A card with
   review grades but no "revealed" event (grades recorded by Personal OS or an older
   client) showed as Reviewed in the topic, Unsorted in Library and Sort, and was not
   counted as ready by Review. There is now one definition, `cardStage()` in
   `src/lib/sort.ts`; `cardHasCompletedSort()` also treats any graded review as sorted.
3. **The selected Review direction turned invisible on hover** (hover rule repainted it
   white on white). Fixed in `study-direction-simple.css`.
4. **Card Capture: "Add another" did not add.** It only parked the card in a local
   Waiting list; closing the window left those cards out of the topic with no warning.
5. **Card Capture closed on Escape during IME composition** (cancelling a pinyin
   candidate closed the window). Escape/Enter are now ignored while composing.
6. **Review showed "Heuresis could not open."** for an empty selection (e.g. no
   favourites). It now says "Nothing to review here." with the reason.
7. Plurals: "1 lessons", "1 notes", "Start review · 1 cards", "1 records", "1 cards".
8. Pin toggles used opposite conventions (crossed-out pin meant "off" in Quick Capture
   but "pinned" on a note). All three now use one pin, filled when on.

## Simplifications

- **Card Capture** adds each card immediately (Enter on the last field, Ctrl+Enter or
  *Add card*), clears the form and confirms "Added “马上” to HSK 2 — Time". Offline the
  insert goes to the existing outbox like every Study write. Closing with a complete
  unsaved card asks once: *Keep editing · Close · keep draft · Add and close*. Cards left
  in Waiting by the previous version are still shown and can be added (*Add N waiting*).
  Labels: Recto/Verso → Front/Back; the expanded side panel lists cards added this session.
- **Sort**: the three outcomes — *Learn it 1–5*, *Keep as reference (R)*, *Decide later
  (S)* — sit together in one block at a fixed place; tags (if any) come first, marked
  "choose before deciding". Enter in the setup starts sorting.
- **Review launcher**: Cards and Amount are one box ("how many of which cards");
  Direction takes the left column; the hint is secondary text.
- **Review**: after Reveal the prompt stays visible (smaller, muted) above the answer
  instead of disappearing.
- **Search (Ctrl+K)**: Study card matches appear directly in the palette (up to five);
  choosing one opens its topic with that card selected and scrolled into view. Full card
  search remains one row away. The card search overlay also opens the exact card.
- **Topic page**: stage counts sit beside their names ("3 Unsorted"); at tablet width each
  card is one compact row (word left; interest, stage, recall and links right) instead of
  six stacked cells (~95px instead of ~160px per card).
- **Edit card**: Esc closes, Ctrl/⌘+Enter saves, Save stays visible while scrolling.
- **Header**: only one sidebar toggle shows at a time; the Study header button says
  *New card* (it was "Card", next to "Capture", which captures notes).
- **Wording**: the collection Inbox's related words are "Discoveries" everywhere (were
  "Raw" in some places); unadded card captures are "Card drafts".

## Verification

| Check | Result |
| --- | --- |
| `tsc --noEmit` (also with `--noUnusedLocals --noUnusedParameters`) | clean |
| `npm run build` | passes |
| 38 static checks in `.github/workflows/check.yml` | all pass |
| `verification/tests/regressions.mjs` | 57 / 57 |
| `verification/tests/study-polish.mjs` | 31 / 31 |
| `verification/tests/clarity.mjs` (new, added to CI) | 52 / 52 |

`study-polish.mjs` now honours `CHROMIUM_PATH` in its tablet scenario, like `lib.mjs`.

## Not verified here

Tauri desktop and Android runtimes (separate Capture/Review windows, WebView2 and Android
WebView behaviour), real Supabase data volumes, a real IME session (composition was
simulated), screen readers.
