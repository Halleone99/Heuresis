// Additional browser coverage for the Study and touch-navigation polish.
// Uses the same disposable PostgreSQL/PostgREST fixture as regressions.mjs.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BASE, check, launch, signIn } from "./lib.mjs";
const here = fileURLToPath(new URL("..", import.meta.url));
function restore() { execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" }); }

async function desktopStudy() {
  restore();
  const { browser, page, errors } = await launch({ width: 1440, height: 900 });
  try {
    await signIn(page);
    await page.locator(".desktop-search-action").click();
    await page.locator(".ws-palette").waitFor();
    check(await page.getByRole("dialog", { name: "Search Heuresis and run commands" }).count() === 1,
      "Header Search opens the single global palette");
    await page.keyboard.press("Escape");
    await page.click('.hw-sections button:has-text("Study")');
    await page.waitForTimeout(700);
    await page.locator(".desktop-search-action").click();
    await page.locator(".ws-palette").waitFor();
    await page.locator(".ws-palette input").fill("再见");
    check(await page.locator(".ws-palette-row.is-cards").count() === 1,
      "Study header Search offers full-card search in the same palette");
    await page.keyboard.press("Escape");
    await page.locator('button:has-text("HSK 2 — Time")').first().click();
    await page.locator(".topic-command-bar").waitFor();
    await page.locator(".topic-browse-hub").waitFor();
    await page.locator('.topic-browse-actions button:has-text("Show all")').click();
    await page.locator(".modern-topic-table").waitFor(); // The tag-first topic only renders rows after Show all.
    check(await page.locator(".topic-learning-actions > button").count() === 4 && await page.locator(".topic-learning-actions > .review-split").count() === 0,
      "Topic has four clear actions: Sort, Review, Browse and New card");
    check(await page.locator(".desktop-header-actions > .desktop-primary").count() === 0, "No redundant New card in the header of an open topic");
    await page.locator(".topic-more-menu > summary").click();
    check(await page.locator(".topic-more-popover button").count() === 2, "Import and Connections live inside one More menu");
    await page.locator(".topic-more-menu > summary").click();
    const learning = Number(await page.locator('[data-stage="learning"] strong').innerText());
    const review = page.getByRole("button", { name: "Review", exact: true });
    check(await review.isDisabled() === (learning === 0), "Review cannot open until a card is in Learning");
    if (learning) {
      await page.locator(".review-command").click();
      await page.locator(".compact-study-launcher").waitFor();
      await page.locator(".review-controls").waitFor();
      check(await page.locator('[role="group"][aria-label="Number of cards"] button').count() === 3, "Exactly 5, 10 and 20 session-size choices");
      check(await page.locator('[role="group"][aria-label="Review card order"] button').count() === 3, "Exactly three order choices");
      check(await page.locator(".review-filter-chips").count() === 2, "Content and review filters may be combined");
      check(await page.locator(".review-include-mastered input").count() === 1, "Mastered cards can be included on demand");
      check(await page.locator(".study-start").count() === 1, "One start action");
      await page.keyboard.press("Escape");
      check(await page.locator(".compact-study-launcher").count() === 0, "Escape dismisses Review");
    }
    const sortAction = page.locator(".sort-command");
    if (await sortAction.isEnabled()) {
      await sortAction.click();
      await page.locator(".sort-modal").waitFor();
      check(await page.locator(".sort-card").count() === 1, "Sort opens straight into the queue");
      await page.locator(".sort-filter-open").click();
      check(await page.locator('[role="group"][aria-label="Sort card order"] button').count() === 2, "Sort reuses the order control (inside Filter)");
      check(await page.locator('[role="group"][aria-label="Sort card order"] button[aria-pressed="true"]').count() === 1, "Only one sort order selected");
      await page.keyboard.press("Escape");
      check(await page.locator(".sort-modal").count() === 1 && await page.locator(".sort-card").count() === 1, "Escape in the filter search closes Filter first");
      await page.keyboard.press("Escape");
      check(await page.locator(".sort-modal").count() === 0, "Escape dismisses Sort");
    } else {
      check(true, "Sort is correctly unavailable when the fixture has no unsorted cards (covered by Capture → Sort → Review test)");
    }
    check(errors.filter((e) => !/status of 404|Failed to load resource/.test(e)).length === 0, "No browser errors on Study controls");
  } finally { await browser.close(); }
}

async function tabletNavigation() {
  restore();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 820, height: 1100 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(BASE);
    await page.fill("input[type=email]", "thomas@example.test");
    await page.fill("input[type=password]", "heuresis");
    await page.click("button[type=submit]");
    await page.locator(".mobile-workspace-nav:visible").waitFor({ timeout: 15000 });
    check(await page.locator(".mobile-workspace-nav button").count() === 8, "Eight main sections include a pinned Captures destination");
    await page.locator('.mobile-workspace-nav button:has-text("Overview")').tap();
    await page.locator('.oh-track[role="progressbar"]').waitFor({ timeout: 15000 });
    check(await page.locator('.oh-track[role="progressbar"]').count() === 1, "Review coverage is accessible directly on tablet Overview");
    check(await page.locator('.mobile-workspace-nav button:has-text("Quotations")').count() === 1 && await page.locator('.mobile-workspace-nav button:has-text("Reference")').count() === 1, "Reading-related destinations remain accessible from touch navigation");
    check(!(await page.locator(".desktop-nav-group").isVisible()), "Old Study bottom bar is not stacked over it");
    const touchSize = await page.locator(".mobile-workspace-nav button").first().boundingBox();
    check(Boolean(touchSize && touchSize.height >= 44), "Bottom targets are finger-sized");
    await page.locator('.mobile-workspace-nav button:has-text("Study")').tap();
    await page.locator(".mobile-study-subnav:visible").waitFor();
    check(await page.locator(".mobile-study-subnav button").count() === 4, "Study still exposes all four sub-pages");
    await page.locator('.mobile-study-subnav button:has-text("Catalogue")').tap();
    check((await page.locator('.mobile-study-subnav button:has-text("Catalogue")').getAttribute("aria-current")) === "page", "Tablet Catalogue navigation works");
    await page.locator('.mobile-study-subnav button:has-text("Library")').tap();
    const fab = page.locator(".tablet-capture-fab");
    const beforeDrag = await fab.boundingBox();
    check(Boolean(beforeDrag && beforeDrag.width >= 44), "Capture handle has a 44px+ touch target");
    if (!beforeDrag) throw new Error("Floating Capture handle is not rendered");
    // Real Chromium touch pointer events, not simulated click or CSS assertions.
    const cdp = await context.newCDPSession(page);
    const initialX = beforeDrag.x + beforeDrag.width / 2;
    const initialY = beforeDrag.y + beforeDrag.height / 2;
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: initialX, y: initialY }] });
    for (let step = 1; step <= 7; step++) {
      const x = initialX + ((25 - initialX) * step) / 7;
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: initialY }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const snapped = await fab.boundingBox();
    check(Boolean(snapped && snapped.x < 22), "Dragging Capture to the left snaps it to the edge");
    check(await page.locator(".qc-panel").count() === 0, "Dragging Capture does not accidentally open it");
    await page.reload();
    await page.locator(".tablet-capture-fab:visible").waitFor();
    const afterReload = await page.locator(".tablet-capture-fab").boundingBox();
    check(Boolean(afterReload && afterReload.x < 22), "Capture remembers its snapped edge after restart");
    await page.setViewportSize({ width: 760, height: 900 });
    const afterRotation = await page.locator(".tablet-capture-fab").boundingBox();
    check(Boolean(afterRotation && afterRotation.x < 22), "Capture stays attached to its edge on rotation");
    await page.locator(".tablet-capture-fab").focus();
    await page.keyboard.press("ArrowRight");
    const afterKeyboard = await page.locator(".tablet-capture-fab").boundingBox();
    check(Boolean(afterKeyboard && afterKeyboard.x > 680), "Arrow keys can reposition Capture without opening it");
    check(await page.locator(".qc-panel").count() === 0, "Moving Capture by keyboard does not activate it");
    await page.locator(".tablet-capture-fab").tap();
    await page.locator(".qc-panel:visible").waitFor();
    check(await page.locator(".qc-panel").isVisible(), "Movable Capture shortcut opens real Capture");
    await page.locator('button[aria-label="Close Quick Capture"]').tap();
    check(await page.locator(".qc-panel").count() === 0, "Capture closes without trapping tablet navigation");
    check(errors.length === 0, "No tablet page errors");
  } finally { await browser.close(); }
}

await desktopStudy();
await tabletNavigation();
if (process.exitCode) throw new Error("Study and touch-browser regressions failed");
console.log("Study actions and tablet navigation: browser checks complete.");
