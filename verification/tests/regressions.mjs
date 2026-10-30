// Browser regression suite for the audit of 15 October 2026. Each scenario starts
// from a fresh copy of the showcase database and drives the real app.
//   node tests/regressions.mjs            (all scenarios)
//   node tests/regressions.mjs offline    (scenarios whose name contains "offline")
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BASE, check, launch, signIn, sql } from "./lib.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const only = process.argv[2] ?? "";
const HSK = "a0000000-0000-4000-8000-000000000001";
const NOTE_A2 = "e0000000-0000-4000-8000-0000000000a2"; // 以前 / 以后 (Chinese › Grammar › Time expressions)

function restore() {
  execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" });
}
async function openPalette(page) {
  await page.keyboard.press("Control+KeyK");
  await page.waitForSelector(".ws-palette input");
}
async function openNote(page, query) {
  await openPalette(page);
  await page.keyboard.type(query);
  await page.waitForTimeout(250);
  await page.locator(".ws-palette-row:not(.is-command):not(.is-cards)").first().click();
  await page.waitForSelector(".nb-doc-title");
}
async function queueSize(page) {
  return page.evaluate(() => new Promise((resolve) => {
    const request = indexedDB.open("heuresis-offline-network-v1");
    request.onsuccess = () => {
      const all = request.result.transaction("queue").objectStore("queue").getAll();
      all.onsuccess = () => resolve(all.result.length);
    };
  }));
}
async function editNote(page) {
  await page.keyboard.press("e");
  const editor = page.locator(".nb-doc-editor [contenteditable=true]");
  await editor.waitFor();
  await editor.click();
  await page.keyboard.press("Control+End");
}

