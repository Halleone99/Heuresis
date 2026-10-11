# Heuresis Desktop

Standalone Tauri client for Heuresis, using the same Supabase account and Heuresis schema as Personal OS.

## Development

```powershell
npm install
npm run dev
```

For Tauri development:

```powershell
npm run tauri dev
```

## Learning workspace

The app has five sections in a compact sidebar: **Overview, Study, Notebook, Mistake Log, Progress**. Study is the original Heuresis flashcard system, unchanged internally. Notes, lessons and mistakes are captured from anywhere:

| Keys | Action |
| --- | --- |
| `Ctrl/⌘ ⇧ N` / `M` / `L` | Quick note / mistake / start a lesson |
| `Ctrl/⌘ K` or `/` | Search (notes in the workspace, cards in Study) |
| `Alt 1–5` | Switch section · `?` lists every shortcut |

**Database requirement:** apply `supabase/migrations/20261012090000_knowledge_workspace_v2.sql` (additive; it does not change existing rows). Until it is applied the Notebook and Mistake Log are read-only and say so; Study works either way.

Details: `docs/KNOWLEDGE_WORKSPACE.md`. What changed in this version, how it was verified and what is still open: `docs/WORKSPACE_V2_REPORT.md`. Local end-to-end harness (PostgreSQL + PostgREST + Playwright, no real Supabase project needed): `verification/README.md`.

## Shared database contract

The desktop client and Personal OS currently write the same Heuresis database. Compatibility is therefore a data-integrity requirement, not just a UI-parity goal.

Current invariants:

- ordinary topic lists load `role = 'main'` cards only;
- pack-level Related review loads related identities explicitly and runs through the normal Cosmos review/session/event path;
- Browse does not record review encounters;
- review events are queued locally and flushed through `heuresis_record_events` so temporary connectivity loss does not discard grades;
- stale abandoned sessions are reconciled after authentication;
- desktop workspace edits preserve block formats the desktop client cannot render yet (including Personal OS image blocks and malformed/legacy entries);
- global Search includes both main and related identities and labels related hits;
- Related schema/RPC migrations are versioned under `supabase/migrations/`.

See `docs/INTEGRITY_AUDIT_STATUS.md` for the current parity audit and remaining work.

The main unresolved schema issue is card-type field-key resolution in Related RPC/view logic: vocabulary types use `term/reading/meaning`, while sentence and concept types use different role keys. Live read-only verification on 2026-09-05 found no currently affected relations. No production schema change was made by this branch.
