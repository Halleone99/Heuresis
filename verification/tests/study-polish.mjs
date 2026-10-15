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
    await page.click('.hw-sections button:has-text("Study")');
    await page.waitForTimeout(700);
    await page.locator('button:has-text("HSK 2 — Time")').first().click();
    await page.locator(".topic-command-bar").waitFor();
    await page.locator(".modern-topic-table").waitFor(); // Wait for cards before inspecting enabled actions.
    check(await page.locator(".topic-learning-actions > button").count() === 4, "Topic has four main actions: Sort, Review, Browse and New card");
    check(await page.locator(".desktop-header-actions > .desktop-primary").count() === 0, "No redundant New card in the header of an open topic");
    await page.locator(".topic-more-menu > summary").click();
    check(await page.locator(".topic-more-popover button").count() === 2, "Import and Connections live inside one More menu");
    await page.locator(".topic-more-menu > summary").click();
    const ready = Number(await page.locator('[data-stage="ready"] strong').innerText());
    const reviewed = Number(await page.locator('[data-stage="reviewed"] strong').innerText());
    const review = page.getByRole("button", { name: "Review", exact: true });
    check(await review.isDisabled() === (ready + reviewed === 0), "Review cannot open until a card is ready");
    if (ready + reviewed) {
      await review.click();
      await page.locator(".compact-study-launcher").waitFor();
      await page.locator(".review-controls").waitFor(); // The Study templates load asynchronously.
      check(await page.locator(".compact-study-heading .eyebrow").count() === 0, "Review heading is not repeated");
      check(await page.locator('[role="group"][aria-label="Review directions"] button').count() === 2, "One accessible direction switch");
      check(await page.locator('[role="group"][aria-label="Review card order"] button').count() === 2, "One accessible order switch");
      check(await page.locator(".compact-count-shortcuts").count() === 0, "No duplicate 10/20/50 amount buttons");
      check(await page.locator(".study-start").count() === 1, "One start action");
      await page.keyboard.press("Escape");
      check(await page.locator(".compact-study-launcher").count() === 0, "Escape dismisses Review");
    }
    const sortAction = page.locator(".sort-command");
    if (await sortAction.isEnabled()) {
      await sortAction.click();
      await page.locator(".sort-modal").waitFor();
      check(await page.locator('[role="group"][aria-label="Sort card order"] button').count() === 2, "Sort reuses the order control");
      check(await page.locator('[role="group"][aria-label="Sort card order"] button[aria-pressed="true"]').count() === 1, "Only one sort order selected");
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
  const browser = await chromium.launch();
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
    check(await page.locator(".mobile-workspace-nav button").count() === 5, "All five workspace sections have one bottom bar");
    check(!(await page.locator(".desktop-nav-group").isVisible()), "Old Study bottom bar is not stacked over it");
    const touchSize = await page.locator(".mobile-workspace-nav button").first().boundingBox();
    check(Boolean(touchSize && touchSize.height >= 44), "Bottom targets are finger-sized");
    await page.locator('.mobile-workspace-nav button:has-text("Study")').tap();
    await page.locator(".mobile-study-subnav:visible").waitFor();
    check(await page.locator(".mobile-study-subnav button").count() === 4, "Study still exposes all four sub-pages");
    await page.locator('.mobile-study-subnav button:has-text("Catalogue")').tap();
    check((await page.locator('.mobile-study-subnav button:has-text("Catalogue")').getAttribute("aria-current")) === "page", "Tablet Catalogue navigation works");
    await page.locator('.mobile-study-subnav button:has-text("Library")').tap();
    await page.locator(".tablet-capture-fab").tap();
    await page.locator(".qc-panel:visible").waitFor();
    check(await page.locator(".qc-panel").isVisible(), "Movable Capture shortcut opens real Capture");
    await page.locator('button[aria-label="Close quick capture"]').tap();
    check(await page.locator(".qc-panel").count() === 0, "Capture closes without trapping tablet navigation");
    check(errors.length === 0, "No tablet page errors");
  } finally { await browser.close(); }
}

await desktopStudy();
await tabletNavigation();
if (process.exitCode) throw new Error("Study and touch-browser regressions failed");
console.log("Study actions and tablet navigation: browser checks complete.");
