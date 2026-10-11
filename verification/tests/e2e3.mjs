// Organisation and secondary flows on the showcase data.
import { check, launch, section, shot, signIn, sql } from "./lib.mjs";

const { browser, page, errors } = await launch();
await signIn(page);
const mod = "Control";
const openSearch = async (text) => {
  await page.keyboard.press(`${mod}+KeyK`);
  await page.waitForSelector(".ws-palette");
  await page.keyboard.type(text);
  await page.waitForTimeout(150);
  await page.keyboard.press("Enter");
};

console.log("A. Wiki links: open an existing note, create a missing one");
await section(page, "Notebook");
await openSearch("的时候 — “when");
await page.waitForSelector(".nb-doc-title");
await page.click(".nb-wikilink:has-text('以前 / 以后')");
await page.waitForSelector(".nb-doc-title:has-text('以前 / 以后')");
check(true, "[[以前 / 以后]] opens the linked note");
check((await page.locator(".nb-backlinks").innerText()).includes("的时候"), "backlink shows where it is linked from");
await page.click(".nb-back");
await page.waitForSelector(".nb-doc-title:has-text('的时候')");

console.log("B. Make a flashcard from a note through the existing card path");
await openSearch("一边");
await page.waitForSelector(".nb-doc-title:has-text('一边')");
await page.click("button[aria-label='More actions']");
await page.click(".ws-menu-list button:has-text('Make a flashcard')");
await page.waitForSelector(".ws-dialog#fc-title, .ws-dialog [id='fc-title']").catch(() => undefined);
await page.waitForSelector(".ws-dialog select");
await page.selectOption(".ws-dialog select", { label: "Everyday sentences" });
await page.waitForTimeout(200);
const fields = await page.locator(".ws-dialog .ws-field-grid input").evaluateAll((inputs) => inputs.map((input) => input.value));
check(fields[0] === "一边…一边…", `term prefilled from the note title (${JSON.stringify(fields)})`);
await page.fill(".ws-dialog .ws-field-grid input >> nth=2", "doing two things at once");
await shot(page, "flashcard-dialog");
await page.click(".ws-dialog button:has-text('Add card')");
await page.waitForSelector(".ws-toast:has-text('Card added')");
check(await sql("select count(*) from heuresis_cards where data->>'sentence' = '一边…一边…' and note like 'From Notebook:%'") === "1", "card created in heuresis_cards");

console.log("C. Move a note to another topic");
await page.click("button[aria-label='More actions']");
await page.click(".ws-menu-list button:has-text('Move to')");
await page.waitForSelector(".ws-picker");
await page.keyboard.type("time expr");
await page.keyboard.press("Enter");
await page.waitForSelector(".ws-toast:has-text('Moved to')");
check(await sql("select t.name from knowledge_records r join knowledge_topics t on t.id=r.topic_id where r.title='一边…一边…'") === "Time expressions", "note moved");
check((await page.locator(".nb-doc-bar .nb-crumbs").innerText()).includes("Time expressions"), "breadcrumb follows the move");

console.log("D. Rename a topic; deleting a non-empty topic is refused; an empty one is deleted");
await page.locator(".nb-tree-row:has-text('Blocks of meaning')").hover();
await page.click(".nb-tree-row:has-text('Blocks of meaning') .ws-menu-trigger");
await page.click(".ws-menu-list button:has-text('Rename')");
await page.fill("input[aria-label='Topic name']", "Chunks");
await page.keyboard.press("Enter");
await page.waitForSelector(".nb-tree-row:has-text('Chunks')");
check(await sql("select count(*) from knowledge_topics where name='Chunks'") === "1", "topic renamed");
await page.locator(".nb-tree-row:has-text('Time expressions')").hover();
await page.click(".nb-tree-row:has-text('Time expressions') .ws-menu-trigger");
await page.click(".ws-menu-list button:has-text('Delete')");
await page.waitForSelector(".ws-toast:has-text('still contains')");
check(await sql("select count(*) from knowledge_topics where name='Time expressions'") === "1", "non-empty topic kept, with an explanation");
await page.locator(".nb-tree-row:has-text('Chunks')").hover();
await page.click(".nb-tree-row:has-text('Chunks') .ws-menu-trigger");
await page.click(".ws-menu-list button:has-text('Delete')");
await page.waitForSelector(".ws-dialog[role='alertdialog']");
await page.click(".ws-dialog button:has-text('Delete topic')");
await page.waitForTimeout(500);
check(await sql("select count(*) from knowledge_topics where name='Chunks'") === "0", "empty topic deleted after confirmation");

console.log("E. Organise lesson captures afterwards");
await openSearch("Chapter 4");
await page.waitForSelector(".nb-lesson-extras");
await page.click(".nb-capture-row:has-text('下课以后') button:has-text('Move into lesson')");
await page.waitForSelector(".ws-toast:has-text('Moved into the lesson text')");
check((await sql("select body from knowledge_records where title='HSK 2 · Chapter 4'")).includes("下课以后 — after class"), "capture text appended to the lesson");
check(await sql("select count(*) from knowledge_records where body = '下课以后 — after class'") === "0", "separate capture removed");
await page.click(".nb-capture-row:has-text('why is 了') button:has-text('Answered')");
await page.waitForSelector(".ws-toast:has-text('Marked as answered')");
check(await sql("select category from knowledge_records where body like '吃饭的时候下雨了 — why%'") === "note", "question marked answered");

console.log("F. Overview opens items directly");
await section(page, "Overview");
await page.click(".ov-list button:has-text('B1.2 · Lektion 7')");
await page.waitForSelector(".nb-doc-title:has-text('Lektion 7')");
check((await page.locator(".hw-sections button.active").innerText()).includes("Notebook"), "Overview → lesson opens in the Notebook");
await section(page, "Overview");
await page.click(".ov-figures + button");
await page.waitForSelector(".ws-dialog.is-recall");
check((await page.locator(".ws-dialog.is-recall h2").innerText()).includes("of"), "Overview starts a recall session for the due mistakes");
await page.keyboard.press("Escape");

console.log("G. Keyboard: Alt+3 → Notebook, ? → shortcuts");
await page.keyboard.press("Alt+Digit3");
await page.waitForTimeout(200);
check((await page.locator(".hw-sections button.active").innerText()).includes("Notebook"), "Alt+3 opens the Notebook");
await page.keyboard.press("Shift+Slash");
await page.waitForSelector("#shortcuts-title");
await shot(page, "shortcuts");
await page.keyboard.press("Escape");

console.log("H. Theme switch from the account menu");
await page.click(".desktop-account-menu summary");
await page.click(".hw-theme-row button:has-text('Dark')");
check(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "dark theme applied");
await page.reload();
await page.waitForSelector(".heuresis-section-sidebar");
check(await page.evaluate(() => document.documentElement.dataset.theme) === "dark", "theme remembered after restart");

check(errors.length === 0, `no page errors (${errors.length})`);
await browser.close();
