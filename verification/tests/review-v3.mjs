// Browser checks for the evolved Sort and Review (learning model v3): one-click
// recommended Review, four Sort outcomes with recoverable Discard, Core / Useful /
// Peripheral importance, direction-specific knowledge states, typed-answer suggestions
// (Chinese and input methods), Adjust preferences, and offline recovery.
// Each scenario starts from a fresh copy of the showcase database and drives the real app.
//   node tests/review-v3.mjs              (all scenarios)
//   node tests/review-v3.mjs offline      (scenarios whose name contains "offline")
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE, check, launch, signIn, sql } from "./lib.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const shots = `${here}screenshots/review-v3`;
mkdirSync(shots, { recursive: true });
const only = process.argv[2] ?? "";
const USER = "11111111-1111-4111-8111-111111111111";
const HSK = "a0000000-0000-4000-8000-000000000001";
const REC = "00000000-0000-4000-8000-000000000101"; // Chinese → English (the topic's default direction)
const PRO = "00000000-0000-4000-8000-000000000102"; // English → Chinese
const GRADES = "('again','hard','good','easy')";
/** Numbered pinyin for the showcase words (what a learner without a tone keyboard types). */
const NUMBERED = { 以后: "yi3hou4", 已经: "yi3jing1", 刚才: "gang1cai2", 以前: "yi3qian2", 的时候: "de shi2hou" };

