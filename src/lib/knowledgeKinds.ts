import type { CardType, CardWithStats, FieldRole } from "./heuresis";
import { fieldText } from "./heuresis";
import { APPLIED_KIND_KEY, splitList } from "./teachingShape";

/**
 * What kind of applied knowledge a card holds. Applied topics are no longer one shape: a
 * documentation topic is mostly *definitions* ("CMR consignment note"), a compliance topic mostly
 * *rules*, a process topic *procedures*, and every field has its *figures* (limits, deadlines,
 * rates). Each kind gets the details that fit it in New, its own Learn exercises and its own
 * Review questions.
 *
 *   definition  a term and what it means            recognise · tell apart · define
 *   rule        what applies, when, what follows    identify · scope · apply to cases
 *   procedure   steps in order                      order · next step · recall the steps
 *   figure      a value, limit or deadline          recall the value · tell figures apart
 *   question    a direct question and its answer    recall · explain
 *
 * Stored on the card as `_applied_kind` (the key that already held "knowledge" | "question").
 * Cards written before this change hold "knowledge" or nothing; their kind is read from what the
 * card contains until someone chooses one. Older clients read every value except "question" as
 * "knowledge", so nothing breaks for them.
 *
 * This is a property of the card, inside an Applied topic. Whether a topic is Applied at all is
 * still decided by its card type (teachingShape.ts), never by this file.
 */
export type KnowledgeKind = "definition" | "rule" | "procedure" | "figure" | "question";

export const KNOWLEDGE_KIND_ORDER: readonly KnowledgeKind[] = ["definition", "rule", "procedure", "figure", "question"];

export type KindInfo = {
  id: KnowledgeKind;
  label: string;
  /** A one-character mark for compact chips. */
  mark: string;
  /** What a card of this kind holds. */
  short: string;
  /** What Learn and Review practise with it, in order. */
  trains: string;
  /** Labels for the two fields every Applied card has. */
  term: string;
  meaning: string;
  termPlaceholder: string;
  meaningPlaceholder: string;
};

export const KIND_INFO: Record<KnowledgeKind, KindInfo> = {
  definition: {
    id: "definition", label: "Definition", mark: "≡", short: "A term and what it means",
    trains: "Recognise · tell apart · define", term: "Term", meaning: "Definition",
    termPlaceholder: "CMR consignment note", meaningPlaceholder: "What it is, in one sentence",
  },
  rule: {
    id: "rule", label: "Rule", mark: "§", short: "What applies, when, and what follows",
    trains: "Identify · scope · apply to cases", term: "Rule", meaning: "What it requires",
    termPlaceholder: "Name of the rule", meaningPlaceholder: "What it requires",
  },
  procedure: {
    id: "procedure", label: "Procedure", mark: "→", short: "Steps that happen in order",
    trains: "Order · next step · recall the steps", term: "Procedure", meaning: "What it achieves",
    termPlaceholder: "Name of the procedure", meaningPlaceholder: "What it achieves, in one sentence",
  },
  figure: {
    id: "figure", label: "Figure", mark: "#", short: "A value, limit, rate or deadline",
    trains: "Recall the value · tell figures apart", term: "What it measures", meaning: "Value",
    termPlaceholder: "CMR liability limit", meaningPlaceholder: "8.33 SDR per kg of gross weight",
  },
  question: {
    id: "question", label: "Question", mark: "?", short: "Ask directly, answer from memory",
    trains: "Recall · explain", term: "Question", meaning: "Answer",
    termPlaceholder: "The question", meaningPlaceholder: "The answer",
  },
};

export function isKnowledgeKind(value: unknown): value is KnowledgeKind {
  return value === "definition" || value === "rule" || value === "procedure" || value === "figure" || value === "question";
}

/** The kind someone chose for this card, or null when it was never chosen ("knowledge" or nothing). */
export function storedKnowledgeKind(data: Record<string, unknown> | null | undefined): KnowledgeKind | null {
  const value = data?.[APPLIED_KIND_KEY];
  return isKnowledgeKind(value) ? value : null;
}

/* ------------------------------------------------------------------------- */
/* Reading the kind from what a card contains                                 */
/* ------------------------------------------------------------------------- */

