// The Android APK (MagicPad) on a tablet: Sort and Review (flashcards) by touch only.
//
// Runs the real app as the APK runs it: Android WebView user agent, touch input, no
// physical keyboard, one WebView whose window must never be closed (see android-lib.mjs).
// Each scenario starts from a fresh showcase database and checks what is saved.
//   node tests/android-tablet.mjs                (all scenarios)
//   node tests/android-tablet.mjs portrait       (scenarios whose name contains "portrait")
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE, check, sql } from "./lib.mjs";
import { TABLET, fingerTap, launchTablet, openTopicByTouch, reachableNow, signInTablet, tauriCalls, webviewDestroyed } from "./android-lib.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const shots = `${here}screenshots/android-tablet`;
mkdirSync(shots, { recursive: true });
const only = process.argv[2] ?? "";
const USER = "11111111-1111-4111-8111-111111111111";
const HSK = "a0000000-0000-4000-8000-000000000001";
const GRADES = "('again','hard','good','easy')";

function restore() {
  execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" });
}
async function addUnsortedCards() {
  await sql(`insert into heuresis_cards(user_id, pack_id, data) values
    ('${USER}','${HSK}','{"term":"马上","reading":"mǎshàng","meaning":"immediately","example":"我马上来。"}'),
    ('${USER}','${HSK}','{"term":"最近","reading":"zuìjìn","meaning":"recently"}'),
    ('${USER}','${HSK}','{"term":"一会儿","reading":"yíhuìr","meaning":"a moment"}')`);
}
const gradeCount = async () => Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES}`));
async function waitFor(condition, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await condition()) return true; await new Promise((resolve) => setTimeout(resolve, 300)); }
  return false;
}
function tapped(result, message) {
  return check(result.ok, result.ok ? message : `${message} (${result.reason})`);
}

/** Sort a full pass using the current Core / Active / Passive decisions.
 * Choosing an importance saves immediately; Sort Later and Discard remain separate actions.
 * The right-hand panel can scroll on a tablet, so test actual finger reachability.
 */
async function sortByTouch(page, name) {
  await addUnsortedCards();
  await openTopicByTouch(page);
  tapped(await fingerTap(page, ".sort-command", { label: "Sort" }), "Sort opens with a tap");
  await page.locator(".sort-card").waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${shots}/${name}-sort.png` });
  check(await reachableNow(page, ".sort-topbar-actions button:last-child"), "Sort's close button is on screen and not covered");
  check(await reachableNow(page, ".sort-topbar > span"), "Sort's progress (1 / 3) is on screen and not covered");
  check(await reachableNow(page, ".sort-card > strong"), "the card itself is on screen");
  const bottomNavCovers = await page.evaluate(() => {
    const modal = document.querySelector(".sort-modal");
    if (!modal) return true;
    return [...document.querySelectorAll(".mobile-workspace-nav, .tablet-capture-fab")].some((element) => {
      const box = element.getBoundingClientRect();
      if (!box.width || getComputedStyle(element).display === "none" || getComputedStyle(element).visibility === "hidden") return false;
      const top = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return Boolean(top && element.contains(top));
    });
  });
  check(!bottomNavCovers, "no app navigation or Capture handle floats over Sort");

  const first = (await page.locator(".sort-card > strong").innerText()).trim();
  tapped(await fingerTap(page, '.sort-rating button[aria-label="Learn as Core"]', { label: "Core" }), "Core saves the first card with a tap");
  await page.waitForTimeout(700);
  const second = (await page.locator(".sort-card > strong").innerText()).trim();
  check(second !== first, "choosing Core advances to the next card");
  tapped(await fingerTap(page, '.sort-rating button[aria-label="Learn as Passive"]', { label: "Passive" }), "Passive saves the second card");
  await page.waitForTimeout(700);
  tapped(await fingerTap(page, '.sort-undo button', { label: "Undo" }), "Undo restores the last sorted card");
  await page.waitForTimeout(700);
  check((await page.locator(".sort-card > strong").innerText()).trim() === second, "Undo brings the second card back");
  tapped(await fingerTap(page, '.sort-rating button[aria-label="Learn as Passive"]', { label: "Passive again" }), "Passive re-sorts the restored card");
  await page.waitForTimeout(700);
  const third = (await page.locator(".sort-card > strong").innerText()).trim();
  const full = page.viewportSize();
  tapped(await fingerTap(page, ".sort-note-panel textarea", { label: "Quick note" }), "the quick note field takes a tap");
  await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
  await page.waitForTimeout(400);
  await page.locator(".sort-note-panel textarea").fill("seen in lesson 4");
  tapped(await fingerTap(page, ".sort-note-panel textarea", { label: "Quick note (keyboard open)" }), "the quick note remains reachable with the keyboard open");
  await page.screenshot({ path: `${shots}/${name}-sort-keyboard.png` });
  tapped(await fingerTap(page, '.sort-rating button[aria-label="Learn as Active"]', { label: "Active (keyboard open)" }), "Active saves with the keyboard open");
  await page.setViewportSize(full);
  await page.waitForTimeout(800);
  await page.locator(".sort-finished").waitFor({ timeout: 8000 });
  check(/3 cards decided/.test(await page.locator(".sort-finished").innerText()), "the pass ends with its summary");
  const expected = [[first, `${first}:5:learning:true:`], [second, `${second}:1:learning:true:`], [third, `${third}:3:learning:true:seen in lesson 4`]]
    .sort((a, b) => a[0] < b[0] ? -1 : 1).map((entry) => entry[1]).join(",");
  check(await sql(`select string_agg(data->>'term' || ':' || interest_rank || ':' || retention || ':' || ((data->>'_sorted_at') is not null) || ':' || coalesce(note,''), ',' order by data->>'term') from heuresis_cards where data->>'term' in ('${first}','${second}','${third}')`) === expected,
    "all three importance decisions and the quick note persist");
  await page.screenshot({ path: `${shots}/${name}-sort-finished.png` });
  check(await reachableNow(page, '.sort-finished-actions button:has-text("Review now")'), "Review now is on screen");
}

