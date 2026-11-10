// Browser and database checks for Learn (five-exercise rounds; migration
// 20261110120000_heuresis_learn_rounds.sql). Each scenario starts from a fresh copy of
// the v2 baseline database and drives the real app against PostgREST with real RLS.
//   node tests/learn.mjs              (all scenarios)
//   node tests/learn.mjs refresh      (scenarios whose name contains "refresh")
// Screenshots go to screenshots/learn/.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { BASE, check, launch, signIn, sql } from "./lib.mjs";
import { TABLET, fingerTap, launchTablet, reachableNow, signInTablet, webviewDestroyed } from "./android-lib.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const shots = `${here}screenshots/learn`;
mkdirSync(shots, { recursive: true });
const only = process.argv[2] ?? "";
const USER = "11111111-1111-4111-8111-111111111111";
const HSK = "a0000000-0000-4000-8000-000000000001";
const GERMAN = "a0000000-0000-4000-8000-000000000003";
const RUSSIAN = "a0000000-0000-4000-8000-000000000009";
const GRADES = "('again','hard','good','easy')";
const GATEWAY = process.env.HEURESIS_GATEWAY ?? "http://localhost:54321";

/** A signed session for direct REST calls (what a replayed or hand-made request would send). */
function token(sub = USER) {
  const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600 })}`;
  const secret = process.env.JWT_SECRET ?? "local-heuresis-test-secret-at-least-32-chars";
  return `${body}.${crypto.createHmac("sha256", secret).update(body).digest("base64url")}`;
}
async function rest(method, path, body, sub = USER) {
  const response = await fetch(`${GATEWAY}/rest/v1/${path}`, {
    method, headers: { authorization: `Bearer ${token(sub)}`, "content-type": "application/json", prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
const rpc = (name, body, sub) => rest("POST", `rpc/${name}`, body, sub);

function restore(snapshot = "heuresis_v2_baseline") {
  execFileSync("./db.sh", ["restore", snapshot], { cwd: here, stdio: "ignore" });
}

/** German and Russian cards with the data the language-specific exercises use. */
async function seed() {
  // created_at is spaced out so that the cards have a fixed order (topics list cards oldest first).
  await sql(`insert into heuresis_cards(user_id, pack_id, data, created_at) values
    ('${USER}','${GERMAN}','{"term":"die Entwicklung, -en","meaning":"development","example":"Die Entwicklung dauert zwei Jahre.","example_translation":"The development takes two years."}', now() + interval '1 second'),
    ('${USER}','${GERMAN}','{"term":"der Vorschlag, ¨-e","meaning":"suggestion; proposal"}', now() + interval '2 seconds'),
    ('${USER}','${GERMAN}','{"term":"anrufen","meaning":"to call (by phone)","example":"Ich rufe dich morgen an.","example_translation":"I will call you tomorrow."}', now() + interval '3 seconds'),
    ('${USER}','${GERMAN}','{"term":"teilnehmen an","meaning":"to take part in"}', now() + interval '4 seconds')`);
  await sql(`insert into heuresis_collections(id, user_id, title, accent, glyph, sort_order)
    values ('c0000000-0000-4000-8000-000000000009','${USER}','Russian','indigo','Я',2)`);
  await sql(`insert into heuresis_packs(id, user_id, collection_id, card_type_id, title, sort_order)
    values ('${RUSSIAN}','${USER}','c0000000-0000-4000-8000-000000000009','00000000-0000-4000-8000-000000000002','A2 — Verbs',0)`);
  await sql(`insert into heuresis_cards(user_id, pack_id, data) values
    ('${USER}','${RUSSIAN}','{"term":"говорить","reading":"говори́ть","meaning":"to speak; to talk","example":"Я говорю по-русски.","example_translation":"I speak Russian."}'),
    ('${USER}','${RUSSIAN}','{"term":"понимать","reading":"понима́ть","meaning":"to understand"}'),
    ('${USER}','${RUSSIAN}','{"term":"молоко","reading":"молоко́","meaning":"milk"}'),
    ('${USER}','${RUSSIAN}','{"term":"город","reading":"го́род","meaning":"city; town"}'),
    ('${USER}','${RUSSIAN}','{"term":"читать","reading":"чита́ть","meaning":"to read"}')`);
}

const cardId = (term) => sql(`select id from heuresis_cards where data->>'term' = '${term}'`);
const phaseOf = async (term) => JSON.parse(await sql(`select coalesce(data->>'_acquisition_v1','{"phase":"none","cycle":0}') from heuresis_cards where data->>'term' = '${term}'`));
const gradeCount = async (where = "") => Number(await sql(`select count(*) from heuresis_card_events where event_type in ${GRADES} ${where}`));

/** Puts cards into Learn the way Sort does (sorted, phase = learning, first cycle). */
async function sendToLearn(...terms) {
  for (const term of terms) {
    const state = JSON.stringify({ phase: "learning", cycle: 1, completed: [], history: [{ at: new Date().toISOString(), cycle: 1, kind: "enter_learning", reason: "new" }] });
    await sql(`update heuresis_cards set data = data || jsonb_build_object('_sorted_at', now()::text, '_acquisition_v1', '${state.replace(/'/g, "''")}'), interest_rank = 3 where data->>'term' = '${term}'`);
  }
}

/** The phone scenario runs in a touch context: every press there is a tap, with no pointer hover. */
let touch = false;
const hit = (locator) => (touch ? locator.tap() : locator.click());

async function openStudy(page) {
  // A phone has its sections in a bar at the bottom of the screen.
  const bar = page.locator('.mobile-workspace-nav button:has-text("Study")');
  await hit(touch && await bar.isVisible().catch(() => false) ? bar : page.locator('.hw-sections button:has-text("Study")'));
  // The navigation opens while the pointer is over it; on a narrow screen it would cover the page.
  const size = page.viewportSize();
  await page.mouse.move(size.width - 4, size.height / 2);
  await page.locator(".today-study-switch").waitFor();
  await page.waitForTimeout(900);
}

async function startLearn(page) {
  await hit(page.locator('.today-study-switch button:has-text("Learn")'));
  await page.locator(".today-study-start:not([disabled])").waitFor();
  await hit(page.locator(".today-study-start"));
  await page.locator(".lrn").waitFor();
}

const stat = async (page, label) => (await page.locator(`.today-study-stat:has(span:text-is("${label}")) strong`).innerText()).trim();

/** The round on screen, as the server stored it. */
async function activeRound(term) {
  const row = await sql(`select r.id || '|' || r.plan::text from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id
    where r.status = 'active' ${term ? `and c.data->>'term' = '${term}'` : ""} order by r.started_at desc limit 1`);
  const at = row.indexOf("|");
  return { id: row.slice(0, at), plan: JSON.parse(row.slice(at + 1)) };
}

async function waitExercise(page, position) {
  await page.locator(`.lrn-step:has-text("Exercise ${position}/5")`).waitFor({ timeout: 10000 });
  await page.locator(".lrn-stage:not(.is-summary)").waitFor();
}