/** Obligations and consequences: the language of rules, not of definitions. */
const NORMATIVE = /\b(?:must|shall|should|may(?:\s+not)?|is\s+required|are\s+required|requires?|needs?\s+to|has\s+to|have\s+to|is\s+liable|are\s+liable|bears?|pays?|is\s+prohibited|are\s+prohibited|is\s+not\s+allowed|cannot|is\s+entitled|are\s+entitled|is\s+reimbursed|are\s+reimbursed|is\s+recognised|are\s+recognised|only\s+if|unless)\b/i;
/** "A …", "An …", "X is a …", "means …", "Document issued by …": how definitions are written. */
const DEFINING = /^(?:an?\s|one\s+of\s)|^[^.]{0,60}?\b(?:is|are|means|refers\s+to|denotes|describes)\s+(?:an?|the|one)\b|^\p{L}[\p{L}-]*(?:\s+\p{L}[\p{L}-]*){0,4}\s+(?:used|issued|signed|made|showing|recording|containing|covering|that|which|whose)\b/iu;
/** "Every …", "All …", "No …": a statement about everything of a sort is a rule, however it is phrased. */
const UNIVERSAL = /^(?:every|each|all|any|no|none|only|whoever|whenever)\b/i;
/** A number with a unit, a currency or a percentage (kept in step with appliedExercises' VALUE). */
const HAS_VALUE = /(?:[€$£]\s?|\b(?:EUR|USD|GBP|CHF|SDR)\s?)\d|\d(?:[.,  ]?\d)*\s?(?:%|per\s?cent\b|percent\b|(?:working |business |calendar )?days?\b|weeks?\b|months?\b|years?\b|hours?\b|minutes?\b|kg\b|tonnes?\b|tons?\b|km\b|litres?\b|liters?\b|SDR\b|EUR\b|USD\b|GBP\b|CHF\b|€|\$|£)/i;

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

export type KindEvidence = {
  term: string;
  meaning: string;
  conditions: number;
  exceptions: number;
  steps: number;
  cases: number;
};

/**
 * The most likely kind of a card that nobody has classified yet. Steps make a procedure;
 * conditions, exceptions or cases make a rule; a short answer built around a value is a figure;
 * a sentence written like a definition ("A consignment note used for …") is a definition.
 * Anything else stays a rule, which is what every Applied card was before kinds existed.
 */
export function inferKnowledgeKind(evidence: KindEvidence): Exclude<KnowledgeKind, "question"> {
  const meaning = evidence.meaning.trim();
  if (evidence.steps >= 3) return "procedure";
  // A short answer built around a value is a figure, even with the conditions it applies under.
  if (HAS_VALUE.test(meaning) && words(meaning) <= 10 && !NORMATIVE.test(meaning)) return "figure";
  if (evidence.conditions || evidence.exceptions || evidence.cases) return "rule";
  if (!meaning) return "rule";
  if (HAS_VALUE.test(meaning) && words(meaning) <= 14 && !NORMATIVE.test(meaning)) return "figure";
  if (!NORMATIVE.test(meaning) && !UNIVERSAL.test(meaning) && DEFINING.test(meaning)) return "definition";
  return "rule";
}

/** The fields of a card type with one role, read as list items. */
function countRole(type: Pick<CardType, "field_schema"> | null | undefined, data: CardWithStats["data"], role: FieldRole) {
  return (type?.field_schema ?? []).filter((field) => field.role === role)
    .reduce((total, field) => total + splitList(fieldText(data, field.key)).length, 0);
}

/** Extra cases written on the card (Details → Cases), so they count as evidence of a rule. */
function blockCases(data: CardWithStats["data"]) {
  const raw = data["_workspace_blocks"];
  if (!Array.isArray(raw)) return 0;
  return raw.filter((entry) => {
    try { const value = JSON.parse(entry) as Record<string, unknown>; return value.dim === "examples" && /\n\s*(?:→|->|=>)/.test(String(value.text ?? "")); }
    catch { return false; }
  }).length;
}

/** The kind of an Applied card: the one chosen for it, else the one its content suggests. */
export function knowledgeKind(data: CardWithStats["data"], type: Pick<CardType, "field_schema"> | null | undefined): KnowledgeKind {
  const stored = storedKnowledgeKind(data);
  if (stored) return stored;
  const role = (name: FieldRole) => (type?.field_schema ?? []).find((field) => field.role === name)?.key;
  const term = fieldText(data, role("term") ?? type?.field_schema[0]?.key);
  const meaning = fieldText(data, role("meaning") ?? type?.field_schema[1]?.key);
  return inferKnowledgeKind({
    term, meaning,
    conditions: countRole(type, data, "condition"),
    exceptions: countRole(type, data, "exception"),
    steps: countRole(type, data, "step"),
    cases: (fieldText(data, role("case")).trim() ? 1 : 0) + blockCases(data),
  });
}

/* ------------------------------------------------------------------------- */
/* Details around an Applied card                                             */
/* ------------------------------------------------------------------------- */

/**
 * Sections of the Details panels for Applied cards. Most of them are the same storage as the
 * language dimensions (so every client keeps reading and writing them): only the label and the
 * placeholder change. Three are the Rule card type's own list fields (conditions, exceptions,
 * steps) and are never stored as free blocks.
 */
export type AppliedSection =
  | "structure" | "examples" | "neighbours" | "components"
  | "conditions" | "exceptions" | "steps"
  | "origin" | "facts" | "hook" | "picture" | "notes";

