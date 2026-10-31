// Browser checks for the clarity pass of 15 October 2026 (Study stages, Sort, Review,
// card Capture, Search and touch layouts). Each scenario starts from a fresh copy of the
// showcase database and drives the real app.
//   node tests/clarity.mjs              (all scenarios)
//   node tests/clarity.mjs capture      (scenarios whose name contains "capture")
// Screenshots of each scenario are written to verification/screenshots/clarity/.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { BASE, check, launch, signIn, sql } from "./lib.mjs";

const here = fileURLToPath(new URL("..", import.meta.url));
const shots = `${here}screenshots/clarity`;
mkdirSync(shots, { recursive: true });
const only = process.argv[2] ?? "";
const USER = "11111111-1111-4111-8111-111111111111";
const HSK = "a0000000-0000-4000-8000-000000000001";

function restore() {
  execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" });
}
/** Two cards nobody has sorted yet, next to five that have review grades. */
async function addUnsortedCards() {
  await sql(`insert into heuresis_cards(user_id, pack_id, data) values
    ('${USER}','${HSK}','{"term":"马上","reading":"mǎshàng","meaning":"immediately","example":"我马上来。"}'),
    ('${USER}','${HSK}','{"term":"最近","reading":"zuìjìn","meaning":"recently"}')`);
}
async function openTopic(page) {
  await page.click('.hw-sections button:has-text("Study")');
  await page.waitForTimeout(800);
  await page.locator('button:has-text("HSK 2 — Time")').first().click();
  await page.locator('.topic-browse-actions button:has-text("Show all")').click();
  await page.locator(".modern-topic-row").first().waitFor();
  await page.waitForTimeout(400);
}
const stageCount = async (page, stage) => Number(await page.locator(`[data-stage="${stage}"] strong`).innerText());
/** True when the element under (x, y) belongs to the given selector (i.e. nothing covers it). */
const topmostIs = (page, x, y, selector) => page.evaluate(({ x, y, selector }) => Boolean(document.elementFromPoint(x, y)?.closest(selector)), { x, y, selector });