/** Answers the exercise on screen, rightly or wrongly, using the stored plan. */
async function answer(page, exercise, right = true, { keyboard = false } = {}) {
  if (exercise.format === "choice") {
    const target = exercise.choices.find((choice) => (choice.id === exercise.answerId) === right);
    if (keyboard) await page.keyboard.press(String(exercise.choices.indexOf(target) + 1));
    else await hit(page.locator(".lrn-choice").filter({ has: page.getByText(target.label, { exact: true }) }).first());
  } else if (exercise.format === "build") {
    const order = right ? exercise.answer : [...exercise.answer].reverse().concat(exercise.tiles.map((tile) => tile.text).filter((text) => !exercise.answer.includes(text)).slice(0, 1));
    for (const text of order) await hit(page.locator(".lrn-tiles .lrn-tile:not([disabled])").filter({ hasText: new RegExp(`^\\s*${text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`) }).first());
    if (keyboard) await page.keyboard.press("Enter"); else await hit(page.locator(".lrn-check .lrn-primary"));
  } else if (exercise.format === "gaps") {
    const letters = exercise.cells.filter((cell) => cell.gap).map((cell) => cell.ch);
    if (right && keyboard) { for (const letter of letters) await page.keyboard.press(letter); await page.keyboard.press("Enter"); }
    else if (right) {
      for (const letter of letters) await hit(page.locator(".lrn-tile.is-letter:not([disabled])").filter({ hasText: new RegExp(`^${letter}$`) }).first());
      await hit(page.locator(".lrn-check .lrn-primary"));
    } else await hit(page.locator('.lrn-check button:has-text("I don’t know")'));
  } else {
    await page.fill(".lrn-input", right ? exercise.accepted[0].value : "zzz");
    await page.keyboard.press("Enter");
  }
  await page.locator(".lrn-feedback").waitFor();
}

const proceed = (page) => hit(page.locator(".lrn-feedback-actions .lrn-primary"));

/** Plays a whole round. `wrong` lists the exercise numbers to answer incorrectly. */
async function playRound(page, term, wrong = [], options = {}) {
  await waitExercise(page, 1); // the round exists on the server once its first exercise is shown
  const round = await activeRound(term);
  for (let position = 1; position <= 5; position += 1) {
    await waitExercise(page, position);
    await answer(page, round.plan[position - 1], !wrong.includes(position), options);
    await proceed(page);
  }
  await page.locator(".lrn-summary").waitFor();
  return round;
}

const points = async (page) => (await page.locator(".lrn-points").innerText()).replace(/\s+/g, " ").trim();

