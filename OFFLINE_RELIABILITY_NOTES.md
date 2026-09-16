# Offline reliability hotfix

This branch hardens Heuresis for long offline periods:

- cached session/user fallback remains usable after the Supabase JWT expires;
- card media is downloaded as IndexedDB blobs during Synchronise and rendered from blob URLs offline;
- Supabase read requests are bounded to seven seconds before the existing offline cache fallback takes over;
- Inter, DM Mono and Libre Caslon Display are bundled with the application instead of fetched from Google Fonts in the packaged build.

The larger response-cache architecture remains unchanged in this hotfix.

## Follow-up pass

- The seven-second deadline now applies only to idempotent reads. Card inserts let the server generate the row id, so aborting a slow-but-successful write and handing it to the offline queue could replay it as a duplicate row.
- `signHeuresisCardImages` no longer re-signs and re-downloads paths already held as blobs. Cached image paths are immutable because each upload receives a UUID.
- The packaged build continues to strip the legacy Google Fonts `@import` and ships the font files locally. The source-level import can be removed separately without changing offline installer behaviour.
