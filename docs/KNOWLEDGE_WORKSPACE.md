# Heuresis learning workspace

Heuresis has exactly five sections, in a compact sidebar:

| Section | What it is for |
| --- | --- |
| **Overview** | What needs attention today: a lesson in progress or the last document, recent lessons, questions to clarify, mistakes due for recall, pinned notes, Personal OS objectives (read-only) and a one-line Study summary. Every row opens the item directly. A subject filter (All · Chinese · German · …) scopes the page. |
| **Study** | The original Heuresis flashcard system — Library, Catalogue, Connections, Collections, topics, cards, Capture window, Sort/Browse/Review (Cosmos), spaced repetition and offline sync. Its internals are unchanged. |
| **Notebook** | Subjects → topics (nestable four levels deep) → documents: notes and lessons. Read like a book, edit in place. |
| **Mistake Log** | Attempt → correct form → why → recall practice, linked to topics and lessons. |
| **Progress** | Weekly activity produced inside Heuresis (card reviews, study sessions, lessons, mistake recalls, notes) and honest mistake evidence. Anki Tracker stays in Personal OS. |

Note, Lesson and Mistake are capture types, not sections.

## Capture during a lesson

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ ⇧ N` | Quick note |
| `Ctrl/⌘ ⇧ M` | Mistake (attempt now, correction now or later) |
| `Ctrl/⌘ ⇧ L` | Start a lesson (creates an empty lesson page and makes it the *current lesson*) |
| `Ctrl/⌘ ↵` | Save the capture / finish editing a document |
| `Esc` | Close the panel — the draft is kept |
| `Ctrl/⌘ K` or `/` | Search notes, lessons, mistakes and topics (in Study: search cards) |
| `Alt 1–5` | Switch section · `?` shows every shortcut |

* The shortcuts work everywhere in the app, including while typing in another field, and use physical key positions (`KeyboardEvent.code`), so they also work with a Russian, German or Chinese input method active. They are not OS-global: Heuresis must be the focused window.
* The panel opens with the right fields already focused; keys typed straight after the shortcut are not lost.
* The destination is remembered: current lesson → last capture topic → the topic you are looking at. One click changes it, including creating a subject or topic on the spot.
* A note ending in `?` is filed as a **Question** automatically (visible and reversible).
* While a lesson is current (sidebar shows *In lesson*), notes and mistakes are attached to it (`lesson_id`). The lesson page lists them under *To revisit*, *Captured during the lesson* and *Mistakes from this lesson*, with *Move into lesson* and *Answered* actions for organising afterwards. A lesson stays current for up to ten hours or until *End*.
* Drafts are written to local storage as you type, so closing the panel, the window or the app never loses half a thought. Submitted captures are kept in a local outbox until the database confirms them and are retried with the same id after a restart, so they can never be stored twice.
* **Pin** keeps the panel open for several captures in a row.

## Documents

* Reading view: serif reading typography, headings, lists, quotations, highlight (`==text==`), strikethrough, and four callout blocks — **Example** (sentence / reading / translation lines, copy button), **Rule**, **Correction**, **Tip**. `[[Title]]` links another note; *Linked from* shows backlinks.
* Editing (`E`, *Edit* or *Add to this*): the same typography, a toolbar, Markdown-style shortcuts at the start of a line (`# `, `## `, `- `, `1. `, `> `, `---`), `Ctrl B / I / ⇧H`, plain-text paste that keeps lists and bold, a plain-text *source* view, autosave after a pause with a visible save state, `Ctrl S` to save now.
* Text is stored as readable Markdown in `knowledge_records.body`; every line maps to one block, so nothing is reflowed. Unsaved edits are mirrored locally and offered for restore if the app closed before they were saved.
* New notes are created on their first save; a new note left empty is discarded.

## Picking up where you left off

