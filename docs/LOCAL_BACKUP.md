# Heuresis — automatic local Windows backups

## What is implemented

The installed **Windows Tauri** app checks whether a completed backup exists for
the current local calendar day. It checks on app launch, hourly while open, when
the app regains focus, when the Internet reconnects, and after a synchronisation
attempt finishes. It runs only while signed in and online. Current-account edits
still waiting to upload (including server-refused edits) are saved as separate
recovery entries in the dated snapshot, not silently merged into Supabase data.
Automatic failures are quiet and retried; manual checks show the result inside
the Account menu. Older completed backups are never replaced by failures.

**Backup location:** Windows **Documents / Heuresis / Backups / <account UUID> /
Heuresis-YYYY-MM-DD**. Windows may redirect Documents to another location
(e.g. OneDrive); use the actual path shown by the app after a manual backup.

Each complete backup folder contains:
- `snapshot.json`: versioned JSON of *all account rows*, including Notebook,
  archived records, mistake modes/recall, Study cards, templates, tags,
  relationships, statistics, sessions and events, Reading books/quotations,
  and the Heuresis page background configuration.
  `offline_recovery.entries` also contains any unsent current-account mutation
  bodies found on this device, marked for manual review; `legacy_unassigned_count`
  records older quarantined edits (their contents are **not** imported into
  the signed-in account's backup because ownership cannot be verified).
- `media/<bucket>/<user-id>/...`: original binary files from the private
  `heuresis-card-media` and `page-background-media` buckets.
- `manifest.json`: completion marker, per-table record counts, media count
  and number of separately preserved offline edits.

Copies are retained as the **latest 7 daily snapshots**, **up to 4 older
weekly snapshots** and **up to 3 older monthly snapshots**. They are independent
of Supabase and of the WebView cache. The current day's snapshot is never
overwritten by another automatic attempt.

**Manual check:** Account menu → **Check PC backup**, or Ctrl+K →
**Create local Heuresis backup**. The result, including the actual folder or
a failure explanation, appears quietly inside the Account menu; no routine banner
or toast is raised.

## Fail-closed behaviour

All reads come from the live, signed-in Supabase account, paginated with a hard
limit; they never silently use a partial offline cache. Any read, media
listing, file download or native filesystem failure prevents completion.
The app writes into a `.incomplete` folder and atomically renames it to a
dated folder only when the snapshot, offline journal and every media file have
been checked. If the offline journal changes while downloading data, the staging
folder is not published and a later attempt retries.
The original database is never changed by this feature.

## Limitations and recovery

- Automatic backup runs **only while the Windows desktop app is open**. It is
  not a Windows scheduled task and does not run if the PC is powered off.
- Today's backup captures one point in time; edits made after it are normally
  stored in Supabase and included in the **next day's** local backup.
- An unsent offline edit is present only in `offline_recovery.entries`, not
  yet in the server tables. No automatic replay/restore is currently provided.
  Older **unassigned** offline edits must still be exported separately from
  Account → Offline recovery. Never clear app data before reviewing them.
- Study review events in the device's separate local queue and unfinished drafts
  are not covered by the current account-specific offline recovery journal;
  this must be addressed before treating snapshots as universal device backups.
- A multi-table Supabase export is not a transactionally consistent database
  dump; simultaneous edits can span different instants during collection.
- The export covers the listed Heuresis tables and uploaded media. It does
  **not** constitute a complete backup of unrelated Personal OS/BEON tables
  or externally hosted images linked from notes.
- Backups are **not encrypted**. Keep the account folder private; use disk
  encryption and a separate encrypted off-device copy for stronger protection.
- The format is intentionally inspectable JSON plus files. Automated
  full-library **restore has not been implemented or tested**; do not assume
  clicking Restore is available. Preserve multiple backups before attempting
  manual recovery.

## Release verification checklist (on the actual Windows PC)

1. Build/install the latest Windows Tauri app and sign in.
2. Account menu → Check PC backup. Observe success and inspect the
   folder's `manifest.json`, `snapshot.json` and `media`.
3. Check `manifest.json` lists all expected tables, its counts agree with
   `snapshot.json` and `pending_offline_writes` matches
   `snapshot.json.offline_recovery.entries.length`. Spot-check a note,
   a flashcard and a quotation.
4. Run the command again today: it must preserve the already completed backup.
5. Temporarily disconnect the network on a day without a backup: no incomplete
   folder should be shown as a successful completed copy.
6. Verify restart/focus/next-day backup behaviour and retention over time.
   On a fresh backup day, test a held offline edit: its full body should be
   preserved in `offline_recovery` even while server sync cannot accept it,
   and no banner should appear in Notebook.
7. Perform a test restore into a **separate** database/environment before
   treating the backups as fully recoverable.

Status: feature committed to source. Build and on-device restoration checks
must be completed separately; do not infer success just from source presence.
