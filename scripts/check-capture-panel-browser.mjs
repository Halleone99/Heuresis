// Capture in Chromium: the quick note, the pen (eraser, undo, stylus eraser, palm
// rejection), the formatted page with drawings and its saving, and the floating
// window (move, resize, full screen, minimise) on the desktop, in the desktop
// app's own window, and on the Android tablet (touch and stylus).
// The workspace is an in-memory stand-in (scripts/lib/capture-fixture.mjs);
// the panel, pad, editor and styles are the real ones.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { chromium } from "playwright";
import { writeCaptureFixture } from "./lib/capture-fixture.mjs";

const dir = "test-output/capture-panel";
const shots = `${dir}/shots`;
mkdirSync(shots, { recursive: true });
writeCaptureFixture(dir);
const port = 5193;
const server = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { stdio: "pipe" });
let serverLog = "";
server.stdout.on("data", (data) => { serverLog += data; });
server.stderr.on("data", (data) => { serverLog += data; });
const base = `http://127.0.0.1:${port}/${dir}/index.html`;
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; HEY2-W09 Build/HONORHEY2-W09; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Safari/537.36";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
let passed = 0;
const check = (condition, message) => { assert.ok(condition, message); passed += 1; };

async function open(query = "", options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...options });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base + query);
  await page.waitForSelector(".cap-panel, .cap-pill", { timeout: 20000 });
  return page;
}
const calls = (page, type) => page.evaluate((kind) => window.__calls.filter((call) => call.type === kind), type);
const strokeCount = (page, scope = ".cap-body") => page.locator(`${scope} .hn-canvas .hn-stroke`).count();
/** Points in 0–1 of the canvas box, drawn with the mouse. */
async function draw(page, points, canvas = ".cap-body .hn-canvas") {
  const box = await page.locator(canvas).first().boundingBox();
  const at = points.map(([x, y]) => [box.x + x * box.width, box.y + y * box.height]);
  await page.mouse.move(at[0][0], at[0][1]);
  await page.mouse.down();
  for (const [x, y] of at.slice(1)) await page.mouse.move(x, y, { steps: 5 });
  await page.mouse.up();
}
/** Synthetic pointer events, for stylus buttons that no input API can press. */
async function pointer(page, canvas, points, init) {
  await page.evaluate(({ canvas, points, init }) => {
    const target = document.querySelector(canvas);
    const box = target.getBoundingClientRect();
    const at = points.map(([x, y]) => ({ clientX: box.left + x * box.width, clientY: box.top + y * box.height }));
    const fire = (type, point, extra = {}) => target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, isPrimary: true, ...init, ...point, ...extra }));
    fire("pointerdown", at[0]);
    for (const point of at.slice(1)) fire("pointermove", point);
    fire("pointerup", at[at.length - 1], { buttons: 0 });
  }, { canvas, points, init });
}
async function cdpStroke(page, cdp, kind, canvas, points) {
  const box = await page.locator(canvas).first().boundingBox();
  const at = points.map(([x, y]) => ({ x: box.x + x * box.width, y: box.y + y * box.height }));
  if (kind === "touch") {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at[0]] });
    for (const point of at.slice(1)) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", pointerType: "pen", button: "left", buttons: 1, clickCount: 1, ...at[0] });
    for (const point of at.slice(1)) await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", pointerType: "pen", button: "left", buttons: 1, ...point });
    await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", pointerType: "pen", button: "left", buttons: 0, clickCount: 1, ...at[at.length - 1] });
  }
  await page.waitForTimeout(60);
}
/** A finger tap through the same input channel as the strokes, so the two never overlap. */
async function cdpTap(page, cdp, selector) {
  const box = await page.locator(selector).first().boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(80);
}
async function rect(page, selector) {
  // The panel rises into place when it opens; measure where it settles.
  await page.locator(selector).first().evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished))).catch(() => undefined);
  return page.locator(selector).first().boundingBox();
}