const scenarios = {
  async "new card → learn → five exercises → ready → review"(page) {
    await openStudy(page);
    check(await stat(page, "New cards") === "17", "New counts every unsorted card (17)");
    // NEW: classify one German card and send it to Learn.
    await page.locator('.today-study-picker-trigger').click();
    await page.locator('.today-study-picker-subject button:has-text("German")').click();
    await page.locator('.today-study-picker-topics button:has-text("B1.2 — Lesson 7")').click();
    await page.click(".today-study-start");
    await page.locator(".library-study-v2-dialog").waitFor();
    await page.fill(".library-study-v2-custom input", "1");
    await page.click(".library-study-v2-confirm");
    await page.locator(".sort-card").waitFor();
    const term = await page.locator(".sort-card strong").innerText();
    await page.keyboard.press("u");
    await page.click('.sort-save-next:has-text("To Learn")');
    await page.locator(".sort-finished").waitFor();
    const afterSort = await phaseOf(term);
    check(afterSort.phase === "learning" && afterSort.cycle === 1, `New → Learn: “${term}” is in Learn, first cycle`);
    check(await gradeCount() === 0, "sending a card to Learn records no review grade");
    check(await sql(`select from_state is null and to_state = 'learning' from heuresis_card_state_changes where state_kind = 'learning_phase' and card_id = '${await cardId(term)}'`) === "t",
      "the transition is in the card's server-side history, with its time");
    await page.screenshot({ path: `${shots}/01-sort-finished.png` });

    // LEARN: opens from the end of the Sort pass, one exercise per screen.
    await page.click('.sort-finished-actions button:has-text("Start Learn")');
    await page.locator(".lrn").waitFor();
    await waitExercise(page, 1);
    check(await points(page) === "0/50 points", "the points indicator starts at 0/50");
    check(await page.locator(".lrn-stage").count() === 1 && await page.locator(".lrn-prompt").count() === 1, "exactly one exercise is on screen");
    await page.screenshot({ path: `${shots}/02-exercise-1.png` });
    const round = await activeRound(term);
    check(round.plan.length === 5 && round.plan.map((item) => item.stage).join(",") === "recognition,reconstruction,completion,context,recall",
      "the round has exactly five exercises, from recognition to active recall");
    check(new Set(round.plan.map((item) => item.kind)).size === 5, `five different exercises (${round.plan.map((item) => item.kind).join(", ")})`);

    await answer(page, round.plan[0], true);
    const gained = await points(page);
    check(/^\+10 · ?10\/50 points$/.test(gained), `a correct first answer shows +10 · 10/50 (“${gained}”)`);
    check(await sql(`select count(*) || '|' || coalesce(sum(points),0) from heuresis_learn_attempts where round_id = '${round.id}'`) === "1|10", "the answer is saved at once, with 10 points");
    await page.screenshot({ path: `${shots}/03-correct.png` });
    await proceed(page);

    await waitExercise(page, 2);
    await answer(page, round.plan[1], false);
    check(/Not quite/.test(await page.locator(".lrn-feedback").innerText()), "a wrong answer says so and shows the right one");
    check(await points(page) === "10/50 points", "a wrong first answer earns 0 points");
    await page.screenshot({ path: `${shots}/04-wrong.png` });
    // Correcting it afterwards is practice: it never returns the points.
    if (await page.locator('.lrn-feedback-actions button:has-text("Try again")').count()) {
      await page.click('.lrn-feedback-actions button:has-text("Try again")');
      await page.locator(".lrn-practice").waitFor();
      await answer(page, round.plan[1], true);
      check(await points(page) === "10/50 points", "correcting the answer after feedback does not award the missed points");
      await page.waitForTimeout(400);
      check(await sql(`select correct::text || '|' || points || '|' || (corrected_at is not null) from heuresis_learn_attempts where round_id = '${round.id}' and position = 2`) === "false|0|true",
        "the first answer stays recorded as wrong (0 points); the correction is noted");
    }
    await proceed(page);
    for (const position of [3, 4, 5]) {
      await waitExercise(page, position);
      await answer(page, round.plan[position - 1], true);
      await proceed(page);
    }
    await page.locator(".lrn-summary").waitFor();
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${shots}/05-summary-ready.png` });
    const summary = await page.locator(".lrn-summary").innerText();
    check(/Learning round complete/.test(summary) && /40\s*\/ 50/.test(summary.replace(/\n/g, " ")), "the summary shows the score 40/50");
    check(/Successful exercises\s*4\/5/.test(summary.replace(/\n/g, " ")), "the summary shows 4/5 successful exercises");
    check(/Ready for Review/.test(summary), "40/50 with the final recall right is Ready for Review");
    check(await sql(`select status || '|' || score || '|' || correct_count || '|' || ready from heuresis_learn_rounds where id = '${round.id}'`) === "completed|40|4|true",
      "the round is stored as completed, 40 points, ready");
    check(await sql(`select count(*) || '|' || string_agg(position::text, '' order by position) from heuresis_learn_attempts where round_id = '${round.id}'`) === "5|12345",
      "exactly five answers are stored, one per exercise");
    check((await phaseOf(term)).phase === "learning", "the card stays in Learn until it is moved");

    // REVIEW: one obvious action; nothing is fabricated.
    const stats = await sql(`select encounter_count || '|' || study_count || '|' || again_count || '|' || hard_count || '|' || good_count || '|' || easy_count from heuresis_card_stats where card_id = '${await cardId(term)}'`);
    await page.click('.lrn-actions button:has-text("Move to Review")');
    await page.locator('.lrn-facts dd:has-text("Moved to Review")').waitFor();
    const moved = await phaseOf(term);
    check(moved.phase === "review" && moved.history.at(-1).kind === "enter_review" && moved.history.at(-1).reason === "ready", "Learn → Review: the card is in Review");
    check(await gradeCount() === 0, "moving to Review records no review grade");
    check(await sql(`select encounter_count || '|' || study_count || '|' || again_count || '|' || hard_count || '|' || good_count || '|' || easy_count from heuresis_card_stats where card_id = '${await cardId(term)}'`) === stats,
      "review statistics are untouched by Learn");
    check(await sql(`select count(*) from heuresis_cards where data->>'term' = '${term}'`) === "1", "it is still one card (same identity)");
    await page.screenshot({ path: `${shots}/06-moved.png` });
    await page.click('.lrn-actions button:has-text("Return to Learn")');
    await page.locator(".lrn").waitFor({ state: "detached" });
    await page.waitForTimeout(1500);
    await page.locator('.today-study-picker-trigger').click();
    await page.locator('.today-study-picker-menu > button:has-text("All subjects")').click();
    await page.click('.today-study-switch button:has-text("Review")');
    check(await stat(page, "Due now") === "1", "Review now has the card due; the interface updated without a reload");
    await page.click('.today-study-switch button:has-text("Learn")');
    check(await stat(page, "Learning") === "0" && await stat(page, "Exercises today") === "5", "Learn shows 0 cards learning and 5 exercises today");
    check(/5 exercises · 80% right first time/.test(await page.locator(".today-study-week").innerText()), "the learning success rate (80%) is shown with the week's exercises");
    await page.click('.today-study-switch button:has-text("New")');
    check(await stat(page, "New cards") === "16" && await stat(page, "Introduced today") === "1", "New shows 16 cards left and 1 introduced today");
    await page.screenshot({ path: `${shots}/07-library-after.png` });
  },

  async "points and readiness: 40 without recall, a hint, then a clean round"(page) {
    await sendToLearn("die Entwicklung, -en", "der Vorschlag, ¨-e", "anrufen");
    await openStudy(page);
    await page.locator('button:has-text("German")').first().click();
    await page.locator('button:has-text("B1.2 — Lesson 7")').first().click();
    await page.locator(".topic-session-control").waitFor();
    await page.locator('.topic-session-control button:has-text("Learn"):not([disabled])').waitFor();
    const learnButton = (await page.locator('.topic-session-control button:has-text("Learn")').innerText()).replace(/\s+/g, " ").trim();
    check(learnButton === "Learn 3", `the topic's Learn button counts the three cards in Learn (“${learnButton}”)`);
    await page.click('.topic-session-control button:has-text("Learn")');
    await page.locator(".lrn").waitFor();
    const term = "die Entwicklung, -en";

    // Round 1: four right, the final recall wrong → 40/50 but not ready.
    const first = await playRound(page, term, [5]);
    check(first.plan.some((item) => item.kind === "choose-article"), "a German noun is asked for its article (der / die / das)");
    await page.waitForTimeout(400);
    let summary = (await page.locator(".lrn-summary").innerText()).replace(/\n/g, " ");
    check(/40\s*\/ 50/.test(summary) && /Keep learning/.test(summary) && !/Ready for Review/.test(summary), "40/50 with the final recall wrong is not Ready for Review");
    check(/final active-recall exercise/.test(summary), "the summary says what is missing: the final recall");
    check(await page.locator('.lrn-actions button:has-text("Move to Review")').count() === 0, "no Move to Review is offered");
    check(await sql(`select score || '|' || recall_correct || '|' || ready from heuresis_learn_rounds where id = '${first.id}'`) === "40|false|false", "stored: 40 points, recall wrong, not ready");
    await page.screenshot({ path: `${shots}/10-summary-keep-learning.png` });

    // Review mistakes: practice only.
    await page.click('.lrn-actions button:has-text("Review mistakes")');
    await page.locator(".lrn-practice").waitFor();
    await answer(page, first.plan[4], true);
    check(/Practice does not change your score/.test(await page.locator(".lrn-feedback").innerText()), "reviewing a mistake is practice and says so");
    await proceed(page);
    await page.locator(".lrn-summary").waitFor();
    check(await sql(`select score from heuresis_learn_rounds where id = '${first.id}'`) === "40", "practice leaves the round's score at 40");

    // Round 2: new exercises; everything right but the recall with a hint → 40, assisted, not ready.
    await page.click('.lrn-actions button:has-text("Start another round")');
    await waitExercise(page, 1);
    const second = await activeRound(term);
    check(second.id !== first.id && JSON.stringify(second.plan) !== JSON.stringify(first.plan), "another round is a new round with different exercises");
    check(second.plan.map((item) => item.kind).join() !== first.plan.map((item) => item.kind).join(), `the exercise types change too (${second.plan.map((item) => item.kind).join(", ")})`);
    for (let position = 1; position <= 4; position += 1) { await waitExercise(page, position); await answer(page, second.plan[position - 1], true); await proceed(page); }
    await waitExercise(page, 5);
    await page.click('.lrn-type .lrn-link');
    await page.locator(".lrn-hint").waitFor();
    await page.screenshot({ path: `${shots}/11-recall-hint.png` });
    await answer(page, second.plan[4], true);
    check(/with a hint/.test(await page.locator(".lrn-feedback").innerText()) && await points(page) === "40/50 points", "a hinted answer is accepted but earns no points");
    await proceed(page);
    await page.locator(".lrn-summary").waitFor();
    await page.waitForTimeout(400);
    check(await sql(`select round_number || '|' || score || '|' || correct_count || '|' || recall_correct || '|' || ready from heuresis_learn_rounds where id = '${second.id}'`) === "2|40|4|false|false",
      "stored: round 2, 40 points, four unaided successes, recall assisted, not ready");
    check(await sql(`select correct::text || '|' || assisted || '|' || points from heuresis_learn_attempts where round_id = '${second.id}' and position = 5`) === "true|true|0", "the hinted answer is stored as correct, assisted, 0 points");

    // Round 3: two wrong at the start → 30/50, recall right → still not ready.
    await page.click('.lrn-actions button:has-text("Start another round")');
    await playRound(page, term, [1, 2]);
    await page.waitForTimeout(400);
    summary = (await page.locator(".lrn-summary").innerText()).replace(/\n/g, " ");
    check(/30\s*\/ 50/.test(summary) && /Reach at least 40 of 50 points/.test(summary), "30/50 is not ready even with the recall right");

    // Round 4: clean → 50/50, ready.
    await page.click('.lrn-actions button:has-text("Start another round")');
    const fourth = await playRound(page, term, []);
    await page.waitForTimeout(400);
    summary = (await page.locator(".lrn-summary").innerText()).replace(/\n/g, " ");
    check(/50\s*\/ 50/.test(summary) && /Ready for Review/.test(summary) && /No mistakes/.test(summary), "50/50 is Ready for Review");
    check(await sql(`select string_agg(round_number || ':' || score, ',' order by round_number) from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where c.data->>'term' = '${term}'`) === "1:40,2:40,3:30,4:50",
      "each round keeps its own score; the latest (50) does not overwrite the history");
    check(await sql(`select count(*) || '|' || count(distinct (round_id, position)) || '|' || max(points) from heuresis_learn_attempts`) === "20|20|10", "20 answers for 4 rounds, never more than 10 points each");
    check(await sql("select count(*) from heuresis_review_mistakes") === "0" && await gradeCount() === 0, "wrong Learning answers are not reviews and do not enter the Mistake Log");
    check(fourth.plan.length === 5, "every round has exactly five exercises");
    await page.screenshot({ path: `${shots}/12-summary-50.png` });

    // Leave it ready, continue with the next card, then come back through the library.
    await page.click('.lrn-actions button:has-text("Continue learning another card")');
    await waitExercise(page, 1);
    check(/Card 2 of 3/.test(await page.locator(".lrn-context").innerText()), "Continue goes straight to the next card (Card 2 of 3)");
    await page.keyboard.press("Escape");
    await page.locator(".lrn").waitFor({ state: "detached" });
    await page.locator(".topic-session-control").waitFor();
    await page.click(".modern-topic-back");
    await page.locator(".today-study-switch").waitFor();
    await page.waitForTimeout(1200);
    await page.click('.today-study-switch button:has-text("Learn")');
    check(await stat(page, "Learning") === "2" && await stat(page, "Ready for Review") === "1", "Learn shows 2 cards learning and 1 ready for Review");
    check(await stat(page, "Exercises today") === "20", "20 learning exercises today");
    check(/20 exercises · 80% right first time/.test(await page.locator(".today-study-week").innerText()), "success rate: 16 of 20 right first time (80%)");
    await page.click('.today-study-switch button:has-text("Review")');
    check(await stat(page, "Due now") === "0" && await stat(page, "Reviewed today") === "0" && /0 reviews completed/.test(await page.locator(".today-study-week").innerText()),
      "none of this counts as a review");
    await page.screenshot({ path: `${shots}/13-library-learn-stats.png` });
  },

  async "refresh midway resumes the same round at the same exercise"(page) {
    await sendToLearn("以前", "已经");
    await openStudy(page);
    await startLearn(page);
    await waitExercise(page, 1);
    const term = await sql("select c.data->>'term' from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where r.status = 'active'");
    const round = await activeRound(term);
    check(round.plan.some((item) => ["missing-character", "choose-reading", "cloze-choice"].includes(item.kind)), `a Chinese word gets character and tone work (${round.plan.map((item) => item.kind).join(", ")})`);
    await answer(page, round.plan[0], true); await proceed(page);
    await waitExercise(page, 2);
    await answer(page, round.plan[1], false); await proceed(page);
    await waitExercise(page, 3);
    await page.screenshot({ path: `${shots}/20-chinese-exercise-3.png` });
    const prompt = await page.locator(".lrn-prompt").innerText();

    await page.reload();
    await page.locator(".lrn").waitFor({ timeout: 20000 });
    await waitExercise(page, 3);
    check(await page.locator(".lrn-prompt").innerText() === prompt, "after a refresh Learn reopens on the same exercise (3/5), unchanged");
    check(await points(page) === "10/50 points", "the points earned so far are still there (10/50)");
    check(await page.locator('.lrn-progress i[data-state="right"]').count() === 1 && await page.locator('.lrn-progress i[data-state="wrong"]').count() === 1, "the progress bar shows one right and one wrong");
    check(await sql("select count(*) from heuresis_learn_rounds") === "1" && (await activeRound(term)).id === round.id, "it is the same round: none was created by the refresh");
    await answer(page, round.plan[2], true); await proceed(page);

    // Leaving and coming back by hand resumes too.
    await waitExercise(page, 4);
    await page.click(".lrn-exit");
    await page.locator(".lrn").waitFor({ state: "detached" });
    await page.reload();
    await page.locator(".today-study-switch").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1200);
    check(await page.locator(".lrn").count() === 0, "a session that was closed is not reopened by a refresh");
    check(await page.locator('.today-study-switch button.selected').innerText() === "Learn", "the mode selector is still on Learn");
    await page.click(".today-study-start");
    await page.locator(".lrn").waitFor();
    await waitExercise(page, 4);
    check(await points(page) === "20/50 points", "Start resumes the unfinished card first, at exercise 4 with 20/50");
    await answer(page, round.plan[3], true); await proceed(page);
    await waitExercise(page, 5);
    await answer(page, round.plan[4], true); await proceed(page);
    await page.locator(".lrn-summary").waitFor();
    await page.waitForTimeout(400);
    check(await sql(`select count(*) || '|' || sum(points) from heuresis_learn_attempts where round_id = '${round.id}'`) === "5|40", "five answers, 40 points, no duplicate from the refreshes");
    check(await sql("select count(*) from heuresis_learn_rounds") === "1", "still exactly one round");
  },

  async "duplicate scoring is impossible"(page) {
    await sendToLearn("刚才");
    await openStudy(page);
    await startLearn(page);
    await waitExercise(page, 1);
    const round = await activeRound("刚才");
    const card = await cardId("刚才");
    // A double click on the answer tile.
    const first = round.plan[0];
    const right = first.choices.find((choice) => choice.id === first.answerId);
    await page.locator(".lrn-choice").filter({ has: page.getByText(right.label, { exact: true }) }).first().dblclick();
    await page.locator(".lrn-feedback").waitFor();
    await page.waitForTimeout(500);
    check(await sql(`select count(*) || '|' || sum(points) from heuresis_learn_attempts where round_id = '${round.id}'`) === "1|10", "a double click records one answer and 10 points");
    check(await points(page).then((text) => /10\/50 points$/.test(text)), "the indicator shows 10/50, not 20");

    // The same request again, as a retry or an offline replay would send it.
    const again = await rpc("heuresis_learn_record_attempt", { p_round_id: round.id, p_position: 1, p_stage: "recognition", p_exercise_type: "choose-meaning", p_correct: true, p_assisted: false, p_response: "x", p_expected: "x" });
    check(again.status === 200 && again.data.score === 10 && again.data.attempts.length === 1, "repeating the request returns the round unchanged (10 points)");
    // Trying to turn a recorded answer around, to skip ahead, or to invent a sixth exercise.
    await rpc("heuresis_learn_record_attempt", { p_round_id: round.id, p_position: 2, p_stage: "reconstruction", p_exercise_type: "build-term", p_correct: false, p_assisted: false, p_response: "", p_expected: "" });
    const flipped = await rpc("heuresis_learn_record_attempt", { p_round_id: round.id, p_position: 2, p_stage: "reconstruction", p_exercise_type: "build-term", p_correct: true, p_assisted: false, p_response: "", p_expected: "" });
    check(flipped.data.score === 10 && flipped.data.attempts[1].correct === false, "a recorded wrong answer cannot be re-sent as right");
    const skipped = await rpc("heuresis_learn_record_attempt", { p_round_id: round.id, p_position: 5, p_stage: "recall", p_exercise_type: "recall-type", p_correct: true, p_assisted: false, p_response: "", p_expected: "" });
    check(skipped.status >= 400, "exercise 5 cannot be recorded before 3 and 4");
    const sixth = await rpc("heuresis_learn_record_attempt", { p_round_id: round.id, p_position: 6, p_stage: "recall", p_exercise_type: "x", p_correct: true, p_assisted: false, p_response: "", p_expected: "" });
    check(sixth.status >= 400, "there is no sixth exercise");
    // Writing to the tables directly is refused; points cannot be edited.
    const insert = await rest("POST", "heuresis_learn_attempts", { round_id: round.id, position: 3, user_id: USER, card_id: card, pack_id: HSK, stage: "completion", exercise_type: "x", correct: true, points: 10 });
    const update = await rest("PATCH", `heuresis_learn_rounds?id=eq.${round.id}`, { score: 50, ready: true, status: "completed" });
    const erase = await rest("DELETE", `heuresis_learn_attempts?round_id=eq.${round.id}`);
    check(insert.status >= 400 && update.status >= 400 && erase.status >= 400, "direct inserts, updates and deletes are refused: only the functions write");
    check(await sql(`select score || '|' || status from heuresis_learn_rounds where id = '${round.id}'`) === "10|active", "the round is untouched");
    // A second start for the same card resumes the round instead of creating another.
    const second = await rpc("heuresis_learn_begin_round", { p_round_id: crypto.randomUUID(), p_card_id: card, p_cycle: 1, p_plan: round.plan });
    check(second.status === 200 && second.data.id === round.id && await sql("select count(*) from heuresis_learn_rounds") === "1", "starting again (another tab or device) returns the same unfinished round");
    const four = await rpc("heuresis_learn_begin_round", { p_round_id: crypto.randomUUID(), p_card_id: card, p_cycle: 1, p_plan: round.plan.slice(0, 4) });
    check(four.status >= 400, "a round with four exercises is refused");
    // Someone else's session sees nothing and can do nothing.
    const stranger = "22222222-2222-4222-8222-222222222222";
    await sql(`insert into auth.users(id, email) values ('${stranger}', 'other@example.test')`);
    const peek = await rest("GET", "heuresis_learn_attempts?select=round_id", undefined, stranger);
    const poke = await rpc("heuresis_learn_record_attempt", { p_round_id: round.id, p_position: 3, p_stage: "completion", p_exercise_type: "x", p_correct: true, p_assisted: false, p_response: "", p_expected: "" }, stranger);
    const steal = await rpc("heuresis_learn_begin_round", { p_round_id: crypto.randomUUID(), p_card_id: card, p_cycle: 1, p_plan: round.plan }, stranger);
    const spy = await rpc("heuresis_learn_overview", { p_card_ids: [card], p_day_start: new Date(0).toISOString(), p_week_start: new Date(0).toISOString() }, stranger);
    check(peek.status === 200 && peek.data.length === 0 && poke.status >= 400 && steal.status >= 400 && spy.data.cards.length === 0 && spy.data.packs.length === 0,
      "another account cannot read, answer or start a round on this card");
    const anonymous = await fetch(`${GATEWAY}/rest/v1/rpc/heuresis_learn_overview`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ p_card_ids: [card], p_day_start: new Date(0).toISOString(), p_week_start: new Date(0).toISOString() }) });
    check(anonymous.status >= 400, "without a session the functions cannot be called");
    check(await sql(`select count(*) || '|' || sum(points) from heuresis_learn_attempts where round_id = '${round.id}'`) === "2|10", "after all of that: two answers, 10 points");
  },

  async "direct new → review bypasses learn without a fabricated review"(page) {
    await openStudy(page);
    await page.locator('.today-study-picker-trigger').click();
    await page.locator('.today-study-picker-subject button:has-text("Chinese")').click();
    await page.locator('.today-study-picker-topics button:has-text("HSK 2 — Time")').click();
    await page.click(".today-study-start");
    await page.locator(".library-study-v2-dialog").waitFor();
    await page.fill(".library-study-v2-custom input", "1");
    await page.click(".library-study-v2-confirm");
    await page.locator(".sort-card").waitFor();
    const term = await page.locator(".sort-card strong").innerText();
    await page.keyboard.press("c");
    await page.click('.sort-footer-later:has-text("To Review")');
    await page.locator(".sort-finished").waitFor();
    const id = await cardId(term);
    const state = await phaseOf(term);
    check(state.phase === "review" && state.history.at(-1).reason === "direct", `New → Review: “${term}” goes straight to Review`);
    check(await sql(`select count(*) from heuresis_card_events where card_id = '${id}'`) === "0", "no review event of any kind is created");
    check(await sql(`select study_count || '|' || again_count || '|' || hard_count || '|' || good_count || '|' || easy_count || '|' || (last_encountered_at is null) from heuresis_card_stats where card_id = '${id}'`) === "0|0|0|0|0|true",
      "its review statistics are all zero: it arrives as an unreviewed card");
    check(await sql(`select count(*) from heuresis_learn_rounds where card_id = '${id}'`) === "0", "no learning round or points are invented");
    check(await sql(`select to_state from heuresis_card_state_changes where card_id = '${id}' and state_kind = 'learning_phase'`) === "review", "the transition is recorded as New → Review");
    await page.click('.sort-finished-actions button.is-quiet');
    await page.waitForTimeout(1500);
    await page.click('.today-study-switch button:has-text("Review")');
    check(await stat(page, "Due now") === "1", "Review has it due");
    await page.click('.today-study-switch button:has-text("Learn")');
    check(await stat(page, "Learning") === "0" && await page.locator(".today-study-start").isDisabled(), "Learn has nothing and its Start is disabled");
  },

  async "review → relearn, and repeated mistakes return a card to learn"(page, context) {
    // Two cards already in Review; one has been learned before (a ready round in cycle 1).
    await sql(`update heuresis_cards set data = data || jsonb_build_object('_sorted_at', now()::text), interest_rank = 3 where data->>'term' in ('以前', '以后')`);
    await sendToLearn("已经");
    await openStudy(page);
    await startLearn(page);
    await playRound(page, "已经", []);
    await page.click('.lrn-actions button:has-text("Move to Review")');
    await page.locator('.lrn-facts dd:has-text("Moved to Review")').waitFor();
    await page.click('.lrn-actions button:has-text("Return to Learn")');
    await page.locator(".lrn").waitFor({ state: "detached" });

    const REC = "00000000-0000-4000-8000-000000000101";
    const popup = await context.newPage();
    await popup.goto(`${BASE}?cosmos=1&mode=review&pack=${HSK}&source=all&count=3&order=pack&mastered=1&templates=${REC}`);
    await popup.locator(".cosmos-count").waitFor({ timeout: 15000 });
    const shown = async () => sql(`select data->>'term' from heuresis_cards where id = '${await popup.locator(".cosmos-card").getAttribute("data-card-id")}'`);

    // Manual Relearn: available on any revealed card, without grading it.
    const manual = await shown();
    await popup.keyboard.press(" ");
    await popup.locator('.cosmos-secondary-actions button:has-text("Relearn")').click();
    await popup.waitForTimeout(900);
    const relearned = await phaseOf(manual);
    check(relearned.phase === "learning" && relearned.history.at(-1).reason === "relearn", `manual Relearn sends “${manual}” back to Learn`);
    check(await gradeCount(`and card_id = '${await cardId(manual)}'`) === 0, "Relearn records no grade");
    check(await shown() !== manual, "the card leaves the Review queue at once");

    // Repeated mistakes: Missed twice → the card is offered back to Learn.
    const hard = await shown();
    await popup.keyboard.press(" ");
    await popup.locator(".cosmos-results button:has-text('Missed')").click();
    await popup.waitForTimeout(500);
    check(await popup.locator(".cosmos-relearn-suggested").count() === 0, "one mistake does not suggest Learn");
    await popup.locator(".cosmos-continue").click();
    await popup.waitForTimeout(500);
    await popup.close();
    const again = await context.newPage();
    await again.goto(`${BASE}?cosmos=1&mode=review&pack=${HSK}&source=all&count=3&order=pack&mastered=1&templates=${REC}`);
    await again.locator(".cosmos-count").waitFor({ timeout: 15000 });
    for (let guard = 0; guard < 4; guard += 1) {
      const term = await sql(`select data->>'term' from heuresis_cards where id = '${await again.locator(".cosmos-card").getAttribute("data-card-id")}'`);
      await again.keyboard.press(" ");
      if (term === hard) break;
      await again.locator(".cosmos-results button:has-text('Known')").click();
      await again.waitForTimeout(600);
    }
    await again.locator(".cosmos-results button:has-text('Missed')").click();
    await again.locator(".cosmos-relearn-suggested").waitFor();
    await again.screenshot({ path: `${shots}/30-review-missed-repeatedly.png` });
    const before = await gradeCount(`and card_id = '${await cardId(hard)}'`);
    check(before === 2 && await sql(`select count(*) from heuresis_review_mistakes where card_id = '${await cardId(hard)}'`) === "1", "the second mistake enters the Mistake Log, as before (and only then)");
    await again.locator(".cosmos-relearn-suggested").click();
    await again.waitForTimeout(900);
    const returned = await phaseOf(hard);
    check(returned.phase === "learning" && returned.history.at(-1).reason === "repeated-mistakes", `after repeated mistakes “${hard}” returns to Learn in one click`);
    check(await gradeCount(`and card_id = '${await cardId(hard)}'`) === before, "its review history is kept exactly (2 grades)");
    await again.close();

    // A card learned before and sent back starts a new cycle: its old readiness does not count.
    const learned = await phaseOf("已经");
    const back = JSON.stringify({ ...learned, phase: "learning", cycle: learned.cycle + 1, completed: [], history: [...learned.history, { at: new Date().toISOString(), cycle: learned.cycle + 1, kind: "enter_learning", reason: "relearn" }] });
    await sql(`update heuresis_cards set data = data || jsonb_build_object('_acquisition_v1', '${back.replace(/'/g, "''")}') where data->>'term' = '已经'`);
    await page.bringToFront();
    await page.reload();
    await page.locator(".today-study-switch").waitFor({ timeout: 20000 });
    await page.waitForTimeout(1500);
    check(await stat(page, "Learning") === "3" && await stat(page, "Ready for Review") === "0", "all three are in Learn; the earlier Ready round of a relearned card no longer counts");
    await page.click(".today-study-start");
    await page.locator(".lrn").waitFor();
    await waitExercise(page, 1);
    check(await sql(`select string_agg(cycle || ':' || round_number || ':' || status, ',' order by cycle) from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where c.data->>'term' = '已经'`) !== ""
      && await sql("select count(*) from heuresis_learn_rounds where status = 'active'") === "1", "Learn starts a fresh round for the current cycle");
    check(await sql(`select string_agg(distinct coalesce(from_state, 'new') || '>' || to_state, ',' order by coalesce(from_state, 'new') || '>' || to_state) from heuresis_card_state_changes where state_kind = 'learning_phase'`) === "learning>review,new>learning,review>learning",
      "every transition is in the card history: New → Learn, Learn → Review, Review → Learn");
  },

  async "subject and topic filtering, and Start follows the selected mode"(page) {
    await sendToLearn("以前", "anrufen", "говорить");
    await sql(`update heuresis_cards set data = data || jsonb_build_object('_sorted_at', now()::text, '_acquisition_v1',
      '{"phase":"review","cycle":0,"completed":[],"history":[]}'), interest_rank = 3 where data->>'term' = '以后'`);
    await openStudy(page);
    const pick = async (subject, topic) => {
      await page.locator(".today-study-picker-trigger").click();
      if (!subject) { await page.locator('.today-study-picker-menu > button:has-text("All subjects")').click(); return; }
      const group = page.locator(`.today-study-picker-group:has(.today-study-picker-subject-name:text-is("${subject}"))`);
      if (await group.locator(".today-study-picker-topics").count() === 0) await group.locator(".today-study-picker-subject button").click();
      await group.locator(`.today-study-picker-topics button:has-text("${topic ?? "All topics"}")`).click();
    };
    await page.click('.today-study-switch button:has-text("Learn")');
    check(await stat(page, "Learning") === "3", "All subjects: three cards are in Learn");
    await pick("German");
    check(await stat(page, "Learning") === "1", "German: one card in Learn");
    await page.click('.today-study-switch button:has-text("New")');
    const germanNew = await stat(page, "New cards");
    await page.click('.today-study-switch button:has-text("Review")');
    check(await stat(page, "Due now") === "0", "German: nothing due in Review (the due card is Chinese)");
    await page.click('.today-study-switch button:has-text("Learn")');
    check(germanNew === "5" && await stat(page, "Learning") === "1", "the chosen subject stays selected across New, Learn and Review (German: 5 new, 1 learning)");
    // Start in Learn mode opens Learn, with the cards of the chosen subject only.
    await page.click(".today-study-start");
    await page.locator(".lrn").waitFor();
    await waitExercise(page, 1);
    check(/Card 1 of 1/.test(await page.locator(".lrn-context").innerText()) && /German/.test(await page.locator(".lrn-context strong").innerText()), "Start in Learn opens Learn with the German card only (Card 1 of 1)");
    check(await sql("select c.data->>'term' from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where r.status = 'active'") === "anrufen", "the round is for the German card");
    await page.keyboard.press("Escape");
    await page.locator(".lrn").waitFor({ state: "detached" });
    await page.waitForTimeout(1200);
    // A topic with nothing in Learn: Start is disabled rather than opening an empty session.
    await pick("Chinese", "Everyday sentences");
    check(await stat(page, "Learning") === "0" && await page.locator(".today-study-start").isDisabled(), "a topic with nothing in Learn: 0 learning and Start disabled");
    await pick("Chinese", "HSK 2 — Time");
    check(await stat(page, "Learning") === "1" && await page.locator(".today-study-start").isEnabled(), "the Chinese topic with a card in Learn: 1 learning");
    // The same Start button follows the mode.
    await page.click('.today-study-switch button:has-text("New")');
    await page.click(".today-study-start");
    await page.locator(".library-study-v2-dialog").waitFor();
    check(await page.locator(".lrn").count() === 0, "Start in New opens the New session dialog, not Learn");
    await page.keyboard.press("Escape");
    await page.click('.today-study-switch button:has-text("Review")');
    check(await stat(page, "Due now") === "1", "Chinese · HSK 2 — Time: one card due in Review");
    await page.click(".today-study-start");
    await page.locator(".reviews-centre").waitFor();
    check(await page.locator(".lrn").count() === 0, "Start in Review opens Review, not Learn");
    check(await sql("select count(*) from heuresis_learn_rounds") === "1" && await gradeCount() === 0, "only the one Learning round was created; no review was recorded");
  },

  async "german, russian and chinese on a phone, by touch"(page) {
    await sendToLearn("говорить", "的时候", "sich freuen auf");
    await openStudy(page);
    await startLearn(page);
    const seen = [];
    for (let card = 1; card <= 3; card += 1) {
      await waitExercise(page, 1);
      const term = await sql("select c.data->>'term' from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where r.status = 'active'");
      const round = await activeRound(term);
      seen.push(`${term}: ${round.plan.map((item) => item.kind).join(", ")}`);
      for (let position = 1; position <= 5; position += 1) {
        await waitExercise(page, position);
        await page.waitForTimeout(250);
        const fit = await page.evaluate(() => {
          const stage = document.querySelector(".lrn-stage"); const shell = document.querySelector(".lrn");
          const bottom = document.querySelector(".lrn-bottom").getBoundingClientRect().bottom;
          // The exercise itself, the whole Learn screen, its width, and whether the page behind can still scroll.
          return { stage: stage.scrollHeight - stage.clientHeight, page: Math.max(shell.scrollHeight - shell.clientHeight, Math.round(bottom - window.innerHeight)),
            wide: shell.scrollWidth - shell.clientWidth, behind: getComputedStyle(document.documentElement).overflowY };
        });
        const fits = fit.stage <= 1 && fit.page <= 0 && fit.wide <= 0 && fit.behind === "hidden";
        check(fits, `${term} · exercise ${position} (${round.plan[position - 1].kind}) fits a 390 × 844 screen without scrolling${fits ? "" : ` (${JSON.stringify(fit)})`}`);
        await page.screenshot({ path: `${shots}/40-phone-${card}-${position}-${round.plan[position - 1].kind}.png` });
        const target = await page.locator(".lrn-choice, .lrn-tile:not(.is-tool)").first().boundingBox().catch(() => null);
        if (target) check(target.height >= 44, `touch targets are at least 44 px high (${Math.round(target.height)})`);
        await answer(page, round.plan[position - 1], !(card === 1 && position === 2));
        if (card === 1 && position === 2) await page.screenshot({ path: `${shots}/41-phone-wrong.png` });
        await proceed(page);
      }
      await page.locator(".lrn-summary").waitFor();
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${shots}/42-phone-summary-${card}.png` });
      if (card < 3) await page.locator('.lrn-actions button:has-text("Continue learning another card")').tap();
    }
    const kinds = seen.join(" | ");
    console.log(`    ${kinds}`);
    check(/говорить: [^|]*choose-stress/.test(kinds), "Russian: the stress is asked for");
    check(/говорить: [^|]*cloze-choice/.test(kinds), "Russian: the inflected form in a sentence is recognised (говорю)");
    check(/的时候: [^|]*(missing-character|choose-reading)/.test(kinds) && /的时候: [^|]*cloze-choice/.test(kinds), "Chinese: characters and the word in its sentence");
    check(/sich freuen auf: [^|]*choose-preposition/.test(kinds), "German: the verb's preposition is asked for");
    // All three met the criteria (one of them with 40/50), so nothing is left to learn.
    check(await page.locator('.lrn-actions button:has-text("Continue learning another card")').count() === 0, "after the last card no further card is offered");
    await page.locator('.lrn-actions button:has-text("Move to Review")').tap();
    await page.locator('.lrn-facts dd:has-text("Moved to Review")').waitFor();
    await page.locator('.lrn-actions button:has-text("Return to Learn")').tap();
    await page.locator(".lrn").waitFor({ state: "detached" });
    await page.waitForTimeout(1200);
    check(await sql("select count(*) from heuresis_learn_rounds where status = 'completed'") === "3", "three rounds completed and stored");
    check(await page.evaluate(() => document.documentElement.style.overflow) === "", "leaving Learn lets the page behind scroll again");
    // Start now offers the two cards that are ready and were not moved yet.
    await page.locator(".today-study-start").tap();
    await page.locator(".lrn-summary").waitFor();
    check(/2 cards are ready for Review/.test(await page.locator(".lrn-title").innerText()), "Start then shows the two cards still waiting to be moved");
    await page.screenshot({ path: `${shots}/43-phone-finished.png` });
  },

  async "android tablet (MagicPad): learn by touch, in the one WebView"(page, context, { popups }) {
    await sendToLearn("以前", "anrufen");
    await openStudy(page);
    await startLearn(page);
    const tap = async (selector, label) => {
      const result = await fingerTap(page, selector, { label, scroll: false });
      if (!result.ok) check(false, `${label}: ${result.reason}`);
      return result.ok;
    };
    for (const [label, viewport] of [["landscape 1200 × 768", TABLET.landscape], ["portrait 768 × 1200", TABLET.portrait]]) {
      await page.setViewportSize(viewport);
      await waitExercise(page, 1);
      const term = await sql("select c.data->>'term' from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where r.status = 'active'");
      const round = await activeRound(term);
      // Learn must sit above the app header and the touch navigation, edge to edge.
      check(await page.evaluate(() => {
        const learn = document.querySelector(".lrn");
        return [[innerWidth / 2, 3], [innerWidth / 2, innerHeight - 3], [3, innerHeight / 2], [innerWidth - 3, innerHeight / 2]]
          .every(([x, y]) => learn.contains(document.elementFromPoint(x, y)));
      }), `${label}: Learn covers the whole screen, including the app header and the touch navigation`);
      let fitted = true; let reached = true;
      for (let position = 1; position <= 5; position += 1) {
        await waitExercise(page, position);
        await page.waitForTimeout(250);
        const exercise = round.plan[position - 1];
        fitted &&= await page.evaluate(() => {
          const stage = document.querySelector(".lrn-stage");
          return stage.scrollHeight - stage.clientHeight <= 1 && document.querySelector(".lrn-bottom").getBoundingClientRect().bottom <= innerHeight + 1;
        });
        if (position === 1) await page.screenshot({ path: `${shots}/45-tablet-${label.split(" ")[0]}-1.png` });
        if (exercise.format === "type") {
          // The on-screen keyboard takes the lower part of the screen.
          await page.locator(".lrn-input").tap();
          await page.setViewportSize({ width: viewport.width, height: Math.round(viewport.height * 0.55) });
          await page.waitForTimeout(200);
          check(await reachableNow(page, ".lrn-input") && await reachableNow(page, ".lrn-check .lrn-primary"), `${label}: with the keyboard open the answer field and Check stay reachable`);
          await page.screenshot({ path: `${shots}/45-tablet-${label.split(" ")[0]}-keyboard.png` });
          await page.fill(".lrn-input", exercise.accepted[0].value);
          reached &&= await tap(".lrn-check .lrn-primary", "Check");
          await page.locator(".lrn-feedback").waitFor();
          check(await reachableNow(page, ".lrn-feedback-actions .lrn-primary"), `${label}: Continue is reachable while the keyboard is still open`);
          await page.setViewportSize(viewport);
        } else await answer(page, exercise, true);
        reached &&= await tap(".lrn-feedback-actions .lrn-primary", "Continue");
      }
      check(fitted, `${label}: all five exercises fit the screen without scrolling`);
      check(reached, `${label}: Check and Continue are reached by a finger every time`);
      await page.locator(".lrn-summary").waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${shots}/45-tablet-${label.split(" ")[0]}-summary.png` });
      await tap('.lrn-actions button:has-text("Move to Review")', "Move to Review");
      await page.locator('.lrn-facts dd:has-text("Moved to Review")').waitFor();
      if (label.startsWith("landscape")) await tap('.lrn-actions button:has-text("Continue learning another card")', "Continue learning another card");
    }
    await tap('.lrn-actions button:has-text("Return to Learn")', "Return to Learn");
    await page.locator(".lrn").waitFor({ state: "detached" });
    check(!(await webviewDestroyed(page)) && popups.length === 0, "Learn runs inside the app's one WebView: no window is opened or closed");
    check(await page.locator(".today-study-switch").isVisible(), "leaving Learn returns to Study");
    check((await phaseOf("以前")).phase === "review" && (await phaseOf("anrufen")).phase === "review" && await gradeCount() === 0, "both cards moved to Review; no review recorded");
  },

  async "keyboard only, reduced motion and the finished screen"(page) {
    await sendToLearn("anrufen", "teilnehmen an");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await openStudy(page);
    await startLearn(page);
    for (let card = 1; card <= 2; card += 1) {
      await waitExercise(page, 1);
      const term = await sql("select c.data->>'term' from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where r.status = 'active'");
      const round = await activeRound(term);
      if (card === 1) check(await page.evaluate(() => getComputedStyle(document.querySelector(".lrn-stage")).animationName) === "none", "with reduced motion the exercise does not animate in");
      for (let position = 1; position <= 5; position += 1) {
        await waitExercise(page, position);
        const exercise = round.plan[position - 1];
        if (exercise.format === "build") {
          // Number keys pick the remaining tiles in order; Backspace takes one back.
          const wanted = [...exercise.answer];
          await page.keyboard.press("1"); await page.keyboard.press("Backspace");
          for (const text of wanted) {
            const free = (await page.locator(".lrn-tiles .lrn-tile:not([disabled])").allInnerTexts()).map((item) => item.trim());
            await page.keyboard.press(String(free.indexOf(text.trim()) + 1));
          }
          await page.keyboard.press("Enter");
          await page.locator(".lrn-feedback").waitFor();
        } else await answer(page, exercise, true, { keyboard: true });
        check(await page.evaluate(() => document.activeElement?.classList.contains("lrn-primary")), `exercise ${position}: focus moves to Continue`);
        await page.keyboard.press("Enter");
      }
      await page.locator(".lrn-summary").waitFor();
      await page.waitForTimeout(300);
      // Leave both ready without moving them, to reach the end-of-session screen.
      if (card === 1) { await page.locator('.lrn-actions button:has-text("Continue learning another card")').focus(); await page.keyboard.press("Enter"); }
    }
    check(await page.evaluate(() => document.querySelector("#root").hasAttribute("inert")), "the app behind Learn is inert while it is open");
    await page.keyboard.press("Escape");
    await page.locator(".lrn").waitFor({ state: "detached" });
    check(!(await page.evaluate(() => document.querySelector("#root").hasAttribute("inert"))), "closing Learn gives the app back");
    await page.waitForTimeout(1200);
    check(await stat(page, "Ready for Review") === "2" && await stat(page, "Learning") === "0", "two cards are ready for Review, none still learning");
    await page.click(".today-study-start");
    await page.locator(".lrn-summary").waitFor();
    await page.screenshot({ path: `${shots}/50-finished-ready.png` });
    check(/2 cards are ready for Review/.test(await page.locator(".lrn-title").innerText()), "with nothing left to learn, Start shows the cards that are ready");
    await page.click('.lrn-actions button:has-text("Move all 2 to Review")');
    await page.locator('.lrn-title:has-text("Everything ready has moved to Review")').waitFor();
    check((await phaseOf("anrufen")).phase === "review" && (await phaseOf("teilnehmen an")).phase === "review", "both cards are in Review");
    check(await gradeCount() === 0, "and no review was recorded");
    await page.click('.lrn-actions button:has-text("Return to Learn")');
    await page.waitForTimeout(1200);
    check(await page.locator(".today-study-start").isDisabled(), "Learn's Start is disabled once nothing is in Learn");
  },

  async "answers given offline reach the server once"(page, context) {
    await sendToLearn("молоко");
    await openStudy(page);
    await startLearn(page);
    const round = await playRoundOffline(page, context, "молоко");
    await page.waitForTimeout(2500);
    check(await sql(`select count(*) || '|' || sum(points) || '|' || (select status from heuresis_learn_rounds where id = '${round.id}')
      from heuresis_learn_attempts where round_id = '${round.id}'`) === "5|40|completed", "after reconnecting all five answers are on the server, once each (40 points)");
  },

  async "cards from the earlier ten-exercise learning keep their place"(page) {
    const legacy = (completed) => JSON.stringify({ phase: "learning", cycle: 1, completed,
      history: [{ at: new Date().toISOString(), cycle: 1, kind: "enter_learning" },
        ...completed.map((exercise) => ({ at: new Date().toISOString(), cycle: 1, kind: "exercise", exercise, verification: "self", evidence: "done" }))] });
    const all = ["typing", "handwriting", "reconstruct", "missing", "meaning", "context", "pronunciation", "contrast", "sentence", "association"];
    await sql(`update heuresis_cards set data = data || jsonb_build_object('_sorted_at', now()::text, '_acquisition_v1', '${legacy(all)}') where data->>'term' = '以前'`);
    await sql(`update heuresis_cards set data = data || jsonb_build_object('_sorted_at', now()::text, '_acquisition_v1', '${legacy(all.slice(0, 4))}') where data->>'term' = '以后'`);
    await page.reload();
    await page.locator(".heuresis-section-sidebar").waitFor({ timeout: 20000 });
    await openStudy(page);
    await page.click('.today-study-switch button:has-text("Learn")');
    check(await stat(page, "Learning") === "1" && await stat(page, "Ready for Review") === "1", "a card that had reached 100 points stays Ready; one at 40 stays in Learn");
    check(await stat(page, "Exercises today") === "14", "their 14 earlier exercises still count as activity");
    await page.click(".today-study-start");
    await page.locator(".lrn").waitFor();
    await waitExercise(page, 1);
    check(await sql("select c.data->>'term' from heuresis_learn_rounds r join heuresis_cards c on c.id = r.card_id where r.status = 'active'") === "以后", "Learn starts with the card that still needs work");
    const kept = JSON.parse(await sql(`select data->>'_acquisition_v1' from heuresis_cards where data->>'term' = '以前'`));
    check(kept.history.filter((event) => event.kind === "exercise").length === 10, "the earlier exercise history is preserved on the card");
  },

  async "before the migration: learn explains itself and nothing else breaks"(page) {
    await sendToLearn("以前");
    await sql(`drop function public.heuresis_learn_overview(uuid[], timestamptz, timestamptz);
      drop function public.heuresis_learn_begin_round(uuid, uuid, integer, jsonb);
      drop function public.heuresis_learn_record_attempt(uuid, integer, text, text, boolean, boolean, text, text);
      drop function public.heuresis_learn_mark_corrected(uuid, integer);
      drop function public.heuresis_learn_round_state(uuid);
      drop table public.heuresis_learn_attempts; drop table public.heuresis_learn_rounds;
      notify pgrst, 'reload schema'`);
    await page.waitForTimeout(1500);
    await page.reload();
    await page.locator(".heuresis-section-sidebar").waitFor({ timeout: 20000 });
    await openStudy(page);
    check(await stat(page, "New cards") === "16", "New still counts its cards");
    await page.click('.today-study-switch button:has-text("Learn")');
    check(await stat(page, "Learning") === "1", "Learn still knows which cards are in Learn");
    check(/database update/.test(await page.locator(".today-study-notice").innerText()), "Learn says that a database update is needed");
    await page.click(".today-study-start");
    // The same element first says "Preparing your exercises…".
    const explained = await page.locator('.lrn-state:has-text("Learn is almost ready")').waitFor({ timeout: 10000 }).then(() => true, () => false);
    check(explained && /database update/.test(await page.locator(".lrn-state").innerText()), "starting Learn explains it instead of failing");
    await page.screenshot({ path: `${shots}/60-before-migration.png` });
    await page.click('.lrn-state button:has-text("Return to Learn")');
    await page.click('.today-study-switch button:has-text("Review")');
    check(await stat(page, "Due now") === "0" && await page.locator(".today-study-notice").count() === 0, "Review is unaffected");
  },
};

