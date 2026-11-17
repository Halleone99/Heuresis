import { fieldByRole, fieldText, type CardWithStats, type PackWithType } from "./heuresis";
import { isWordSized, normaliseAnswer } from "./answerCheck";
import { rng, shuffle, tiles, uniqueBy } from "./learnRandom";
import { STAGE_ORDER } from "./learnRounds";
import { appliedCardKind, parseCaseText, splitList } from "./teachingShape";
import type { Choice, Exercise, ExerciseKind, JudgePoint, LearnCard, LearnCase, LearnExample, RuleParts } from "./learnExercises";

/**
 * Applied learning: rules, regulations, procedures and practical decisions.
 *
 * Same engine as every other card (five positions, 10 points each, Ready at 40/50 with the
 * last exercise right unaided, stored rounds, Review). What differs is how the five are
 * chosen: from a small library of exercises, by what the card actually contains.
 *
 *   Identify  which rule governs a situation, told apart from its nearest neighbours
 *   Scope     the condition, exception or threshold that decides whether it applies
 *   Sequence  a procedure's steps in order
 *   Apply     what follows in a case; which situation the rule covers
 *   Solve     a case kept back from the round, answered in writing (or the steps, or the rule)
 *
 * The plan always runs from recognising to producing. A card with steps gets Sequence; a card
 * with cases gets Apply; conditions and exceptions give Scope. Some identification questions
 * use a neighbouring rule's case, so "this round is about FCA" never answers the question.
 * Later rounds put first the skill that went wrong last time, hide the rule's name where a
 * first round names it, and prefer cases not yet seen. Weak "wording" exercises are used only
 * when a card holds too little for anything better.
 *
 * Nothing is invented as fact. Questions, answers and cases come from the card and from the
 * other rules of its topic (or collection). Wrong options may be another rule's statement or
 * case, the card's own exception offered as a condition, the same outcome with the parties
 * swapped, or a nearby amount; all of them are shown as wrong.
 */

export type AppliedSkill = "identify" | "scope" | "sequence" | "apply" | "solve" | "wording";

export const SKILL_LABEL: Record<AppliedSkill, string> = {
  identify: "Identify", scope: "Scope", sequence: "Sequence", apply: "Apply", solve: "Solve", wording: "Wording",
};

const KIND_SKILL: Partial<Record<ExerciseKind, AppliedSkill>> = {
  "rule-for-case": "identify", "rule-boundary": "identify", "rule-for-statement": "identify", "statement-for-rule": "identify",
  "missing-condition": "scope", "missing-exception": "scope", "missing-value": "scope",
  "order-steps": "sequence",
  "case-outcome": "apply", "which-case": "apply",
  "solve-case": "solve", "recall-steps": "solve", "state-rule": "solve",
  "build-statement": "wording", "complete-statement": "wording", "complete-condition": "wording", "name-rule": "wording",
};

/** Easier skills first; the unaided answer always comes last. */
const SKILL_ORDER: Record<AppliedSkill, number> = { identify: 0, wording: 1, scope: 2, sequence: 3, apply: 4, solve: 5 };

export function appliedSkill(kind: string): AppliedSkill | null {
  return KIND_SKILL[kind as ExerciseKind] ?? null;
}

/** What the previous round of this card showed and where it went wrong. */
export type RoundHistory = {
  score: number;
  /** Exercise kinds answered wrongly or with a hint. */
  weak: string[];
  /** Cases already shown (normalised situations). */
  seen: string[];
  /** The case solved at the end of that round, if any. */
  solved?: string[];
};

/** Reads a finished round back as history for the next one. Works on any stored plan. */
export function roundHistory(plan: unknown[], attempts: Array<{ position: number; correct: boolean; assisted: boolean }>, score: number): RoundHistory {
  const exercises = plan.filter((item): item is Exercise => Boolean(item && typeof item === "object" && typeof (item as Exercise).kind === "string"));
  const weak = attempts.filter((attempt) => !attempt.correct || attempt.assisted)
    .map((attempt) => exercises.find((exercise) => exercise.position === attempt.position)?.kind).filter((kind): kind is ExerciseKind => Boolean(kind));
  const keys = (exercise: Exercise) => (Array.isArray(exercise.uses) ? exercise.uses.filter((key) => typeof key === "string") : []);
  const seen = exercises.flatMap(keys);
  const solved = exercises.filter((exercise) => exercise.kind === "solve-case").flatMap(keys);
  return { score, weak: Array.from(new Set(weak)), seen: Array.from(new Set(seen)), solved };
}

/* ------------------------------------------------------------------------- */
/* The card as Applied reads it                                               */
/* ------------------------------------------------------------------------- */

function clean(value: string) { return value.normalize("NFC").replace(/\s+/g, " ").trim(); }
const caseKey = (item: LearnCase) => normaliseAnswer(item.situation);

/**
 * Further cases written on the card: example blocks (situation, outcome) and notes added
 * under Cases. A case marked as generated (for instance by an AI suggestion) is used only
 * once someone has confirmed it; until then it is not presented as a fact.
 */
function workspaceCases(card: CardWithStats): LearnCase[] {
  const raw = card.data["_workspace_blocks"];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    try {
      const value = JSON.parse(entry) as Record<string, unknown>;
      if (value.origin === "generated" && value.verified !== true) return [];
      if (value.type === "example") {
        const situation = clean(typeof value.source === "string" ? value.source : String(value.text ?? "").split("\n")[0]);
        return situation ? [{ situation, outcome: clean(typeof value.translation === "string" ? value.translation : "") }] : [];
      }
      if (value.type === "text" && value.dim === "examples" && typeof value.text === "string") {
        const parsed = parseCaseText(value.text);
        return parsed ? [{ situation: clean(parsed.situation), outcome: clean(parsed.outcome) }] : [];
      }
    } catch { /* not a case */ }
    return [];
  });
}

