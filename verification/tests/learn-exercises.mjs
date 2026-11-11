// Checks of the Learn exercise generator and answer checking (src/lib/learnExercises.ts),
// without a browser or a database: every kind of card gets exactly five sound exercises,
// the right answer is always judged right, and language-specific exercises appear where
// the card supports them.
//   node tests/learn-exercises.mjs
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const require = createRequire(`${root}package.json`);
const out = mkdtempSync(`${tmpdir()}/heuresis-learn-`);
// The module is TypeScript written for Vite; esbuild (shipped with Vite) turns it into one file.
require("esbuild").buildSync({
  entryPoints: [`${root}src/lib/learnExercises.ts`], bundle: true, format: "cjs", platform: "node",
  outfile: `${out}/learnExercises.cjs`, logLevel: "error", define: { "import.meta.env": "{}" },
});
globalThis.localStorage ??= { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, setTimeout, clearTimeout, location: { href: "http://x/", search: "", origin: "http://x" }, navigator: { onLine: true } };
globalThis.document ??= { addEventListener() {}, visibilityState: "visible" };
const { buildRound, checkExercise, readPlan, writtenForm, locateInSentence } = require(`${out}/learnExercises.cjs`);
rmSync(out, { recursive: true, force: true });

let failed = 0;
const check = (condition, message) => { console.log(`  ${condition ? "✓" : "✗"} ${message}`); if (!condition) failed += 1; };
const HAN = /\p{Script=Han}/u;
const card = (id, term, meaning, extra = {}) => ({
  id, term, form: writtenForm(term), reading: "", meaning, examples: [], language: null,
  han: HAN.test(term), wordSized: writtenForm(term).split(" ").length <= 3 && !/[.!?。！？]$/.test(term), ...extra,
});
const example = (source, translation = "", reading = "") => ({ source, translation, reading });

const topics = {
  "German (B1)": [
    card("de1", "die Entwicklung, -en", "development", { language: "de", examples: [example("Die Entwicklung dauert zwei Jahre.", "The development takes two years.")] }),
    card("de2", "der Vorschlag, ¨-e", "suggestion; proposal", { language: "de" }),
    card("de3", "sich freuen auf", "to look forward to", { language: "de", examples: [example("Ich freue mich auf das Wochenende.", "I am looking forward to the weekend.")] }),
    card("de4", "anrufen", "to call (by phone)", { language: "de", examples: [example("Ich rufe dich morgen an.", "I will call you tomorrow.")] }),
    card("de5", "das Mädchen, -", "girl", { language: "de" }),
    card("de6", "Ich hätte gern einen Kaffee, bitte.", "I would like a coffee, please.", { language: "de" }),
  ],
  "Russian (A2)": [
    card("ru1", "говорить", "to speak; to talk", { language: "ru", reading: "говори́ть", examples: [example("Я говорю по-русски.", "I speak Russian.")] }),
    card("ru2", "понимать", "to understand", { language: "ru", reading: "понима́ть" }),
    card("ru3", "молоко", "milk", { language: "ru", reading: "молоко́" }),
    card("ru4", "читать / прочитать", "to read (impf / pf)", { language: "ru" }),
    card("ru5", "город", "city; town", { language: "ru", reading: "го́род" }),
  ],
  "Chinese (HSK 2)": [
    card("zh1", "以前", "before; previously", { language: "zh", reading: "yǐqián", examples: [example("我以前住在北京。", "I used to live in Beijing.", "wǒ yǐqián zhù zài Běijīng")] }),
    card("zh2", "已经", "already", { language: "zh", reading: "yǐjīng" }),
    card("zh3", "的时候", "when; while; at the time of", { language: "zh", reading: "de shíhou" }),
    card("zh4", "水", "water", { language: "zh", reading: "shuǐ" }),
    card("zh5", "我明天去北京出差。", "I am going to Beijing on business tomorrow.", { language: "zh", reading: "wǒ míngtiān qù Běijīng chūchāi" }),
  ],
  "Philosophy (no language)": [
    card("ph1", "Categorical imperative", "Kant's principle: act only on a maxim you could will to be a universal law", { examples: [example("The categorical imperative binds every rational agent regardless of their desires.")] }),
    card("ph2", "Utilitarianism", "the view that the right action maximises overall happiness"),
    card("ph3", "Epoché", "suspension of judgement about the external world"),
    card("ph4", "A priori", "knowledge independent of experience"),
    card("ph5", "Dasein", "Heidegger's term for the being that we ourselves are"),
  ],
  "A topic with one card": [card("one", "Hapax legomenon", "a word that occurs only once in a text or corpus")],
  "A topic with two cards": [card("two1", "der Tisch", "table", { language: "de" }), card("two2", "die Lampe", "lamp", { language: "de" })],
};