function luminance([r, g, b]) {
  const channel = (value) => { const c = value / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const rgb = (value) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

const scenarios = {
  async "topic starts with tag groups rather than every card"(page) {
    await page.click('.hw-sections button:has-text("Study")');
    await page.locator('button:has-text("HSK 2 — Time")').first().click();
    await page.locator(".topic-browse-hub").waitFor();
    check(await page.locator(".modern-topic-row").count() === 0, "opening a topic does not render every card");
    check(await page.locator(".topic-filter-picker").count() === 1, "a compact searchable tag and state selector is available instead");
    await page.locator('.topic-browse-actions button:has-text("Show all")').click();
    await page.locator(".modern-topic-row").first().waitFor();
    check(await page.locator(".modern-topic-row").count() >= 5, "Show all explicitly expands the full table");
    await page.locator('.topic-browse-actions button:has-text("Overview")').click();
    check(await page.locator(".modern-topic-row").count() === 0, "Overview hides the table again");
  },

  async "study stages agree in Library, topic, Sort, Browse and Review"(page) {
    await addUnsortedCards();
    await page.click('.hw-sections button:has-text("Study")');
    await page.waitForTimeout(1200);
    const libraryRow = await page.locator('.library-resume-topics button:has-text("HSK 2 — Time") small').innerText();
    check(/2 UNSORTED/i.test(libraryRow), `Library counts the two unsorted cards (“${libraryRow}”)`);
    await page.locator('button:has-text("HSK 2 — Time")').first().click();
    await page.locator('.topic-browse-actions button:has-text("Show all")').click();
    await page.locator(".modern-topic-row").first().waitFor();
    await page.waitForTimeout(400);
    const [unsorted, learning, reference] = [await stageCount(page, "unsorted"), await stageCount(page, "learning"), await stageCount(page, "reference")];
    check(unsorted === 2 && learning === 5 && reference === 0, `topic stages are Unsorted 2 → Learning 5 · Reference 0 (got ${unsorted} / ${learning} / ${reference})`);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    check(/^1 \/ 2$/.test((await page.locator(".sort-topbar > span").innerText()).trim()), "Sort opens on the first of the two unsorted cards, never reviewed ones");
    await page.keyboard.press("Escape");
    await page.locator('button:has-text("Browse")').first().click();
    await page.locator(".browse-status-grid").waitFor();
    const browseUnsorted = Number(await page.locator('.browse-status-grid button:has-text("Unsorted") b').innerText());
    const browseReviewed = Number(await page.locator('.browse-status-grid button:has(span:text-is("Reviewed")) b').innerText());
    check(browseUnsorted === 2 && browseReviewed === 5, `Browse uses the same stages (${browseUnsorted} unsorted, ${browseReviewed} reviewed)`);
    check(await page.locator(".browse-importance-row button").count() === 3, "Browse filters by Core / Useful / Peripheral, not 1–5");
    await page.keyboard.press("Escape");
    await page.locator(".review-command").click();
    await page.locator(".review-controls").waitFor();
    // Eligibility can change when historical grades arrive: mastered cards are excluded
    // unless requested. Assert against the *loaded* pool, not its transient initial count.
    await page.locator('.study-state:has-text("Loading cards and review history")').waitFor({ state: "hidden" });
    const meta = await page.locator(".compact-study-meta").innerText();
    check(/\d+\s*available/.test(meta), `Review shows eligible cards (“${meta.replace(/\s+/g, " ")}”)`);
    const available = Number(meta.match(/(\d+)\s*available/)?.[1] ?? 0);
    const start = page.locator(".study-start");
    const error = await page.locator(".study-error").allInnerTexts();
    const directionMissing = await page.locator('.study-state:has-text("No review direction")').count();
    check(error.length === 0 && !directionMissing, `Review setup loads a direction without errors (errors: ${error.join("; ") || "none"}; missing direction: ${directionMissing})`);
    check((await start.isEnabled()) === (available > 0),
      `Review starts only with eligible cards (available: ${available}; enabled: ${await start.isEnabled()})`);
    await page.screenshot({ path: `${shots}/review-setup.png` });
  },

  async "study dialogs are never covered by the sidebar"(page) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    check(await topmostIs(page, 120, 300, ".sort-backdrop"), "Sort covers the sidebar instead of sitting under it");
    check(await topmostIs(page, 200, 100, ".sort-modal"), "the Sort title is visible (not hidden behind the sidebar)");
    await page.screenshot({ path: `${shots}/sort-card.png` });
    await page.keyboard.press("Escape");
    await page.locator(".modern-topic-row").first().dblclick();
    await page.locator(".card-editor-modal").waitFor();
    check(await topmostIs(page, 120, 300, ".modal-backdrop"), "Edit card covers the sidebar");
  },

  async "selected review direction stays readable while hovered"(page) {
    await openTopic(page);
    await page.locator(".review-command").click();
    await page.locator(".review-controls").waitFor();
    const selected = page.locator('.study-order-toggle button[aria-pressed="true"]');
    await selected.hover();
    await page.waitForTimeout(300);
    const colours = await selected.evaluate((element) => { const style = getComputedStyle(element); return { color: style.color, background: style.backgroundColor }; });
    const ratio = contrast(rgb(colours.color), rgb(colours.background));
    check(ratio >= 4.5, `hovered selected option has readable contrast (${ratio.toFixed(2)}:1)`);
  },

  async "Sort restores the card enrichment rails and preserves additions"(page) {
    await addUnsortedCards();
    await openTopic(page);
    await page.locator(".sort-command").click();
    await page.locator(".sort-enrichment").waitFor();
    const left = await page.locator(".sort-enrichment").boundingBox();
    const centre = await page.locator(".sort-card").boundingBox();
    const right = await page.locator(".sort-panel").boundingBox();
    check(Boolean(left && centre && right && left.x < centre.x && centre.x < right.x),
      "Enrichment left, complete flashcard centre, Sort decisions right");
    const cardId = await page.locator(".sort-card").getAttribute("data-card-id");
    const examplesHeading = page.locator('.sort-enrich-heading:has-text("Examples")');
    if (await examplesHeading.getAttribute("aria-expanded") !== "true") await examplesHeading.click();
    await page.getByRole("button", { name: "Add example" }).click();
    // Keyboard typing produces normal paragraph markup in this WYSIWYG editor;
    // Playwright fill() inserts a bare text node, bypassing the real user path.
    await page.getByRole("textbox", { name: "Write examples" }).pressSequentially("An example recorded while sorting.");
    check(await page.locator(".sort-rating button").first().isDisabled(),
      "An unfinished enrichment draft blocks moving to the next card");
    await page.keyboard.press("Escape");
    check(await page.locator(".sort-modal").count() === 1 && await page.locator(".sort-enrich-editor").count() === 1,
      "Escape cannot silently discard typed card knowledge");
    await page.locator(".sort-enrich-editor").getByRole("button", { name: "Save", exact: true }).click();
    await page.locator('.sort-enrich-item:has-text("An example recorded while sorting.")').waitFor();
    const persisted = await sql("select data->>'_workspace_blocks' from heuresis_cards where id='" + cardId + "'");
    check(persisted.includes("An example recorded while sorting."),
      "New knowledge is saved to the original flashcard data");
    await page.keyboard.press("Escape");
    await page.locator(".sort-command").click();
    if (await page.locator('.sort-enrich-heading:has-text("Examples")').getAttribute("aria-expanded") !== "true")
      await page.locator('.sort-enrich-heading:has-text("Examples")').click();
    check(await page.locator('.sort-enrich-item:has-text("An example recorded while sorting.")').count() === 1,
      "Saved enrichment is present when Sort reopens");
  },

  async "sort keeps its four outcomes together and works from the keyboard"(page) {
    await addUnsortedCards();
    await openTopic(page);
    await page.click(".sort-command");
    await page.locator(".sort-card").waitFor();
    check(true, "Sort opens straight into the queue (no setup step)");
    const decision = page.locator(".sort-panel");
    check(await decision.locator(".sort-rating button").count() === 3, "Three priorities: Core, Useful and Peripheral");
    check(await decision.getByRole("button", { name: "Learn as Core" }).count() === 1, "Core classification is available");
    check(await decision.getByRole("button", { name: /Reference/ }).count() === 0, "Reference is no longer a Sort action");
    check(await decision.getByRole("button", { name: /^Later/ }).count() === 1, "Sort Later is available");
    check(await decision.getByRole("button", { name: /Discard/ }).count() === 1, "Discard to Trash remains recoverable");
    const first = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("l");
    await page.waitForTimeout(350);
    check(await sql(`select (data->>'_sorted_at') is null from heuresis_cards where data->>'term'='${first}'`) === "t", "Sort Later leaves the first card unsorted");
    const second = (await page.locator(".sort-card > strong").innerText()).trim();
    await page.keyboard.press("u");
    await page.waitForTimeout(900);
    check(await sql(`select interest_rank||'|'||((data->>'_sorted_at') is not null) from heuresis_cards where data->>'term'='${second}'`) === "3|true", "Active stores rank 3 and marks the card sorted");
    check(await page.locator(".sort-finished").count() === 1, "the pass ends with a summary");
  },

  async "card capture adds each card at once and asks before closing with an unsaved card"(page) {
    await page.goto(`${BASE}?capture=1&pack=${HSK}`);
    await page.locator(".capture-composer").waitFor({ timeout: 15000 });
    const slots = page.locator(".capture-card-surface .capture-slot textarea");
    check((await page.locator(".capture-side-label").first().innerText()).includes("FRONT"), "the card sides are called Front and Back");
    await slots.nth(0).fill("马上");
    await slots.nth(0).press("Enter");
    await page.keyboard.type("mǎshàng");
    await page.keyboard.press("Enter");
    await page.keyboard.type("immediately");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    check(await sql(`select count(*) from heuresis_cards where data->>'term'='马上' and pack_id='${HSK}'`) === "1", "Enter on the last field adds the card to the topic immediately");
    check(/Added “马上”/.test(await page.locator(".capture-foot-copy").innerText()), "the footer confirms what was added");
    check(await slots.nth(0).inputValue() === "", "the form is cleared for the next card");
    await slots.nth(0).fill("最近");
    await slots.nth(2).fill("recently");
    // Escape while an input method is composing (pinyin) belongs to the IME, not to Capture.
    await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true })));
    check(await page.locator(".capture-close-confirm").count() === 0, "Escape during IME composition does not try to close Capture");
    await page.keyboard.press("Escape");
    await page.locator(".capture-close-confirm").waitFor();
    check(/1 card is not added yet/.test(await page.locator(".capture-close-confirm").innerText()), "closing with a complete, unsaved card asks first");
    await page.screenshot({ path: `${shots}/capture-close-confirm.png` });
    await page.click('.capture-close-confirm button:has-text("Add and close")');
    await page.waitForTimeout(1200);
    check(await sql(`select count(*) from heuresis_cards where data->>'term'='最近' and pack_id='${HSK}'`) === "1", "Add and close adds the card");
  },

  async "search opens a Study card directly in its topic"(page) {
    await page.keyboard.press("Control+KeyK");
    await page.waitForSelector(".ws-palette input");
    await page.keyboard.type("already");
    await page.locator(".ws-palette-row.is-card").first().waitFor({ timeout: 5000 });
    check(await page.locator(".ws-palette-row.is-cards").count() === 1, "full card search is still one row away");
    await page.screenshot({ path: `${shots}/palette-cards.png` });
    await page.locator(".ws-palette-row.is-card").first().click();
    await page.locator('.modern-topic-row[aria-selected="true"]').waitFor({ timeout: 8000 });
    const selected = await page.locator('.modern-topic-row[aria-selected="true"] .modern-card-title').innerText();
    check(selected.includes("已经"), `the topic opens with that card selected (“${selected}”)`);
  },

  async "review keeps the prompt visible after reveal"(page) {
    await page.goto(`${BASE}?cosmos=1&mode=review&pack=${HSK}&source=all&order=pack&count=3`);
    await page.locator(".cosmos-count").waitFor({ timeout: 15000 });
    const prompt = (await page.locator(".cosmos-card-copy").innerText()).trim();
    await page.keyboard.press(" ");
    await page.locator(".cosmos-card-copy.revealed").waitFor();
    const recap = (await page.locator(".cosmos-core-field.is-recap").allInnerTexts()).join(" ");
    check(recap.length > 0 && prompt.includes(recap.split(" ")[0]), `the prompt stays above the answer (“${recap}”)`);
    check(await page.locator(".cosmos-card-copy.revealed .cosmos-core-field:not(.is-recap)").count() > 0, "the answer is shown below it");
    await page.screenshot({ path: `${shots}/review-revealed.png` });
  },

  async "empty review selection is explained, not reported as a failure"(page) {
    await page.goto(`${BASE}?cosmos=1&mode=review&pack=${HSK}&source=favourites&order=pack&count=3`);
    await page.waitForFunction(() => { const state = document.querySelector(".cosmos-state"); return Boolean(state && !/Opening/.test(state.textContent ?? "")); }, null, { timeout: 15000 });
    const text = await page.locator(".cosmos-state").innerText();
    check(/Nothing to review here/.test(text) && !/could not open/i.test(text), `calm empty state (“${text.split("\n")[0]}”)`);
  },

  async "edit card works from the keyboard"(page) {
    await openTopic(page);
    await page.locator('.modern-topic-row:has-text("刚才")').dblclick();
    await page.locator(".card-editor-modal").waitFor();
    await page.keyboard.press("Escape");
    check(await page.locator(".card-editor-modal").count() === 0, "Escape closes Edit card");
    await page.locator('.modern-topic-row:has-text("刚才")').dblclick();
    await page.locator(".card-editor-modal").waitFor();
    const meaning = page.locator(".card-editor-modal .field-row").filter({ has: page.locator("span", { hasText: /^English/ }) }).locator("input");
    await meaning.fill("just now; a moment ago");
    await page.keyboard.press("Control+Enter");
    await page.waitForTimeout(1200);
    check(await sql(`select data->>'meaning' from heuresis_cards where data->>'term'='刚才'`) === "just now; a moment ago", "Ctrl+Enter saves the card");
    check(await page.locator(".card-editor-modal").count() === 0, "and closes the editor");
  },

  async "Quick Capture respects Chinese IME candidate keys"(page) {
    await page.keyboard.press("Control+Shift+KeyN");
    await page.locator(".qc-panel").waitFor();
    const input = page.locator('textarea[aria-label="Quick note"]');
    await input.fill("我正在写汉字");
    // Some real input methods report keyCode 229 even if isComposing is false.
    await input.evaluate((element) => {
      for (const key of ["Enter", "Escape"]) {
        const event = new KeyboardEvent("keydown", { key, bubbles: true, ctrlKey: key === "Enter" });
        Object.defineProperty(event, "keyCode", { get: () => 229 });
        element.dispatchEvent(event);
      }
    });
    check(await page.locator(".qc-panel").count() === 1, "IME candidate Enter/Escape does not close Quick Capture or submit notes");
    check(await input.inputValue() === "我正在写汉字", "Chinese note remains intact during composition");
    await page.keyboard.press("Escape");
    check(await page.locator(".qc-panel").count() === 0, "Ordinary Escape still closes Quick Capture");
  },

  async "Quick Capture offers one clear Save and Close action"(page) {
    await page.keyboard.press("Control+Shift+KeyN");
    await page.locator(".q-capture-panel").waitFor();
    check(await page.locator('.q-capture-panel button[aria-label="Close Quick Capture"]').count() === 1,
      "one labelled close action is available");
    check(await page.locator(".q-capture-panel .q-primary:has-text(\"Save\")").count() === 1,
      "one save action is available");
    await page.locator('.q-capture-panel button[aria-label="Close Quick Capture"]').click();
    check(await page.locator(".q-capture-panel").count() === 0, "Close dismisses Quick Capture");
  },

  async "notebook counts read naturally"(page) {
    await page.click('.hw-sections button:has-text("Notebook")');
    await page.waitForTimeout(800);
    const russian = await page.locator('.nb-home-subject:has-text("Russian") .nb-subject-copy > span').innerText();
    check(russian === "1 topic · 1 note", `singular and plural are right (“${russian}”)`);
  },

  async "notebook creates subjects and customises their cards"(page) {
    console.log("NB77: entering Notebook");
    await page.click('.hw-sections button:has-text("Notebook")');
    await page.waitForSelector(".nb-home-subject");
    console.log("NB77: click New");
    await page.locator(".nb-new-button").click();
    for (const label of ["New subject", "New topic", "New note"]) {
      check(await page.locator('.nb-scope-head [role=menuitem]:has-text("' + label + '")').count() === 1, label + " exists once");
    }
    console.log("NB77: click New subject");
    await page.locator('.nb-scope-head [role=menuitem]:has-text("New subject")').click();
    console.log("NB77: new subject form");
    await page.locator(".nb-create-shell input").fill("Philosophy");
    await page.locator(".nb-create-shell input").press("Enter");
    await page.waitForSelector('.nb-scope-head h1:has-text("Philosophy")');
    console.log("NB77: click breadcrumb");
    await page.locator('.nb-crumbs button:has-text("Notebook")').click();
    await page.waitForSelector('.nb-home-subject:has-text("Philosophy")');
    check(await page.locator(".nb-home-subject").count() === 4, "a fourth subject can be created");
    await page.locator(".nb-new-button").click();
    await page.locator('.nb-scope-head [role=menuitem]:has-text("New topic")').click();
    await page.locator("#nb-new-topic-subject").selectOption({label:"Philosophy"});
    await page.locator(".nb-create-shell input").fill("Ethics");
    await page.locator(".nb-create-shell input").press("Enter");
    await page.waitForSelector('.nb-scope-head h1:has-text("Ethics")');
    await page.locator('.nb-crumbs button:has-text("Philosophy")').click();
    check(await page.locator('.nb-topic-card:has-text("Ethics")').count() === 1, "Subject shows its topic as a card");
    check(await page.locator('.nb-doc-row').count() === 0, "Subject does not mix notes into the topic overview");
    check(await page.locator('.nb-scope-meta').count() === 0, "No Mistake Log counter on subject landing");
    await page.locator('.nb-topic-card:has-text("Ethics")').click();
    await page.waitForSelector('.nb-scope-head h1:has-text("Ethics")');

    check(true, "New topic creates a topic inside the chosen subject");
    await page.locator('.nb-crumbs button:has-text("Notebook")').click();
    await page.locator('.nb-home-subject:has-text("Philosophy") .nb-subject-open').click();
    await page.locator('.nb-topic-card:has-text("Ethics")').click();
    await page.locator(".nb-new-button").click();
    await page.locator('.nb-scope-head [role=menuitem]:has-text("New note")').click();
    await page.waitForSelector(".nb-title-input");
    check(await page.locator(".qc-panel").count() === 0, "New note does not open Quick Capture");
    check(await page.locator('.nb-toolbar [aria-label="Bold"]').count() === 1, "New note opens the rich-text editor");
    await page.locator(".nb-title-input").fill("Today's grammar");
    await page.locator('.nb-editor[contenteditable="true"]').fill("今天是星期日。 Jīntiān shì xīngqīrì.");
    await page.locator('.nb-doc-actions button:has-text("Done")').click();
    await page.locator('.nb-doc-title:has-text("Today")').waitFor();
    await page.locator('.nb-doc-actions button[aria-label="More actions"]').click();
    check(await page.getByRole("menuitem", { name: "Open in new window" }).count() === 1,
      "A saved note offers a separate writing window through More actions");
    await page.locator('.nb-doc-actions button[aria-label="More actions"]').click();
    // The Notebook section is a home button, including when it is already selected.
    await page.locator('.hw-sections button:has-text("Notebook")').click();
    await page.locator('.nb-home-subject:has-text("Philosophy")').waitFor();
    check(await page.locator(".nb-doc").count() === 0, "Clicking Notebook leaves the last note and shows the subject library");
    // Overview now reports Study activity; saved notes remain accessible from Notebook topics.
    await page.locator('.hw-sections button:has-text("Overview")').click();
    await page.locator(".oh-overview .oh-coverage").waitFor();
    check(await page.locator(".oh-overview .oh-coverage").count() === 1,
      "Overview displays Study review coverage");
    await page.locator('.hw-sections button:has-text("Notebook")').click();
    await page.locator('.nb-home-subject:has-text("Philosophy") .nb-subject-open').click();
    await page.locator('.nb-topic-card:has-text("Ethics")').click();
    await page.locator('.nb-doc-open:has-text("Today")').click();
    await page.locator('.nb-doc-title:has-text("Today")').waitFor();
    check(await page.locator(".nb-doc").count() === 1,
      "A saved note reopens from its Notebook topic");
    await page.locator('.hw-sections button:has-text("Notebook")').click();
    await page.locator('.nb-home-subject:has-text("Philosophy") .nb-subject-open').click();
    await page.locator('.nb-topic-card:has-text("Ethics")').click();
    // Two independent editor windows must not share the same unsaved draft key.
    await page.locator(".nb-new-button").click();
    const firstWindow = page.waitForEvent("popup");
    await page.locator('.nb-scope-head [role=menuitem]:has-text("New writing window")').click();
    const grammarWindow = await firstWindow;
    await grammarWindow.locator(".nb-title-input").waitFor();
    const secondWindow = grammarWindow.waitForEvent("popup");
    await grammarWindow.locator('.nb-window-actions button:has-text("New note")').click();
    const helpWindow = await secondWindow;
    await helpWindow.locator(".nb-title-input").waitFor();
    check(grammarWindow.url() !== helpWindow.url(), "separate windows use separate note identities");
    await grammarWindow.locator(".nb-title-input").fill("Grammar notes");
    await grammarWindow.locator('.nb-editor[contenteditable="true"]').fill("了 marks completion.");
    await helpWindow.locator(".nb-title-input").fill("Sentence help");
    await helpWindow.locator('.nb-editor[contenteditable="true"]').fill("请再说一遍。");
    await grammarWindow.locator('.nb-doc-actions button:has-text("Done")').click();
    await helpWindow.locator('.nb-doc-actions button:has-text("Done")').click();
    await grammarWindow.locator('.nb-doc-title:has-text("Grammar notes")').waitFor();
    await helpWindow.locator('.nb-doc-title:has-text("Sentence help")').waitFor();
    await grammarWindow.close(); await helpWindow.close();
    await page.locator('.nb-crumbs button:has-text("Notebook")').click();
    console.log("NB77: double click German");
    await page.locator('.nb-home-subject:has-text("German") .nb-subject-open').dblclick();
    await page.waitForSelector(".nb-cover-dialog");
    console.log("NB77: select colour");
    await page.locator('.nb-colour-option[aria-label="Colour 1"]').click();
    console.log("NB77: save cover");
    await page.locator('.nb-cover-dialog button:has-text("Save")').click();
    await page.locator(".nb-cover-dialog").waitFor({ state: "hidden" });
    const colour = await page.locator('.nb-home-subject:has-text("German")').evaluate(el => getComputedStyle(el).getPropertyValue("--nb-subject-accent").trim());
    check(colour === "#354b68", "a colour choice changes the subject card accent");
    await page.reload();
    await page.waitForSelector('.nb-home-subject:has-text("German")');
    const retained = await page.locator('.nb-home-subject:has-text("German")').evaluate(el => getComputedStyle(el).getPropertyValue("--nb-subject-accent").trim());
    check(retained === colour, "subject colour survives reopening");
    // Cover images should survive reload without any database migration.
    await page.locator('.nb-home-subject:has-text("German") .nb-subject-open').dblclick();
    await page.waitForSelector(".nb-cover-dialog");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPU9k1hYGBgYmBgYGBgAAAKQQDgBh0uIwAAAABJRU5ErkJggg==", "base64");
    await page.locator('.nb-cover-dialog input[type="file"]').setInputFiles({name:"cover.png",mimeType:"image/png",buffer:png});
    await page.waitForSelector(".nb-cover-preview");
    await page.locator('.nb-cover-dialog button:has-text("Save")').click();
    await page.locator(".nb-cover-dialog").waitFor({ state: "hidden" });
    const image = await page.locator('.nb-home-subject:has-text("German")').evaluate(el => getComputedStyle(el).backgroundImage);
    check(image.includes("blob:"), "cover image applies to subject card");
    await page.reload();
    await page.waitForSelector('.nb-home-subject:has-text("German")');
    await page.waitForFunction(() => getComputedStyle([...document.querySelectorAll(".nb-home-subject")].find(el => el.textContent?.includes("German"))).backgroundImage.includes("blob:"));
    check(true, "cover image survives reopening");
  },

  async "reference note stays in the Notebook; the Catalogue only copies it on request"(page) {
    const topicId = await sql("select id from knowledge_topics where user_id='11111111-1111-4111-8111-111111111111' limit 1");
    check(Boolean(topicId), "test user has a Notebook topic");
    await sql(`insert into knowledge_records(id,user_id,topic_id,kind,title,body,category)
      values ('e0000000-0000-4000-8000-00000000b001','11111111-1111-4111-8111-111111111111','${topicId}',
      'note','Roman Ideas',E'# Republic\\n\\nA mixed constitution.\\n\\n# Citizenship\\n\\nA civic status.','reference')`);
    const note = () => sql("select title || '|' || body || '|' || updated_at from knowledge_records where id='e0000000-0000-4000-8000-00000000b001'");
    const before = await note();
    await page.reload();
    await page.waitForSelector(".heuresis-section-sidebar");
    await page.click('.hw-sections button:has-text("Catalogue")');
    await page.locator(".ct-library").waitFor();
    check(!(await page.locator(".ct-library").innerText()).includes("Roman Ideas"), "a Reference note does not appear in the Catalogue by itself");
    check(await page.locator("button.ct-create").count() === 1, "the empty Catalogue offers Create Article");
    await page.click("button.ct-create");
    await page.click('.ct-choice:has-text("From Notebook")');
    await page.fill('input[aria-label="Find a note"]', "Roman Ideas");
    await page.locator('.ct-note-list button:has(strong:text-is("Roman Ideas"))').click();
    await page.waitForSelector(".ct-studio .ct-page-slot", { timeout: 20000 });
    await page.locator("input.ct-bar-title").fill("Roman Ideas, revised for print");
    await page.waitForFunction(() => document.querySelector(".ct-save")?.textContent === "Saved", null, { timeout: 15000 });
    check(await sql("select count(*) from catalogue_articles where source_note_id='e0000000-0000-4000-8000-00000000b001' and title='Roman Ideas, revised for print' and status='draft'") === "1",
      "the article is a separate draft copy");
    check(await note() === before, "editing the article leaves the Notebook note unchanged");
    await page.locator(".ct-bar-back").click();
    await page.click('.hw-sections button:has-text("Notebook")');
    await page.waitForTimeout(600);
    check(await sql("select count(*) from knowledge_records where id='e0000000-0000-4000-8000-00000000b001' and deleted_at is null and category='reference'") === "1",
      "the note is still a Reference note in the Notebook");
  },

  async "sidebar shortcut changes navigation mode"(page) {
    check(await page.locator(".hw-sidebar-header-toggle").count() === 1, "one header sidebar toggle exists");
    const desktop = page.locator(".heuresis-desktop");
    const before = await desktop.getAttribute("data-sidebar");
    await page.keyboard.press("Control+Backslash");
    check(await desktop.getAttribute("data-sidebar") !== before, "sidebar shortcut changes navigation mode");
    await page.keyboard.press("Control+Backslash");
    check(await desktop.getAttribute("data-sidebar") === before, "sidebar can return to its previous mode");
  },
};

const TABLET = "tablet: topic rows stay compact";
async function tabletRows() {
  restore();
  console.log(`— ${TABLET}`);
  const { browser, page, errors } = await launch({ width: 820, height: 1180 });
  try {
    await addUnsortedCards();
    await signIn(page);
    await openTopic(page);
    const heights = await page.locator(".modern-topic-row").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
    const tallest = Math.max(...heights);
    check(tallest <= 110, `each card row is at most 110px tall (tallest ${Math.round(tallest)}px)`);
    await page.screenshot({ path: `${shots}/tablet-topic.png` });
    check(!errors.filter((message) => !/Failed to load resource/.test(message)).length, "no page errors");
  } finally { await browser.close(); }
}

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
if (!only || TABLET.includes(only)) await tabletRows();
if (failures) console.log(`${failures} scenario(s) stopped with an exception.`);