* Heuresis reopens the last section, and within it the last note, lesson, topic or Study topic (stored per user on this device).
* Each section keeps its scroll position while the app is open; a different note always opens at its top.
* Back (button, `Alt ←`, mouse back button) returns to the previous page, including pages opened from search or Overview.
* *Recent* in the Notebook rail lists the last documents opened; Overview lists recent lessons and recently edited notes.
* A remembered note that was moved elsewhere opens in its new place; one deleted on another device produces a one-time message and the Notebook falls back to the topic or home page.

## Mistake Log and recall

* Stages: **To correct** (no correct form yet) → **Practising** → **Understood** (self-assessed, labelled as such).
* *Test recall*: write the corrected form from memory, reveal, compare (character-level differences are underlined), then grade yourself.
* Schedule: a correct recall brings the mistake back after 1 → 3 → 7 → 21 → 60 days; a miss brings it back tomorrow. Several correct answers on the same day count once. Marking “I understand it” schedules a recall check in three days. Only recall on separate days is reported as retention.
* Every attempt is stored in `knowledge_practice_events`, which feeds Progress. This is deliberately not a second flashcard engine: when deliberate memorisation is needed, **Make a flashcard…** sends a note or a corrected mistake to a Study topic through the normal `createCard` path.

## Quick Log — reviewed, not added

A separate “I did 30 minutes of listening” log would duplicate Personal OS's Quick Log and Capital tracking. Inside Heuresis the meaningful activity is already recorded: lessons (dated), captures, mistake recalls and Study sessions/reviews, all shown in Progress.

## Data model and migrations

| Table | Purpose |
| --- | --- |
| `knowledge_subjects` | Languages or fields. |
| `knowledge_topics` | `parent_id` for nesting (same subject, max four levels, no cycles — enforced by trigger). Sibling names are unique. |
| `knowledge_records` | `kind` = `note` · `lesson` · `mistake`; `category` (note · question · grammar · vocabulary · phrase); `lesson_id` (captures → lesson, `on delete set null`); `lesson_date`; `pinned`; `recall_streak`, `last_recalled_at`, `recall_due_at`. `updated_at` moves only when content changes (not on pin/recall). |
| `knowledge_practice_events` | Append-only recall attempts (`correct` / `incorrect`, the typed answer). |

Migrations: `20261011190000_create_knowledge_workspace.sql` (v1, already applied) and **`20261012090000_knowledge_workspace_v2.sql`** (new, additive). The v2 migration adds columns, relaxes two checks (an empty lesson; a mistake recorded with only the attempt), adds triggers, a table and column-scoped grants. It does not update, copy or delete any row. Requires PostgreSQL 15+ (Supabase default). Rollback instructions are in the file header.

Until v2 is applied, the app detects it (`detectKnowledgeSchema`) and shows the Notebook **read-only** with a notice naming the file; Study is unaffected. Notes created by the first workspace version keep working; a note titled `Lesson · …` is shown as a lesson but cannot receive new captures.

Personal OS data stays read-only: `language_notebooks` (objectives) and `knowledge_entries` (earlier captures, shown collapsed on Overview). `scripts/check-architecture.mjs` enforces this, the five sections, physical-key shortcuts and the offline-replay guarantees.

## Offline behaviour

Knowledge reads and writes go through the same offline layer as Study. Offline captures and edits are applied to the local copy immediately (“Saved on this device — will sync”), queued, and replayed after reconnection; the Notebook refreshes once replay has finished. Two reliability fixes were made to the shared layer: replay is single-flight (concurrent sync triggers could previously send the same queued write twice), and a queued insert whose id already exists is treated as delivered instead of blocking the queue forever.

## Appearance

*Account menu → Auto / Light / Dark.* The shell, Overview, Notebook, Mistake Log, Progress, Quick capture, search and dialogs have a designed dark palette. Study's own screens (Library, topics, Catalogue, review windows) were built for paper and are not themed yet: in dark mode they keep their light surface inside the dark shell rather than rendering half-inverted. The wallpaper from Personal OS is shown in Study only; writing and reading happen on plain paper.

## Verification

See `docs/WORKSPACE_V2_REPORT.md` and `verification/README.md`.
