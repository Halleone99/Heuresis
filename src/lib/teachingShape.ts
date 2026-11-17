import type { CardType, FieldDef, FieldRole, PackWithType } from "./heuresis";

/**
 * How a topic's cards are taught. It is a property of the topic's **card type**, set explicitly
 * (`heuresis_card_types.teaching_shape`), never guessed from a title, from field names or from
 * the collection's knowledge mode: the mode only decides where a collection is shown, and one
 * collection may hold topics of different shapes.
 *
 *   standard  the existing exercises: words, expressions, sentences and term–definition cards
 *   rule      Applied knowledge: a rule or procedure with conditions, exceptions, steps and cases
 *
 * General ("fact") and Concepts ("idea") will be further values of the same column, each with
 * its own small exercise library on the same engine. An unknown value is taught as standard.
 */
export type TeachingShape = "standard" | "rule";

/** The built-in Rule — Applied card type (migration 20261117160000). */
export const RULE_CARD_TYPE_ID = "00000000-0000-4000-8000-000000000006";

/** Field roles that Applied cards use. They describe fields; they do not make a card Applied. */
export const RULE_ROLES: readonly FieldRole[] = ["condition", "exception", "step", "case", "outcome", "source"];

export function cardTypeShape(type: Pick<CardType, "id" | "teaching_shape"> | null | undefined): TeachingShape {
  if (!type) return "standard";
  if (type.teaching_shape === "rule") return "rule";
  // Before the teaching-shape migration is applied (or while it cannot be read offline),
  // the built-in Rule type is still recognised by its fixed id.
  return type.id === RULE_CARD_TYPE_ID ? "rule" : "standard";
}

export function packShape(pack: Pick<PackWithType, "cardType"> | null | undefined): TeachingShape {
  return cardTypeShape(pack?.cardType);
}

/** Fields whose text is usually longer than one line in an Applied card editor. */
export function isRuleTextField(type: Pick<CardType, "id" | "teaching_shape"> | null | undefined, field: FieldDef): boolean {
  if (cardTypeShape(type) !== "rule") return false;
  return field.role === "meaning" || field.role === "condition" || field.role === "exception"
    || field.role === "step" || field.role === "case" || field.role === "outcome";
}

/**
 * A list written in one field: one item per line, or separated by semicolons.
 * Bullets and numbering ("- ", "• ", "1. ", "a) ") are not part of the item.
 */
export function splitList(value: string): string[] {
  const text = value.normalize("NFC").trim();
  if (!text) return [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const items = lines.length > 1 ? lines : text.split(/\s*;\s*/);
  return items
    .map((item) => item.replace(/^(?:[-–—•·*▪◦]\s*|\(?(?:\d{1,2}|[a-z])[.)]\s+)/iu, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

/**
 * An extra case written as a note on the card: the situation, then a line starting with
 * "→" (or "Outcome:") for what follows. "situation → outcome" on one line works too.
 */
export function parseCaseText(value: string): { situation: string; outcome: string } | null {
  const text = value.normalize("NFC").trim();
  if (!text) return null;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const marker = /^(?:→|->|=>|outcome\s*:|result\s*:|then\s*:)\s*/i;
  const at = lines.findIndex((line, index) => index > 0 && marker.test(line));
  if (at > 0) {
    return {
      situation: lines.slice(0, at).join(" "),
      outcome: [lines[at].replace(marker, ""), ...lines.slice(at + 1)].join(" ").trim(),
    };
  }
  const inline = text.split(/\s+(?:→|->|=>)\s+/);
  if (inline.length === 2 && inline[0].trim() && inline[1].trim()) return { situation: inline[0].trim(), outcome: inline[1].trim() };
  return { situation: lines.join(" "), outcome: "" };
}
