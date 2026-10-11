# Heuresis learning workspace — implementation and verification report

11 October 2026 · applies to this source tree (base: `Heuresis-dc03337e`).

## Before you run it

1. **Apply the database migration** `supabase/migrations/20261012090000_knowledge_workspace_v2.sql` (Supabase SQL editor, or `supabase db push`). It is additive and re-runnable: it adds columns, one table, triggers, indexes and column-scoped grants, and relaxes two checks. It does not update, copy or delete any row (verified with checksums, see §C2). Taking a backup first is still sensible. It needs PostgreSQL 15 or later, which is the Supabase default. Rollback steps are in the file header.
2. Nothing else changes: `package.json` is untouched (no new dependencies), and `npm install`, `npm run tauri dev` and the CI workflow work as before.
3. If the migration has not been applied yet, the app detects that. Notebook and Mistake Log then open **read-only** with a notice naming the file, nothing is written, and Study works normally.

---

## B. Implementation summary

### Preserved

* **Study is unchanged internally.** Library, Catalogue, Connections, Collections, topics and cards, the Capture window, Sort/Browse/Review (Cosmos), spaced repetition and the offline review queue still use their original components with the same data paths. `App.tsx` was rewritten only as the shell around them. Inside Study the only edits are small: the Catalogue loading message shows its progress, two unused values were removed from `PackView`, and the card search accepts a starting query, closes on `Esc` and has an accessible label.
* **The Supabase client, authentication and existing migrations are untouched.** The offline layer received two fixes (below) and kept its behaviour.
* **Personal OS data is read-only.** `language_notebooks` supplies the objectives and `knowledge_entries` the earlier captures; both are only displayed. Anki Tracker is not read, moved or recreated. `scripts/check-architecture.mjs` now fails the build if code writes to those tables or queries anything named Anki.
* **Existing knowledge records keep working.** Notes created by the first workspace version open normally, and a note titled `Lesson · …` is shown as a lesson.

### Implemented, in your priority order

**1. Reliability**
* One store (`WorkspaceProvider`) is the single source of truth for subjects, topics, notes, lessons, mistakes and practice events. Every section reads from it, so nothing is duplicated and nothing goes stale between sections.
* Captures are idempotent. Ids are created on the device, a submitted capture stays in a local outbox until the database confirms it, and after a restart it is retried with the same id, so it is never stored twice.
* Offline layer fixes in `offlineFetch.ts`:
  * Replay is now single-flight. Before, two sync triggers firing at once could send the same queued write twice.
  * A queued insert that had in fact already reached the server is now treated as delivered. Before, it blocked the queue permanently.
* The app checks which schema version the database has (`detectKnowledgeSchema`) and falls back to read-only mode instead of failing.

**2. Quick Capture**
* **Opening it:** the Capture button sits in the header and in the sidebar, and works in every section, including Study. The shortcuts are `Ctrl/⌘ ⇧ N` (note), `⇧ M` (mistake) and `⇧ L` (start a lesson). They read the physical key position, so they also work with a Russian, German or Chinese keyboard layout, and they work while another field has focus.
* **Typing:** the panel opens with the right field focused, so keys typed straight after the shortcut are not lost. `Ctrl/⌘ ↵` saves and `Esc` closes. Focus and caret return to where you were typing, for example the middle of a note you are editing.
* **Where it goes:** the destination defaults to the current lesson, then the last topic you captured to, then the topic you are viewing. One click changes it, and a subject or topic can be created from inside the panel.
* **What it keeps:** incomplete thoughts are fine. A note ending in `?` is filed as a Question, visibly and reversibly. A mistake can be saved with only your attempt and corrected later.
* **Drafts and confirmation:** the draft is saved locally as you type, so it survives closing the panel, the window or the app. Each save confirms where it went ("Saved to Chinese › Grammar", or "Saved on this device — will sync" when offline) and offers *Undo*. **Pin** keeps the panel open for several captures in a row.
* **Quick Log (reviewed, not added):** it would duplicate Personal OS Quick Log and Capital tracking. Lessons, captures, recalls and Study sessions are already recorded and appear in Progress.

