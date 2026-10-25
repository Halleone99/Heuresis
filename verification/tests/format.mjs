import { chromium } from "playwright";
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("http://localhost:1421/");
const samples = [
  "Plain line",
  "***bold italic***",
  "# What we covered\n\n## New words and expressions\n- 的时候 **when**\n- *while*\n\n## To practise\n",
  "Intro line\nsecond line\n\nAfter blank",
  "- one\n  - nested a\n  - nested b\n- two\n1. first\n2. second",
  "> a quote\n> continues\n\n> [!example]\n> 吃饭的时候下雨了。\n> Chīfàn de shíhou xià yǔ le.\n> It rained while we ate.\n\n> [!rule]\n> 的时候 follows a clause",
  "Text with ==highlight== and [[的时候]] and [[Lesson 7|this lesson]]",
  "---\nМосква — **столица** России.\nIch *freue* mich auf das Wochenende.",
  "a * b * c and 5*3 and **bold with spaces **",
  "1. step\n   - detail\n2. next",
  "   indented text",
  "| a | b |\n|---|---|\n| 1 | 2 |",
  "",
  "> [!rule]\n> Use **auf** for the future:\n> - sich freuen auf\n> - warten auf\n\nAfter",
  "> [!example]\n> 我是昨天来的。\n> Wǒ shì zuótiān lái de.\n>\n> 他一边吃饭一边看手机。\n> He looks at his phone while eating.",
  "好了！ — Hǎo le! — I\'m ready!\n我不明白。 — Wǒ bù míngbai. — I don\'t understand.\n请再说一遍。 — Qǐng zài shuō yí biàn.",
  "Wo\u030C bu\u0300 mi\u0301ngbai",
];
const result = await page.evaluate(async (samples) => {
  const mod = await import("/src/lib/noteFormat.ts");
  return samples.map((md) => {
    const div = document.createElement("div");
    div.innerHTML = mod.markdownToEditorHtml(md);
    const back = mod.editorToMarkdown(div);
    const div2 = document.createElement("div");
    div2.innerHTML = mod.markdownToEditorHtml(back);
    const again = mod.editorToMarkdown(div2);
    return { md, html: div.innerHTML, back, stable: back === again, exact: back === md.replace(/\n+$/, ""), pinyinSpans: div.querySelectorAll("span.nb-pinyin[lang='zh-Latn']").length };
  });
}, samples);
for (const r of result) {
  console.log(`--- exact=${r.exact} stable=${r.stable}`);
  if (!r.exact) { console.log("IN :", JSON.stringify(r.md)); console.log("OUT:", JSON.stringify(r.back)); console.log("HTML:", r.html); }
}
// Combined emphasis must stay styled and preserve its exact Markdown on reopen.
const emphasis = result.find((entry) => entry.md === "***bold italic***");
if (!emphasis || !emphasis.exact || !emphasis.stable || !emphasis.html.includes("<strong><em>bold italic</em></strong>"))
  throw new Error("Combined bold and italic must round-trip without stray asterisks.");
const pinyinSamples = result.slice(-2);
if (!pinyinSamples.every((entry) => entry.stable && entry.pinyinSpans > 0))
  throw new Error("Pinyin tone marks must survive editor HTML/Markdown round trips.");
if (pinyinSamples[0].back !== pinyinSamples[0].md)
  throw new Error("Precomposed pinyin must round-trip without losing its accents.");
if (!pinyinSamples[1].back.includes("Wǒ bù míngbai"))
  throw new Error("Decomposed tone marks must normalize to attached vowels.");
console.log("Pinyin formatting and round trip checks passed.");
await browser.close();