/** The redesign opens a Review setup before launching the in-app Cosmos session. */
async function startReviewByTouch(page) {
  await page.locator(".study-start").waitFor({ timeout: 15000 });
  check(await reachableNow(page, ".study-close"), "Review setup has a reachable close button");
  tapped(await fingerTap(page, ".study-start", { label: "Start review" }), "Review starts from its setup with a tap");
  await page.locator(".cosmos-count").waitFor({ timeout: 15000 });
}

/** A whole recommended Review by touch, then Done returns to the topic. */
async function reviewByTouch(page, name, { start = "topic" } = {}) {
  if (start === "topic") {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, ".review-command", { label: "Review" }), "Review starts with a tap");
  }
  await startReviewByTouch(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${shots}/${name}-review-front.png` });
  const total = Number((await page.locator(".cosmos-count").innerText()).split("/")[1]);
  check(total > 0, `Review opens in the app with ${total} cards`);
  check(await reachableNow(page, ".cosmos-close"), "Review's close button is on screen");
  const layout = await page.evaluate(() => {
    const card = document.querySelector(".cosmos-card")?.getBoundingClientRect();
    const panels = [...document.querySelectorAll(".cosmos-details")].map((panel) => panel.getBoundingClientRect());
    const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    return {
      cardWidth: card ? Math.round(card.width) : 0,
      covered: card ? panels.reduce((sum, panel) => sum + overlap(card, panel), 0) / (card.width * card.height) : 1,
      pageScroll: document.documentElement.scrollHeight - innerHeight,
    };
  });
  check(layout.covered < 0.01, `the side panels never cover the card (${Math.round(layout.covered * 100)}% covered)`);
  check(layout.cardWidth >= Math.min(560, page.viewportSize().width - 40), `the card keeps a readable width (${layout.cardWidth}px)`);
  check(layout.pageScroll <= 0, `the session fits the screen without scrolling (${layout.pageScroll}px over)`);

  const before = await gradeCount();
  let failures = 0;
  for (let step = 0; step < total; step += 1) {
    const reveal = await fingerTap(page, ".cosmos-inline-reveal", { label: "Show answer", scroll: false });
    if (!reveal.ok) { failures += 1; console.log("   ", reveal.reason); break; }
    await page.locator(".cosmos-results").waitFor({ timeout: 5000 });
    if (step === 0) {
      await page.screenshot({ path: `${shots}/${name}-review-revealed.png` });
      const size = await page.locator(".cosmos-results button").first().boundingBox();
      check(Boolean(size && size.height >= 44), `result buttons are finger-sized (${Math.round(size?.height ?? 0)}px)`);
    }
    const grade = await fingerTap(page, `.cosmos-results button:nth-child(${step === 0 ? 1 : 3})`, { label: "result", scroll: false });
    if (!grade.ok) { failures += 1; console.log("   ", grade.reason); break; }
    await page.waitForTimeout(250);
  }
  check(failures === 0, `every card is revealed and answered by tapping, without scrolling (${total})`);
  await page.locator(".cosmos-summary").waitFor({ timeout: 8000 });
  check(await waitFor(async () => await gradeCount() - before === total), "every result reaches the server");
  await page.screenshot({ path: `${shots}/${name}-review-summary.png` });
  tapped(await fingerTap(page, '.cosmos-summary-actions button:has-text("Done")', { label: "Done" }), "Done is tapped");
  await page.waitForTimeout(1500);
  check(!(await webviewDestroyed(page)), "Done keeps the app alive (the Android WebView is not closed)");
  check(!(await tauriCalls(page)).some((call) => /plugin:window\|(close|destroy)/.test(call)), "Review never asks Android to close its only window");
  check(await page.locator(".modern-topic-row").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false), "Done returns to the topic that was open");
  check(Number(await sql(`select count(*) from heuresis_sessions where mode='flashcards' and ended_at is null`)) === 0, "the Review session is closed");
}

const scenarios = {
  async "landscape: Sort by touch"(page) { await sortByTouch(page, "landscape"); },
  async "portrait: Sort by touch"(page) { await sortByTouch(page, "portrait"); },
  async "landscape: Sort → Review now → Done, by touch"(page) {
    await sortByTouch(page, "landscape-flow");
    tapped(await fingerTap(page, '.sort-finished-actions button:has-text("Review now")', { label: "Review now" }), "Review now");
    await reviewByTouch(page, "landscape-flow", { start: "here" });
  },
  async "landscape: Review by touch"(page) { await reviewByTouch(page, "landscape"); },
  async "portrait: Review by touch"(page) { await reviewByTouch(page, "portrait"); },
  async "wide landscape: Review by touch"(page) { await reviewByTouch(page, "wide"); },
  async "landscape: closing Review mid-session returns to the topic"(page) {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, ".review-command", { label: "Review" }), "Review");
    await startReviewByTouch(page);
    tapped(await fingerTap(page, ".cosmos-inline-reveal", { label: "Show answer" }), "Show answer");
    tapped(await fingerTap(page, ".cosmos-results button:nth-child(3)", { label: "Recalled" }), "Recalled");
    await page.waitForTimeout(400);
    tapped(await fingerTap(page, ".cosmos-close", { label: "Close" }), "the close button is tapped");
    await page.waitForTimeout(1500);
    check(!(await webviewDestroyed(page)), "closing keeps the app alive");
    check(await page.locator(".modern-topic-row").first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false), "closing returns to the topic");
    check(await waitFor(async () => Number(await sql(`select count(*) from heuresis_sessions where mode='flashcards' and ended_at is null`)) === 0), "the session is closed");
    check(Number(await sql(`select count(*) from heuresis_card_events where event_type='good' and created_at > now() - interval '5 minutes'`)) === 1, "the answer given before closing is saved");
  },
  async "landscape: side panels open and close by touch"(page) {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, ".review-command", { label: "Review" }), "Review");
    await startReviewByTouch(page);
    tapped(await fingerTap(page, ".cosmos-inline-reveal", { label: "Show answer" }), "Show answer");
    for (const label of ["Context", "Notes"]) {
      const toggle = `.cosmos-panel-toggles button:has-text("${label}")`;
      const wasOpen = (await page.locator(toggle).getAttribute("aria-pressed")) === "true";
      tapped(await fingerTap(page, toggle, { label }), `${label} toggles with a tap`);
      await page.waitForTimeout(300);
      check(((await page.locator(toggle).getAttribute("aria-pressed")) === "true") === !wasOpen, `${label} changed state`);
      if (!wasOpen) {
        check(await reachableNow(page, ".cosmos-results button:nth-child(3)"), `with ${label} open, the results stay reachable`);
        tapped(await fingerTap(page, toggle, { label }), `${label} closes again`);
        await page.waitForTimeout(300);
      }
    }
    tapped(await fingerTap(page, '.retention-actions button:has-text("Connections")', { label: "Connections" }), "the card's connections open from Review");
    await page.locator(".connections-panel").waitFor({ timeout: 10000 });
    check(await reachableNow(page, ".connections-close"), "the connections tree's close button is on screen and not covered");
    tapped(await fingerTap(page, ".connections-close", { label: "Close connections" }), "the connections tree closes");
    tapped(await fingerTap(page, ".cosmos-results button:nth-child(3)", { label: "Recalled" }), "the card is still answerable");
  },
  async "landscape: a card's connections open from the topic"(page) {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, ".modern-topic-row .row-connections-icon", { label: "Connections" }), "a card's connections open with a tap");
    await page.locator(".connections-panel").waitFor({ timeout: 10000 });
    check(await reachableNow(page, ".connections-close"), "the close button is on screen and not covered");
    tapped(await fingerTap(page, ".connections-close", { label: "Close connections" }), "they close again");
  },
  async "portrait: Notes drawer opens over the card and closes"(page) {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, ".review-command", { label: "Review" }), "Review");
    await startReviewByTouch(page);
    tapped(await fingerTap(page, ".cosmos-inline-reveal", { label: "Show answer" }), "Show answer");
    tapped(await fingerTap(page, '.cosmos-panel-toggles button:nth-child(2)', { label: "Notes" }), "Notes opens");
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/portrait-notes-drawer.png` });
    check(await reachableNow(page, ".cosmos-details-right .cosmos-details-head button"), "the drawer's close button is reachable");
    tapped(await fingerTap(page, ".cosmos-details-right .cosmos-details-head button", { label: "Close drawer" }), "the drawer closes");
    await page.waitForTimeout(300);
    tapped(await fingerTap(page, ".cosmos-results button:nth-child(3)", { label: "Recalled" }), "the card is answerable again");
  },
  async "landscape: Adjust → Start review, by touch"(page) {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, ".review-command", { label: "Review setup" }), "Review setup opens");
    await page.locator(".study-start").waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/landscape-adjust.png` });
    await startReviewByTouch(page);
    check(/cosmos=1/.test(page.url()), "the chosen session opens in the app");
    tapped(await fingerTap(page, ".cosmos-close", { label: "Close" }), "close");
    await page.waitForTimeout(1500);
    check(!(await webviewDestroyed(page)), "the app is still alive");
  },
  async "landscape: Review with typed answers"(page) {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, ".review-command", { label: "Review" }), "Review");
    await startReviewByTouch(page);
    await page.locator(".cosmos-method select").selectOption("type");
    const input = page.locator(".cosmos-card input, .cosmos-card textarea").first();
    check(await input.count() === 1, "a typed-answer field appears");
    tapped(await fingerTap(page, input, { label: "Answer field" }), "the answer field takes a tap");
    const full = page.viewportSize();
    await page.setViewportSize({ width: full.width, height: Math.round(full.height * 0.55) });
    await input.fill("recently");
    tapped(await fingerTap(page, input, { label: "Answer field (keyboard open)" }), "with the keyboard open the answer field can be brought into view");
    await page.screenshot({ path: `${shots}/landscape-typed-keyboard.png` });
    tapped(await fingerTap(page, ".cosmos-inline-reveal, .cosmos-card button:has-text('Show')", { label: "Show answer (keyboard open)" }), "Show answer is reachable with the keyboard open");
    await page.locator(".cosmos-results").waitFor({ timeout: 5000 });
    await page.setViewportSize(full);
    await page.waitForTimeout(300);
    tapped(await fingerTap(page, ".cosmos-results button.primary", { label: "suggested result" }), "the suggested result can be tapped");
    await page.locator(".cosmos-method select").selectOption("think");
  },
  async "landscape: Edit card by touch"(page) {
    await openTopicByTouch(page);
    const row = page.locator(".modern-topic-row").first();
    const term = (await row.locator(".modern-card-title strong").innerText()).trim();
    tapped(await fingerTap(page, row.locator(".modern-card-cell"), { label: "card row" }), "a card is selected with a tap");
    tapped(await fingerTap(page, row.locator('.row-mini-actions button:has-text("Edit")'), { label: "Edit" }), "Edit appears on the selected card and opens it");
    await page.locator(".card-editor-modal").waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${shots}/landscape-edit-card.png` });
    check(await reachableNow(page, ".editor-head-actions .text-button"), "the editor's Close is on screen and not covered");
    const note = page.locator('.card-editor-modal .field-row:has(> span:text-is("Note")) textarea');
    tapped(await fingerTap(page, note, { label: "Note" }), "the note field takes a tap");
    await note.fill("edited on the tablet");
    tapped(await fingerTap(page, '.editor-actions .primary-button', { label: "Save changes" }), "Save changes is reachable");
    check(await waitFor(async () => await sql(`select coalesce(note,'') from heuresis_cards where pack_id='${HSK}' and data->>'term'='${term}'`) === "edited on the tablet"), "the edit is saved");
  },
  async "landscape: Browse by touch"(page) {
    await openTopicByTouch(page);
    tapped(await fingerTap(page, '.topic-learning-actions button:has-text("Browse")', { label: "Browse" }), "Browse opens");
    await page.locator(".browse-start-button").waitFor({ timeout: 10000 });
    check(await reachableNow(page, ".browse-setup-head .browse-icon-button"), "Browse's close button is on screen and not covered");
    tapped(await fingerTap(page, ".browse-start-button", { label: "Browse start" }), "Browse starts");
    await page.locator(".modern-browse-card").waitFor({ timeout: 10000 });
    await page.screenshot({ path: `${shots}/landscape-browse.png` });
    check(await reachableNow(page, '.modern-browse-bar-actions button:has-text("Close")'), "Browse's Close is on screen and not covered");
    tapped(await fingerTap(page, '.modern-browse-controls .primary-button', { label: "Next" }), "Next card");
    tapped(await fingerTap(page, '.modern-browse-bar-actions button:has-text("Close")', { label: "Close" }), "Browse closes");
  },
};

const viewportFor = (title) => title.startsWith("portrait") ? TABLET.portrait : title.startsWith("wide") ? TABLET.wideLandscape : TABLET.landscape;
for (const [title, run] of Object.entries(scenarios)) {
  if (only && !title.includes(only)) continue;
  console.log(`— ${title}`);
  restore();
  const { browser, context, page, errors, popups } = await launchTablet({ viewport: viewportFor(title) });
  try {
    await signInTablet(page, BASE);
    await run(page, context);
    check(popups.length === 0, "no second window was opened");
    check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 2).join(" | ")}` : ""}`);
  } catch (error) {
    check(false, `${title}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    await page.screenshot({ path: `${shots}/failure-${title.replace(/[^a-z0-9]+/gi, "-")}.png` }).catch(() => undefined);
  } finally {
    await browser.close();
  }
}
if (process.exitCode) console.log("Android tablet: some checks failed.");
else console.log("Android tablet: Sort and Review work by touch.");