const right = (exercise) => {
  if (exercise.format === "choice") return { format: "choice", choiceId: exercise.answerId };
  if (exercise.format === "build") {
    const left = [...exercise.tiles];
    return { format: "build", tileIds: exercise.answer.map((text) => left.splice(left.findIndex((tile) => tile.text === text), 1)[0].id) };
  }
  if (exercise.format === "gaps") return { format: "gaps", letters: exercise.cells.filter((cell) => cell.gap).map((cell) => cell.ch) };
  return { format: "type", text: typeof exercise.accepted[0] === "string" ? exercise.accepted[0] : exercise.accepted[0].value };
};

const seen = new Map();
console.log("— every card, three rounds: five sound exercises");
for (const [topic, cards] of Object.entries(topics)) {
  const problems = [];
  for (const item of cards) {
    const perRound = [];
    for (const round of [1, 2, 3]) {
      const plan = buildRound({ card: item, pool: cards, round, seed: `seed-${round}` });
      const kinds = plan.map((exercise) => exercise.kind);
      perRound.push(kinds.join(","));
      if (round === 1) seen.set(item.id, plan);
      const note = (text) => problems.push(`${item.term} r${round}: ${text}`);
      if (plan.length !== 5) note("not five exercises");
      if (plan.map((exercise) => exercise.stage).join() !== "recognition,reconstruction,completion,context,recall") note("stages out of order");
      if (new Set(kinds).size !== 5 && cards.length > 1) note(`an exercise type repeats (${kinds.join(", ")})`);
      if (!/^recall-(type|build)$/.test(plan[4].kind)) note("does not end with independent recall");
      if (!readPlan(JSON.parse(JSON.stringify(plan)))) note("the stored round cannot be read back");
      if (JSON.stringify(buildRound({ card: item, pool: cards, round, seed: `seed-${round}` })) !== JSON.stringify(plan)) note("not deterministic");
      for (const exercise of plan) {
        const shown = `${exercise.prompt.text} ${exercise.prompt.sub ?? ""}`.toLocaleLowerCase();
        if (exercise.stage === "recall" && shown.includes(item.form.toLocaleLowerCase())) note("the recall question shows its answer");
        if (exercise.format === "choice") {
          // A two-syllable Russian word has exactly two places for its stress.
          if (exercise.choices.length < (exercise.kind === "choose-stress" ? 2 : 3)) note(`${exercise.kind}: too few choices`);
          if (new Set(exercise.choices.map((choice) => choice.label)).size !== exercise.choices.length) note(`${exercise.kind}: two identical choices`);
          if (exercise.choices.filter((choice) => choice.id === exercise.answerId).length !== 1) note(`${exercise.kind}: not exactly one right choice`);
          const wrong = exercise.choices.find((choice) => choice.id !== exercise.answerId);
          if (checkExercise(exercise, { format: "choice", choiceId: wrong.id }).correct) note(`${exercise.kind}: a wrong choice is accepted`);
        }
        if (exercise.format === "build") {
          if (exercise.tiles.slice(0, exercise.answer.length).map((tile) => tile.text).join("|") === exercise.answer.join("|")) note(`${exercise.kind}: the pieces start in the right order`);
          const trimmed = exercise.tiles.map((tile) => tile.text.trim().toLocaleLowerCase());
          const own = new Set(exercise.answer.map((text) => text.trim().toLocaleLowerCase()));
          if (exercise.tiles.some((tile, index) => !exercise.answer.includes(tile.text) && own.has(trimmed[index]))) note(`${exercise.kind}: a wrong piece looks like a right one`);
        }
        if (!checkExercise(exercise, right(exercise)).correct) note(`${exercise.kind}: the right answer is judged wrong`);
      }
    }
    if (cards.length >= 4 && new Set(perRound).size < 2) problems.push(`${item.term}: three rounds with the same exercises`);
  }
  check(problems.length === 0, `${topic}: ${cards.length} ${cards.length === 1 ? "card" : "cards"}${problems.length ? ` — ${problems.join("; ")}` : ""}`);
}

