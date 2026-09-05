# Heuresis integrity audit status

This branch compares standalone Heuresis against the more mature Personal OS implementation and ports high-confidence mechanisms rather than redesigning them.

## Fixed / ported

- Browse no longer records `encountered` events.
- Sort no longer writes stale full card `data` just to stamp `_sorted_at`.
- Standalone card-data writes preserve workspace entries they cannot round-trip yet.
- Legacy text blocks without `dim` render under Notes; legacy `contrast` maps to Words.
- Pack-level Related review runs through Cosmos, uses session mode `related`, and records encountered/revealed/Again/Hard/Good/Easy through the canonical event path.
- Related pack CSV export restored.
- Review events use a localStorage-backed retry queue and `heuresis_record_events` batch RPC.
- Abandoned sessions older than 90 minutes are reconciled after authentication.
- Global Search includes related identities and marks them as Related.
- Four existing Related schema/RPC/security migrations from Personal OS are now versioned in the standalone repository.

## Live database verification

On 2026-09-05, the shared Supabase project showed:

- all current Related relations are on `Vocabulary — Chinese`;
- the query for relations whose source lacks `data.term` returned zero rows;
- therefore no current Related relation is known to be affected by the field-key bug described below.

## Still open

### P0 — role-based field keys in Related SQL

The current SQL assumes `term`, `reading`, and `meaning`. This is wrong for card types such as:

- `Sentence — Chinese`: `sentence`, `reading`, `translation`;
- `Concept`: `concept`, `thinker`, `definition`.

Fix the RPC/view contract before enabling Related vocabulary on those card types. The migration should resolve fields by `field_schema.role` rather than hardcoded JSON keys and preserve deduplication semantics.

### P1 — complete image support

Desktop writes now preserve Personal OS image workspace blocks, but the standalone Cosmos does not yet render/upload them.

### P1 — deletion integrity

Define source-card deletion semantics for related-only identities and provide a human error for FK `23503` when a relation target prevents deletion.

### P1 — server-side JSONB patching

The Sort overwrite bug is narrowed, but `patchCardData` still performs client read-modify-write. Move generic metadata patching to a server-side JSONB merge RPC or equivalent concurrency-safe path.

### P2 — import/catalogue parity

Still missing from standalone: import-with-tags/progress/layout and cross-pack Catalogue sessions.