export function toRuleCard(card: CardWithStats, pack: PackWithType, base: { term: string; meaning: string; examples: LearnExample[] }): LearnCard {
  // A direct Q&A card is not a procedural rule. Give it standard recall exercises and a
  // conventional Q→A review rather than inventing a condition, case or rule attribution.
  if (appliedCardKind(card.data) === "question") return {
    id: card.id, term: base.term, form: base.term, reading: "", meaning: base.meaning, examples: base.examples,
    language: null, han: false, wordSized: false,
  };
  const type = pack.cardType;
  const list = (role: "condition" | "exception" | "step") =>
    uniqueBy((type?.field_schema ?? []).filter((field) => field.role === role).flatMap((field) => splitList(fieldText(card.data, field.key))).map(clean), normaliseAnswer);
  const cases: LearnCase[] = [];
  const situation = clean(fieldText(card.data, fieldByRole(type, "case")?.key));
  if (situation) cases.push({ situation, outcome: clean(fieldText(card.data, fieldByRole(type, "outcome")?.key)) });
  for (const extra of workspaceCases(card)) if (!cases.some((item) => caseKey(item) === caseKey(extra))) cases.push(extra);
  return {
    id: card.id, term: base.term, form: base.term, reading: "", meaning: base.meaning, examples: base.examples,
    language: null, han: false, wordSized: isWordSized(base.term),
    rule: { conditions: list("condition"), exceptions: list("exception"), steps: list("step"), cases, source: clean(fieldText(card.data, fieldByRole(type, "source")?.key)) },
  };
}

/**
 * What Learn can do with an Applied card, and the one addition that would help most.
 * Shown quietly while a card is written, so a basic card is quick and a richer one is a choice.
 */
export function appliedCoverage(card: LearnCard, neighbours: number): { skills: AppliedSkill[]; hint: string } {
  const rule = card.rule;
  if (!rule) return { skills: [], hint: "" };
  const solvable = rule.cases.filter((item) => item.outcome).length;
  const skills: AppliedSkill[] = [];
  if (neighbours >= 2 || rule.cases.length) skills.push("identify");
  if (rule.conditions.length || rule.exceptions.length || valuesIn(card.meaning).length) skills.push("scope");
  if (rule.steps.length >= 3) skills.push("sequence");
  if (solvable) skills.push("apply");
  if (solvable >= 2 || rule.steps.length >= 3) skills.push("solve");
  const hint = !card.meaning ? ""
    : !rule.cases.length ? "Add a case and what follows in it, so Learn can ask you to apply the rule."
      : !solvable ? "Add what follows in the case, so Learn can ask you to predict it."
        : solvable < 2 && rule.steps.length < 3 ? "One more case (with its outcome) lets Learn keep a case back for you to solve unseen."
          : neighbours < 2 ? "Rules it could be confused with, in the same topic, let Learn ask you to tell them apart."
            : "";
  return { skills, hint };
}

/* ------------------------------------------------------------------------- */
/* Neighbours, cases and wrong options                                        */
/* ------------------------------------------------------------------------- */

const STOP = new Set(["about", "after", "also", "applies", "apply", "before", "being", "between", "does", "each", "from", "have", "into", "must", "need", "needs", "only", "other", "same", "shall", "should", "than", "that", "their", "them", "then", "there", "these", "they", "this", "those", "under", "unless", "until", "when", "where", "which", "while", "will", "with", "within", "without", "would", "your"]);

