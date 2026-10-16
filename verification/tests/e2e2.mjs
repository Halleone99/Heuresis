// Workflows 11–17 (continues from the database state left by e2e1).
import { STATE_FILE, check, launch, section, shot, signIn, sql } from "./lib.mjs";

const { browser, context, page, errors } = await launch({ storageState: STATE_FILE });
const mod = "Control";
await page.goto("http://localhost:1421/");
await page.waitForSelector(".heuresis-section-sidebar");
await page.waitForTimeout(600);

console.log("11. Record a general mistake in two fields");
await section(page, "Mistake Log");
await page.click(".ws-page-actions button:has-text('Add mistake')");
await page.waitForSelector(".ml-simple-edit");
check(await page.locator(".ml-simple-edit > label.ws-field textarea").count() === 2, "only mistake and correction are required");
await page.locator(".ml-simple-edit textarea").nth(0).fill("Ich freue mich über das Wochenende.");
await page.locator(".ml-simple-edit textarea").nth(1).fill("Ich freue mich auf das Wochenende.");
await page.click(".ml-simple-edit button:has-text('Save')");
await page.waitForSelector(".ml-simple-item:has-text('freue mich auf')");
check(await sql("select correction from knowledge_records where attempt like 'Ich freue mich über%'") === "Ich freue mich auf das Wochenende.", "correction stored");
await shot(page, "mistake-log");

console.log("12. Edit a correction without extra classification or practice modes");
check(await page.locator(".ml-mode-grid, .ml-languages-tabs, .ml-filters, .ml-stage").count() === 0, "no language, mode or stage controls");
await page.locator(".ml-simple-item:has-text('Ich freue mich über') [aria-label='Edit mistake']").click();
await page.waitForSelector(".ml-simple-edit");
await page.locator(".ml-simple-edit textarea").nth(1).fill("Ich freue mich auf das lange Wochenende.");
await page.click(".ml-simple-edit button:has-text('Save')");
await page.waitForSelector(".ml-simple-item:has-text('lange Wochenende')");
check(await sql("select correction from knowledge_records where attempt like 'Ich freue mich über%'") === "Ich freue mich auf das lange Wochenende.", "editing changes only the correction");
check(await sql("select s.name from knowledge_records r join knowledge_topics t on t.id=r.topic_id join knowledge_subjects s on s.id=t.subject_id where r.attempt like 'Ich freue mich über%'") === "Unsorted", "general mistakes need no subject selection");

console.log("13. Search for notes and reopen the correct result");
await section(page, "Overview");
await page.keyboard.press(`${mod}+KeyK`);
await page.waitForSelector(".ws-palette");
await page.keyboard.type("change of state");
await page.waitForTimeout(200);
check((await page.locator(".ws-palette-row.is-active").innerText()).includes("吃饭的时候"), "body text match ranks the right note first");
await shot(page, "search-palette");
await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title");
check((await page.locator(".nb-doc-title").innerText()).includes("吃饭的时候"), "Enter opens that exact note in the Notebook");
await page.keyboard.press(`${mod}+KeyK`);
await page.keyboard.type("下课");
await page.waitForTimeout(150);
await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title:has-text('下课以后')");
check(true, "Chinese substring search opens the captured note");
await page.click(".nb-back");
await page.waitForTimeout(300);
check((await page.locator(".nb-doc-title").innerText()).includes("吃饭的时候"), "Back returns to the previously open note");

console.log("14. Delete an entry with confirmation (and undo)");
await page.keyboard.press(`${mod}+KeyK`);
await page.keyboard.type("下课");
await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title:has-text('下课以后')");
await page.click("button[aria-label='More actions']");
await page.click(".ws-menu-list button:has-text('Delete')");
await page.waitForSelector(".ws-dialog[role='alertdialog']");
await shot(page, "delete-confirmation");
await page.click(".ws-dialog button:has-text('Delete')");
await page.waitForSelector(".ws-toast:has-text('Deleted')");
check(await sql("select count(*) from knowledge_records where body like '下课以后%' and deleted_at is not null") === "1", "entry archived reversibly after confirmation");
await page.click(".ws-toast:has-text('Deleted') button:has-text('Undo')");
await page.waitForSelector(".ws-toast:has-text('Restored')");
check(await sql("select count(*) from knowledge_records where body like '下课以后%' and lesson_id is not null and deleted_at is null") === "1", "Undo restores it, including its lesson link");

console.log("15. Study still functions");
await section(page, "Study");
await page.waitForSelector(".desktop-nav-group");
const libraryText = await page.locator(".desktop-content").innerText();
check(libraryText.includes("Chinese") && libraryText.includes("German"), "Study library lists the existing collections");
await page.click("text=HSK 2 — Time");
await page.waitForTimeout(1200);
const packText = await page.locator(".desktop-content").innerText();
check(packText.includes("以前") && packText.includes("已经"), "topic opens with its existing cards");
await shot(page, "study-pack");
await page.keyboard.press(`${mod}+KeyK`);
await page.waitForSelector(".search-modal");
await page.keyboard.type("yǐqián");
await page.waitForTimeout(900);
check((await page.locator(".search-results").innerText()).includes("以前"), "Study card search still works (Ctrl+K in Study)");
await page.keyboard.press("Escape");
await section(page, "Notebook");
await section(page, "Study");
check((await page.locator(".desktop-content").innerText()).includes("以前"), "returning to Study keeps the open topic");
await page.reload();
await page.waitForSelector(".desktop-nav-group");
await page.waitForTimeout(1500);
check((await page.locator(".desktop-content").innerText()).includes("以前"), "Study reopens the same topic after a restart");

console.log("16. Window sizes (no horizontal overflow)");
for (const [w, h] of [[1920, 1080], [1280, 800], [1024, 768], [980, 680], [820, 1180], [600, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  for (const label of ["Overview", "Notebook", "Mistake Log", "Progress", "Study"]) {
    await section(page, label);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `${w}×${h} ${label}: no horizontal scroll (${overflow}px)`);
  }
}
await page.setViewportSize({ width: 1440, height: 900 });

console.log("17. Offline capture and edit, then reconnect");
await section(page, "Notebook");
await context.setOffline(true);
await page.waitForTimeout(300);
await page.keyboard.press(`${mod}+Shift+KeyN`);
await page.waitForSelector(".qc-panel");
await page.keyboard.type("Offline note: 以前 = before");
await page.keyboard.press(`${mod}+Enter`);
await page.waitForSelector(".ws-toast:has-text('Saved on this device')", { timeout: 8000 });
check(await sql("select count(*) from knowledge_records where body like 'Offline note%'") === "0", "offline note not on the server yet");
check((await page.locator(".desktop-action").first().innerText()).includes("Offline"), "header shows offline state with pending writes");
await shot(page, "offline-capture");
await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event("online")));
let synced = "0";
for (let i = 0; i < 24 && synced !== "1"; i += 1) { await page.waitForTimeout(500); synced = await sql("select count(*) from knowledge_records where body like 'Offline note%'"); }
check(synced === "1", "offline note reached the server after reconnecting");
await page.waitForTimeout(800);
check((await page.locator(".desktop-action").first().innerText()).includes("Synced"), "header returns to Synced");

check(errors.length === 0, `no page errors (${errors.length})`);
await context.storageState({ path: STATE_FILE });
await browser.close();
