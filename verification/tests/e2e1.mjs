// Workflows 1–10: sign in, sections, subject/topic, quick note, reopen/edit, lesson, restart.
import { mkdirSync } from "node:fs";
import { SHOTS, STATE_FILE, check, launch, section, shot, signIn, sql } from "./lib.mjs";

mkdirSync(SHOTS, { recursive: true });
const { browser, context, page, errors } = await launch();
const mod = "Control";

console.log("1. Launch and sign in");
await signIn(page);
check(await page.locator(".hw-sections button").count() === 5, "exactly five sections in the sidebar");

console.log("2. Navigate between all five sections");
for (const label of ["Overview", "Study", "Notebook", "Mistake Log", "Progress"]) {
  await section(page, label);
  const active = await page.locator(".hw-sections button.active").innerText();
  check(active.includes(label), `${label} opens`);
}

console.log("3. Create a language subject (from the Notebook welcome)");
await section(page, "Notebook");
await page.click(".nb-welcome button:has-text('Chinese')");
await page.waitForSelector(".nb-scope-head h1:has-text('Inbox')");
check(await sql("select count(*) from knowledge_subjects where name='Chinese'") === "1", "subject Chinese stored");
check(await sql("select count(*) from knowledge_topics where name='Inbox'") === "1", "Inbox topic stored");
await shot(page, "notebook-inbox-empty");

console.log("4. Create a topic and a sub-topic");
await page.locator(".nb-tree-row.is-subject").first().hover();
await page.click(".nb-tree-add");
await page.fill("input[aria-label='Topic name']", "Grammar");
await page.keyboard.press("Enter");
await page.waitForSelector(".nb-scope-head h1:has-text('Grammar')");
await page.click(".nb-subtopic.is-add");
await page.fill("input[aria-label='Sub-topic name']", "Time expressions");
await page.keyboard.press("Enter");
await page.waitForSelector(".nb-scope-head h1:has-text('Time expressions')");
check(await sql("select count(*) from knowledge_topics t join knowledge_topics p on p.id=t.parent_id where t.name='Time expressions' and p.name='Grammar'") === "1", "nested topic Grammar → Time expressions stored");
check((await page.locator(".nb-crumbs").first().innerText()).includes("Grammar"), "breadcrumb shows the parent topic");

console.log("5. Capture a quick note with Ctrl+Shift+N while focus is in a text field");
await page.click(".nb-rail-search"); // opens palette (focus in an input)
await page.keyboard.press("Escape");
await page.keyboard.press(`${mod}+Shift+KeyN`);
await page.waitForSelector(".qc-panel");
check(await page.locator(".qc-topic").innerText().then((t) => t.includes("Time expressions")), "capture defaults to the topic being viewed");
await page.keyboard.type("吃饭的时候下雨了 — why is 了 at the end?");
check(await page.locator(".qc-categories button.is-active").innerText() === "Question", "question mark files it as a Question");
await shot(page, "quick-capture-note");
const t0 = Date.now();
await page.keyboard.press(`${mod}+Enter`);
await page.waitForSelector(".ws-toast:has-text('Saved to')", { timeout: 5000 });
console.log(`   saved and confirmed in ${Date.now() - t0} ms`);
check(await page.locator(".qc-panel").count() === 0, "panel closes after saving");
check(await sql("select count(*) from knowledge_records where kind='note' and category='question' and body like '吃饭的时候%'") === "1", "note stored as a question");

console.log("5b. Draft protection: Esc keeps the draft, reopening restores it");
await page.keyboard.press(`${mod}+Shift+KeyN`);
await page.keyboard.type("half-typed thought about 以前");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check(await page.locator(".qc-panel").count() === 0, "Esc closes the panel");
await page.reload();
await page.waitForSelector(".heuresis-section-sidebar");
await page.keyboard.press(`${mod}+Shift+KeyN`);
await page.waitForSelector(".qc-panel");
check(await page.inputValue(".qc-main-input") === "half-typed thought about 以前", "draft survives closing and an app restart");
await page.click(".qc-foot button:has-text('Discard')");