try {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error("Vite exited: " + serverLog);
    try { if ((await fetch(base)).ok) break; } catch { /* starting */ }
    if (attempt === 79) throw new Error("Vite did not start: " + serverLog);
    await sleep(250);
  }

  // ---------------------------------------------------------------------------
  console.log("1. Quick note: save, the panel stays open for the next one");
  let page = await open();
  await page.locator(".cap-text").fill("der Bahnhof — station");
  await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => window.__calls.some((call) => call.type === "submit"));
  let [submit] = await calls(page, "submit");
  check(submit.input.body === "der Bahnhof — station" && submit.input.kind === "note" && submit.input.topicId === "t1", "quick note saved as a provisional note in the Inbox");
  check(submit.input.description === "heuresis:q:v1:note", "the Captures marker is kept");
  await page.waitForSelector(".cap-foot-note.is-flash");
  check(await page.locator(".cap-text").inputValue() === "", "the panel is cleared and stays open for the next capture");
  check((await page.locator(".cap-foot-note").innerText()).includes("Saved to Captures"), "saving is confirmed quietly");
  await page.locator(".cap-text").fill("我正在写");
  await page.locator(".cap-text").evaluate((element) => {
    for (const key of ["Enter", "Escape"]) {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, ctrlKey: key === "Enter" });
      Object.defineProperty(event, "keyCode", { get: () => 229 });
      element.dispatchEvent(event);
    }
  });
  check(await page.locator(".cap-panel").count() === 1 && (await calls(page, "submit")).length === 1, "an input method's Enter and Escape neither save nor close");

  // ---------------------------------------------------------------------------
  console.log("2. Pen: strokes, undo and redo, eraser, stylus eraser, highlighter, paper, clear");
  await page.click(".cap-seg button:has-text('Pen')");
  await page.waitForSelector(".cap-body .hn-canvas");
  await draw(page, [[.1, .15], [.2, .2], [.3, .15], [.4, .2]]);
  await draw(page, [[.1, .45], [.4, .45]]);
  await draw(page, [[.6, .3], [.8, .6]]);
  check(await strokeCount(page) === 3, "three strokes drawn");
  await page.keyboard.press("Control+z");
  check(await strokeCount(page) === 2, "Ctrl+Z removes the last stroke");
  await page.keyboard.press("Control+Shift+z");
  check(await strokeCount(page) === 3, "Ctrl+Shift+Z brings it back");
  await page.click(".hn-tools button[aria-label^='Eraser']");
  await draw(page, [[.25, .35], [.25, .55]]);
  check(await strokeCount(page) === 2, "the eraser removes the stroke it crosses");
  check(await page.locator(".hn-tools [aria-label^='Size'], .hn-sizes").count() === 0, "colours and sizes step aside for the eraser");
  await page.click(".hn-tools button[aria-label='Undo (Ctrl+Z)']");
  check(await strokeCount(page) === 3, "an erasure can be undone");
  await page.keyboard.press("p");
  check(await page.locator(".hn-pad[data-tool='pen']").count() === 1, "P picks the pen again");
  await pointer(page, ".cap-body .hn-canvas", [[.7, .2], [.7, .5], [.7, .8]], { pointerId: 41, pointerType: "pen", buttons: 32, button: 5 });
  check(await strokeCount(page) === 2, "the stylus's eraser end erases while the pen is selected");
  await pointer(page, ".cap-body .hn-canvas", [[.15, .1], [.15, .3]], { pointerId: 42, pointerType: "pen", buttons: 2, button: 2 });
  check(await strokeCount(page) === 1, "so does the stylus's side button");
  await page.click(".hn-tools button[aria-label^='Highlighter']");
  check(await page.locator(".hn-sizes:visible").count() === 0, "secondary pen sizes start hidden");
  await page.click(".hn-tools button[aria-label='More handwriting tools']");
  await page.click(".hn-sizes button[aria-label='Bold']");
  await draw(page, [[.05, .45], [.5, .46]]);
  const marker = page.locator(".cap-body .hn-stroke.hn-marker");
  check(await marker.count() === 1 && await marker.getAttribute("stroke-width") === "32", "a bold highlighter stroke");
  await page.click(".hn-tools button[aria-label^='Plain paper']");
  check(await page.locator(".cap-body .hn-sheet[data-paper='lines'] .hn-paper-lines").count() === 1, "lined paper");
  await page.click(".hn-tools button[aria-label='Clear page']");
  check(await strokeCount(page) === 0, "Clear empties the page");
  check((await page.locator(".hn-status").innerText()).includes("Undo"), "and says Undo brings it back");
  await page.keyboard.press("Control+z");
  check(await strokeCount(page) === 2, "which it does");
  const heightBefore = (await rect(page, ".cap-body .hn-canvas")).height;
  await page.click(".hn-tools button[aria-label='Pen (P)']");
  await page.locator(".cap-body .hn-scroll").evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await draw(page, [[.3, .985], [.5, .99]]);
  check((await rect(page, ".cap-body .hn-canvas")).height > heightBefore + 50, "writing at the bottom adds paper");
  await page.locator(".cap-caption").fill("Strokes of 写");
  await page.click(".cap-save");
  await page.waitForFunction(() => window.__calls.filter((call) => call.type === "submit").length === 2);
  submit = (await calls(page, "submit"))[1];
  const [caption, line] = submit.input.body.split("\n\n");
  check(caption === "Strokes of 写" && line.startsWith("::handnote:v1:"), "handwriting is saved with its caption");
  const saved = await page.evaluate((text) => window.__ink.decodeHandNote(text), line);
  check(saved.strokes.length === 3 && saved.paper === "lines" && saved.height > 700, "every stroke, the paper and the added space are stored");
  check(saved.strokes.some((stroke) => stroke.tool === "marker" && stroke.size === 2), "the highlighter is stored as a highlighter");
  check(await strokeCount(page) === 0, "the pad is clear after saving");
  await page.screenshot({ path: `${shots}/desktop-pen.png` });

  // ---------------------------------------------------------------------------
  console.log("3. Format: a page with headings, lists and drawings that keeps saving itself");
  await page.click(".cap-seg button:has-text('Text')");
  await page.locator(".cap-text").fill("independent quick draft");
  await page.click(".cap-chip.is-format");
  await page.waitForSelector(".cap-page .nb-editor");
  check(!(await page.locator(".cap-page .nb-editor").innerText()).includes("independent quick draft"), "opening Page does not silently move the Quick draft");
  await page.locator(".cap-page .nb-editor p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.type("# Aspect");
  await page.keyboard.press("Enter");
  await page.keyboard.type("- 了 marks completion");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  check(await page.locator(".cap-page .nb-editor h2").count() === 1 && await page.locator(".cap-page .nb-editor li").count() >= 1, "# and - become a heading and a list");
  await page.click(".nb-toolbar button[aria-label='Draw']");
  await page.waitForSelector(".ink-sheet .hn-canvas");
  check(await page.locator(".ink-sheet .hn-pad[data-tool='pen']").count() === 1, "a new drawing opens with the pen");
  await draw(page, [[.1, .1], [.3, .2], [.5, .1]], ".ink-sheet .hn-canvas");
  await draw(page, [[.1, .3], [.5, .3]], ".ink-sheet .hn-canvas");
  await page.click(".ink-sheet button:has-text('Insert drawing')");
  check(await page.locator(".cap-page .nb-editor [data-handnote]").count() === 1, "the drawing sits in the page");
  check(await page.locator(".cap-page .nb-editor [data-handnote] + p").count() === 1, "with a line after it to keep writing");
  await page.locator(".cap-page-title").fill("Lesson 12");
  await page.keyboard.press("Control+s");
  await page.waitForFunction(() => window.__calls.filter((call) => call.type === "submit").length === 3);
  submit = (await calls(page, "submit"))[2];
  check(submit.input.title === "Lesson 12" && /^# Aspect$/m.test(submit.input.body) && /^- 了 marks completion$/m.test(submit.input.body), "the page is saved with its title and formatting");
  check((submit.input.body.match(/^::handnote:v1:/gm) ?? []).length === 1, "and its drawing as one line");
  await page.waitForSelector(".cap-save:has-text('Saved')");
  check((await page.locator(".cap-foot-note").innerText()).includes("saves itself"), "after the first save the page says it saves itself");
  await page.locator(".cap-page .nb-editor p").last().click();
  await page.keyboard.type("Later addition");
  await page.waitForFunction(() => window.__calls.some((call) => call.type === "patch"), null, { timeout: 8000 });
  const [patch] = await calls(page, "patch");
  check(patch.id === submit.input.id && patch.patch.body.includes("Later addition"), "later writing updates the same capture");
  check((await calls(page, "submit")).length === 3, "without creating a second one");

  // A failed update must retain the original saved identity; retry updates
  // the same note and never silently creates a second capture.
  await page.evaluate(() => { window.__failPatch = true; });
  await page.locator(".cap-page .nb-editor p").last().click();
  await page.keyboard.type(" save retry");
  await page.keyboard.press("Control+s");
  await page.waitForSelector(".cap-error-actions button:has-text('Save copy')");
  check((await calls(page, "submit")).length === 3, "failed update did not create a duplicate capture");
  const idAfterFailure = await page.evaluate(() => JSON.parse(localStorage.getItem("heuresis.capture.panel.v2:u1:main")).page.savedId);
  check(idAfterFailure === submit.input.id, "failed update keeps the original saved ID in the local draft");
  await page.evaluate(() => { window.__failPatch = false; });
  await page.click(".cap-save");
  await page.waitForFunction(() => document.querySelector(".cap-save")?.textContent?.trim() === "Saved");
  const lastRetry = (await calls(page, "patch")).at(-1);
  check(lastRetry.id === submit.input.id && lastRetry.patch.body.includes("save retry"), "retry updates the same saved record");
  check((await calls(page, "submit")).length === 3, "retry still did not create another record");
  await page.screenshot({ path: `${shots}/desktop-page.png` });
  await page.locator(".cap-page .nb-editor [data-handnote]").click();
  await page.waitForSelector(".ink-sheet");
  check(await strokeCount(page, ".ink-sheet") === 2 && await page.locator(".ink-sheet button:has-text('Update drawing')").count() === 1, "clicking a drawing opens it again");
  await draw(page, [[.6, .5], [.8, .5]], ".ink-sheet .hn-canvas");
  await page.keyboard.press("Escape");
  check(await page.locator(".ink-sheet").count() === 0, "Escape closes the drawing");
  const updated = await page.locator(".cap-page .nb-editor [data-handnote]").getAttribute("data-handnote");
  check((await page.evaluate((text) => window.__ink.decodeHandNote(text), updated)).strokes.length === 3, "and keeps the stroke just added");
  await page.locator(".cap-page .nb-editor [data-handnote]").click();
  await page.click(".ink-sheet button:has-text('Remove drawing')");
  check(await page.locator(".cap-page .nb-editor [data-handnote]").count() === 0, "a drawing can be removed");
  await page.click(".cap-chip:has-text('New page')");
  await page.waitForFunction(() => !document.querySelector(".cap-page-title")?.value);
  check((await page.locator(".cap-page .nb-editor").innerText()).trim() === "", "New page saves this one and opens a blank page");
  const lastPatch = (await calls(page, "patch")).at(-1);
  check(!lastPatch.patch.body.includes("::handnote:"), "after saving the removal of the drawing");
  await page.click(".cap-chip:has-text('Quick')");
  check(await page.locator(".cap-text").inputValue() === "independent quick draft", "Quick returns with its independent draft unchanged");
  await page.locator(".cap-text").fill("");
  // The saved page, as Captures shows it.
  const pageEntry = await page.evaluate((id) => window.__entries.find((entry) => entry.id === id), submit.input.id);
  const captures = await page.context().newPage();
  captures.on("pageerror", (error) => errors.push(error.message));
  await captures.addInitScript((entry) => localStorage.setItem("fixture.entries", JSON.stringify([{ ...entry, user_id: "u1", attempt: "", correction: "", explanation: "" }])), {
    ...pageEntry, body: `${pageEntry.body}\n\n${submit.input.body.match(/^::handnote:v1:.*$/m)[0]}`,
  });
  await captures.goto(base + "?view=captures");
  await captures.waitForSelector(".q-review");
  check((await captures.locator(".q-list > button").first().innerText()).includes("Lesson 12"), "Captures lists the page by its title");
  check(await captures.locator(".q-review-title").innerText() === "Lesson 12", "and shows the title");
  check(await captures.locator(".q-review-read h2").count() === 1 && await captures.locator(".q-review-read .hn-svg").count() === 1, "the page reads formatted, with its drawing");
  check(await captures.locator(".q-review textarea").count() === 0, "drawing data is never shown as text");
  await captures.click(".q-edit-link");
  check((await calls(captures, "openDocument")).some((call) => call.options?.edit), "Edit opens it in the Notebook editor, where drawings stay editable");
  await captures.screenshot({ path: `${shots}/captures-page.png` });
  await captures.close();

  // ---------------------------------------------------------------------------
  console.log("4. The floating panel: move, resize, full screen, minimise, close");
  const start = await rect(page, ".cap-panel");
  const head = await rect(page, ".cap-head");
  await page.mouse.move(head.x + 80, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(head.x - 120, head.y + head.height / 2 - 80, { steps: 6 });
  await page.mouse.up();
  const moved = await rect(page, ".cap-panel");
  check(Math.abs(moved.x - (start.x - 200)) < 3 && Math.abs(moved.y - (start.y - 80)) < 3, `the title bar moves the panel (${JSON.stringify([start, moved])})`);
  const grip = await rect(page, ".cap-resize");
  await page.mouse.move(grip.x + 8, grip.y + 8);
  await page.mouse.down();
  await page.mouse.move(grip.x + 68, grip.y + 48, { steps: 6 });
  await page.mouse.up();
  const resized = await rect(page, ".cap-panel");
  check(Math.abs(resized.width - start.width - 60) < 3 && Math.abs(resized.height - start.height - 40) < 3, "the corner grip resizes it");
  await page.locator(".cap-text").fill("draft that must survive");
  await page.click(".cap-window button[aria-label='Full screen']");
  await page.waitForSelector(".cap-panel.is-full");
  const full = await rect(page, ".cap-panel");
  check(full.x === 0 && full.y === 0 && full.width === 1280 && full.height === 860, "full screen fills the window");
  check(await page.evaluate(() => document.elementFromPoint(5, 5)?.closest(".cap-panel") !== null), "above the app's header");
  await page.keyboard.press("Escape");
  check(Math.abs((await rect(page, ".cap-panel")).width - resized.width) < 3, "Escape leaves full screen first");
  await page.keyboard.press("F11");
  check((await rect(page, ".cap-panel")).width === 1280, "F11 toggles full screen");
  await page.keyboard.press("F11");
  await page.click(".cap-window button[aria-label='Minimise']");
  check(await page.locator(".cap-panel").count() === 0 && (await page.locator(".cap-pill").innerText()).includes("draft that must survive"), "minimised to a pill naming the draft");
  await page.click("[data-testid='behind']");
  await page.click(".cap-pill");
  check(await page.locator(".cap-text").inputValue() === "draft that must survive", "the pill brings the draft back");
  await page.click(".cap-window button[aria-label='Close Capture']");
  check(await page.locator(".cap-panel").count() === 0, "close hides the panel");
  await page.reload();
  await page.waitForSelector(".cap-panel");
  check(await page.locator(".cap-text").inputValue() === "draft that must survive", "and the draft survives a restart");
  const afterReload = await rect(page, ".cap-panel");
  check(Math.abs(afterReload.x - resized.x) < 3 && Math.abs(afterReload.width - resized.width) < 3, `as do the panel's place and size (${JSON.stringify([resized, afterReload, await page.evaluate(() => localStorage.getItem("heuresis.capture.panel.frame.v1:u1"))])})`);

  // Drawings render in notes: one saved by the old panel, one by the new pad.
  const legacy = "::handnote:v1:" + Buffer.from(JSON.stringify({ version: 1, strokes: [{ d: "M10 20 L300 40", color: "#2563eb" }, { d: "M10 200 L300 240", color: "#202938" }] })).toString("base64");
  await page.evaluate(({ legacy, line }) => window.__setReader(`Old\n\n${legacy}\n\nNew\n\n${line}`), { legacy, line });
  check(await page.locator("[data-testid='reader'] .hn-svg").count() === 2, "old and new drawings both render in a note");
  check(await page.locator("[data-testid='reader'] .hn-svg").first().locator(".hn-stroke").count() === 2, "the old drawing keeps its strokes");
  const roundTrip = await page.evaluate((body) => {
    const holder = document.createElement("div");
    holder.innerHTML = window.__noteFormat.markdownToEditorHtml(body);
    return window.__noteFormat.editorToMarkdown(holder);
  }, `# Lesson\n\n${line}\n\n${legacy}`);
  check(roundTrip === `# Lesson\n\n${line}\n\n${legacy}`.replace(/\n\n/g, "\n\n"), "the editor saves drawings back exactly as they were");
  await page.context().close();

  // ---------------------------------------------------------------------------
  console.log("5. The desktop app's own window");
  page = await open("?mode=native&theme=dark", { viewport: { width: 620, height: 660 } });
  const panel = await rect(page, ".cap-panel");
  check(panel.width === 620 && panel.height === 660, "Capture fills its window");
  check(await page.locator(".cap-window button[aria-label='Stop keeping on top']").count() === 1, "it is kept on top, and can be released");
  await page.click(".cap-chip.is-format");
  check((await calls(page, "ensureSize")).some((call) => call.width >= 900 && call.height >= 740), "Format makes the window large enough for a page");
  await page.click(".cap-window button[aria-label='Full screen']");
  check((await calls(page, "fullscreen")).length === 1 && await page.locator(".cap-panel.is-full").count() === 1, "full screen goes through the window");
  await page.keyboard.press("Escape");
  check((await calls(page, "fullscreen")).length === 2, "Escape leaves full screen");
  const nativeHead = await rect(page, ".cap-title");
  await page.mouse.move(nativeHead.x + 10, nativeHead.y + 5);
  await page.mouse.down();
  await page.mouse.up();
  check((await calls(page, "drag")).length === 1, "the title bar moves the window");
  const nativeGrip = await rect(page, ".cap-resize");
  await page.mouse.move(nativeGrip.x + 8, nativeGrip.y + 8);
  await page.mouse.down();
  await page.mouse.up();
  check((await calls(page, "resize")).length === 1, "the grip resizes the window");
  await page.click(".cap-window button[aria-label='Minimise']");
  check((await calls(page, "minimise")).length === 1, "minimise folds the window into its bubble");
  await page.click(".cap-window button[aria-label='Close Capture']");
  check((await calls(page, "hide")).length === 1, "close hides the window and keeps the draft");
  await page.screenshot({ path: `${shots}/native-page-dark.png` });
  await page.context().close();

  // ---------------------------------------------------------------------------
  for (const [name, viewport] of [["portrait", { width: 768, height: 1200 }], ["landscape", { width: 1200, height: 768 }]]) {
    console.log(`6. Android tablet, ${name}: touch, stylus and full screen`);
    page = await open("", { viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: ANDROID_UA });
    const cdp = await page.context().newCDPSession(page);
    check(await page.evaluate(() => document.documentElement.dataset.platform) === "android", "runs as the Android app");
    const box = await rect(page, ".cap-panel");
    check(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, "the panel is fully on screen");
    const nav = await page.locator("[data-testid='bottom-nav']").evaluate((element) => getComputedStyle(element).display === "none" ? null : element.getBoundingClientRect().top);
    if (nav !== null) check(box.y + box.height <= nav + 1, "and clear of the bottom bar");
    check(await page.locator(".tablet-capture-fab").evaluate((element) => getComputedStyle(element).display) === "none", "the capture button steps aside while Capture is open");
    for (const button of await page.locator(".cap-window button").all()) {
      const size = await button.boundingBox();
      check(size.width >= 40 && size.height >= 40, "window buttons are finger-sized");
    }
    await page.locator(".cap-seg button:has-text('Pen')").tap();
    await page.waitForSelector(".cap-body .hn-canvas");
    await page.evaluate(() => localStorage.removeItem("heuresis.ink.penSeen.v1"));
    await cdpStroke(page, cdp, "touch", ".cap-body .hn-canvas", [[.1, .2], [.2, .25], [.3, .2]]);
    check(await strokeCount(page) === 1, "a finger draws before a stylus has been used");
    await cdpStroke(page, cdp, "pen", ".cap-body .hn-canvas", [[.1, .5], [.3, .55], [.5, .5]]);
    check(await strokeCount(page) === 2, "the stylus draws");
    check(await page.locator(".hn-canvas[data-finger='scroll']").count() === 1, "after the stylus, fingers scroll instead of drawing");
    await cdpStroke(page, cdp, "touch", ".cap-body .hn-canvas", [[.6, .2], [.7, .4], [.8, .6]]);
    check(await strokeCount(page) === 2, "so a resting hand leaves no mark");
    await cdpTap(page, cdp, ".hn-tools button[aria-label^='Fingers scroll']");
    await cdpStroke(page, cdp, "touch", ".cap-body .hn-canvas", [[.6, .2], [.7, .4], [.8, .6]]);
    check(await strokeCount(page) === 3, "the hand button lets fingers draw again");
    await cdpTap(page, cdp, ".cap-window button[aria-label='Full screen']");
    await page.waitForSelector(".cap-panel.is-full");
    const screen = await rect(page, ".cap-panel");
    check(screen.width === viewport.width && screen.height === viewport.height, `full screen covers the tablet (${screen.width}×${screen.height})`);
    check(await page.evaluate(({ w, h }) => [[4, 4], [w / 2, h - 4], [w - 4, h / 2]].every(([x, y]) => document.elementFromPoint(x, y)?.closest(".cap-panel")), { w: viewport.width, h: viewport.height }), "including the header and the bottom bar");
    const paper = await rect(page, ".cap-body .hn-scroll");
    const sheet = await rect(page, ".cap-body .hn-sheet");
    check(sheet.height >= paper.height - 4, "the paper fills the screen");
    await page.screenshot({ path: `${shots}/android-${name}-full.png` });
    await cdpTap(page, cdp, ".cap-window button[aria-label='Leave full screen']");
    await cdpTap(page, cdp, ".cap-window button[aria-label='Minimise']");
    const pill = await rect(page, ".cap-pill");
    if (nav !== null) check(pill.y + pill.height <= nav, "the minimised pill sits above the bottom bar");
    else check(pill.y + pill.height <= viewport.height, "the minimised pill is on screen");
    await cdpTap(page, cdp, ".cap-pill");
    check(await strokeCount(page) === 3, "and opens Capture with the drawing intact");
    await page.context().close();
  }

  console.log("7. Dark theme screens");
  page = await open("?theme=dark");
  await page.click(".cap-chip.is-format");
  await page.locator(".cap-page .nb-editor").click();
  await page.keyboard.type("Dark page");
  await page.screenshot({ path: `${shots}/desktop-dark-page.png` });
  await page.context().close();

  check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(" | ")})`);
  console.log(`Capture panel: ${passed} browser checks passed (desktop, desktop window, Android portrait and landscape).`);
} finally {
  await browser.close();
  server.kill();
}
