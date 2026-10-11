// Continuity: a remembered note moved or deleted on another device, and repeated section switching.
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BASE, check, launch, section, signIn, sql } from "./lib.mjs";

const state = join(tmpdir(), "heuresis-e2e6-state.json");
const mod = "Control";
const title = "以前 / 以后";

let { browser, context, page, errors } = await launch();
await signIn(page);
await section(page, "Notebook");
await page.keyboard.press(`${mod}+KeyK`); await page.keyboard.type(title); await page.waitForTimeout(150); await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title");
await context.storageState({ path: state });
let allErrors = [...errors];
await browser.close();

console.log("Moved on another device while Heuresis was closed");
await sql(`update knowledge_records set topic_id = (select t.id from knowledge_topics t join knowledge_subjects s on s.id = t.subject_id where s.name = 'Chinese' and t.name = 'Inbox') where title = '${title}'`);
({ browser, context, page, errors } = await launch({ storageState: state }));
await page.goto(BASE);
await page.waitForSelector(".nb-doc-title", { timeout: 15000 });
check((await page.locator(".nb-doc-title").innerText()).includes(title), "the moved note reopens after restart");
check((await page.locator(".nb-crumbs").innerText()).includes("Inbox"), "breadcrumb shows its new topic");
await context.storageState({ path: state });
allErrors.push(...errors);
await browser.close();

console.log("Deleted on another device while Heuresis was closed");
await sql(`delete from knowledge_records where title = '${title}'`);
({ browser, context, page, errors } = await launch({ storageState: state }));
await page.goto(BASE);
await page.waitForSelector(".ws-toast:has-text('no longer available')", { timeout: 15000 });
check(true, "a message explains the note is no longer available");
check(await page.locator(".nb-doc-title").count() === 0, "no empty or stale page is shown");
check(await page.locator(".nb-scope-head").count() === 1, "falls back to the topic or Notebook home");
check(!(await page.locator(".nb-rail-recent").allInnerTexts()).some((text) => text.includes(title)), "removed from Recent");
await page.reload();
await page.waitForSelector(".heuresis-section-sidebar", { timeout: 15000 });
await page.waitForTimeout(1200);
check(await page.locator(".ws-toast:has-text('no longer available')").count() === 0, "the message is not repeated on the next launch");

console.log("Repeated switching between sections");
await section(page, "Notebook");
await page.keyboard.press(`${mod}+KeyK`); await page.keyboard.type("的时候"); await page.waitForTimeout(150); await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title");
const openTitle = await page.locator(".nb-doc-title").innerText();
for (let round = 0; round < 6; round += 1) {
  for (const label of ["Overview", "Study", "Mistake Log", "Progress", "Notebook"]) {
    await page.click(`.hw-sections button:has-text("${label}")`);
    await page.waitForTimeout(60);
  }
}
await page.waitForTimeout(600);
check((await page.locator(".nb-doc-title").innerText()) === openTitle, "after 30 rapid switches the Notebook still shows the same note");
await section(page, "Study");
check(await page.locator(".desktop-content").count() === 1 && (await page.locator(".desktop-content").innerText()).length > 0, "Study still renders");

console.log("Scroll position per section and per page");
const scrollY = () => page.evaluate(() => Math.round(window.scrollY));
await section(page, "Notebook");
await page.keyboard.press(`${mod}+KeyK`); await page.keyboard.type("Chapter 4"); await page.waitForTimeout(150); await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title:has-text('Chapter 4')");
await page.mouse.move(900, 500);
await page.mouse.wheel(0, 700); await page.waitForTimeout(400);
const lessonY = await scrollY();
await section(page, "Mistake Log");
check(lessonY > 0 && await scrollY() === 0, `another section opens at its top (the lesson was scrolled to ${lessonY}px)`);
await section(page, "Notebook");
check(Math.abs(await scrollY() - lessonY) <= 2, "returning to the Notebook restores the reading position");
await section(page, "Overview");
await page.keyboard.press(`${mod}+KeyK`); await page.keyboard.type("的时候 — “when"); await page.waitForTimeout(150); await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title:has-text('的时候')");
check(await scrollY() === 0, "a different note opened from search starts at its top");
await page.mouse.wheel(0, 500); await page.waitForTimeout(300);
await page.click(".nb-rail-recent:has-text('Chapter 4')");
await page.waitForSelector(".nb-doc-title:has-text('Chapter 4')"); await page.waitForTimeout(200);
check(await scrollY() === 0, "opening another note from the rail starts at its top");

allErrors.push(...errors);
check(allErrors.length === 0, `no page errors (${allErrors.length})`);
await browser.close();