const scenarios = {
  async "offline edits all reach the server"(page, context) {
    await openNote(page, "以前 / 以后");
    await editNote(page);
    await context.setOffline(true);
    for (const word of ["OFF-1", "OFF-2", "OFF-3"]) { await page.keyboard.type(` ${word}`); await page.waitForTimeout(1600); }
    check(await queueSize(page) >= 3, "three offline autosaves are queued");
    await context.setOffline(false);
    await page.waitForTimeout(200);
    await page.keyboard.type(" AFTER");
    await page.waitForTimeout(6000);
    const body = await sql(`select body from knowledge_records where id='${NOTE_A2}'`);
    check(/OFF-1 OFF-2 OFF-3 AFTER$/.test(body), "every offline edit and the edit typed on reconnecting are on the server");
    check(await queueSize(page) === 0, "the offline queue is empty");
    check(!/Sync problem/.test(await page.getAttribute(".hw-sync-indicator", "aria-label")), "no permanent sync problem");
    check(!(await page.locator(".nb-save-state.is-error").count()), "no conflict error while typing during reconnection");
  },

  async "offline edit conflicting with another device is held, not overwritten"(page, context) {
    await openNote(page, "以前 / 以后");
    await editNote(page);
    await context.setOffline(true);
    await page.keyboard.type(" MINE-1");
    await page.waitForTimeout(1600);
    await page.keyboard.type(" MINE-2");
    await page.waitForTimeout(1600);
    await sql(`update knowledge_records set body = body || ' THEIRS' where id='${NOTE_A2}'`);
    await context.setOffline(false);
    await page.waitForTimeout(5000);
    const body = await sql(`select body from knowledge_records where id='${NOTE_A2}'`);
    check(body.endsWith("THEIRS") && !body.includes("MINE"), "the other device's edit is not overwritten");
    await page.click(".hw-sync-indicator");
    await page.waitForSelector(".hw-sync-dialog");
    check(/refused/.test(await page.locator(".hw-sync-dialog").innerText()), "the sync dialog explains the refused edits");
    await page.click('.hw-sync-dialog button:has-text("Review changes")');
    await page.waitForSelector(".held-recovery");
    const listed = await page.locator(".held-recovery .legacy-recovery-entry").count();
    check(listed >= 2 && listed === await queueSize(page), `every refused edit is listed for review (${listed})`);
    await page.keyboard.press("Escape");
    // Reopening the note offers this device's version back.
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.waitForTimeout(1500);
    await page.keyboard.press("Escape");
    await openNote(page, "以前 / 以后");
    check(await page.locator(".nb-restore").count() === 1, "the note offers to restore the unsynced text from this device");
  },

  async "flashcards stay in the note's language"(page) {
    await sql(`insert into knowledge_records(id,user_id,topic_id,kind,title,body,category)
      values ('e0000000-0000-4000-8000-0000000000f2','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-0000000000e1','note','','с утра до вечера — from morning until evening','phrase')`);
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.waitForTimeout(1200);
    await openNote(page, "с утра до вечера");
    await page.click('button[aria-label="More actions"]');
    await page.click('button[role=menuitem]:has-text("Make a flashcard")');
    await page.waitForSelector("#fc-title");
    await page.waitForTimeout(800);
    const selected = await page.locator(".ws-dialog select").inputValue();
    check(selected === "", "a Russian note is not preselected into a Chinese or German topic");
    check(/No Study collection is in Russian/.test(await page.locator(".ws-dialog").innerText()), "the dialog says why nothing is preselected");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
    check(await page.locator("#fc-title").count() === 0, "Escape closes the flashcard dialog");

    await openNote(page, "以前 / 以后");
    await page.click('button[aria-label="More actions"]');
    await page.click('button[role=menuitem]:has-text("Make a flashcard")');
    await page.waitForSelector("#fc-title");
    await page.waitForTimeout(800);
    const label = await page.locator(".ws-dialog select").evaluate((select) => select.selectedOptions[0]?.parentElement?.getAttribute("label"));
    check(label === "Chinese", "a Chinese note defaults to a Chinese topic");
    await page.keyboard.press("Control+KeyK");
    await page.waitForTimeout(250);
    check(await page.locator(".ws-palette").count() === 0, "Ctrl+K does not open the palette underneath an open dialog");
  },

  async "palette: Enter opens what was typed"(page) {
    await sql(`insert into knowledge_records(id,user_id,topic_id,kind,title,body,category)
      values ('e0000000-0000-4000-8000-00000000c0de','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-0000000000d3','note','Note-taking phrases','mitschreiben — to take notes','phrase')`);
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.waitForTimeout(1200);
    await openPalette(page);
    await page.keyboard.type("note");
    await page.waitForTimeout(250);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(600);
    check((await page.locator(".nb-doc-title").innerText().catch(() => "")) === "Note-taking phrases", "a note whose title matches opens instead of “Capture a note”");
    await openPalette(page);
    await page.keyboard.type("sync");
    await page.waitForTimeout(250);
    check(/Sync now/.test(await page.locator(".ws-palette-row").first().innerText()), "a command named by the query stays first");
    await page.keyboard.press("Escape");
  },

  async "a mistake is filed in the Notebook hierarchy and recurring errors stay distinct"(page) {
    await page.click('.hw-sections button:has-text("Mistake Log")');
    await page.waitForSelector(".ml-hierarchy");
    check(await page.locator(".ml-organiser").count() === 0, "The old side rail has been replaced");
    await page.click('button:has-text("Add mistake")');
    const editor = page.locator(".ml-simple-edit");
    check(await editor.locator(":scope > label.ws-field textarea").count() === 2, "A correction keeps only two main text fields");
    await editor.locator("textarea").nth(0).fill("Wrong assumption");
    await editor.locator("textarea").nth(1).fill("Corrected conclusion");
    await editor.locator("button.ml-destination").click();
    await page.locator(".ws-picker-list button").first().waitFor();
    await page.locator(".ws-picker-search input").fill("B1.2");
    await page.locator('.ws-picker-list button:has-text("German")').filter({ hasText: "B1.2" }).first().click();
    await editor.locator('button:has-text("Save")').click();
    await page.waitForSelector('.ml-simple-item:has-text("Corrected conclusion")');
    const destination = await sql("select s.name || ' › ' || t.name from knowledge_records r join knowledge_topics t on t.id=r.topic_id join knowledge_subjects s on s.id=t.subject_id where r.attempt='Wrong assumption'");
    check(destination === "German › B1.2", "Saving requires a real destination and never creates Unsorted");

    await page.locator('.ml-simple-item:has-text("Corrected conclusion") [aria-label="Edit mistake"]').click();
    await page.locator(".ml-simple-edit input[maxlength='200']").fill("Cause and effect");
    await page.locator(".ml-simple-edit summary").click();
    await page.locator(".ml-edit-notes textarea").fill("Compare correlation and causation");
    await page.locator('.ml-simple-edit button:has-text("Save")').click();
    await page.waitForSelector('.ml-simple-item:has-text("Cause and effect")');
    check(await page.locator('.ml-simple-item:has-text("Compare correlation")').count() === 1,
      "The rule and its formatted explanation are preserved");

    await page.locator('.ml-crumbs button:has-text("Mistake Log")').click();
    await page.locator('.nb-home-subject:has-text("German") .nb-subject-open').click();
    const grammarTheme = page.locator('.ml-theme-tile:has-text("B1.2")').first();
    await grammarTheme.locator(".ml-theme-pick").click();
    check(await page.locator('.ml-study-selection:has-text("1 theme selected")').count() === 1,
      "A whole theme can be selected for targeted practice without opening corrections");
    check(await page.locator('.ml-study-selection button:has-text("Practise selected")').isEnabled(),
      "The selected theme has correctable mistakes ready for practice");
    await grammarTheme.locator(".ml-theme-open").click();
    const quick = page.locator(".ml-quick-add");
    await quick.locator("input").nth(0).fill("Wrong assumption");
    await quick.locator("input").nth(1).fill("Corrected conclusion");
    await quick.locator('button:has-text("Add")').click();
    await page.waitForSelector(".ml-duplicate-check");
    await page.locator('.ml-duplicate-check button:has-text("Made again")').click();
    await page.waitForTimeout(500);
    check(await sql("select count(*) from knowledge_records where attempt='Wrong assumption' and deleted_at is null") === "1",
      "A repeated mistake doesn't create a second card");
    check(await sql("select count(*) from knowledge_practice_events where source='repeated'") === "1",
      "Actual recurrence is distinguished from a failed recall");

    await page.locator('.ml-bulk-add button:has-text("Paste a list")').click();
    await page.locator(".ml-bulk-panel textarea").fill("ein neue Haus → ein neues Haus // adjective endings\nich habe gegangen → ich bin gegangen");
    await page.locator('.ml-bulk-panel button:has-text("Add 2 mistakes")').click();
    await page.waitForTimeout(600);
    check(await sql("select count(*) from knowledge_records where attempt in ('ein neue Haus','ich habe gegangen') and deleted_at is null") === "2",
      "Bulk paste records both corrections");
  },

  async "older classified mistakes remain intact in the simpler UI"(page) {
    const id = "e0000000-0000-4000-8000-00000000dead";
    const mode = "a1a1a1a1-0000-4000-8000-000000000001";
    await sql("insert into knowledge_mistake_modes(id,user_id,name,description,symbol,sort_order) values ('" + mode + "','11111111-1111-4111-8111-111111111111','Word order','Sentence order','🧩',9)");
    await sql("insert into knowledge_records(id,user_id,topic_id,kind,attempt,correction,status,category,mistake_mode_id) values ('" + id + "','11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-0000000000c1','mistake','ich habe gegangen','ich bin gegangen','needs_practice','grammar','" + mode + "')");
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.click('.hw-sections button:has-text("Mistake Log")');
    await page.locator(".ml-search-field").fill("ich habe gegangen");
    const card = page.locator('[data-mistake="' + id + '"]');
    await card.waitFor();
    check(await card.locator(".ml-simple-wrong").innerText() === "ich habe gegangen", "Old attempt remains readable");
    check(await card.locator(".ml-simple-right").innerText() === "ich bin gegangen", "Old correction remains readable");
    await card.locator('[aria-label="Edit mistake"]').click();
    await page.locator(".ml-simple-edit textarea").nth(1).fill("ich bin nach Hause gegangen");
    await page.locator('.ml-simple-edit button:has-text("Save")').click();
    await page.waitForSelector('.ml-simple-item:has-text("ich bin nach Hause gegangen")');
    const preserved = await sql("select category || '|' || mistake_mode_id::text from knowledge_records where id='" + id + "'");
    check(preserved === "grammar|" + mode, "Editing the text does not destroy historical classification");

    await page.keyboard.press("Control+Shift+KeyM");
    await page.waitForSelector(".qc-panel");
    await page.locator('.q-capture-types button:has-text("Mistake")').click();
    check(await page.locator(".q-capture-editor textarea").count() === 2, "Quick Capture also uses two mistake fields");
    check(await page.locator(".qc-panel .qc-categories").count() === 0, "Quick Capture no longer demands a mistake type");
  },

  async "organise inbox uses the language being worked in"(page) {
    await page.click('.hw-sections button:has-text("Notebook")');
    await page.waitForTimeout(500);
    await openPalette(page);
    await page.keyboard.type("Lesson 7");
    await page.waitForTimeout(250);
    await page.locator(".ws-palette-row:not(.is-command):not(.is-cards)").first().click();
    await page.waitForTimeout(500);
    await openPalette(page);
    await page.keyboard.type("organise inbox");
    await page.waitForTimeout(250);
    await page.keyboard.press("Enter");
    await page.waitForSelector(".lc-dialog");
    const heading = await page.locator(".lc-heading p").innerText();
    check(heading === "German › Inbox", `the German Inbox opens while working in German (got “${heading}”)`);
  },

  async "capture while the notebook is still loading does not offer to create languages"(page, context) {
    await context.route("**/rest/v1/knowledge_*", async (route) => {
      if (route.request().method() === "GET") await new Promise((resolve) => setTimeout(resolve, 2500));
      await route.continue();
    });
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.keyboard.press("Control+Shift+KeyN");
    await page.waitForSelector(".qc-panel");
    check(await page.locator(".qc-first-run").count() === 0, "no “Where should your notes live?” prompt while languages are loading");
    check(await page.locator(".q-capture-editor textarea").count() === 1 && await page.locator(".qc-language-choices").count() === 0,
      "Q Capture accepts a note without demanding a subject while Notebook data loads");
  },

  async "overview shows review coverage and daily activity"(page) {
    await page.click('.hw-sections button:has-text("Overview")');
    await page.locator('.oh-track[role="progressbar"]').waitFor();
    check(await page.locator(".oh-metric").count() === 3, "Overview shows card totals, additions and reviews");
    await page.locator(".oh-days .oh-cell").first().waitFor({ timeout: 15000 });
    check(await page.locator(".oh-days .oh-cell").count() >= 180, "Overview shows the last 26 weeks of daily review activity");
  },

  async "tablet portrait: the Notebook drawer neither peeks out nor opens displaced"(page) {
    await page.setViewportSize({ width: 800, height: 1280 });
    await page.click('.hw-sections button[title^="Notebook"]');
    await page.mouse.move(600, 900);
    await page.waitForTimeout(900);
    const sidebar = await page.locator(".heuresis-section-sidebar").evaluate((el) => el.getBoundingClientRect().right);
    const closed = await page.locator(".nb-rail").evaluate((el) => ({ right: el.getBoundingClientRect().right, visibility: getComputedStyle(el).visibility }));
    check(closed.visibility === "hidden" && closed.right <= sidebar, `the closed drawer is hidden behind the sidebar (right edge ${closed.right}, sidebar ${sidebar})`);
    await page.click(".nb-rail-toggle");
    await page.waitForTimeout(500);
    const open = await page.locator(".nb-rail").evaluate((el) => el.getBoundingClientRect().left);
    check(Math.abs(open - sidebar) <= 1, `the open drawer starts at the sidebar edge (${open} vs ${sidebar})`);
  },

  async "narrow window: the icon rail closes again after choosing a section"(page) {
    await page.setViewportSize({ width: 1000, height: 800 });
    await page.waitForTimeout(300);
    await page.click('.hw-sections button[title^="Overview"]');
    await page.mouse.move(700, 500);
    await page.waitForTimeout(400);
    const width = await page.locator(".heuresis-section-sidebar").evaluate((el) => el.getBoundingClientRect().width);
    check(width <= 64, `the rail does not stay expanded over the page (${width}px)`);
  },

  async "long lists render in pages and still reach old records"(page) {
    await sql(`insert into knowledge_records(user_id,topic_id,kind,attempt,correction,status,created_at,updated_at)
      select '11111111-1111-4111-8111-111111111111','70b00000-0000-4000-8000-0000000000c1','mistake','错 ' || g,'对 ' || g,'needs_practice',
        now() - (g || ' minutes')::interval, now() - (g || ' minutes')::interval from generate_series(1,300) g`);
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.waitForTimeout(1200);
    await page.click('.hw-sections button:has-text("Mistake Log")');
    await page.locator(".ml-search-field").fill("错");
    await page.waitForSelector(".ml-simple-item");
    check(await page.locator(".ml-simple-item").count() === 60, "Only the first 60 matching corrections render initially");
    await page.click(".ml-simple-more");
    check(await page.locator(".ml-simple-item").count() === 120, "Show more progressively loads the next 60 corrections");
    await openPalette(page);
    await page.keyboard.type("对 299");
    await page.waitForTimeout(250);
    await page.locator(".ws-palette-row:not(.is-command):not(.is-cards)").first().click();
    await page.waitForTimeout(800);
    check(await page.locator(".ml-simple-item.is-highlighted").count() === 1, "Searching opens and highlights an old correction");
  },

  async "undo restores a move and a deletion, even after leaving the page"(page) {
    await openNote(page, "以前 / 以后");
    await page.click('button[aria-label="More actions"]');
    await page.click('button[role=menuitem]:has-text("Move to")');
    await page.fill(".ws-picker-search input", "Blocks of meaning");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(800);
    check(await sql(`select t.name from knowledge_records r join knowledge_topics t on t.id=r.topic_id where r.id='${NOTE_A2}'`) === "Blocks of meaning", "the note moved");
    await page.click('.hw-sections button:has-text("Overview")');
    await page.click('.ws-toast button:has-text("Undo")');
    await page.waitForTimeout(800);
    check(await sql(`select t.name from knowledge_records r join knowledge_topics t on t.id=r.topic_id where r.id='${NOTE_A2}'`) === "Time expressions", "Undo after leaving the note moves it back");

    const RU = "e0000000-0000-4000-8000-0000000000d4";
    check(await sql("select count(*) from knowledge_records where id='" + RU + "' and deleted_at is null") === "1", "A seeded mistake exists");
    await page.click('.hw-sections button:has-text("Mistake Log")');
    const ruAttempt = await sql("select attempt from knowledge_records where id='" + RU + "'");
    await page.locator(".ml-search-field").fill(ruAttempt);
    await page.locator('[data-mistake="' + RU + '"] [aria-label="Edit mistake"]').click();
    await page.locator(".ml-simple-edit .ml-delete-in-editor").click();
    await page.locator('[role="alertdialog"] button:has-text("Delete mistake")').click();
    await page.waitForTimeout(700);
    check(await sql("select count(*) from knowledge_records where id='" + RU + "' and deleted_at is null") === "0", "The mistake is deleted");
    await page.click('.hw-sections button:has-text("Overview")');
    await page.locator('.ws-toast button:has-text("Undo")').click();
    await page.waitForTimeout(700);
    check(await sql("select count(*) from knowledge_records where id='" + RU + "' and deleted_at is null") === "1",
      "Undo restores the original mistake even after leaving Mistake Log");
  },

  async "server unreachable: the device copy is shown and captures are not called stored"(page, context) {
    await page.click('.hw-sections button:has-text("Notebook")');
    await page.waitForTimeout(1200);
    await context.route("http://localhost:54321/**", (route) => route.abort("connectionrefused"));
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar", { timeout: 20000 });
    await page.click('.hw-sections button:has-text("Notebook")');
    await page.waitForTimeout(3000);
    check(/Chinese/.test(await page.locator("main").innerText()), "the Notebook opens from the device copy");
    await page.keyboard.press("Control+Shift+KeyN");
    await page.locator(".q-capture-editor textarea").fill("Server down capture");
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(1500);
    const toast = (await page.locator(".ws-toast").allInnerTexts()).join(" ");
    check(/on this device|waiting to sync/i.test(toast), `the capture is reported as kept on this device (“${toast.split("\n")[0]}”)`);
    await context.unroute("http://localhost:54321/**");
    await page.evaluate(() => window.dispatchEvent(new Event("online")));
    await page.waitForTimeout(5000);
    check(await sql("select count(*) from knowledge_records where body='Server down capture'") === "1", "it reaches the server once the server is back");
  },

  async "learning loop: capture → flashcard → sort → review"(page, context) {
    // Q Capture now files provisional notes in the Captures queue. Use the dedicated
    // Study card composer to test the complete card-to-review learning loop.
    await page.goto(`${BASE}?capture=1&pack=${HSK}`);
    await page.locator(".capture-composer").waitFor({ timeout: 15000 });
    const slots = page.locator(".capture-card-surface .capture-slot textarea");
    await slots.nth(0).fill("再见");
    await slots.nth(1).fill("zàijiàn");
    await slots.nth(2).fill("goodbye");
    await slots.nth(2).press("Enter");
    await page.waitForTimeout(1200);
    check(await sql("select p.title||'|'||(c.data->>'meaning') from heuresis_cards c join heuresis_packs p on p.id=c.pack_id where c.data->>'term'='再见'") === "HSK 2 — Time|goodbye",
      "the card is in the Chinese topic with its meaning");
    await page.goto(BASE);
    await page.locator(".heuresis-section-sidebar").waitFor();
    await page.click('.hw-sections button:has-text("Study")');
    await page.waitForTimeout(1200);
    await page.locator('button:has-text("HSK 2 — Time")').first().click();
    await page.waitForTimeout(1200);
    await page.click("button.sort-command");
    // Sort opens straight into the queue; narrowing it is behind Filter.
    await page.waitForSelector(".sort-card");
    await page.click(".sort-filter-open");
    await page.fill(".sort-setup-search input", "再见");
    check(await page.locator(".sort-setup-start").innerText() === "Sort 1 card", "Sort button tells the user exactly how many cards are prepared");
    await page.click(".sort-setup-start");
    await page.waitForTimeout(400);
    const disclosure = page.locator('.sort-enrich-heading:has-text("Examples")');
    await disclosure.focus();
    await page.keyboard.press("Enter");
    check(await disclosure.getAttribute("aria-expanded") === "true", "Sort opens the editable Examples dimension with keyboard Enter");
    await page.keyboard.press("Space");
    check(await disclosure.getAttribute("aria-expanded") === "false", "Sort closes the Examples dimension with keyboard Space");
    await page.keyboard.press("c");
    await page.waitForTimeout(1200);
    // Core is stored on the existing 1–5 scale as 5.
    check(await sql("select interest_rank||'|'||((data->>'_sorted_at') is not null) from heuresis_cards where data->>'term'='再见'") === "5|true", "sorting stores importance (Core) and completion");
    // Review is one click from the end of a Sort pass.
    await page.click('.sort-finished-actions button:has-text("Review now")');
    await page.locator(".review-controls").waitFor();
    const popupOpened = context.waitForEvent("page");
    await page.locator(".study-start").click();
    const popup = await popupOpened;
    await popup.waitForSelector(".cosmos-count", { timeout: 15000 });
    await popup.keyboard.press(" ");
    await popup.waitForTimeout(500);
    await popup.keyboard.press("3");
    await popup.waitForTimeout(1200);
    const graded = Number(await sql("select count(*) from heuresis_card_events where event_type in ('again','hard','good','easy') and template_id is not null and created_at > now() - interval '5 minutes'"));
    check(graded >= 1, "the review grade is recorded with its direction");
    await popup.close();
  },
};

let failures = 0;
for (const [name, run] of Object.entries(scenarios)) {
  if (only && !name.includes(only)) continue;
  restore();
  console.log(`— ${name}`);
  const { browser, context, page, errors } = await launch({ width: 1440, height: 900 });
  try {
    await signIn(page);
    await run(page, context);
    const unexpected = errors.filter((message) => !/status of 406|Failed to load resource|ERR_CONNECTION_REFUSED|Failed to fetch/.test(message));
    check(!unexpected.length, `no page errors${unexpected.length ? `: ${unexpected.join(" | ")}` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}: ${error instanceof Error ? error.stack ?? error.message : error}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
if (failures) console.log(`${failures} scenario(s) stopped with an exception.`);
