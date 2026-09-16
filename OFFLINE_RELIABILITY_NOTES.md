# Offline reliability hotfix

This branch hardens Heuresis for long offline periods:

- cached session/user fallback remains usable after the Supabase JWT expires;
- card media is downloaded as IndexedDB blobs during Synchronise and rendered from blob URLs offline;
- Supabase requests are bounded to seven seconds before the existing offline cache/queue fallback takes over;
- Inter, DM Mono and Libre Caslon Display are bundled with the application instead of fetched from Google Fonts at runtime.

The larger response-cache architecture remains unchanged in this hotfix.
