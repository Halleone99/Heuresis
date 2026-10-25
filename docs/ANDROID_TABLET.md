# Android tablet (MagicPad APK): Sort and Review

24 October 2026. The APK built by `.github/workflows/tauri-android.yml` runs the same web
app inside the Android System WebView. On the tablet, Review (flashcards) and Sort did not
work. This change fixes them for Android only. The Windows app is unchanged.

## What was broken

| # | Where | What happened on the tablet | Cause |
|---|---|---|---|
| 1 | Review, landscape | Both side panels covered the whole screen and hid **Show answer**, so no card could be answered. The card was squeezed to about 230 px. | Between 1180 and 1240 CSS px wide (a MagicPad in landscape is about 1200), Review opens with both panels shown as columns, but an older rule (`@media (max-width:1240px) .cosmos-details { position:fixed; … }`) turned each into a fixed, full-width sheet on top of the card. |
| 2 | Review, every exit | **Done**, the close button and **Close** on an error tore down the app's only WebView. | Review called `getCurrentWindow().close()`. On Windows that closes the separate Review window. On Android the "window" is the whole app. |
| 3 | Sort, landscape | Sort's close button and progress (1 / 3) were hidden under the app header. Without a keyboard there was no Escape, so the only way out was to finish the pass. | Sort renders inside the content column, whose stacking context sits below the header. The tablet header is 72 px tall, so it covers Sort's top bar. |
| 4 | Sort, portrait | The bottom navigation and the Capture handle floated over Sort. The Save & next button sat below the visible part of the dialog. | Same stacking. The dialog was also sized for a desktop window. |
| 5 | Browse, a card's Connections tree | Their close buttons were under the app header. | Same stacking. |
| 6 | Review and Sort | Result buttons were 35 px tall, and the edit tools in Sort's knowledge column only appeared on mouse hover. | Desktop sizing. |
| 7 | Typing (Sort's quick note, typed answers, Capture) | The on-screen keyboard covered the field being typed into. | The app runs full screen (edge-to-edge), and Android does not resize such a window for the keyboard. |

## What changed

- `src/lib/platform.ts`: `markAndroidRuntime()` sets `data-platform="android"` on `<html>`. It does this only when the user agent is Android, before the first render (called from `main.tsx`). It also refreshes Study's counts if the WebView brings the page back from its back/forward cache.
- `src/android-tablet.css`: every rule is scoped to `:root[data-platform="android"]`.
  - Sort, Adjust, Browse, targeted sessions, Edit card and the Connections tree are lifted above the header and the bottom navigation.
  - Sort fills the screen.
  - Review fits the screen exactly. In landscape the side panels are columns. In portrait they are drawers. The card scrolls inside itself if it must.
  - Controls are finger-sized. Keyboard-digit hints are hidden.
- `src/components/CosmosWindow.tsx`:
  - On Android, leaving Review closes the session and goes Back to the topic it was opened from (`returnToHeuresisApp`) instead of closing the window.
  - The hints say "tap Show answer" instead of "(Space)".
- `src/components/ReviewScratchpad.tsx`: on Android, the writing layer also follows the card when the card scrolls.
- `.github/workflows/tauri-android.yml`: the generated `MainActivity` now shrinks the WebView by the keyboard's height (an IME inset listener plus `adjustResize`).
- Tests:
  - `verification/tests/android-tablet.mjs` and `android-lib.mjs`, added to `e2e.yml`;
  - `verification/tests/desktop-unchanged.mjs` (see `verification/README.md`).

## Why the Windows app is unaffected

- Nothing above runs or matches unless the user agent says Android.
- On Windows, the attribute is never set, and no listener is added.
- Every CSS rule needs the attribute.
- The `CosmosWindow` and `ReviewScratchpad` branches test `isAndroidRuntime()`.
- No Rust, `tauri.conf.json` or capability file was touched.

**Checked by pixel comparison.** `desktop-unchanged.mjs` compared production builds of this version and the previous one:
- screens: the topic, Sort, Adjust, Browse, and Review before and after reveal;
- Windows profiles: a 1440 px window, a 1200 px window and a Windows touchscreen;
- result: every screen was identical to the pixel;
- the Windows Review window still closes itself through Tauri.

The existing desktop suites (`review-v3`, `clarity`, `study-polish`, `regressions`) give exactly the same results before and after this change: 228 checks pass and 23 fail in both. The 23 are older checks written for earlier versions of Sort, the Notebook and the navigation; they fail without this change too. Every static check in `check.yml` passes.

## Verification

| Check | Before | After |
|---|---|---|
| `android-tablet.mjs` on the production build | 35 checks failed; most Review scenarios stopped at the first card | 204 of 204 pass |
| `desktop-unchanged.mjs` (Windows, three window profiles) | — | 18 of 18 screens identical; 27 of 27 checks pass |
| Existing desktop suites | 228 pass, 23 fail | 228 pass, the same 23 fail |
| `tsc --noEmit`, `npm run build`, every script in `check.yml` | pass | pass |

**Not verifiable here: the APK build itself.** This environment cannot reach Google's Android SDK or Maven repositories. The Kotlin added to `MainActivity` was generated from the workflow and read, but not compiled. The first CI run of `tauri-android.yml` is its compile check.

On the tablet itself, check:
- the keyboard no longer covers what you type;
- the Back gesture during Review returns to the topic;
- the result buttons feel right under a finger.

## Left as it was (deliberately)

- **The same Review panel overlap exists on Windows** when the Review window is between 1180 and 1240 px wide. Review windows normally open wider than that. It was left alone so that the desktop app is unchanged. The one-rule fix is in `android-tablet.css` (the `min-width: 1180px` block) if you want it on desktop too.
- **On Android, leaving Review reloads the main page** (unless the WebView keeps it in its back/forward cache). The topic reopens because Study remembers it, but the start-up synchronisation runs again.
- **The Android Back gesture outside Review leaves the app**, as before. It does not close an open dialog. Dialogs close with their own buttons.
- **The e2e workflow stops before the new suite.** It already stops at older failing checks, such as clarity's "Sort restores the card enrichment rails…". `android-tablet.mjs` is listed last, so it will only run in CI once those checks are updated. Until then, run it locally with `node tests/android-tablet.mjs`.