/** Exercises 2–5 are answered with the network off; the answers wait and are sent on reconnect. */
async function playRoundOffline(page, context, term) {
  await waitExercise(page, 1); // the round exists on the server once its first exercise is shown
  const round = await activeRound(term);
  await answer(page, round.plan[0], true); await proceed(page);
  await waitExercise(page, 2);
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await answer(page, round.plan[1], false); await proceed(page);
  for (const position of [3, 4, 5]) { await waitExercise(page, position); await answer(page, round.plan[position - 1], true); await proceed(page); }
  await page.locator(".lrn-summary").waitFor();
  check(await sql(`select count(*) from heuresis_learn_attempts where round_id = '${round.id}'`) === "1", "while offline only the first answer is on the server");
  check(/40\s*\/ 50/.test((await page.locator(".lrn-summary").innerText()).replace(/\n/g, " ")), "the round still completes on the device (40/50)");
  await page.screenshot({ path: `${shots}/55-offline-summary.png` });
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  return round;
}

/** A 390 × 844 phone: touch input only, mobile viewport. */
async function launchPhone() {
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.log("[pageerror]", error.message); });
  page.on("console", (message) => {
    if (message.type() !== "error" || /page_backgrounds|status of 404|favicon/.test(message.text())) return;
    errors.push(message.text()); console.log("[console.error]", message.text().slice(0, 400));
  });
  return { browser, context, page, errors };
}