const kindsOf = (id) => seen.get(id).map((exercise) => exercise.kind);
const find = (id, kind) => seen.get(id).find((exercise) => exercise.kind === kind);
console.log("— exercises follow the card's language and content");
const article = find("de1", "choose-article");
check(Boolean(article) && article.choices.map((choice) => choice.label).join() === "der,die,das" && article.answerId === "die" && /-ung take die/.test(article.explain), "German noun: der / die / das, with the -ung rule in the explanation");
check(Boolean(find("de5", "choose-article")) && find("de5", "choose-article").answerId === "das", "German: das Mädchen");
const preposition = find("de3", "choose-preposition");
check(Boolean(preposition) && preposition.prompt.text === "sich freuen ＿" && preposition.answerId === "auf", "German verb: its preposition (sich freuen ＿)");
const cloze = find("de3", "cloze-choice");
check(Boolean(cloze) && cloze.prompt.text === "Ich ＿＿＿ mich auf das Wochenende.", "German: the conjugated verb is found in its example (freue)");
const separable = locateInSentence({ form: "anrufen", han: false, language: "de" }, "Ich rufe dich morgen an.");
check(Boolean(separable) && "Ich rufe dich morgen an.".slice(separable.start, separable.end) === "rufe", "German: a separable verb is found by its stem (rufe … an)");
check(kindsOf("de6")[4] === "recall-build" || kindsOf("de6")[4] === "recall-type", "German sentence: word order is rebuilt or typed at the end");
const stress = find("ru1", "choose-stress");
check(Boolean(stress) && stress.prompt.text === "говорить" && stress.choices.find((choice) => choice.id === stress.answerId).label === "говори́ть", "Russian: where the stress falls (говори́ть)");
check(Boolean(find("ru1", "cloze-choice")) && find("ru1", "cloze-choice").prompt.text === "Я ＿＿＿ по-русски.", "Russian: the inflected form is found in its sentence (говорю)");
check(!kindsOf("ru4").includes("choose-stress"), "Russian card without a stress mark: no stress question is invented");
const missing = find("zh1", "missing-character");
check(Boolean(missing) && /＿/.test(missing.prompt.text) && missing.choices.every((choice) => HAN.test(choice.label)), "Chinese: the missing character among other characters");
const tones = seen.get("zh4").find((exercise) => exercise.kind === "choose-reading") ?? buildRound({ card: topics["Chinese (HSK 2)"][1], pool: topics["Chinese (HSK 2)"], round: 2, seed: "t" }).find((exercise) => exercise.kind === "choose-reading");
const plain = (text) => text.normalize("NFD").replace(/\p{M}/gu, "");
check(Boolean(tones) && new Set(tones.choices.map((choice) => plain(choice.label))).size === 1, "Chinese: pinyin choices differ only in their tones");
check(kindsOf("zh5")[4] === "recall-build", "Chinese sentence: built from memory at the end");
check(kindsOf("ph1").includes("cloze-choice") && find("ph1", "cloze-choice").prompt.text.startsWith("The ＿＿＿ binds"), "Knowledge card: the concept in its sentence");
check(buildRound({ card: topics["Philosophy (no language)"][2], pool: topics["Philosophy (no language)"], round: 3, seed: "s3" }).some((exercise) => exercise.kind === "build-meaning"), "Knowledge card: its definition put back in order");
check(new Set(kindsOf("one")).size === 5, `A lone card still gets five different exercises (${kindsOf("one").join(", ")})`);

console.log("— answers: legitimate variants are accepted, real mistakes are explained");
const typed = (id, text, round = 1) => {
  const topic = Object.values(topics).find((cards) => cards.some((item) => item.id === id));
  const exercise = buildRound({ card: topic.find((item) => item.id === id), pool: topic, round, seed: "typed" })[4];
  return checkExercise(exercise, { format: "type", text });
};
check(typed("de1", "die Entwicklung").correct && typed("de1", "  die entwicklung ").correct, "German: capitals and stray spaces do not matter");
check(typed("de5", "das Maedchen").correct, "German: ae / oe / ue / ss for ä ö ü ß");
const noArticle = typed("de1", "Entwicklung");
check(!noArticle.correct && /article/.test(noArticle.message), "German: the noun without its article is not accepted, and the feedback says why");
check(!typed("de1", "die Entwiklung").correct, "German: a misspelling is not accepted");
check(typed("ru1", "говорить").correct && typed("ru1", "говори́ть").correct, "Russian: with or without the stress mark");
check(typed("ru4", "читать").correct && typed("ru4", "прочитать").correct, "Russian: either aspect of an aspect pair");
check(typed("zh1", "以前").correct && typed("zh1", "yi3qian2").correct && typed("zh1", "yǐqián").correct, "Chinese: characters, or pinyin with tone marks or numbers");
const toneless = typed("zh1", "yiqian");
check(!toneless.correct && /tones/.test(toneless.message), "Chinese: pinyin without tones is not accepted, and the feedback says why");
check(typed("ph3", "epoche").correct === false && typed("ph3", "Epoché").correct, "Accents count when they are part of the word (Epoché)");
const meaning = buildRound({ card: topics["A topic with two cards"][0], pool: topics["A topic with two cards"], round: 1, seed: "m" }).find((exercise) => exercise.kind === "type-meaning");
check(Boolean(meaning) && checkExercise(meaning, { format: "type", text: "Table" }).correct && !checkExercise(meaning, { format: "type", text: "lamp" }).correct, "A typed meaning is checked as a gloss");
check(!checkExercise(seen.get("de1")[4], { format: "type", text: "" }).correct, "An empty answer (I don’t know) is wrong, never an error");

console.log(failed ? `FAILED (${failed})` : "All Learn exercise checks passed.");
process.exit(failed ? 1 : 0);