/** Sections that are card fields, not free blocks. */
export const FIELD_SECTIONS: ReadonlySet<AppliedSection> = new Set(["conditions", "exceptions", "steps"]);
export const SECTION_ROLE: Partial<Record<AppliedSection, FieldRole>> = { conditions: "condition", exceptions: "exception", steps: "step" };

export function sectionLabel(section: AppliedSection, kind: KnowledgeKind): string {
  switch (section) {
    case "structure": return kind === "question" ? "Key points" : "Key features";
    case "examples": return kind === "definition" || kind === "question" ? "Examples" : "Cases";
    case "neighbours": return "Not to be confused with";
    case "components": return "Key terms";
    case "conditions": return kind === "figure" ? "Applies to" : "Applies when";
    case "exceptions": return "Unless";
    case "steps": return "Steps, in order";
    case "origin": return "Source";
    case "facts": return "Key figures";
    case "hook": return "Memory hook";
    case "picture": return "Picture";
    case "notes": return "My note";
  }
}

export function sectionPlaceholder(section: AppliedSection, kind: KnowledgeKind): string {
  switch (section) {
    case "structure": return kind === "definition" ? "One feature per line: what it records, who issues it, what it is used for…" : "One point per line";
    case "examples": return kind === "definition" ? "Where you meet it in practice…" : "A situation…\n→ what follows";
    case "neighbours": return "Other term — how it differs";
    case "components": return "A term it relies on — what it means";
    case "conditions": return "One condition per line";
    case "exceptions": return "One exception per line";
    case "steps": return "One step per line, in order";
    case "origin": return "Article, regulation, version";
    case "facts": return "A number, limit or deadline worth knowing";
    case "hook": return "Something that makes it stick";
    case "picture": return "Picture";
    case "notes": return "My note";
  }
}

/** What each section is for, shown quietly beneath its heading the first time it is opened. */
export function sectionHelp(section: AppliedSection, kind: KnowledgeKind): string {
  switch (section) {
    case "structure": return kind === "definition" ? "Learn asks which features belong to it, and which belong to something else." : "Learn checks these points when you answer freely.";
    case "examples": return kind === "definition" ? "Learn asks which term an example illustrates." : "Learn asks what follows in a case, and keeps one back for you to solve.";
    case "neighbours": return "Learn asks you to tell them apart.";
    case "steps": return "Learn asks for the order, the next step and the missing one.";
    case "conditions": case "exceptions": return "Learn asks which condition is missing, or when it does not apply.";
    case "facts": return "Values here can be asked as figures.";
    default: return "";
  }
}

/** The left panel ("Structure"): what defines the knowledge. Ordered by what helps most. */
export function structureSections(kind: KnowledgeKind): AppliedSection[] {
  switch (kind) {
    case "definition": return ["structure", "examples", "neighbours"];
    case "rule": return ["conditions", "exceptions", "examples", "neighbours", "components"];
    case "procedure": return ["steps", "conditions", "examples", "neighbours"];
    case "figure": return ["conditions", "exceptions", "examples", "neighbours"];
    case "question": return ["structure", "examples", "neighbours"];
  }
}
/** Every section that belongs in the left panel, whatever the kind (filled ones always show). */
export const STRUCTURE_SECTIONS: readonly AppliedSection[] = ["structure", "conditions", "exceptions", "steps", "examples", "neighbours", "components"];
/** The right panel ("Knowledge"): where it comes from and what helps it stick. */
export const KNOWLEDGE_SECTIONS: readonly AppliedSection[] = ["origin", "facts", "hook", "picture", "notes"];

/** The card face's quiet "+ …" action, which opens the most useful section for the kind. */
export function primaryAddition(kind: KnowledgeKind): { section: AppliedSection; label: string } {
  switch (kind) {
    case "definition": return { section: "structure", label: "+ Key features" };
    case "rule": return { section: "examples", label: "+ Case" };
    case "procedure": return { section: "steps", label: "+ Steps" };
    case "figure": return { section: "conditions", label: "+ Applies to" };
    case "question": return { section: "structure", label: "+ Key points" };
  }
}

/** Lines of a free block, without bullets: "a; b" or one per line. */
export function blockLines(text: string): string[] {
  return splitList(text.replace(/(\*\*|__|==|`)/g, ""));
}

/** The label of a card field for a kind: "Term" and "Definition", "Rule" and "What it requires"… */
export function kindFieldLabel(field: { role?: FieldRole; label: string }, kind: KnowledgeKind): string {
  if (field.role === "term") return KIND_INFO[kind].term;
  if (field.role === "meaning") return KIND_INFO[kind].meaning;
  return field.label;
}

/** The kind to store for an Applied card being saved: an explicit choice, never "knowledge". */
export function kindToStore(kind: KnowledgeKind): string {
  return kind;
}