let failures = 0;
for (const [name, run] of Object.entries(scenarios)) {
  if (only && !name.includes(only)) continue;
  restore();
  await seed();
  console.log(`— ${name}`);
  const phone = name.includes("phone");
  const tablet = name.includes("android");
  touch = phone || tablet;
  const { browser, context, page, errors, popups } = phone ? await launchPhone() : tablet ? await launchTablet() : await launch({ width: 1440, height: 900 });
  try {
    if (phone) {
      await page.goto(BASE);
      await page.fill("input[type=email]", "thomas@example.test");
      await page.fill("input[type=password]", "heuresis");
      await page.locator("button[type=submit]").tap();
      await page.locator(".mobile-workspace-nav").waitFor({ timeout: 15000 });
      await page.waitForTimeout(800);
    } else if (tablet) await signInTablet(page, BASE);
    else await signIn(page);
    await run(page, context, { popups });
    // With the network switched off on purpose, the browser itself logs each refused request.
    const real = name.includes("offline") ? errors.filter((text) => !/ERR_INTERNET_DISCONNECTED/.test(text)) : errors;
    check(real.length === 0, `no page errors${real.length ? `: ${real[0].slice(0, 160)}` : ""}`);
  } catch (error) {
    failures += 1;
    console.log(`  ✗ ${name}: ${String(error.message ?? error).split("\n")[0]}`);
    await page.screenshot({ path: `${shots}/failure-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}.png` }).catch(() => undefined);
  }
  await browser.close();
}
if (failures || process.exitCode) { console.log("FAILED"); process.exitCode = 1; } else console.log("All Learn scenarios passed.");
