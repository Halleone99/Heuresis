// Real-browser regression for knowledge modes. The disposable fixture has three Languages
// collections and no Applied collections; this must remain true when changing study mode.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { check, launch, signIn, sql } from "./lib.mjs";

// The mode badge is a button that opens a listbox; its accessible name says which mode is selected.
const modeBadge = (page) => page.getByRole("button", { name: /^Choose knowledge mode/ });
const selectedMode = async (page) => ((await modeBadge(page).getAttribute("aria-label")) ?? "").replace(/^.*, (\w+) selected$/, "$1").toLowerCase();
const chooseMode = async (page, label) => {
  await modeBadge(page).click();
  await page.getByRole("option", { name: new RegExp(`^${label}`) }).click();
};

const here = fileURLToPath(new URL("..", import.meta.url));
execFileSync("./db.sh", ["restore", "heuresis_showcase"], { cwd: here, stdio: "ignore" });

const { browser, page, errors } = await launch({ width: 1280, height: 880 });
try {
  await signIn(page);
  await page.locator('.hw-sections button:has-text("Study")').click();
  await modeBadge(page).waitFor();
  check(await selectedMode(page) === "languages", "Existing study collections start in Languages");
  check(await page.locator(".study-desk-feature").count() === 1, "Languages shows the existing Study Desk");

  await chooseMode(page, "Applied");
  await page.locator(".study-knowledge-empty").waitFor();
  check(await page.locator(".study-home").count() === 0, "Empty Applied has no language study panel");
  check(!/Chinese|German|Russian/.test(await page.locator(".intelligent-library").innerText()),
    "Applied does not leak language collection names or decks");
  check(await page.locator(".study-knowledge-empty button").count() === 1, "Applied can create its first collection");

  await page.locator(".study-knowledge-empty button").click();
  await page.locator(".collection-editor").waitFor();
  check(await page.locator(".collection-editor select").first().inputValue() === "applied",
    "New collection inherits the active Applied mode");
  await page.locator('.collection-editor input[placeholder="Name this collection"]').fill("Trade & Logistics");
  await page.locator('.collection-editor .primary-button').click();
  await page.locator('.collection-manager-row:has-text("Trade & Logistics")').waitFor();
  check(await sql("select study_mode from heuresis_collections where title='Trade & Logistics'") === "applied",
    "Applied assignment persists in the database");
  await page.locator(".management-modal .settings-head .icon-button").click();
  await page.locator(".study-desk-feature").waitFor();
  check((await page.locator(".study-desk-feature").innerText()).includes("Trade & Logistics"),
    "Applied collection appears when its mode is selected");
  check(!/Chinese|German|Russian/.test(await page.locator(".intelligent-library").innerText()),
    "Applied collection stays isolated from languages");

  await chooseMode(page, "Languages");
  await page.locator(".study-desk-feature").waitFor();
  check(!/Trade & Logistics/.test(await page.locator(".intelligent-library").innerText()),
    "Switching back to Languages hides the Applied collection");

  await page.reload();
  await page.locator('.hw-sections button:has-text("Study")').click();
  await modeBadge(page).waitFor();
  check(await selectedMode(page) === "languages", "Selected mode survives a refresh");
  check(errors.filter((message) => /Uncaught|TypeError|Cannot read properties/.test(message)).length === 0,
    "No runtime exceptions during knowledge mode switching");
} finally {
  await browser.close();
}
if (process.exitCode) process.exit(process.exitCode);
console.log("Study knowledge modes: real-browser smoke checks passed.");
