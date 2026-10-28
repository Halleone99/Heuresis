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
async function openTopic(page) {
  await page.click('.hw-sections button:has-text("Study")');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("HSK 2 — Time")').first().click();
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
  await popup.keyboard.press(" ");
  await popup.locator(".cosmos-results").waitFor();
  await popup.keyboard.press(key);
  await popup.waitForTimeout(350);
}
async function waitFor(condition, timeout = 12000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await condition()) return true; await new Promise((resolve) => setTimeout(resolve, 400)); }
  return false;
}

const scenarios = {
  async "sort → review → grading: one click, recommended, explained and summarised"(page, context) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    const first = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("c");
    await page.waitForTimeout(800);
    const second = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("p");
    await page.waitForTimeout(800);
    check(await sql(`select interest_rank||'|'||retention||'|'||((data->>'_sorted_at') is not null) from heuresis_cards where data->>'term'='${first}'`) === "5|learning|true", `C learns ${first} as Core (stored as 5)`);
    check(await sql(`select interest_rank from heuresis_cards where data->>'term'='${second}'`) === "1", `P learns ${second} as Peripheral (stored as 1)`);
    check(/2 cards decided/.test(await page.locator(".sort-finished").innerText()), "the pass ends with a summary of the decisions");
    const popupOpened = context.waitForEvent("page");
    await page.click('.sort-finished-actions button:has-text("Review now")');
    const popup = await popupOpened;
    await popup.locator(".cosmos-count").waitFor({ timeout: 15000 });
    await popup.waitForTimeout(400);
    check(/source=recommended/.test(popup.url()), "Review starts a recommended session without a setup step");
    const total = Number((await popup.locator(".cosmos-count").innerText()).split("/")[1]);
    check(total === 14, `the session covers both directions of the seven Learning cards (default 20, here ${total})`);
    await popup.click(".cosmos-why");
    const reasons = await popup.locator(".cosmos-why-panel li").allInnerTexts();
    check(reasons.length >= 1 && reasons.every((reason) => reason.length > 8), `"Why?" explains the recommendation (“${reasons.join(" ")}”)`);
    await popup.click(".cosmos-why");
    await popup.screenshot({ path: `${shots}/review-front.png` });

    const seen = [];
    const before = await gradeCount();
    for (let step = 0; step < total; step += 1) {
      seen.push(await current(popup));
      await popup.keyboard.press(" ");
      await popup.locator(".cosmos-results").waitFor();
      if (step === 0) {
        check((await popup.locator(".cosmos-results button b").allInnerTexts()).join(",") === "Missed,Partial,Recalled,Secure",
          "results are Missed / Partial / Recalled / Secure");
        check(await popup.locator(".cosmos-core-field.is-recap").count() >= 1, "the question stays visible above the revealed answer");
        await popup.screenshot({ path: `${shots}/review-revealed.png` });
      }
      await popup.keyboard.press(step === 0 ? "1" : step === 1 ? "4" : "3");
      await popup.waitForTimeout(300);
    }
    await popup.locator(".cosmos-summary").waitFor();
    check(await waitFor(async () => await gradeCount() - before === total), `every result is recorded (${total})`);
    check(Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES} and template_id is null and created_at > now() - interval '5 minutes'`)) === 0,
      "every result is recorded with its direction");
    const keys = seen.map((entry) => `${entry.cardId}:${entry.templateId}`);
    check(new Set(keys).size === keys.length, "no card and direction is asked twice in one session");
    check(seen.every((entry, index) => index === 0 || entry.cardId !== seen[index - 1].cardId), "the opposite direction of a card never follows it immediately");
    check(new Set(seen.map((entry) => entry.templateId)).size === 2, "both directions are recommended");
    const summary = await popup.locator(".cosmos-summary-lines").innerText();
    check(/You reviewed 14 cards: 13 recalled or secure, 0 partial, 1 missed\./.test(summary), "the summary states the results in words");
    check(/recogni/i.test(summary) && /produc/i.test(summary), "the summary compares recognition and production");
    check(/Missed: /.test(summary), "the summary names the missed word");
    await popup.screenshot({ path: `${shots}/review-summary.png` });
    check(await popup.locator('.cosmos-summary-actions button:has-text("10 more")').count() === 0, "10 more is not offered when nothing else is left to recommend");
    await popup.click('.cosmos-summary-actions button:has-text("Retry 1 missed or partial card")');
    await popup.locator(".cosmos-card").waitFor();
    check((await popup.locator(".cosmos-count").innerText()).trim() === "1 / 1", "Retry missed asks only the missed card");
    const retried = await current(popup);
    check(retried.cardId === seen[0].cardId && retried.templateId === seen[0].templateId, "in the same direction it was missed");
    await revealAndGrade(popup, "3");
    await popup.locator(".cosmos-summary").waitFor();
    const afterRetry = await popup.locator(".cosmos-summary-lines").innerText();
    check(/You reviewed 14 cards: 13 recalled or secure, 0 partial, 1 missed\./.test(afterRetry) && /On retry, 1 of 1 was recalled\./.test(afterRetry),
      "after a retry the summary still counts each card once and reports the retry separately");
    check(await popup.locator('.cosmos-summary-actions button:has-text("Retry")').count() === 0 && await popup.locator('.cosmos-summary-actions button:has-text("Done")').count() === 1,
      "after the retry only Done remains");
    await popup.close();
  },

  async "ten more continues with new recommendations and never repeats"(page, context) {
    const popup = await openPopup(context, "source=recommended&count=5&order=pack");
    const first = [];
    for (let step = 0; step < 5; step += 1) { first.push(await current(popup)); await revealAndGrade(popup, "3"); }
    await popup.locator(".cosmos-summary").waitFor();
    const more = popup.locator('.cosmos-summary-actions button:has-text("10 more")');
    check(await more.count() === 1, "10 more is offered at the end of a session");
    await more.click();
    await popup.locator(".cosmos-card").waitFor();
    const remaining = Number((await popup.locator(".cosmos-count").innerText()).split("/")[1]);
    check(remaining === 5, `the next round has the five remaining recommendations (got ${remaining})`);
    const keys = new Set(first.map((entry) => `${entry.cardId}:${entry.templateId}`));
    let repeated = false;
    for (let step = 0; step < remaining; step += 1) {
      const entry = await current(popup);
      if (keys.has(`${entry.cardId}:${entry.templateId}`)) repeated = true;
      await revealAndGrade(popup, "3");
    }
    check(!repeated, "no card and direction from the first round is repeated");
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

    await page.click(".desktop-account-menu summary");
    await page.click('button:has-text("Trash & export")');
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
    await page.click(".desktop-account-menu summary");
    await page.click('button:has-text("Trash & export")');
    await page.locator(`.ws-dialog :text("${first}")`).first().waitFor({ timeout: 10000 });
    page.once("dialog", (dialog) => void dialog.accept());
    await page.locator('.ws-dialog button:has-text("Delete permanently")').first().click();
    check(await waitFor(async () => await sql(`select count(*) from heuresis_cards where data->>'term'='${first}'`) === "0"), "Delete permanently (after confirmation) removes it for good");
  },

  async "typed chinese answers get suggested results and input-method enter never reveals"(page, context) {
    const popup = await openPopup(context, `source=all&count=5&order=pack&templates=${PRO}`);
    await popup.locator('.cosmos-recall-methods button:has-text("Type")').click();
    const textarea = popup.locator(".cosmos-inline-typing");
    await textarea.waitFor();
    check(true, "Typing it shows an answer field in the session");
    const answers = [];
    for (let step = 0; step < 5; step += 1) {
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
    check(answers[0].suggestion === "Recalled", `the characters committed by an IME are Recalled (${answers[0].term}: ${answers[0].suggestion})`);
    check(answers[1].suggestion === "Partial", `numbered pinyin is Partial (${answers[1].term}: ${answers[1].suggestion})`);
    check(answers[2].suggestion === "Partial", `pinyin without tones is Partial (${answers[2].term}: ${answers[2].suggestion})`);
    check(answers[3].suggestion === "Missed", `a wrong word is Missed (${answers[3].term}: ${answers[3].suggestion})`);
    check(answers[4].suggestion === "", "an empty answer gets no suggestion");
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
    check(await popup.locator(".cosmos-card").count() === 1 && (await popup.locator(".cosmos-count").innerText()).startsWith("4 /"), "Review continues offline");
    await page.waitForTimeout(1000);
    check(await gradeCount() === before, "offline results wait on the device");
    await context.setOffline(false);
    check(await waitFor(async () => await gradeCount() - before === 3, 20000), "after reconnecting all three results reach the server");
    check(Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES} and template_id is null`)) === Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES} and template_id is null and created_at < now() - interval '10 minutes'`)),
      "with their directions");
    await popup.close();
  },

  async "adjust remembers choices and review reuses them in one click"(page, context) {
    await openTopic(page);
    await page.click(".review-adjust");
    await page.locator(".review-controls").waitFor();
    await page.getByRole("button", { name: "One direction" }).click();
    await page.locator(".direction-detail select").selectOption(PRO);
    await page.locator(".compact-cards-select select").selectOption("all");
    let opened = context.waitForEvent("page");
    await page.click(".study-start");
    let popup = await opened;
    await popup.locator(".cosmos-count").waitFor({ timeout: 15000 });
    check(popup.url().includes(`templates=${PRO}`) && popup.url().includes("source=all"), "Adjust starts the session it describes");
    await popup.close();
    await page.click(".review-adjust");
    await page.locator(".review-controls").waitFor();
    check(await page.getByRole("button", { name: "One direction" }).getAttribute("aria-pressed") === "true", "Adjust remembers One direction");
    check(await page.locator(".direction-detail select").inputValue() === PRO, "and which direction");
    check(await page.locator(".compact-cards-select select").inputValue() === "all", "and which cards");
    await page.keyboard.press("Escape");
    opened = context.waitForEvent("page");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    popup = await opened;
    await popup.locator(".cosmos-count").waitFor({ timeout: 15000 });
    check(popup.url().includes("source=recommended") && popup.url().includes(`templates=${PRO}`), "one-click Review stays recommended and uses the remembered direction");
    check((await current(popup)).templateId === PRO, "the session shows that direction");
    await popup.close();
  },

  async "topic shows unsorted, learning and reference, evidence states and importance"(page) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    const reference = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("r");
    await page.waitForTimeout(800);
    const useful = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("u");
    await page.waitForTimeout(800);
    await page.click('.sort-finished-actions button:has-text("Return to topic")');
    await page.waitForTimeout(1000);
    const counts = [await stageCount(page, "unsorted"), await stageCount(page, "learning"), await stageCount(page, "reference")];
    check(counts.join("/") === "0/6/1", `stages read Unsorted 0 → Learning 6 · Reference 1 (got ${counts.join("/")})`);
    await page.click('[data-stage="reference"]');
    await page.waitForTimeout(400);
    check(await page.locator(".modern-topic-row").count() === 1 && await page.locator(`.modern-topic-row.is-reference:has-text("${reference}")`).count() === 1, "the Reference filter shows the reference card");
    await page.click('[data-stage="reference"]');
    await page.waitForTimeout(300);
    const newRow = page.locator(`.modern-topic-row:has-text("${useful}")`);
    check((await newRow.locator(".knowledge-states").innerText()).match(/Not tried/g)?.length === 2, "a new Learning card is Not tried in both directions");
    check(await newRow.locator(".importance-badge").innerText() === "Useful", "and shows its importance as Useful");
    const oldRow = page.locator('.modern-topic-row:has-text("以前")');
    const oldStates = await oldRow.locator(".knowledge-states").innerText();
    check(/(?:中 → EN|New|Developing|Holding|Strong|Needs work)/i.test(oldStates), `results recorded before directions existed still count for the default direction (“${oldStates.replace(/\s+/g, " ")}”)`);
    check(/PRODUCE\s*Not tried/i.test(oldStates), "while the other direction is honestly Not tried");
    await page.screenshot({ path: `${shots}/topic-states.png`, fullPage: true });
    await page.click('[data-stage="reference"]');
    await page.waitForTimeout(300);
    await page.locator(".modern-topic-row").first().dblclick();
    await page.locator(".card-editor-modal").waitFor();
    await page.locator('.card-editor-modal button:has-text("Move to Learning")').click();
    check(await waitFor(async () => await sql(`select retention||'|'||((data->>'_sorted_at') is not null) from heuresis_cards where data->>'term'='${reference}'`) === "learning|true"),
      "a reference card can be moved to Learning from its editor (into Learning, not back to Unsorted)");
  },

  async "retry keeps the practice already recorded in the session"(page, context) {
    const popup = await openPopup(context, "source=recommended&count=2&order=pack");
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
    console.log(`  ✗ ${name}: ${error instanceof Error ? error.message.split("\n")[0] : error}`);
    await page.screenshot({ path: `${shots}/failure-${name.split(" ")[0]}.png` }).catch(() => undefined);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
if (failures) console.log(`${failures} scenario(s) stopped with an exception.`);
