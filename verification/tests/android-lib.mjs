// Android tablet emulation for the Heuresis APK (MagicPad).
//
// The APK is the same web app inside the Android System WebView, started by Tauri.
// What differs from the desktop browser runs, and is reproduced here:
//   * the user agent says Android (the app's own platform switch, src/lib/platform.ts);
//   * input is touch only: taps, no hover, no physical keyboard;
//   * there is exactly one window. Tauri's Android runtime has no second WebView,
//     and closing the current window tears the only WebView down. The stand-in below
//     records every IPC call and blanks the page on window close, so a desktop-only
//     code path shows up as a failure instead of passing silently;
//   * an on-screen keyboard shrinks the visible area (emulated by resizing).
import { chromium } from "playwright";

export const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; HEY2-W09 Build/HONORHEY2-W09; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Safari/537.36";

/** CSS-pixel viewports of an Android tablet in immersive full screen. */
export const TABLET = {
  landscape: { width: 1200, height: 768 },
  portrait: { width: 768, height: 1200 },
  wideLandscape: { width: 1500, height: 960 },
};

function tauriAndroidStandIn() {
  const LOG = "__heuresis_test_tauri_calls";
  const record = (cmd) => {
    try {
      const calls = JSON.parse(sessionStorage.getItem(LOG) || "[]");
      calls.push(cmd);
      sessionStorage.setItem(LOG, JSON.stringify(calls));
    } catch { /* test bookkeeping only */ }
  };
  let next = 0;
  const callbacks = new Map();
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
    plugins: { path: { sep: "/", delimiter: ":" } },
    transformCallback(callback, once) {
      const id = ++next;
      callbacks.set(id, (payload) => { if (once) callbacks.delete(id); return callback?.(payload); });
      return id;
    },
    unregisterCallback(id) { callbacks.delete(id); },
    runCallback(id, payload) { callbacks.get(id)?.(payload); },
    convertFileSrc(path) { return path; },
    async invoke(cmd) {
      record(cmd);
      if (cmd === "plugin:window|close" || cmd === "plugin:window|destroy") {
        // Android: the main window is the app. Closing it drops the only WebView.
        document.documentElement.innerHTML = '<body data-android-webview-destroyed="1"></body>';
        return null;
      }
      if (cmd === "plugin:webview|create_webview_window" || cmd === "plugin:window|create") {
        throw new Error("Android has a single WebView: additional windows are not supported.");
      }
      if (cmd === "plugin:event|listen") return ++next;
      if (cmd === "plugin:window|set_theme") throw new Error("set_theme is not supported on mobile");
      if (cmd.startsWith("local_backup_") || cmd === "show_quick_capture") throw new Error(`Command ${cmd} not found`);
      return null;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
}

export async function launchTablet({ viewport = TABLET.landscape, scheme = "light" } = {}) {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({
    viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: ANDROID_UA, colorScheme: scheme,
  });
  await context.addInitScript(tauriAndroidStandIn);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.log("[pageerror]", error.message); });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/page_backgrounds|status of 404|favicon/.test(text)) return;
    errors.push(text);
    console.log("[console.error]", text.slice(0, 400));
  });
  // Android opens no second WebView: any popup would be a desktop path leaking through.
  const popups = [];
  context.on("page", (opened) => { if (opened !== page) popups.push(opened.url()); });
  return { browser, context, page, errors, popups };
}

export async function tauriCalls(page) {
  return page.evaluate(() => {
    try { return JSON.parse(sessionStorage.getItem("__heuresis_test_tauri_calls") || "[]"); } catch { return []; }
  }).catch(() => []);
}

/** True when the page was torn down the way Android tears down a closed window. */
export async function webviewDestroyed(page) {
  return page.evaluate(() => document.body?.dataset.androidWebviewDestroyed === "1").catch(() => false);
}

/**
 * Taps an element the way a finger does, after checking that it is on screen and that
 * nothing covers its centre. Returns false (and taps nothing) when a finger could not reach it.
 */
export async function fingerTap(page, locator, { label = "control", scroll = true } = {}) {
  const target = typeof locator === "string" ? page.locator(locator).first() : locator;
  await target.waitFor({ state: "visible", timeout: 15000 });
  if (scroll) await target.scrollIntoViewIfNeeded().catch(() => undefined);
  const box = await target.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) return { ok: false, reason: `${label} has no box` };
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (x < 0 || y < 0 || x > viewport.width || y > viewport.height) return { ok: false, reason: `${label} is off screen at ${Math.round(x)},${Math.round(y)}` };
  const hit = await target.evaluate((element, point) => {
    const top = document.elementFromPoint(point.x, point.y);
    return { reachable: Boolean(top && (top === element || element.contains(top))), top: top ? `${top.tagName.toLowerCase()}.${String(top.className).split(" ").join(".")}` : "nothing" };
  }, { x, y });
  if (!hit.reachable) return { ok: false, reason: `${label} is covered by ${hit.top}` };
  await page.touchscreen.tap(x, y);
  return { ok: true, box };
}

/** Whether the element's centre is on screen and not covered, without scrolling anything. */
export async function reachableNow(page, selector) {
  return page.locator(selector).first().evaluate((element) => {
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height) return false;
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
    const top = document.elementFromPoint(x, y);
    return Boolean(top && (top === element || element.contains(top)));
  }).catch(() => false);
}

export async function signInTablet(page, base) {
  await page.goto(base);
  await page.fill("input[type=email]", "thomas@example.test");
  await page.fill("input[type=password]", "heuresis");
  await page.locator("button[type=submit]").tap();
  await page.locator(".heuresis-section-sidebar:visible, .mobile-workspace-nav:visible").first().waitFor({ state: "visible", timeout: 20000 });
  await page.waitForTimeout(800);
}

/** Study → the HSK topic, by touch, in whichever navigation the width shows. */
export async function openTopicByTouch(page, title = "HSK 2 — Time") {
  const mobile = page.locator('.mobile-workspace-nav button:has-text("Study")');
  if (await mobile.isVisible().catch(() => false)) await mobile.tap();
  else await page.locator('.hw-sections button:has-text("Study")').tap();
  await page.waitForTimeout(800);
  await page.locator(`button:has-text("${title}")`).first().tap();
  await page.locator('.topic-browse-actions button:has-text("Show all")').tap();
  await page.locator(".modern-topic-row").first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(500);
}