**3. Notes and lesson pages**
* **Reading view:** serif typography, headings, lists, quotations, highlight, strikethrough, and four callout blocks: Example (sentence, reading and translation lines with a copy button), Rule, Correction and Tip. `[[links]]` connect notes, *Linked from* lists backlinks, and *Newer/Older* steps through the topic's pages.
* **Editing in place** (`E`, *Edit*, *Add to this*):
  * a toolbar with headings, bold, italic, highlight, lists, quote, the four callouts, a divider, undo/redo and a plain-text source view;
  * Markdown-style shortcuts at the start of a line (`# `, `- `, `1. `, `> `, `---`);
  * paste keeps lists and bold;
  * autosave with a visible save state, and `Ctrl S` to save immediately.
* **Storage:** text is stored as readable Markdown, and the Markdown round trip is lossless for the supported format. Unsaved edits are mirrored locally and offered for restore if the app closed first. A new note left empty is discarded rather than leaving an "Untitled" page behind.
* **Lessons are first-class:**
  * *Start a lesson* creates an empty lesson page and makes it current (the sidebar shows **In lesson**).
  * Notes and mistakes captured meanwhile are attached to it. The lesson page groups them under *To revisit*, *Captured during the lesson* and *Mistakes from this lesson*, with *Move into lesson* and *Answered* for organising afterwards.
  * Section headings are optional (*Add lesson outline*).
  * Any number of lessons per day is allowed.

**4. Organisation, search and continuity**
* **Structure:** subjects contain topics nested up to four levels (Chinese → Grammar → Time expressions), enforced in the database. Notes can be moved between topics, and topics renamed. Deleting a non-empty topic or subject is refused with an explanation; empty ones are deleted after confirmation. Deleting a note is confirmed, then offers *Undo*.
* **Search:** `Ctrl/⌘ K` or `/` searches titles and body text of notes, lessons, mistakes and topics, including Chinese substrings, and opens the exact note. In Study it searches cards as before.
* **Continuity:**
  * the last section, note, lesson, topic and Study topic reopen after a restart;
  * each section keeps its scroll position while the app is open, and a different note opens at its top;
  * Back works, including after jumping in from search or Overview;
  * *Recent* sits in the Notebook rail.
  * A remembered note that was moved opens in its new place. One deleted on another device shows a one-time message and falls back cleanly.

**5. Mistake Log**
* Each entry is My attempt → Correct form → Why, linked to a topic and optionally a lesson. Stages: **To correct** (no correct form yet), **Practising**, **Understood**.
* *Test recall*:
  * you write the corrected form before seeing it, then it is revealed;
  * characters you missed are underlined;
  * you grade yourself, and an exact match is recognised automatically.
* **Schedule:** a correct recall brings the mistake back after 1 → 3 → 7 → 21 → 60 days, and a miss brings it back tomorrow. Several correct answers on the same day count once.
* *I understand it* is labelled as self-assessed and schedules a recall check in three days. Only correct recall on separate days is reported as retention.
* *Make a flashcard…* sends a corrected mistake, or a note, into a Study topic through the normal card-creation path. This is deliberately not a second spaced-repetition system.

**6. Navigation, appearance, cleanup**
* **Navigation:** exactly five sections in a compact sidebar, with a due-mistakes badge. `Alt 1–5` switches section and `?` lists every shortcut.
* **Themes:** Light / Dark / Auto in the account menu. Overview, Notebook, Mistake Log, Progress, Quick Capture, search and dialogs have a designed dark palette. Study's own screens keep their light paper surface inside the dark shell (see E).
* **Fixes:**
  * the sticky header, sidebar and editor toolbar had stopped sticking (an `overflow-x: hidden` on the shell);
  * Study pages overflowed beside the sidebar;
  * the header search button was empty below 1100 px;
  * dialogs were trapped under the sticky rail;
  * scrolled text showed through the header.
* **Removed:** the superseded `KnowledgeWorkspace.tsx`, `knowledge-workspace.css` and `KNOWLEDGE_WORKSPACE_V1.md`.

**7. Overview and Progress**
* **Overview:** a lesson in progress or the last document, recent lessons, questions to clarify, mistakes (due, needing a correction, practising, with one button to practise all due), pinned notes, Personal OS objectives (read-only) and a short Study summary. A subject filter scopes the page.
* **Progress:** weekly small multiples over 8, 12 or 26 weeks: card reviews (with good/easy %), study sessions, lessons, mistake recalls (with % correct) and notes. A table view is available. Mistake evidence and a per-subject table complete the page.

### Files

