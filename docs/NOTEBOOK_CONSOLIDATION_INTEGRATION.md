# Notebook and Mistake Log integration — 25 November 2026

Rebased on main 1680eea482e670f520a0d9f9894b5014d4903c1a. This is a functional consolidation, not a wholesale replacement with the uploaded archive. It preserves newer theme, Study, Review and Catalogue work.

- Permanent removal keeps exact-name confirmation and explicitly counts archived records (or reports that the count is unavailable).
- Notebook desktop and drawer share a topic tree; New note here opens the editor in the selected topic.
- Logged mistake filters use stable topic IDs and matching subtree counts; legacy ambiguous preferences are cleared rather than guessed.
- Bulk trash uses one Undo and reports partial failures. Existing individual mistake confirmation is retained.
- Correct rule parsing, unchanged correction handling, keyboard shortcuts and capture visibility.
- Memoised context; coalesced duplicate Study fetches; misleading lesson capture action removed without changing old data.

No schema migration. Retain historical lesson relationships, per-subject inbox routing, existing mistake detail fields, reading preferences and storage keys until compatibility tests establish that migration is safe. Sign-in/loading redesign remains separate in the supplied archive, not included here. CI and manual desktop/tablet tests are required before merge.
