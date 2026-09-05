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

## Shared database contract

The desktop client and Personal OS currently write the same Heuresis database. Compatibility is therefore a data-integrity requirement, not just a UI-parity goal.

Current invariants:

- ordinary topic lists load `role = 'main'` cards only;
- explicit Related review is allowed to load related identities by id and runs through the normal Cosmos review/session/event path;
- Browse does not record review encounters;
- review events are queued locally and flushed through `heuresis_record_events` so temporary connectivity loss does not discard grades;
- stale abandoned sessions are reconciled after authentication;
- desktop workspace edits preserve block formats the desktop client cannot render yet (including Personal OS image blocks and malformed/legacy entries);
- global Search includes both main and related identities and labels related hits;
- Related schema/RPC migrations are versioned under `supabase/migrations/`.

The remaining known schema issue is card-type field-key resolution in Related RPC/view logic: vocabulary types use `term/reading/meaning`, while sentence and concept types use different role keys. Do not enable Related creation on additional card types without fixing that database contract first.