| | Files |
| --- | --- |
| New | `src/components/workspace/*` (14 files), `src/lib/{workspaceMemory,noteFormat,activity,theme}.ts`, `supabase/migrations/20261012090000_knowledge_workspace_v2.sql`, `docs/KNOWLEDGE_WORKSPACE.md`, this report, `verification/` |
| Rewritten | `src/App.tsx` (shell only), `src/lib/knowledgeWorkspace.ts` |
| Edited | `src/main.tsx`, `src/lib/offlineFetch.ts`, `src/components/{CatalogueView,PackView,SearchOverlay}.tsx`, `scripts/check-architecture.mjs`, `README.md`, `docs/PERSONAL_OS_LANGUAGE_MIGRATION.md` |
| Removed | `src/components/KnowledgeWorkspace.tsx`, `src/components/knowledge-workspace.css`, `docs/KNOWLEDGE_WORKSPACE_V1.md` |

---

## C. Verification report

### C1. Build and static checks — all pass

| Check | Result |
| --- | --- |
| `npm run build` (`tsc --noEmit` + Vite) | Passes. Main bundle 771 KB (219 KB gzip), up from 626 KB (178 KB gzip) for the original source. Vite's "chunk larger than 500 KB" warning was already present before. |
| `node scripts/check-architecture.mjs` (also run by CI) | Passes, including the new rules: exactly five sections; no writes to Personal OS tables; nothing Anki-related queried; client ids with duplicate-safe inserts; single-flight offline replay; physical-key shortcuts. |
| `tsc --noEmit --noUnusedLocals --noUnusedParameters` | Clean. |

### C2. Database (PostgreSQL 16 with every migration in the repo)

* **No existing data changed.** On a copy that had all earlier migrations plus existing knowledge records, cards and Personal OS rows, checksums of every pre-existing row in `knowledge_subjects`, `knowledge_topics`, `knowledge_records`, `heuresis_cards`, `language_notebooks` and `knowledge_entries` were identical before and after the migration. New columns take neutral defaults.
* **The migration is idempotent:** it was applied twice in a row without error.
* **Constraints and policies behave as intended** (`verification/sql/mig_checks.sql`):
  * topic cycles, duplicate sibling names and deleting a topic with children are refused;
  * captures can attach only to a lesson, and empty notes or bad categories are refused;
  * pinning does not change `updated_at`, while editing does;
  * `kind` is not updatable through the API;
  * deleting a lesson keeps its captures and only unlinks them;
  * another user sees none of the rows or practice events (row-level security);
  * deleting a subject removes its topics.

### C3. End-to-end: 142 automated checks, 0 failures

**How this was tested:** the real app (Vite build of this source) ran in Chromium through Playwright. It talked to PostgREST 12, the server Supabase uses, with real row-level security, grants and triggers from these migrations. A small local stand-in replaced Supabase Auth. Everything is reproducible with `verification/run-all.sh`; see `verification/README.md`.

| # | Workflow from the brief | Result | How |
| --- | --- | --- | --- |
| 1 | Launch and sign in | ✅ | Password sign-in through the stand-in auth server; session restored after restart |
| 2 | Navigate the five sections | ✅ | Exactly five; sidebar, `Alt 1–5`; 30 rapid switches without errors or lost place |
| 3 | Create a language subject | ✅ | From the Notebook rail and from inside the capture panel |
| 4 | Create a topic | ✅ | Including a nested sub-topic (Grammar → Time expressions) |
| 5 | Capture a quick note | ✅ | `Ctrl ⇧ N` while typing in another field; destination; auto-Question; draft survives a restart |
| 6 | Save and reopen | ✅ | Opens as a full document; stored text checked in the database |
| 7 | Edit and save again | ✅ | Autosave → "Saved"; stored as clean Markdown; first save of a new note creates it once; editor features (headings, lists, Example block, italic, paste, source view) |
| 8 | Create a lesson | ✅ | `Ctrl ⇧ L` → empty lesson stored; *In lesson* shown |
| 9 | Add information to the lesson | ✅ | Typed into the lesson; captured note and mistake linked to it and listed on its page; organising captures into it |
| 10 | Reopen the lesson after restart | ✅ | Notebook reopens that lesson with its text; last section restored |
| 11 | Record a mistake | ✅ | Attempt only → *To correct*; correction added later |
| 12 | Correction and recall | ✅ | Exact match recognised; practice event stored; schedule; same-day repeats don't inflate it; *understood* labelled self-assessed |
| 13 | Search and reopen the correct result | ✅ | Body-text and Chinese-substring searches open the exact note; Back returns |
| 14 | Delete with confirmation | ✅ | Confirmation, then deletion; *Undo* restores it including its lesson link; non-empty topics refused |
| 15 | Study still works | ✅ | Library lists collections; topic opens with its cards; card search; Study topic restored after a restart; flashcard created through `createCard` |
| 16 | Window sizes | ✅ | No horizontal scroll in any section at 1920×1080, 1280×800, 1024×768, 980×680, 820×1180, 600×900; layouts also inspected by screenshot |
| 17 | Online persistence and offline | ✅ | Offline note kept locally, header shows pending writes, reaches the server after reconnecting, header returns to *Synced*; a failed write keeps the text in the panel |