console.log("6. Reopen the note and 7. edit it");
await page.waitForTimeout(300);
await page.click(".nb-doc-row:has-text('吃饭的时候')");
await page.waitForSelector(".nb-doc-title");
check((await page.locator(".nb-doc-title").innerText()).includes("吃饭的时候"), "note opens as a full document");
await shot(page, "note-reading");
await page.keyboard.press("e");
await page.waitForSelector(".nb-editor");
await page.click(".nb-editor");
await page.keyboard.press("End");
await page.keyboard.press(`${mod}+End`);
await page.keyboard.press("Enter");
await page.keyboard.type("# Answer");
await page.keyboard.press("Enter");
await page.keyboard.type("了 marks a change of state: it ");
await page.keyboard.press(`${mod}+KeyB`);
await page.keyboard.type("started");
await page.keyboard.press(`${mod}+KeyB`);
await page.keyboard.type(" raining.");
await page.keyboard.press("Enter");
await page.keyboard.type("- 吃饭的时候 = while eating");
await page.keyboard.press("Enter");
await page.keyboard.type("下雨了 = it started to rain");
await page.waitForTimeout(1600);
check((await page.locator(".nb-save-state").innerText()).match(/Saved|All changes saved/) !== null, "autosave reports Saved");
await shot(page, "note-editing");
await page.keyboard.press(`${mod}+Enter`);
await page.waitForSelector(".nb-doc-body .nb-prose");
const body = await sql("select body from knowledge_records where body like '吃饭的时候%'");
check(body.includes("# Answer") && body.includes("**started**") && body.includes("- 吃饭的时候 = while eating") && body.includes("- 下雨了 = it started to rain"), "edited body stored as clean text: " + JSON.stringify(body));

console.log("8. Create a lesson (Ctrl+Shift+L) and 9. add information to it");
await page.keyboard.press(`${mod}+Shift+KeyL`);
await page.waitForSelector(".qc-panel");
await page.keyboard.type("HSK 2 · Chapter 4");
await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc.is-lesson .nb-editor");
check(await sql("select count(*) from knowledge_records where kind='lesson' and title='HSK 2 · Chapter 4' and body=''") === "1", "empty lesson stored immediately");
await page.click(".nb-outline-button");
await page.waitForTimeout(200);
await page.click(".nb-editor h2 >> nth=0");
await page.keyboard.press("End");
await page.keyboard.press("Enter");
await page.keyboard.type("的时候 — expressing that one event happens during another.");
await page.waitForTimeout(1500);
check(await page.locator(".hw-lesson").count() === 1, "sidebar shows the lesson in progress");
// Quick captures during the lesson attach to it
await page.keyboard.press(`${mod}+Shift+KeyN`);
await page.waitForSelector(".qc-panel");
check(await page.locator(".qc-lesson-chip.is-on").count() === 1, "capture panel shows it will attach to the lesson");
await page.keyboard.type("下课以后 — after class");
await page.keyboard.press(`${mod}+Enter`);
await page.waitForSelector(".ws-toast:has-text('Saved to the lesson')");
await page.keyboard.press(`${mod}+Shift+KeyM`);
await page.waitForSelector(".qc-panel textarea");
await page.keyboard.type("我吃饭了的时候，他来了");
await page.keyboard.press(`${mod}+Enter`);
await page.waitForSelector(".ws-toast:has-text('Mistake Log')");
check(await sql("select count(*) from knowledge_records r join knowledge_records l on l.id=r.lesson_id where l.title='HSK 2 · Chapter 4'") === "2", "note and mistake linked to the lesson");
await page.click(".nb-doc-actions button:has-text('Done')");
await page.waitForSelector(".nb-lesson-extras");
check(await page.locator(".nb-capture-row").count() >= 1 && await page.locator(".nb-mistake-row").count() === 1, "lesson page lists its captures and mistake");
await shot(page, "lesson-page");

console.log("10. Reopen the lesson after restarting Heuresis");
await context.storageState({ path: STATE_FILE });
await page.reload();
await page.waitForSelector(".nb-doc-title");
check((await page.locator(".nb-doc-title").innerText()).includes("HSK 2"), "Notebook reopens the last lesson after a restart");
check((await page.locator(".nb-doc-body").innerText()).includes("expressing that one event happens"), "lesson text persisted");
const sectionAfter = await page.locator(".hw-sections button.active").innerText();
check(sectionAfter.includes("Notebook"), "last section restored");

check(errors.length === 0, `no page errors (${errors.length})`);
await browser.close();
