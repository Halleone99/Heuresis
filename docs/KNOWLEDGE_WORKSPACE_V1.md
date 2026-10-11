# Heuresis learning workspace v1

## What changed

The standalone Tauri application now has five sections in a compact sidebar:

1. Overview — Personal OS language objectives, capture counts, and mistakes worth revisiting.
2. Study — the **existing** Library / Catalogue / Connections / pack / review / capture UI, unchanged internally.
3. Notebook — organised Knowledge records (subject → topic → note).
4. Mistake Log — attempt, correction, explanation, needs-practice/understood state, and a deliberate recall exercise.
5. Progress — Heuresis session and review-event activity, and Knowledge activity counts. No Anki Tracker import.

The top bar has **Quick note** in every section. The keyboard shortcuts are
**Ctrl/Cmd+Shift+N** to open note capture, **Ctrl/Cmd+Shift+M** to capture a mistake,
and **Ctrl/Cmd+Enter** in the editor to save. They are disabled while typing in
another input so ordinary editor text is not hijacked.

## Data ownership and compatibility

- Personal OS's existing `knowledge_entries` table is a **legacy capture queue**, containing a different schema; it is not changed by this work.
- The new structured Knowledge data uses `knowledge_subjects`, `knowledge_topics` and `knowledge_records`. This avoids collisions and can eventually be shared with a Personal OS knowledge view without duplication.
- Knowledge records are not automatically converted to Heuresis flashcards or migrated from legacy captures. Importing old captures into this model is **future work**, and must preserve source IDs to prevent duplicates.
- Existing Heuresis Study records and queues are left intact.
- Anki Tracker remains in Personal OS Capital; no Anki tables are read by the Knowledge workspace.
- Language objectives are read only from Personal OS's `language_notebooks.data`; Heuresis does not overwrite that snapshot.

## Persistence

- All new tables have row-level policies by owner `user_id`, composite foreign keys to prevent cross-account attachment, and narrow grants.
- IDs are generated on the client before insertion for safer retry behaviour with Heuresis's network queue.
- The migration is additive and does not delete or rewrite legacy Personal OS data.
- Quick Capture defaults to a selected topic; when there are no topics, create a new subject and an Inbox topic. Move a captured entry between topics via Edit.
- When offline, operations use Heuresis's existing offline network layer. Replayed writes, authenticated context and cross-device sync should be tested with real devices before claiming complete offline reliability.

## Verification

- GitHub's `Check Heuresis` workflow runs `node scripts/check-architecture.mjs` and `npm run build`.
- The initial implementation passed these checks.
- The Supabase migration was applied and new tables verified with RLS enabled.
- The app has not been manually opened and exercised in a signed-in desktop session through this environment.
- No user data was migrated or deleted.

## Next steps (not part of v1)

- Add an explicit reconciliation flow for legacy Personal OS captures (with source-ID deduplication).
- Improve processing of Inbox items into organised notes, mistakes or existing Heuresis card links.
- Add longitudinal delayed-recall evidence to distinguish comprehension from self-declared status.
- Add UI/e2e coverage for authenticated creation, refresh, offline replay and mobile/tablet widths.


## Daily-use polish (next iteration)

The workspace still has **five sections**. Note, Lesson and Mistake are capture choices, not additional navigation sections.

- **Reopen after relaunch:** Heuresis already remembers the last main section; Notebook now also remembers the last opened note/lesson per signed-in user. The chosen topic is remembered on the device, and returning to Notebook can reopen the document.
- **Document view:** the Notebook topic list displays short previews; **Open note / Open lesson** enters the full formatted document with a Back control. Search results open the chosen note, rather than just its enclosing topic.
- **Recent documents:** Overview now includes up to five recently updated notes/lessons, with direct open controls.
- **Lesson template:** New lesson and Ctrl/Cmd+Shift+L launch a capture with prefilled headings (what we covered; vocabulary; corrections; to practise). A lesson remains an ordinary Knowledge note with a dated `Lesson ·` title, not a new database entity.
- **Faster setup:** adding a subject or topic uses inline controls, without native browser prompts. On narrow screens, the subjects rail opens for first-time creation.
- **Notebook filters:** All entries / Lessons / Notes. Mistake Log stays a separate main section.
- **Latest capture:** a newly saved note/lesson is remembered for reopening from Notebook.

### Manual smoke test required on the installed desktop build

1. Sign in, create a Chinese subject from an empty Notebook, and confirm an Inbox topic appears.
2. Capture a normal note via Ctrl+Shift+N. Save with Ctrl+Enter; verify the note is still present after reopening Heuresis.
3. Capture a Lesson via Ctrl+Shift+L. Add content, save, then reopen it from Overview, Notebook and search.
4. Open, edit and delete a note. Confirm all operations are reflected after refresh and a new sign-in.
5. Capture and correct a mistake. Confirm the recall exercise remains available and Study still works.
6. Confirm older Personal OS captures are read-only, the Anki Tracker stays separate and no legacy rows are duplicated.
7. Verify keyboard controls, spacing and modal fields on the actual Windows app; repeat an offline capture and subsequent reconnect before claiming reliable offline behaviour.

GitHub architecture and frontend checks are not substitutes for the manual steps above.
