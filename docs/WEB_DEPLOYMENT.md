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

## Standard release workflow (web + native)

**Single source of truth:** `Halleone99/Heuresis` on GitHub. The Vite React interface is shared by the browser and Tauri. Do not copy files into Personal OS or maintain a separate production web branch.

1. Make changes on a feature branch and open a pull request to `main`.
2. Require the **Check Heuresis / frontend** build to pass and review relevant browser/native acceptance results before merging. Investigate failing checks; do not bypass failures without a documented reason. GitHub branch protection and Vercel Deployment Checks must be enabled by a project administrator.
3. Merge the tested change into `main`. The existing **Heuresis Vercel project** must be connected to `Halleone99/Heuresis`, with production branch `main`, framework Vite, root `/`, build command `npm run build`, and output directory `dist`. Vercel then deploys each push automatically; do **not** create a second project if `heuresis-phi.vercel.app` already belongs to one.
4. Existing GitHub Actions on `main` automatically build Windows x64 installers and Android ARM64 APK artefacts. Windows ARM64 is still manually triggered. Native **builds are not installed updates**: reinstall an APK/installer to run that build. Signed in-app Tauri updating is a separate future project.
5. In **Settings**, compare the short Git SHA and platform label on the web and native app. A native installation can be older than the website, even if both builds come from the same repository.
6. Verify the production deployment says **READY** at the expected source SHA and check sign-in, Learning, Review, Catalogue, and Supabase synchronisation before declaring the website up to date.

### One-time Vercel connection

The existing site currently used is `https://heuresis-phi.vercel.app`. The ChatGPT-connected Vercel team has exposed only the `health-os` project so far. Do not link Heuresis to or overwrite `health-os`. The Vercel owner must switch to the team containing the existing Heuresis project or expand the Vercel connection's project/team access, then connect that existing project to the GitHub repo above.

The build embeds `VERCEL_GIT_COMMIT_SHA` when exposed by Vercel, or detects the current Git HEAD if available; `HEURESIS_BUILD_COMMIT` is an explicit build-time override for non-Git packaging. The fallback label is `unknown revision`, which must **not** count as a verified release.

**Never put Supabase service-role keys or a Vercel access token into Vite client variables.**
