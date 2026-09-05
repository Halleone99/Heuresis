# Heuresis integrity audit status

This audit compared standalone Heuresis with the mature Personal OS implementation, then ported the high-confidence integrity and parity mechanisms into the standalone product and shared Supabase model.

## Completed

- Browse does not write `encountered` events, so browsing cannot inflate review/new/explored metrics.
- Sort no longer writes stale full card `data` to stamp `_sorted_at`.
- Generic metadata patches use the server-side `heuresis_patch_card_data` JSONB merge RPC.
- Workspace writes preserve malformed/unsupported legacy entries rather than deleting data the desktop cannot round-trip.
- Legacy text blocks without `dim` resolve to Notes and legacy `contrast` resolves to Words.
- Shared workspace image blocks are preserved, signed from the private `heuresis-card-media` bucket, and rendered with captions inside Cosmos knowledge panels.
- Card image upload, caption editing and removal are available in the standalone card editor.
- Pack-level Related review runs through Cosmos using canonical session mode `related` and the normal encounter/reveal/Again/Hard/Good/Easy event path.
- Related CSV export is restored.
- Related SQL resolves term/reading/meaning by the card type's `field_schema.role`, so Sentence and Concept cards do not depend on literal `term` / `meaning` keys.
- Related deduplication is role-aware and maintained through a trigger-backed `dedupe_key`.
- Removing the final relation to an unpromoted `role='related'` identity removes that orphan automatically.
- Promoted/linked deletion failures surface a human-readable message instead of a raw FK error.
- Review events use a localStorage-backed retry queue and the `heuresis_record_events` batch RPC.
- Abandoned sessions older than 90 minutes are reconciled after authentication.
- Global Search deliberately includes both main and Related identities.
- Library Related counts use the lightweight count RPC instead of downloading the full catalogue.
- Main topic card loading remains role-aware, so Related identities do not inflate pack card counts.
- Card loading is paged rather than capped at 10,000 cards.
- Import supports progress, tags, `Lesson` / `Tag` / `Tags` columns, automatic tag creation and imported review-layout persistence.
- Saved catalogues can be updated and can run cross-pack Browse or Review sessions, using one canonical session per pack.
- The standalone repository now contains the historical Heuresis migration chain from the original schema through media, tagged imports, Related and the current integrity migrations.

## Production database verification — 2026-09-05

The shared Supabase project was migrated with:

- `20260905110410_heuresis_role_fields_and_integrity`
- `20260905111504_heuresis_rls_and_index_cleanup`

Post-migration verification showed:

- 22 Related relations preserved;
- 0 invalid/blank role-aware dedupe keys;
- 0 orphan Related-only cards;
- 0 Related catalogue rows with a blank source term;
- no remaining Heuresis-specific WARN-level security/performance advisor finding from these changes.

The production schema migrations are mirrored into both the standalone Heuresis repository and the Personal OS schema-sync branch.

## Deliberate non-blockers

These are not integrity blockers for this release:

- Related catalogue filtering/search can be pushed further into SQL later if the catalogue becomes large enough for client-side filtering to matter.
- Supabase reports several Heuresis indexes as currently unused; they are retained because current usage statistics alone are not evidence that the indexes are unnecessary.
- Media editing is centralised in the card editor while Cosmos renders the shared image blocks, matching the separation of storage/editing from study display.

## Release gate

Merge only when the branch's `Check Heuresis` workflow passes both `scripts/check-architecture.mjs` and `npm run build` at the final head.
