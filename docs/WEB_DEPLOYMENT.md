# Heuresis web release — alongside Tauri

Heuresis is one React/Vite interface with two distribution targets:
- **Web:** Vercel serves the Vite `dist/` output at an HTTPS origin.
- **Tauri:** retains native windows, Windows local backups and the existing installable desktop client.

Both targets continue using the same Supabase schema as Personal OS. No database migration is necessary merely to deploy the web frontend. Keep the same source files and design; do not fork the UI.

## Deploy a preview

1. In Vercel, import `Halleone99/Heuresis` as a Vite project, root `/`, build command `npm run build`, output `dist`.
2. Create a **preview** from the browser-ready branch and verify it before merging into `main`; after checks pass, deploy the tested `main` commit to production. Reuse the existing Heuresis Vercel project if you have access rather than creating a duplicate.
3. Use the existing client-side Supabase **publishable** key. Never include service-role/secret keys in Vite environment variables or frontend code.
4. Before making the site public, review RLS on Heuresis and Knowledge tables, user ownership checks in RPC functions and storage bucket policies. Check Supabase's Auth Site URL / Redirect URLs if changing authentication methods (current password sign-in does not depend on an OAuth redirect).
5. Confirm sign-in and sign-out, same-account Personal OS / Heuresis data, Notebook create/edit/reload, card reviews and event counts, Reading, Catalogue, image uploads, popup-blocked fallback, mobile in-tab navigation, and multi-device sync.
6. Test browser refresh and offline recovery. Confirm there are **zero pending edits** in the old desktop app before assuming all content is in the shared database.

## Important differences

- Desktop web and Windows Tauri should have the same React layout and CSS at the same viewport size. Browser chrome and native window frames differ.
- Android Chrome is a web browser, *not* the Android native wrapper. Small touch browsers now use single-tab review and Capture navigation.
- A browser may evict IndexedDB/localStorage and caches. Offline queues are **device- and origin-specific**. Unsynchronised Tauri writes do not appear automatically in the browser. Do not replace native complete daily backups with the smaller Knowledge JSON export; the latter does not cover every Study card, media item or offline journal.
- Tauri continues to provide native local backups and floating windows. On the web these controls are gated or use browser popups/in-page fallbacks.
- A functioning Vite production build establishes build compatibility, not verified end-to-end parity. Only promote a tested preview.

## Checks

```sh
npm ci
node --experimental-strip-types scripts/check-web-runtime.mjs
node scripts/check-architecture.mjs
npm run build
```