function keyWords(text: string): Set<string> {
  return new Set((text.toLocaleLowerCase().normalize("NFC").match(/\p{L}[\p{L}'’-]*/gu) ?? [])
    .filter((word) => word.length >= 4 && !STOP.has(word)).map((word) => word.slice(0, 6)));
}

function ruleText(card: LearnCard) {
  return [card.form, card.meaning, ...(card.rule?.conditions ?? []), ...(card.rule?.exceptions ?? [])].join(" ");
}

/** The other rules, most similar first (shared key words): the ones a learner actually confuses. */
function nearestRivals(card: LearnCard, pool: LearnCard[]): LearnCard[] {
  const own = normaliseAnswer(card.form);
  const mine = keyWords(ruleText(card));
  const rivals = uniqueBy(pool.filter((other) => other.id !== card.id && other.rule && other.term && other.meaning && normaliseAnswer(other.form) !== own),
    (other) => normaliseAnswer(other.form));
  const score = (other: LearnCard) => {
    const theirs = keyWords(ruleText(other));
    let shared = 0;
    for (const word of theirs) if (mine.has(word)) shared += 1;
    return shared / Math.max(1, mine.size + theirs.size - shared);
  };
  return rivals.map((other) => ({ other, value: score(other) }))
    .sort((a, b) => b.value - a.value || a.other.id.localeCompare(b.other.id)).map((entry) => entry.other);
}

/** The nearest few, in a varied order: plausible options without always the same three. */
function plausible<T>(items: T[], random: () => number, count = 3): T[] {
  return shuffle(items.slice(0, count + 1), random).slice(0, count);
}

/** Choices for one question: the right one, then distinct wrong ones (each with a note). */
function choices(answer: { id: string; label: string }, wrong: Array<{ id: string; label: string; note: string }>, random: () => number, count = 3): Choice[] | null {
  const taken = new Set([normaliseAnswer(answer.label)]);
  const distinct = wrong.filter((item) => {
    const key = normaliseAnswer(item.label);
    if (!key || taken.has(key)) return false;
    taken.add(key);
    return true;
  }).slice(0, count);
  if (distinct.length < 2) return null;
  return shuffle<Choice>([answer, ...distinct], random);
}

/**
 * The rule's own name hidden in a text, so a case such as "FCA Hamburg: …" does not answer
 * "Which rule applies?". Both the full name and its short form ("FCA") are hidden.
 */
function maskName(text: string, card: LearnCard): string {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let masked = text.replace(new RegExp(escape(card.form), "giu"), "＿＿＿");
  const short = card.form.split(/\s+[—–-]\s+|\s*[(:]/u)[0].trim();
  if (short && short !== card.form && Array.from(short).length >= 2) {
    const exact = short === short.toLocaleUpperCase();
    masked = masked.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(short)}(?![\\p{L}\\p{N}])`, exact ? "gu" : "giu"), "＿＿＿");
  }
  return masked;
}
const names = (text: string, card: LearnCard) => maskName(text, card) !== text;
const shortName = (card: LearnCard) => card.form.split(/\s+[—–-]\s+/u)[0].trim() || card.form;

/** Opposite parties, the most common confusion in practical rules (who pays, who bears the risk). */
const PARTIES: Array<[string, string]> = [
  ["seller", "buyer"], ["exporter", "importer"], ["consignor", "consignee"], ["supplier", "customer"],
  ["employer", "employee"], ["landlord", "tenant"], ["lessor", "lessee"], ["creditor", "debtor"],
  ["sender", "recipient"], ["principal", "agent"], ["licensor", "licensee"],
];

/** The same sentence with the parties swapped, or null when it names no pair. */
export function swapParties(text: string): string | null {
  let swapped = text;
  let changed = false;
  for (const [a, b] of PARTIES) {
    const pattern = new RegExp(`\\b(${a}|${b})(s|'s|’s)?\\b`, "gi");
    swapped = swapped.replace(pattern, (whole: string, word: string, tail = "") => {
      changed = true;
      const other = word.toLowerCase() === a ? b : a;
      const cased = word[0] === word[0].toUpperCase() ? other[0].toUpperCase() + other.slice(1) : other;
      return cased + tail;
    });
  }
  return changed && normaliseAnswer(swapped) !== normaliseAnswer(text) ? swapped : null;
}

/** "The seller bears the loss: risk passes only on delivery" → outcome and reason. */
export function splitOutcome(text: string): { outcome: string; reason: string } {
  const match = text.match(/^(.{6,}?)(?::\s+|\s+[—–]\s+|,?\s+because\s+|;\s+)(.{6,})$/iu);
  if (!match) return { outcome: text, reason: "" };
  const reason = match[2].trim();
  return { outcome: match[1].trim(), reason: reason[0].toLocaleUpperCase() + reason.slice(1) };
}

/** Amounts, thresholds and deadlines: a number with a unit, a currency or a percentage. */
const VALUE = /(?:[€$£]\s?|\b(?:EUR|USD|GBP|CHF)\s?)?\b\d+(?:[.,  ]\d{3})*(?:[.,]\d+)?(?:\s?(?:%|per\s?cent\b|percent\b|working days?\b|business days?\b|calendar days?\b|days?\b|weeks?\b|months?\b|years?\b|hours?\b|minutes?\b|kg\b|tonnes?\b|tons?\b|km\b|litres?\b|liters?\b|EUR\b|USD\b|GBP\b|CHF\b|€|\$|£))|(?:[€$£]\s?|\b(?:EUR|USD|GBP|CHF)\s?)\d+(?:[.,  ]\d{3})*(?:[.,]\d+)?/giu;
const NUMBER = /\d+(?:[.,  ]\d{3})*(?:[.,]\d+)?/u;

type FoundValue = { text: string; start: number; end: number; amount: number; unit: string; grouping: string; decimals: number };

function valuesIn(text: string): FoundValue[] {
  const found: FoundValue[] = [];
  for (const match of text.matchAll(VALUE)) {
    const token = match[0].trim();
    const number = token.match(NUMBER)?.[0];
    if (!number) continue;
    const grouping = /^0[.,]/.test(number) ? "" : number.match(/\d([.,  ])\d{3}(?!\d)/u)?.[1] ?? "";
    const decimalMark = grouping === "." ? "," : ".";
    const plain = number.split(grouping || "\u0000").join("").replace(decimalMark, ".");
    const amount = Number(plain);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const decimals = plain.includes(".") ? plain.split(".")[1].length : 0;
    const start = (match.index ?? 0) + match[0].indexOf(token);
    found.push({ text: token, start, end: start + token.length, amount, unit: token.replace(number, "#").toLocaleLowerCase().replace(/\s+/g, " "), grouping, decimals });
  }
  return found;
}

function formatLike(value: FoundValue, amount: number): string {
  const number = value.text.match(NUMBER)![0];
  let digits = amount.toFixed(value.decimals);
  if (value.grouping) {
    const [whole, fraction] = digits.split(".");
    digits = whole.replace(/\B(?=(\d{3})+(?!\d))/g, value.grouping) + (fraction ? (value.grouping === "." ? "," : ".") + fraction : "");
  } else if (value.decimals && number.includes(",")) digits = digits.replace(".", ",");
  return value.text.replace(number, digits);
}

/** Words a phrase naturally starts with: a piece may begin here. */
const PHRASE_START = /^(?:and|or|but|if|when|where|unless|until|before|after|within|without|to|at|by|for|of|in|on|from|with|under|over|than|that|which|who|whose|once|while|as|including|except|provided)$/i;
/** A number is never separated from its unit ("1,000 | kg." would be no phrase at all). */
const UNIT_START = /^(?:%|per|percent|working|business|calendar|days?|weeks?|months?|years?|hours?|minutes?|kg|tonnes?|tons?|km|litres?|liters?|eur|usd|gbp|chf)\b/i;

function statementPieces(statement: string): string[] | null {
  const tokens = statement.split(" ").filter(Boolean);
  if (tokens.length < 6 || tokens.length > 40) return null;
  if (tokens.length <= 10) return tokens;
  const count = Math.min(7, Math.max(4, Math.round(tokens.length / 4)));
  const size = tokens.length / count;
  const breakable = (index: number) => {
    const next = tokens[index + 1];
    return Boolean(next) && !(/\d$/.test(tokens[index]) && UNIT_START.test(next)) && !/^[.,;:)]/.test(next)
      && !(/^(?:eur|usd|gbp|chf|[€$£])$/i.test(tokens[index]) && /^\d/.test(next));
  };
  const pieces: string[][] = [[]];
  tokens.forEach((token, index) => {
    const piece = pieces[pieces.length - 1];
    piece.push(token);
    if (!breakable(index)) return;
    const natural = /[,;:)]$/.test(token) || PHRASE_START.test(tokens[index + 1]);
    if ((natural && piece.length >= Math.max(2, size * 0.6)) || piece.length >= size * 1.6) pieces.push([]);
  });
  const merged = pieces.filter((piece) => piece.length).reduce<string[][]>((all, piece) => {
    if (piece.length === 1 && all.length) all[all.length - 1].push(...piece); else all.push([...piece]);
    return all;
  }, []);
  return merged.length >= 4 && merged.length <= 8 ? merged.map((piece) => piece.join(" ")) : null;
}

function firstLetters(text: string) {
  return text.split(" ").map((word) => { const letters = Array.from(word); return letters[0] + "·".repeat(Math.max(0, letters.length - 1)); }).join(" ");
}

/* ------------------------------------------------------------------------- */
/* The library                                                                */
/* ------------------------------------------------------------------------- */

type DraftOf<T> = T extends unknown ? Omit<T, "position" | "stage" | "v"> : never;
type Draft = DraftOf<Exercise>;

/** Everything a round may draw on, decided once per round. */
type Material = {
  card: LearnCard;
  rule: RuleParts;
  rivals: LearnCard[];
  round: number;
  /** 1: first round, or after a weak one (the rule is named, more support). 2: more independent. */
  level: 1 | 2;
  /** The case kept back for the final exercise (never shown before it in this round). */
  held: LearnCase | null;
  /** The other cases, unseen ones first. */
  shown: LearnCase[];
  /** Cases already used in this round, so no case is asked about twice. */
  used: Set<string>;
};
type Builder = (m: Material, random: () => number) => Draft | null;

const ruleLine = (card: LearnCard) => `${card.form}: ${card.meaning}`;
const freeCase = (m: Material, need: (item: LearnCase) => boolean = () => true) =>
  m.shown.find((item) => !m.used.has(caseKey(item)) && need(item)) ?? null;

/**
 * Identify: which rule governs this situation (one of this card's cases). A case with an
 * outcome is used here only when another one is left for "What follows?": predicting a
 * consequence teaches more than naming the rule.
 */
const ruleForCase: Builder = (m, random) => {
  const withOutcome = m.shown.filter((entry) => entry.outcome && !m.used.has(caseKey(entry))).length;
  const item = freeCase(m, (entry) => !entry.outcome) ?? (withOutcome >= 2 ? freeCase(m) : null);
  if (!item) return null;
  const options = choices({ id: m.card.id, label: m.card.form },
    plausible(m.rivals, random).map((other) => ({ id: other.id, label: other.form, note: ruleLine(other) })), random);
  if (!options) return null;
  return {
    format: "choice", kind: "rule-for-case", layout: "list", choices: options, answerId: m.card.id, uses: [caseKey(item)],
    prompt: { ask: "Which rule applies here?", text: maskName(item.situation, m.card), style: "case" },
    solution: m.card.form, explain: ruleLine(m.card),
  };
};

/**
 * A neighbouring case tests the *boundary of this card's rule*, not mere recall of the
 * neighbour. It names the target rule explicitly, and tests whether to reject it and why.
 * The grade remains attributable to the target card, unlike a free-standing question
 * whose correct answer happens to belong to a different card.
 */
const contrastCase: Builder = (m, random) => {
  for (const rival of m.rivals.slice(0, 4)) {
    const item = rival.rule?.cases.find((entry) => !m.used.has(caseKey(entry)));
    if (!item) continue;
    const others = m.rivals.filter((other) => other.id !== rival.id);
    const options = choices({ id: rival.id, label: `No — ${rival.form}` }, [
      { id: m.card.id, label: `Yes — ${m.card.form}`, note: `This case belongs under ${rival.form}, not ${m.card.form}.` },
      ...plausible(others, random, 2).map((other) => ({ id: other.id, label: `No — ${other.form}`, note: ruleLine(other) })),
    ], random);
    if (!options) continue;
    return {
      format: "choice", kind: "rule-boundary", layout: "list", choices: options, answerId: rival.id, uses: [caseKey(item)],
      prompt: { ask: `Does ${m.card.form} apply here?`, text: maskName(maskName(item.situation, rival), m.card), style: "case" },
      solution: `No — ${rival.form}`, explain: `${ruleLine(rival)} — not ${shortName(m.card)}.`,
    };
  }
  return null;
};

const ruleForStatement: Builder = (m, random) => {
  const options = choices({ id: m.card.id, label: m.card.form },
    plausible(m.rivals, random).map((other) => ({ id: other.id, label: other.form, note: ruleLine(other) })), random);
  if (!options) return null;
  return {
    format: "choice", kind: "rule-for-statement", layout: "list", choices: options, answerId: m.card.id,
    prompt: { ask: "Which rule says this?", text: maskName(m.card.meaning, m.card) },
    solution: m.card.form, explain: ruleLine(m.card),
  };
};

const statementForRule: Builder = (m, random) => {
  const options = choices({ id: m.card.id, label: m.card.meaning },
    plausible(m.rivals, random).map((other) => ({ id: other.id, label: other.meaning, note: `That is ${other.form}.` })), random);
  if (!options) return null;
  return {
    format: "choice", kind: "statement-for-rule", layout: "list", choices: options, answerId: m.card.id,
    prompt: { ask: "What does this rule require?", text: m.card.form },
    solution: m.card.meaning, explain: ruleLine(m.card),
  };
};

/** Scope: the condition that is missing; the rule's own exception is a tempting wrong answer. */
const missingCondition: Builder = (m, random) => {
  const { conditions, exceptions } = m.rule;
  if (!conditions.length) return null;
  const at = (m.round - 1) % conditions.length;
  const own = new Set(conditions.map(normaliseAnswer));
  const wrong = [
    ...exceptions.slice(0, 1).map((text, index) => ({ id: `x${index}`, label: text, note: "That is an exception to this rule, not a condition." })),
    ...m.rivals.flatMap((other) => (other.rule?.conditions ?? []).map((text, index) => ({ id: `${other.id}:c${index}`, label: text, note: `That is a condition of ${other.form}.` }))),
  ].filter((item) => !own.has(normaliseAnswer(item.label)));
  const options = choices({ id: "answer", label: conditions[at] }, [...wrong.slice(0, 1), ...plausible(wrong.slice(1), random, 3)], random);
  if (!options) return null;
  const rest = conditions.map((text, index) => (index === at ? "＿＿＿" : text));
  return {
    format: "choice", kind: "missing-condition", layout: "list", choices: options, answerId: "answer",
    prompt: conditions.length > 1
      ? { ask: "Which condition is missing?", text: m.card.form, sub: `Applies when: ${rest.join(" · ")}` }
      : { ask: "When does this rule apply?", text: m.card.form },
    solution: conditions[at], explain: `${m.card.form} applies when: ${conditions.join("; ")}.`,
  };
};

/** Scope: the exception, with the rule's own condition as the tempting wrong answer. */
const missingException: Builder = (m, random) => {
  const { conditions, exceptions } = m.rule;
  if (!exceptions.length) return null;
  const target = exceptions[(m.round - 1) % exceptions.length];
  const own = new Set(exceptions.map(normaliseAnswer));
  const wrong = [
    ...conditions.slice(0, 1).map((text, index) => ({ id: `c${index}`, label: text, note: "That is a condition for the rule, not an exception to it." })),
    ...m.rivals.flatMap((other) => (other.rule?.exceptions ?? []).map((text, index) => ({ id: `${other.id}:x${index}`, label: text, note: `That is an exception to ${other.form}.` }))),
    ...m.rivals.flatMap((other) => (other.rule?.conditions ?? []).map((text, index) => ({ id: `${other.id}:c${index}`, label: text, note: `That is a condition of ${other.form}.` }))),
  ].filter((item) => !own.has(normaliseAnswer(item.label)));
  const options = choices({ id: "answer", label: target }, [...wrong.slice(0, 1), ...plausible(wrong.slice(1), random, 3)], random);
  if (!options) return null;
  return {
    format: "choice", kind: "missing-exception", layout: "list", choices: options, answerId: "answer",
    prompt: { ask: "This rule does not apply when…", text: m.card.form },
    solution: target, explain: `${m.card.form} does not apply when: ${exceptions.join("; ")}.`,
  };
};

/** Scope: a threshold or deadline. Wrong values keep the unit and the number format. */
const missingValue: Builder = (m, random) => {
  const sources = [m.card.meaning, ...m.rule.conditions, ...m.rule.exceptions];
  const spots = sources.flatMap((sentence) => valuesIn(sentence).map((value) => ({ sentence, value })));
  if (!spots.length) return null;
  const { sentence, value } = spots[(m.round - 1) % spots.length];
  const ownAmounts = new Set(spots.filter((spot) => spot.value.unit === value.unit).map((spot) => spot.value.amount));
  const fromRivals = m.rivals.flatMap((other) => [other.meaning, ...(other.rule?.conditions ?? [])].flatMap(valuesIn))
    .filter((other) => other.unit === value.unit && !ownAmounts.has(other.amount)).map((other) => other.amount);
  const step = value.amount >= 100 ? value.amount / 10 : value.amount >= 10 ? 5 : 1;
  const nearby = [value.amount * 2, value.amount / 2, value.amount + step, value.amount - step, value.amount * 3]
    .filter((amount) => amount > 0 && !ownAmounts.has(amount) && (value.unit.includes("%") ? amount <= 100 : true))
    .filter((amount) => Number.isInteger(amount * 10 ** value.decimals));
  const amounts = uniqueBy([...shuffle(fromRivals, random), ...nearby].map(String), (amount) => amount).map(Number).slice(0, 3);
  const options = choices({ id: "answer", label: value.text }, amounts.map((amount, index) => ({ id: `v${index}`, label: formatLike(value, amount), note: "" })), random);
  if (!options) return null;
  return {
    format: "choice", kind: "missing-value", layout: "grid", choices: options, answerId: "answer",
    prompt: { ask: "Which value completes the rule?", text: `${sentence.slice(0, value.start)}＿＿＿${sentence.slice(value.end)}`, sub: sentence === m.card.meaning ? m.card.form : `${m.card.form} applies when…` },
    solution: value.text, explain: `${m.card.form}: ${sentence}`,
  };
};

/** Sequence: a procedure's steps in order. */
const orderSteps: Builder = (m, random) => {
  const steps = m.rule.steps;
  if (steps.length < 3 || steps.length > 8 || new Set(steps.map(normaliseAnswer)).size !== steps.length) return null;
  return {
    format: "build", kind: "order-steps", tiles: tiles(steps, random), answer: steps, joiner: " ", stacked: true,
    prompt: { ask: "Put the steps in order.", text: m.card.form },
    solution: steps.map((step, index) => `${index + 1}. ${step}`).join("  "), explain: "",
  };
};

/**
 * Apply: what follows in a case. Wrong options are what follows in the rule's other cases,
 * the same outcome with the parties swapped, and outcomes under neighbouring rules. A first
 * round names the rule; a later one leaves the learner to recognise it as well.
 */
const caseOutcome: Builder = (m, random) => {
  const item = freeCase(m, (entry) => Boolean(entry.outcome));
  if (!item) return null;
  const right = splitOutcome(item.outcome).outcome;
  const swapped = swapParties(right);
  // Never the kept-back case: its outcome would give away the last exercise.
  const wrong = [
    ...m.rule.cases.filter((other) => other !== item && other !== m.held && other.outcome)
      .map((other, index) => ({ id: `o${index}`, label: splitOutcome(other.outcome).outcome, note: `That follows when: ${other.situation}` })),
    ...(swapped ? [{ id: "swap", label: swapped, note: "The parties are the other way round." }] : []),
    ...m.rivals.flatMap((other) => (other.rule?.cases ?? []).filter((entry) => entry.outcome)
      .map((entry, index) => ({ id: `${other.id}:o${index}`, label: splitOutcome(entry.outcome).outcome, note: `That follows under ${other.form}.` }))),
  ];
  const options = choices({ id: "answer", label: right }, [...wrong.slice(0, 2), ...plausible(wrong.slice(2), random, 2)], random);
  if (!options) return null;
  return {
    format: "choice", kind: "case-outcome", layout: "list", choices: options, answerId: "answer", uses: [caseKey(item)],
    prompt: { ask: "What follows here?", text: m.level === 1 ? item.situation : maskName(item.situation, m.card), sub: m.level === 1 ? `Under ${m.card.form}` : undefined, style: "case" },
    solution: item.outcome, explain: ruleLine(m.card),
  };
};

/** Apply, the other way: which situation does the rule cover (the others belong to its neighbours). */
const whichCase: Builder = (m, random) => {
  const item = freeCase(m, (entry) => !names(entry.situation, m.card));
  if (!item) return null;
  const wrong = m.rivals.flatMap((other) => (other.rule?.cases ?? []).filter((entry) => !names(entry.situation, other))
    .map((entry, index) => ({ id: `${other.id}:s${index}`, label: entry.situation, note: `That situation falls under ${other.form}.` })));
  const options = choices({ id: "answer", label: item.situation }, plausible(wrong, random, 3), random);
  if (!options) return null;
  return {
    format: "choice", kind: "which-case", layout: "list", choices: options, answerId: "answer", uses: [caseKey(item)],
    prompt: { ask: "Which situation does this rule cover?", text: m.card.form, sub: m.card.meaning },
    solution: item.situation, explain: ruleLine(m.card),
  };
};

/** Solve: the case kept back, answered in writing and checked against the card's own points. */
const solveCase: Builder = (m) => {
  const held = m.held;
  if (!held) return null;
  const { outcome, reason } = splitOutcome(held.outcome);
  const points: JudgePoint[] = [{ id: "outcome", label: "Outcome", text: outcome }];
  if (reason) points.push({ id: "reason", label: "Reason", text: reason }, { id: "rule", label: "Rule", text: shortName(m.card), essential: false });
  else points.push({ id: "rule", label: "Rule", text: `${m.card.form}: ${m.card.meaning}` });
  return {
    format: "judge", kind: "solve-case", placeholder: "What follows, and why?", points, uses: [caseKey(held)],
    prompt: { ask: "What follows, and why?", text: maskName(held.situation, m.card), style: "case" },
    solution: `${held.outcome} (${m.card.form})`, explain: ruleLine(m.card),
  };
};

const recallSteps: Builder = (m) => {
  const steps = m.rule.steps;
  if (steps.length < 3) return null;
  return {
    format: "judge", kind: "recall-steps", placeholder: "The steps, in order",
    points: steps.slice(0, 8).map((step, index) => ({ id: `s${index + 1}`, label: `Step ${index + 1}`, text: step })),
    prompt: { ask: "List the steps from memory, in order.", text: m.card.form },
    solution: steps.map((step, index) => `${index + 1}. ${step}`).join("  "), explain: ruleLine(m.card),
  };
};

/** State the rule: what it requires is essential; conditions and exceptions are details (half are enough). */
const stateRule: Builder = (m) => {
  const points: JudgePoint[] = [{ id: "statement", label: "What it requires", text: m.card.meaning }];
  m.rule.conditions.slice(0, 3).forEach((text, index) => points.push({ id: `c${index + 1}`, label: "Applies when", text, essential: false }));
  m.rule.exceptions.slice(0, 2).forEach((text, index) => points.push({ id: `x${index + 1}`, label: "Unless", text, essential: false }));
  return {
    format: "judge", kind: "state-rule", placeholder: "What it requires, when it applies, and its exceptions", points,
    prompt: { ask: "State the rule from memory.", text: m.card.form },
    solution: m.card.meaning, explain: ruleLine(m.card),
  };
};

/* Wording: used only when a card holds too little for anything above. */

const buildStatement: Builder = (m, random) => {
  const pieces = statementPieces(m.card.meaning);
  if (!pieces || new Set(pieces.map((piece) => piece.toLocaleLowerCase())).size < 4) return null;
  return {
    format: "build", kind: "build-statement", tiles: tiles(pieces, random), answer: pieces, joiner: " ",
    prompt: { ask: "Put what it requires in order.", text: m.card.form },
    solution: m.card.meaning, explain: "",
  };
};

/** A key word typed into its gap: one of the longest words, never part of the rule's name. */
function completeWord(m: Material, sentence: string, pick: number, kind: "complete-statement" | "complete-condition"): Draft | null {
  const name = new Set(m.card.form.toLocaleLowerCase().split(/[^\p{L}]+/u).filter(Boolean));
  const tokens = [...sentence.matchAll(/\p{L}[\p{L}'’-]*\p{L}/gu)].map((match) => ({ word: match[0], at: match.index ?? 0 }))
    .filter(({ word }) => Array.from(word).length >= 5 && !STOP.has(word.toLocaleLowerCase()) && !name.has(word.toLocaleLowerCase()));
  if (!tokens.length) return null;
  const ranked = [...tokens].sort((a, b) => Array.from(b.word).length - Array.from(a.word).length || a.at - b.at).slice(0, 3);
  const { word, at } = ranked[pick % ranked.length];
  if (tokens.filter((token) => token.word.toLocaleLowerCase() === word.toLocaleLowerCase()).length > 1) return null;
  return {
    format: "type", kind, accepted: [{ value: word, kind: "exact" }], placeholder: "Type the missing word", language: null, hint: firstLetters(word),
    prompt: { ask: kind === "complete-statement" ? "Complete what the rule requires." : "Complete the condition.", text: `${sentence.slice(0, at)}＿＿＿${sentence.slice(at + word.length)}`, sub: m.card.form },
    solution: word, explain: `${m.card.form}: ${sentence}`,
  };
}
const completeStatement: Builder = (m) => completeWord(m, m.card.meaning, m.round - 1, "complete-statement");
const completeStatementAgain: Builder = (m) => completeWord(m, m.card.meaning, m.round, "complete-statement");
const completeCondition: Builder = (m) => (m.rule.conditions.length ? completeWord(m, m.rule.conditions[(m.round - 1) % m.rule.conditions.length], m.round, "complete-condition") : null);

const nameRule: Builder = (m) => ({
  format: "type", kind: "name-rule", accepted: [{ value: m.card.form, kind: "exact" }, { value: shortName(m.card), kind: "exact" }],
  placeholder: "The rule's name", language: null, hint: firstLetters(m.card.form),
  prompt: { ask: "Which rule is this? Type its name.", text: maskName(m.card.meaning, m.card) },
  solution: m.card.form, explain: "",
});

/* ------------------------------------------------------------------------- */
/* Choosing the five                                                          */
/* ------------------------------------------------------------------------- */

type Pick = { key: string; build: Builder };
const P = (key: string, build: Builder): Pick => ({ key, build });
const SCOPE: Pick[] = [P("missing-condition", missingCondition), P("missing-value", missingValue), P("missing-exception", missingException)];
const SKILL_PICKS: Record<AppliedSkill, Pick[]> = {
  identify: [P("contrast", contrastCase), P("rule-for-case", ruleForCase), P("rule-for-statement", ruleForStatement)],
  scope: SCOPE,
  sequence: [P("order-steps", orderSteps)],
  apply: [P("case-outcome", caseOutcome), P("which-case", whichCase)],
  solve: [],
  wording: [],
};

/**
 * Builds the five exercises of one Applied round. `pool` holds the other rules the card may be
 * confused with; `history` is the previous round of this card, when there was one.
 */
export function buildAppliedRound(input: { card: LearnCard; pool: LearnCard[]; round: number; seed: string; history?: RoundHistory | null }): Exercise[] {
  const { card } = input;
  const rule = card.rule!;
  const round = Math.max(1, Math.floor(input.round));
  const history = input.history ?? null;
  const seen = new Set(history?.seen ?? []);
  const solvedLast = new Set(history?.solved ?? []);
  const level: 1 | 2 = round <= 1 || (history !== null && history.score < 30) ? 1 : 2;

  // Cases not yet seen come first; among equals, the round number rotates the order.
  const rotate = <T,>(items: T[]) => (items.length ? [...items.slice((round - 1) % items.length), ...items.slice(0, (round - 1) % items.length)] : items);
  const fresh = <T extends LearnCase>(items: T[]) => [...rotate(items.filter((item) => !seen.has(caseKey(item)))), ...rotate(items.filter((item) => seen.has(caseKey(item))))];
  const withOutcome = fresh(rule.cases.filter((item) => item.outcome));
  // The case to solve: one not seen last time, else one shown but not solved; never the same twice running.
  const solvable = [...withOutcome.filter((item) => !solvedLast.has(caseKey(item))), ...withOutcome.filter((item) => solvedLast.has(caseKey(item)))];
  const held = solvable.length >= 2 ? solvable[0] : null;
  const m: Material = {
    card, rule, rivals: nearestRivals(card, input.pool), round, level, held,
    shown: fresh(rule.cases.filter((item) => item !== held)), used: new Set(held ? [caseKey(held)] : []),
  };

  const counts = new Map<string, number>();
  const make = (pick: Pick, salt: string): Draft | null => pick.build(m, rng(`${input.seed}:${pick.key}:${salt}`));
  const take = (pick: Pick, draft: Draft) => {
    counts.set(pick.key, (counts.get(pick.key) ?? 0) + 1);
    for (const key of draft.uses ?? []) m.used.add(key);
    return draft;
  };
  const first = (picks: Pick[], salt: string, limit = 1): Draft | null => {
    for (const pick of picks) {
      if ((counts.get(pick.key) ?? 0) >= limit) continue;
      const draft = make(pick, salt);
      if (draft) return take(pick, draft);
    }
    return null;
  };

  // 5. The unaided answer: a case kept back, else a procedure's steps, else the rule itself.
  const solves = [P("solve-case", solveCase), P("recall-steps", recallSteps), P("state-rule", stateRule)];
  if (held && rule.steps.length >= 3 && round % 2 === 0) solves.splice(0, 2, solves[1], solves[0]);
  const final = first(solves, "final")!;

  // 1. Identify, on this rule's own material.
  const opening = first([P("rule-for-case", ruleForCase), P("rule-for-statement", ruleForStatement), P("statement-for-rule", statementForRule)], "open");

  // 2–4. What the card's structure calls for, the last round's weak skill first.
  const weakSkills = Array.from(new Set((history?.weak ?? []).map(appliedSkill).filter((skill): skill is AppliedSkill => Boolean(skill) && skill !== "solve" && skill !== "wording")));
  // Scope rotates between condition, threshold and exception; later rounds start from exceptions (common misconceptions).
  const scopeOrder = level === 2 ? [SCOPE[2], SCOPE[1], SCOPE[0]] : SCOPE;
  const turn = level === 2 ? Math.max(0, round - 2) % 3 : (round - 1) % 3;
  const scopeFirst = [...scopeOrder.slice(turn), ...scopeOrder.slice(0, turn)];
  const middle: Draft[] = [];
  const queue: Array<{ picks: Pick[]; limit?: number }> = [
    ...weakSkills.map((skill) => ({ picks: skill === "scope" ? scopeFirst : SKILL_PICKS[skill] })),
    { picks: [P("order-steps", orderSteps)] },
    { picks: [P("case-outcome", caseOutcome)] },
    { picks: scopeFirst },
    { picks: [P("contrast", contrastCase)] },
    { picks: [P("which-case", whichCase)] },
    { picks: scopeFirst },
    { picks: [P("case-outcome", caseOutcome)], limit: 2 },
    { picks: [P("contrast", contrastCase)], limit: 2 },
    { picks: [P("statement-for-rule", statementForRule), P("rule-for-statement", ruleForStatement)] },
    // Wording only when nothing above fits.
    { picks: [P("build-statement", buildStatement)] },
    { picks: [P("complete-condition", completeCondition)] },
    { picks: [P("complete-statement", completeStatement)] },
    { picks: [P("name-rule", nameRule)] },
    { picks: [P("complete-statement", completeStatementAgain)], limit: 2 },
    { picks: [P("name-rule", nameRule)], limit: 5 },
  ];
  for (const [index, step] of queue.entries()) {
    if (middle.length + (opening ? 1 : 0) >= 4) break;
    const draft = first(step.picks, `m${index}`, step.limit ?? 1);
    if (draft) middle.push(draft);
  }

  const ordered = [...(opening ? [opening] : []), ...middle.map((draft, index) => ({ draft, index }))
    .sort((a, b) => SKILL_ORDER[appliedSkill(a.draft.kind) ?? "wording"] - SKILL_ORDER[appliedSkill(b.draft.kind) ?? "wording"] || a.index - b.index)
    .map((entry) => entry.draft), final];
  return ordered.slice(0, 5).map((draft, index) => ({ ...draft, v: 1, position: index + 1, stage: STAGE_ORDER[index] }) as Exercise);
}

/* ------------------------------------------------------------------------- */
/* Free answers                                                               */
/* ------------------------------------------------------------------------- */

/**
 * Whether an answer seems to mention a point (a shared key word, compared by its first six
 * letters). Advisory only: it flags a tick that the written answer does not appear to support.
 */
export function answerMentions(answer: string, point: string): boolean {
  const words = keyWords(point);
  if (!words.size) return true;
  const said = keyWords(answer);
  for (const word of words) if (said.has(word)) return true;
  return false;
}