**Continuity (brief §7):**
* the last section, subject/topic and note reopen after a restart;
* Back works from documents and from pages reached through search or Overview;
* search opens the right note;
* recent lessons are reachable from Overview and the rail;
* edits persist after a restart;
* a note moved, or deleted, on another device while the app was closed is handled as described in B4;
* scroll positions behave as described in B4.

**Also tested:**
* capturing from inside the editor returns focus and caret, without text leaking between them;
* wiki links and backlinks;
* moving notes and renaming topics;
* the Overview links;
* theme persistence;
* read-only behaviour before the migration;
* the Markdown round trip on 14 representative notes: all stable, 12 byte-identical. Two are normalised on purpose: a space moved outside bold markers, and list indentation tidied.
* Every suite also asserts there were no page errors.

### C4. Not verified — please check these on your machine

* **Real Supabase project and account.** Sign-in went through a local stand-in, and the schema came from this repository's migrations. If the live database was ever changed by hand outside migrations, the result could differ.
* **The Tauri desktop runtime (WebView2):**
  * whether the shortcuts reach the page;
  * how closing the window behaves with unsaved edits. Drafts are mirrored locally on every change and saved after about one second; the brand-new-note case is covered once its first save has happened.
  * the separate Capture and Review windows;
  * the Windows build. The Rust side is unchanged, and no Tauri build was run here.
* **The Android (MagicPad) build** and touch use.
* **Scale and real input:**
  * real data volumes: the test library is small, and loading pages through 1000 rows at a time is untested at scale;
  * a real IME session while composing Chinese: shortcuts are ignored during composition, but only simulated typing was used;
  * screen readers.
* **Simultaneous editing on two devices.**

---

## D. Screenshots

The `screenshots/` folder delivered alongside the ZIP holds the real app at 1440×900 in light and dark: Overview, Notebook home, topic page, note (reading, scrolled and editing), lesson and its captures, Quick Capture (note and mistake), Mistake Log, recall session, Progress, search, and Study library and topic. It also has a 1280×800 set of the note pages. The demo content comes from `verification/sql/20_showcase.sql`.

---

## E. Remaining issues

**Genuine limitations**
1. **The migration must be applied** before the Notebook and Mistake Log can be written to.
2. **Study screens are not designed for dark mode.** In dark mode they keep their light paper surface inside the dark shell rather than looking half-inverted. A proper dark Study is real design work across about 30 existing stylesheets.
3. **Shortcuts work only while Heuresis is the focused window.** An OS-global capture hotkey would need the Tauri global-shortcut plugin, which is a new Rust dependency, so it was not added.
4. **Concurrent edits across devices are last-write-wins** per saved field, with no merge prompt. Local drafts are per device.
5. **Dialogs do not trap keyboard focus.** `Esc` closes them and focus returns, but `Tab` can leave an open dialog.
6. **The bundle grew by about 145 KB** (41 KB gzip). Code-splitting the workspace would bring it down.
7. **The editor covers a deliberate Markdown subset:** no tables, images or nested callouts. Unsupported Markdown is preserved as text.
8. **Search runs in the app over loaded records.** That is fine for thousands of notes; a database full-text index would be the next step beyond that.
9. **Personal OS lessons and captures are displayed, not imported.** Mapping language ids between the two apps is still a prerequisite for any migration (see `PERSONAL_OS_LANGUAGE_MIGRATION.md`, step 6).

**Most worthwhile next steps**
1. Apply the migration, then use it for one real lesson on the desktop app. That confirms the shortcuts in WebView2 and the close-window behaviour, the two things this environment could not reach.
2. Give Study a proper dark theme.
3. Optionally, an OS-global *Quick capture* hotkey through the Tauri plugin.
4. A careful, opt-in import of selected Personal OS captures into the Notebook, keeping their source ids.
5. Code-split the workspace and Study views.
