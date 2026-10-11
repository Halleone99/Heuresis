# Personal OS → Heuresis language workspace

Status (11 Oct 2026): **steps 1–5 implemented; step 6 (ownership cutover) not started.** Personal OS tables are still only read. No existing records have been copied, deleted or rewritten. The workspace is described in `docs/KNOWLEDGE_WORKSPACE.md`; this document is kept as the original plan and boundary.

## Target navigation

- **Overview** — language selection, objectives, current focus and latest activity.
- **Study** — preserve the existing Heuresis Library, Pack, Catalogue, Connections, Capture, Sort and Review flows. Do not replace them with legacy Anki decks.
- **Notebook** — lessons, grammar, examples, blocks of meaning and captured notes, organised by language and topic.
- **Mistake Log** — incorrect forms, correction, explanation, recurrence and links to Heuresis cards.
- **Progress** — activity and retention statistics generated inside Heuresis, plus language-practice trends. Personal OS retains Anki Tracker as part of Capital tracking.

Use a narrow sidebar, not a blocking mode-selection screen. Keep capture available globally.

## Existing sources in Personal OS

| Feature | Implementation | Existing data source | Integration |
| --- | --- | --- | --- |
| Language identity, chosen language, active goals | `src/routes/languages.tsx` | `language_notebooks.data` JSON v2 | Overview; one canonical snapshot |
| Counted and stepped goal ladders, focus and completion | `src/routes/languages.tsx` | same notebook snapshot | Reuse logic, redesign Heuresis UI |
| Language workspace preview | `src/routes/language-workspace-preview.tsx` | notebook + `knowledge_entries` | Design reference only; preview is not the main page |
| Lessons and notes | `src/components/knowledge/QuickKnowledgeCapture.tsx`, `src/routes/capture.tsx` | `language_lessons`, `knowledge_entries`, `capture_sets` | Notebook read-only initially |
| Lexicon filtering and export | `src/routes/lexicon.tsx` | `knowledge_entries` | Import/reconcile into Heuresis vocabulary only after identity mapping |
| German/Russian/Chinese quick goals | `src/lib/quickLog/handlers/languageObjective.ts` | `language_notebooks` | Port the small command grammar, not the entire Personal OS command system |
| Quick Log token parser | `src/lib/quickLog/engine.ts` | service methods, not one table | Reuse command/preview mechanics only |

## What already exists in Heuresis

- `src/App.tsx` owns top navigation. Introduce workspace sections without changing the existing study view internals.
- `src/lib/heuresis.ts` provides collections, packs, card data and card statistics.
- `src/lib/study.ts`, `src/lib/learningSignals.ts` and `src/lib/learningStats.ts` track Heuresis's own study and retention. Do not import Personal OS Anki tracking into this application.
- The existing app authenticates against the same Supabase project, allowing owner-scoped reads.
- `src/lib/personalOsLanguageSources.ts` now supplies three read-only entry points for language objectives, lessons and captured language entries.

## Product boundary: learning versus capital tracking

**Heuresis is for learning:** language material, lessons, memory practice, mistakes, review activity and progress directly produced by Heuresis.

**Personal OS is for assessing capital evolution:** Anki Tracker remains there as one of multiple measures of invested learning effort. No Anki deck, review history, objective or tracker UI should be moved into Heuresis. A future Personal OS Capital overview could consume suitable Heuresis summary data without transferring tracker ownership.

## Issues before writing new data

1. **No duplicate owner.** Personal OS still writes `language_notebooks.data`; Heuresis should read it first. Do not independently write and overwrite its entire JSON object without concurrency handling or transferring ownership.
2. **Lessons cannot yet represent multiple lessons on one day.** The existing database schema has `unique (user_id, language_id, lesson_date)`. Change this constraint before introducing independent lesson entries for the same date.
3. **Local cache is not shared.** Personal OS uses `pos.languageObjectives.v2` in browser localStorage. The Tauri app cannot assume the same local cache; its cloud snapshot is authoritative for this first bridge.
4. **Language IDs need reconciliation.** Personal OS stores string language IDs; Heuresis collections use UUIDs. Create an explicit mapping, not an implicit assumption that the values are identical.
5. **Captured entries are not all cards.** `knowledge_entries.entry_type` can be `note`, `definition` or `pair`. Preserve source IDs, lesson associations and third sides. Do not bulk-insert all of them as Heuresis cards.
6. **Mistake Log does not exist as a dedicated language system.** Build a purpose-made entity with correction, explanation and recurrence. Review failures can suggest mistakes but should not automatically create duplicates.
7. **Clear product boundary.** Anki Tracker, including deck growth, reviews, streaks, calendars and objectives, remains in Personal OS as part of the broader Capital evolution tracker. Heuresis must not read, recreate or move that tracking system. Its own study metrics remain internal to Heuresis.
8. **Offline behaviour matters.** The old Heuresis study flows have offline synchronisation. Any new write path needs an explicit offline and conflict policy before use.

## Build sequence

1. **Read-only bridge (this branch):** typed access to Personal OS cloud data; no UI or database mutation yet.
2. **Navigation + Overview:** small sidebar; language tabs; goals from legacy snapshot; link to existing Study.
3. **Notebook:** read-only legacy lessons/captures; create a proper document/lesson model for multiple lessons per day and ordered blocks.
4. **Mistake Log:** new canonical model and UI, with optional reference to Heuresis card IDs.
5. **Progress + Quick Log:** Heuresis-generated review/activity statistics and lightweight language-session capture. No Anki Tracker import.
6. **Ownership cutover:** decide which app writes which table; migrate data only after verifying counts, identifiers, edits and rollback.

## Verification gate before merging

- `npm run build` and the repository architecture check pass.
- Same user account reads the existing objectives, lessons and captures without changing any row.
- No changes to existing Capture, Review, Sort, Browse or offline event queue behaviour.
- Missing or empty Personal OS sources show a benign empty state.
- Cloud freshness and identity mismatch are handled explicitly.
- New UI remains usable at desktop and tablet widths.

**Current implementation status:**

- Steps 1–4 are implemented. Notebook, lessons and Mistake Log use Heuresis's own `knowledge_*` tables (migrations `20261011190000` and `20261012090000`), which allow any number of lessons per day. Personal OS `language_notebooks` (objectives) and `knowledge_entries` (earlier captures) are shown read-only on Overview; `scripts/check-architecture.mjs` fails the build check if code writes to them.
- Step 5: Progress is implemented from Heuresis's own data. The lightweight Quick Log was reviewed and **not** added, because it would duplicate Personal OS Quick Log / Capital tracking (see `docs/KNOWLEDGE_WORKSPACE.md`).
- Step 6 is open: no data has been migrated from Personal OS, and language-ID reconciliation (issue 4) is still a prerequisite for it.
- Verified against a local PostgreSQL + PostgREST copy of the schema, not against the live project or a live account: see `docs/WORKSPACE_V2_REPORT.md`.
