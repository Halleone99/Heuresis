// Editor behaviour: markdown shortcuts, blocks, paste, source mode, undo.
import { check, launch, signIn, sql } from "./lib.mjs";
const { browser, context, page, errors } = await launch();
await signIn(page);
const mod = "Control";
await page.click(`.hw-sections button:has-text("Notebook")`);
await page.keyboard.press(`${mod}+KeyK`); await page.keyboard.type("Предложный"); await page.waitForTimeout(150); await page.keyboard.press("Enter");
await page.waitForSelector(".nb-doc-title");
await page.keyboard.press("e");
await page.waitForSelector(".nb-editor");
await page.click(".nb-editor > p:last-child");
await page.keyboard.type("# Падежи");
await page.keyboard.press("Enter");
await page.keyboard.type("- в Москве");
await page.keyboard.press("Enter");
await page.keyboard.type("на работе");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter"); // leaves the list
await page.keyboard.type("1. first");
await page.keyboard.press("Enter");
await page.keyboard.type("second");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter");
await page.click(".nb-toolbar button:has-text('Example')");

await page.keyboard.type("Я работаю в офисе.");
await page.keyboard.press("Enter");
await page.keyboard.type("I work in an office.");
await page.keyboard.press("Enter");
await page.keyboard.press("Enter"); // empty line exits the callout
await page.keyboard.type("After the example ");
await page.keyboard.press(`${mod}+Shift+KeyH`); // nothing selected → no-op
await page.keyboard.down("Shift"); for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowLeft"); await page.keyboard.up("Shift");
await page.keyboard.press(`${mod}+KeyI`);
await page.keyboard.press("End");

await context.grantPermissions(["clipboard-read", "clipboard-write"]);
await page.evaluate(() => navigator.clipboard.writeText("pasted line one\n- pasted bullet\n**bold** text"));
await page.keyboard.press("Enter");
await page.keyboard.press(`${mod}+KeyV`);
await page.waitForTimeout(1600);
const body = await sql("select body from knowledge_records where title='Предложный падеж'");
console.log(body);
check(body.includes("# Падежи"), "'# ' became a heading");
check(body.includes("- в Москве\n- на работе"), "'- ' started a bulleted list that continues on Enter");
check(body.includes("1. first\n2. second"), "'1. ' started a numbered list");
check(body.includes("> [!example]\n> Я работаю в офисе.\n> I work in an office."), "Example block stored as a callout");
check(/After the \*example\*/.test(body), "Ctrl+I italicised the selection");
check(body.includes("pasted line one\n- pasted bullet\n**bold** text"), "multi-line paste keeps lines, lists and bold");
await page.click(".nb-toolbar button[title='Edit the plain text source']");
await page.waitForSelector(".nb-source");
const source = await page.inputValue(".nb-source");
check(source === body, "source view shows exactly the stored text");
await page.fill(".nb-source", source + "\n\nAdded in source ==mode==");
await page.click(".nb-toolbar button[title='Edit the plain text source']");
await page.waitForSelector(".nb-editor mark");
check(true, "switching back renders the source edits (highlight)");
await page.keyboard.press(`${mod}+Enter`);
await page.waitForSelector(".nb-doc-body .nb-prose");
check((await sql("select body from knowledge_records where title='Предложный падеж'")).endsWith("Added in source ==mode=="), "source edit saved");
check(await page.locator(".nb-doc-body mark").count() === 1 && await page.locator(".nb-doc-body .nb-callout[data-callout='example']").count() === 2, "reading view renders highlight and example blocks");
check(errors.length === 0, `no page errors (${errors.length})`);
await browser.close();