function restore() {
  execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" });
}
async function addUnsortedCards() {
  await sql(`insert into heuresis_cards(user_id, pack_id, data) values
    ('${USER}','${HSK}','{"term":"马上","reading":"mǎshàng","meaning":"immediately","example":"我马上来。"}'),
    ('${USER}','${HSK}','{"term":"最近","reading":"zuìjìn","meaning":"recently"}')`);
}
async function showAllIfAvailable(page) {
  // The topic keeps its expanded state when revisited; Show all is then absent.
  const showAll = page.locator('.topic-browse-actions button:has-text("Show all")');
  if (await showAll.count()) await showAll.click();
}
async function openTopic(page) {
  await page.click('.hw-sections button:has-text("Study")');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("HSK 2 — Time")').first().click();
  // Wait for the asynchronous topic data: the browse actions do not exist until cards load.
  // Checking Show all before that point leaves the table collapsed and times out on rows.
  await page.locator(".topic-browse-hub").waitFor();
  await showAllIfAvailable(page);
  await page.locator(".modern-topic-row").first().waitFor();
  await page.waitForTimeout(500);
}
const stageCount = async (page, stage) => Number(await page.locator(`[data-stage="${stage}"] strong`).innerText());
const gradeCount = async (extra = "") => Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES} ${extra}`));
const termOf = async (cardId) => sql(`select data->>'term' from heuresis_cards where id='${cardId}'`);
async function openPopup(context, query) {
  const popup = await context.newPage();
  await popup.goto(`${BASE}?cosmos=1&mode=review&pack=${HSK}&${query}`);
  await popup.locator(".cosmos-count").waitFor({ timeout: 15000 });
  await popup.waitForTimeout(300);
  return popup;
}
/** The card and direction on screen. */
async function current(popup) {
  const article = popup.locator(".cosmos-card");
  return { cardId: await article.getAttribute("data-card-id"), templateId: await article.getAttribute("data-template-id") };
}
async function revealAndGrade(popup, key) {
  // A checked Say/Write input keeps focus; space there must not toggle the control.
  // Blur it first so the session's keyboard shortcut reveals the actual card.
  await popup.evaluate(() => document.activeElement?.blur?.());
  await popup.keyboard.press(" ");
  await popup.locator(".cosmos-results").waitFor({ timeout: 15000 }).catch(async (error) => {
    console.log("  reveal diagnostic:", JSON.stringify(await popup.evaluate(() => ({ online: navigator.onLine,
      active: document.activeElement?.outerHTML?.slice(0, 300),
      card: document.querySelector(".cosmos-card")?.textContent?.slice(0, 250),
      state: document.querySelector(".cosmos-state")?.textContent,
      notice: document.querySelector(".cosmos-notice")?.textContent,
      buttons: [...document.querySelectorAll(".cosmos-card button")].slice(0, 12).map((b) => ({ text: b.textContent?.trim().slice(0, 30), disabled: b.disabled })) }))));
    throw error;
  });
  await popup.keyboard.press(key);
  await popup.waitForTimeout(350);
}
async function waitFor(condition, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await condition()) return true; await new Promise((resolve) => setTimeout(resolve, 400)); }
  return false;
}

const scenarios = {
  async "sort → review → grading: chosen session size and overall summary"(page, context) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    const first = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("c");
    await page.waitForTimeout(700);
    const second = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("p");
    await page.waitForTimeout(700);
    check(await sql(`select interest_rank from heuresis_cards where data->>'term'='${first}'`) === "5", "Core is stored as rank 5");
    check(await sql(`select interest_rank from heuresis_cards where data->>'term'='${second}'`) === "1", "Passive is stored as rank 1");
    await page.click('.sort-finished-actions button:has-text("Review now")');
    await page.locator(".review-controls").waitFor();
    await page.getByRole("group", { name: "Number of cards" }).getByRole("button", { name: "5" }).click();
    const popupOpened = context.waitForEvent("page");
    await page.locator(".study-start").click();
    const popup = await popupOpened;
    await popup.locator(".cosmos-count").waitFor({ timeout: 15000 });
    const total = Number((await popup.locator(".cosmos-count").innerText()).split("/")[1]);
    check(total > 0 && total <= 5, "Chosen review size is enforced without repeating cards");
    const before = await gradeCount();
    for (let step = 0; step < total; step++) {
      await popup.keyboard.press(" ");
      await popup.locator(".cosmos-results").waitFor();
      if (step === 0) {
        check((await popup.locator(".cosmos-results button b").allInnerTexts()).join(",") === "Missed,Partial,Known,Easy",
          "Ratings are Missed, Partial, Known and Easy");
        await popup.screenshot({ path: `${shots}/review-revealed.png` });
      }
      await popup.keyboard.press(step === 0 ? "1" : "3");
      await popup.waitForTimeout(250);
    }
    await popup.locator(".cosmos-summary").waitFor();
    check(await waitFor(async () => await gradeCount() - before === total), "Every completed grade is persisted");
    const summary = await popup.locator(".cosmos-summary-lines").innerText();
    check(/cards reviewed/.test(summary) && /bars gained/.test(summary) && /Mastered/.test(summary),
      "Summary shows only totals, bar movements and newly Mastered cards");
    check(await popup.locator('.cosmos-summary-actions button:has-text("10 more")').count() === 0, "No unexpected session extension");
    check(await popup.locator('.cosmos-summary-actions button:has-text("Retry")').count() === 1, "Missed cards can be retried on demand");
    await popup.close();
  },

  async "session size is fixed until a new review is chosen"(page, context) {
    const popup = await openPopup(context, "source=all&count=5&order=random&mastered=1");
    const total = Number((await popup.locator(".cosmos-count").innerText()).split("/")[1]);
    check(total > 0 && total <= 5, "Session shows no more than the selected five cards");
    for (let step = 0; step < total; step += 1) await revealAndGrade(popup, "3");
    await popup.locator(".cosmos-summary").waitFor();
    check(await popup.locator('.cosmos-summary-actions button:has-text("10 more")').count() === 0,
      "Five-card session ends at five without automatic extension");
    await popup.close();
  },

  async "discard is recoverable through undo and trash"(page) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    const first = (await page.locator(".sort-card > strong").innerText()).trim();
    const discarded = () => sql(`select (data->>'_discarded_at') is not null from heuresis_cards where data->>'term'='${first}'`);
    await page.keyboard.press("d");
    await page.waitForTimeout(800);
    check(await discarded() === "t", `D discards ${first} (kept in the database)`);
    check((await page.locator(".sort-undo").innerText()).includes(first), "an Undo bar names the discarded card");
    await page.click(".sort-undo button");
    await page.waitForTimeout(800);
    check(await discarded() === "f", "Undo restores it");
    check((await page.locator(".sort-card > strong").innerText()).trim() === first, "and brings it back as the current card");
    await page.keyboard.press("d");
    await page.waitForTimeout(800);
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(800);
    check(await discarded() === "f", "Ctrl+Z also undoes a discard");
    await page.keyboard.press("d");
    await page.waitForTimeout(800);
    await page.keyboard.press("l");
    await page.waitForTimeout(400);
    check(/1 discarded \(in Trash\)/.test(await page.locator(".sort-finished").innerText()), "the summary says where discarded cards went");
    await page.click('.sort-finished-actions button:has-text("Return to topic")');
    await page.waitForTimeout(800);
    check(await page.locator(`.modern-topic-row:has-text("${first}")`).count() === 0, "a discarded card leaves the topic");
    check(/^6 cards/.test(await page.locator(".pack-record").innerText()), "the topic count leaves it out");
    await page.click('.desktop-nav-group button:has-text("Library")');
    await page.waitForTimeout(1000);
    const libraryRow = await page.locator('.library-resume-topics button:has-text("HSK 2 — Time") small').innerText();
    check(/^6 CARDS/i.test(libraryRow), `the Library count leaves it out too (“${libraryRow}”)`);
    await openTopic(page);
    check(await stageCount(page, "unsorted") === 1, "the card left for later is still unsorted");

    await page.click(".desktop-account-menu > summary");
    await page.locator(".desktop-account-data > summary").click();
    await page.click('.desktop-account-data-items button:has-text("Trash & export")');
    const row = page.locator(`.ws-dialog :text("${first}")`).first();
    await row.waitFor({ timeout: 10000 });
    check(true, "Trash lists the discarded card");
    await page.screenshot({ path: `${shots}/trash.png` });
    await page.locator('.ws-dialog button:has-text("Restore")').first().click();
    check(await waitFor(async () => await discarded() === "f"), "Restore in Trash brings it back");
    await page.locator('.ws-dialog :text("is back in")').waitFor();
    await page.keyboard.press("Escape");
    check(await page.locator(".knowledge-trash").count() === 0, "Escape still closes Trash after the restored row disappears");
    await page.waitForTimeout(1200);
    check(await waitFor(async () => await page.locator(`.modern-topic-row:has-text("${first}")`).count() === 1), "the restored card is back in the topic");

    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    for (let guard = 0; guard < 3 && (await page.locator(".sort-card > strong").innerText()).trim() !== first; guard += 1) { await page.keyboard.press("l"); await page.waitForTimeout(300); }
    await page.keyboard.press("d");
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    await page.click(".desktop-account-menu > summary");
    await page.locator(".desktop-account-data > summary").click();
    await page.click('.desktop-account-data-items button:has-text("Trash & export")');
    await page.locator(`.ws-dialog :text("${first}")`).first().waitFor({ timeout: 10000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator('.ws-dialog button:has-text("Delete permanently")').first().click();
    check(await waitFor(async () => await sql(`select count(*) from heuresis_cards where data->>'term'='${first}'`) === "0"), "Delete permanently (after confirmation) removes it for good");
  },

  async "typed chinese answers get suggested results and input-method enter never reveals"(page, context) {
    const popup = await openPopup(context, `source=all&count=5&order=pack&mastered=1&templates=${PRO}`);
    await popup.locator('.cosmos-recall-methods button:has-text("Type")').click();
    const textarea = popup.locator(".cosmos-inline-typing");
    await textarea.waitFor();
    check(true, "Typing it shows an answer field in the session");
    const answers = [];
    const count = Number((await popup.locator(".cosmos-count").innerText()).split("/")[1]);
    check(count >= 4 && count <= 5, "Typed-answer checks have at least four eligible cards");
    for (let step = 0; step < count; step += 1) {
      const { cardId } = await current(popup);
      const term = await termOf(cardId);
      const reading = await sql(`select data->>'reading' from heuresis_cards where id='${cardId}'`);
      await textarea.waitFor();
      if (step === 0) {
        // Enter that confirms an input-method candidate (isComposing / keyCode 229) must never reveal.
        await textarea.focus();
        await popup.evaluate(() => {
          const field = document.querySelector(".cosmos-inline-typing");
          field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true, isComposing: true }));
          field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 229, bubbles: true, cancelable: true }));
        });
        await popup.waitForTimeout(400);
        check(await popup.locator(".cosmos-results").count() === 0, "Enter during IME composition does not reveal the answer");
        await textarea.focus();
        await popup.keyboard.insertText(term); // what an IME commits
      } else if (step === 1) {
        await textarea.fill(NUMBERED[term] ?? term);
      } else if (step === 2) {
        await textarea.fill(reading.normalize("NFD").replace(/[̀-ͯ]/g, ""));
      } else if (step === 3) {
        await textarea.fill("完全不对");
      } else {
        await textarea.fill("");
      }
      const graded = await gradeCount();
      await textarea.press("Enter");
      await popup.locator(".cosmos-results").waitFor();
      const suggestion = await popup.locator(".cosmos-suggestion b").count() ? await popup.locator(".cosmos-suggestion b").innerText() : "";
      answers.push({ term, suggestion });
      check(await gradeCount() === graded, `revealing records no result by itself (${term})`);
      if (suggestion) check((await popup.locator(".cosmos-results button.is-suggested").innerText()).startsWith(suggestion), "the suggested result is highlighted, not chosen");
      if (step === 0) await popup.screenshot({ path: `${shots}/typed-suggestion.png` });
      // The learner decides: on the first card, override the suggestion with Secure.
      await popup.keyboard.press(step === 0 ? "4" : "3");
      await popup.waitForTimeout(400);
    }
    check(answers[0].suggestion === "Known", `the characters committed by an IME are Recalled (${answers[0].term}: ${answers[0].suggestion})`);
    check(answers[1].suggestion === "Partial", `numbered pinyin is Partial (${answers[1].term}: ${answers[1].suggestion})`);
    check(answers[2].suggestion === "Partial", `pinyin without tones is Partial (${answers[2].term}: ${answers[2].suggestion})`);
    check(answers[3].suggestion === "Missed", `a wrong word is Missed (${answers[3].term}: ${answers[3].suggestion})`);
    if (answers.length > 4) check(answers[4].suggestion === "", "an empty answer gets no suggestion");
    check(await sql(`select event_type from heuresis_card_events where event_type in ${GRADES} order by created_at, id limit 1 offset (select count(*) - 5 from heuresis_card_events where event_type in ${GRADES})`) === "easy",
      "the learner's own choice (Secure) is what is recorded, not the suggestion");
    await popup.close();
  },

  async "offline recovery: sort, discard and review results made offline reach the server"(page, context) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    const first = (await page.locator(".sort-card > strong").innerText()).trim();
    await context.setOffline(true);
    await page.keyboard.press("c");
    await page.waitForTimeout(900);
    const second = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("d");
    await page.waitForTimeout(900);
    check(/2 cards decided/.test(await page.locator(".sort-finished").innerText()), "Sort keeps working offline");
    check(await page.locator(".sort-error").count() === 0, "without error messages");
    check(await sql(`select (data->>'_sorted_at') is null from heuresis_cards where data->>'term'='${first}'`) === "t", "nothing has reached the server yet");
    await page.click('.sort-finished-actions button:has-text("Return to topic")');
    await page.waitForTimeout(1200);
    check(await stageCount(page, "unsorted") === 0, "the offline topic shows both decisions");
    check(await page.locator(`.modern-topic-row:has-text("${second}")`).count() === 0, "the card discarded offline is hidden");
    await context.setOffline(false);
    check(await waitFor(async () => await sql(`select interest_rank||'|'||((data->>'_sorted_at') is not null) from heuresis_cards where data->>'term'='${first}'`) === "5|true"),
      "after reconnecting the Core decision is on the server");
    check(await waitFor(async () => await sql(`select (data->>'_discarded_at') is not null from heuresis_cards where data->>'term'='${second}'`) === "t"),
      "and so is the discard");

    const popup = await openPopup(context, "source=recommended&count=20&order=pack");
    const before = await gradeCount();
    await context.setOffline(true);
    for (const key of ["3", "1", "2"]) await revealAndGrade(popup, key);
    const nextCard = await popup.locator(".cosmos-card").count() === 1 && (await popup.locator(".cosmos-count").innerText()).startsWith("4 /");
    const sessionFinished = await popup.locator(".cosmos-summary").count() === 1;
    check(nextCard || sessionFinished, "Review continues offline, including when the chosen session ends after three cards");
    await page.waitForTimeout(1000);
    check(await gradeCount() === before, "offline results wait on the device");
    await context.setOffline(false);
    check(await waitFor(async () => await gradeCount() - before === 3, 20000), "after reconnecting all three results reach the server");
    check(Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES} and template_id is null`)) === Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES} and template_id is null and created_at < now() - interval '10 minutes'`)),
      "with their directions");
    await popup.close();
  },

  async "review remembers card count and one of three order choices"(page, context) {
    await openTopic(page);
    await page.locator(".review-command").click();
    await page.locator(".review-controls").waitFor();
    await page.getByRole("group", { name: "Number of cards" }).getByRole("button", { name: "5" }).click();
    await page.getByRole("group", { name: "Review card order" }).getByRole("button", { name: "Random" }).click();
    let opened = context.waitForEvent("page");
    await page.click(".study-start");
    let popup = await opened;
    await popup.locator(".cosmos-count").waitFor({ timeout: 15000 });
    const launched = new URL(popup.url());
    const count = Number(launched.searchParams.get("count"));
    check(launched.searchParams.get("order") === "random" && count > 0 && count <= 5,
      "Review launches with Random order and at most the selected five cards");
    await popup.close();
    await page.locator(".review-command").click();
    await page.locator(".review-controls").waitFor();
    check(await page.getByRole("group", { name: "Number of cards" }).getByRole("button", { name: "5" }).getAttribute("aria-pressed") === "true",
      "Five-card choice is remembered");
    check(await page.getByRole("group", { name: "Review card order" }).getByRole("button", { name: "Random" }).getAttribute("aria-pressed") === "true",
      "Random order is remembered");
    await page.keyboard.press("Escape");
  },

  async "topic shows unified bars and intended-use classifications"(page) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    const later = (await page.locator(".sort-card > strong").innerText()).trim();
    const previousCardId = await page.locator(".sort-card").getAttribute("data-card-id");
    await page.locator('.sort-quiet-actions button:has-text("Sort Later")').click();
    await page.waitForFunction((previous) => document.querySelector(".sort-card")?.getAttribute("data-card-id") !== previous, previousCardId);
    const active = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.locator(".sort-rating button:has-text('Active')").click();
    await page.locator(".sort-finished").waitFor();
    await page.locator('.sort-finished-actions button:has-text("Return to topic")').click();
    await showAllIfAvailable(page);
    const row = page.locator(`.modern-topic-row:has-text("${active}")`);
    check(await row.locator(".importance-badge").innerText() === "Active", "Previously Useful is now displayed as Active");
    check(await row.locator(".card-progress-bars > span").count() === 4, "Each card shows exactly four progress bars");
    check((await row.locator(".card-progress > small").innerText()) === "New", "A sorted card with no graded reviews is New");
    const pending = page.locator(`.modern-topic-row:has-text("${later}")`);
    check((await pending.locator(".card-progress > small").innerText()) === "To sort", "Sort Later keeps the first card in the queue");
    check(await row.locator(".modern-learning-cell").count() === 1 && await row.locator(".modern-recall-cell").count() === 1,
      "Review count and Last Seen stay separate");
  },

  async "retry keeps the practice already recorded in the session"(page, context) {
    const popup = await openPopup(context, "source=all&count=2&order=weakest&mastered=1");
    const available = (await popup.locator(".cosmos-count").innerText()).trim();
    console.log(`  retry scenario: selected ${available}`);
    check(available.endsWith("/ 2"), "Retry fixture starts with two eligible cards");
    await popup.locator('.cosmos-recall-methods button:has-text("Say")').click();
    const said = async () => Number(await sql("select count(*) from heuresis_card_events where event_type = 'exercise_say'"));
    const before = await said();
    await popup.locator(".cosmos-say-check input").check();
    await revealAndGrade(popup, "1");
    await popup.locator(".cosmos-say-check input").check();
    await revealAndGrade(popup, "3");
    await popup.locator(".cosmos-summary").waitFor();
    check(await waitFor(async () => await said() === before + 2), "saying the answer aloud is recorded once per card");
    await popup.click('.cosmos-summary-actions button:has-text("Retry 1 missed or partial card")');
    await revealAndGrade(popup, "3");
    await popup.locator(".cosmos-summary").waitFor();
    await popup.waitForTimeout(1200);
    check(await said() === before + 2, "retrying the missed card neither removes nor duplicates that record");
    
    await popup.close();
  },

  async "review window: answering method and details drawer"(page, context) {
    let popup = await openPopup(context, "source=recommended&count=20&order=pack");
    await popup.locator('.cosmos-recall-methods button:has-text("Say")').click();
    check(await popup.locator(".cosmos-say-check input").count() === 1, "Say can be selected directly on the card");
    const said = Number(await sql("select count(*) from heuresis_card_events where event_type = 'exercise_say'"));
    // Selecting Say alone must not count as practice.
    await popup.keyboard.press(" ");
    await popup.locator(".cosmos-results").waitFor();
    check(Number(await sql("select count(*) from heuresis_card_events where event_type = 'exercise_say'")) === said,
      "selecting Say without speaking does not record false practice");
    await popup.keyboard.press("d");
    await popup.locator(".cosmos-details").waitFor();
    check(await popup.locator(".cosmos-details-section, .cosmos-details-empty").count() >= 1, "D opens optional context after the answer");
    await popup.keyboard.press("3");
    await popup.waitForTimeout(400);
    check(await popup.locator(".cosmos-details").count() === 0, "context does not expose the next question's answer");
    await popup.evaluate(() => document.activeElement?.blur?.());
    await popup.keyboard.press(" ");
    await popup.locator(".cosmos-results").waitFor();
    check(await popup.locator(".cosmos-details").count() === 1, "chosen context returns after the next reveal");
    await popup.close();
    popup = await openPopup(context, "source=recommended&count=20&order=pack");
    check(await popup.locator(".cosmos-recall-methods button:has-text('Say')").getAttribute("aria-pressed") === "true",
      "answering method is remembered for the direction");
    await popup.locator('.cosmos-recall-methods button:has-text("Think")').click();
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
    const unexpected = errors.filter((message) => !/status of 406|Failed to load resource|ERR_CONNECTION_REFUSED|ERR_INTERNET_DISCONNECTED|Failed to fetch/.test(message));
    check(!unexpected.length, `no page errors${unexpected.length ? `: ${unexpected.join(" | ")}` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}: ${error instanceof Error ? error.stack ?? error.message : error}`);
    await page.screenshot({ path: `${shots}/failure-${name.split(" ")[0]}.png` }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
if (failures) console.log(`${failures} scenario(s) stopped with an exception.`);
