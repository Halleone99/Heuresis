import type { NoteCategory } from "./knowledgeWorkspace";

export type ParsedCapture =
  | { kind: "note"; body: string; category: NoteCategory; preview: string }
  | { kind: "mistake"; attempt: string; correction: string; explanation: string; category: NoteCategory; preview: string };

/** Small, predictable capture shorthand. Input is not rewritten while typing. */
export function parseCaptureLine(input: string): ParsedCapture {
  let value = input.trim();
  let category: NoteCategory = "note";

  // Tags can appear at the beginning or end without changing the saved meaning.
  const tags: Record<string, NoteCategory> = { "#g": "grammar", "#v": "vocabulary", "#e": "phrase" };
  const leading = value.match(/^(#g|#v|#e)(?=\s|$)/i);
  if (leading) {
    category = tags[leading[1].toLowerCase()];
    value = value.slice(leading[0].length).trim();
  }
  const trailing = value.match(/(?:^|\s)(#g|#v|#e)$/i);
  if (trailing) {
    category = tags[trailing[1].toLowerCase()];
    value = value.slice(0, trailing.index).trim();
  }

  // "a -> b // explanation" (or arrow glyph) is a mistake, even if b is empty.
  const arrow = /\s(?:->|→)\s*/.exec(value);
  if (arrow) {
    const attempt = value.slice(0, arrow.index).trim();
    const rest = value.slice(arrow.index + arrow[0].length);
    const why = /\s\/\/\s*/.exec(rest);
    const correction = (why ? rest.slice(0, why.index) : rest).trim();
    const explanation = why ? rest.slice(why.index + why[0].length).trim() : "";
    if (attempt || correction) return {
      kind: "mistake", attempt, correction, explanation, category,
      preview: `Mistake · ${category === "note" ? "Other" : category}`,
    };
  }

  const question = /[?？]\s*$/.test(value);
  if (question && category === "note") category = "question";
  return { kind: "note", body: value, category,
    preview: category === "note" ? "Note" : category === "question" ? "Question" : category === "phrase" ? "Expression" : category[0].toUpperCase() + category.slice(1) };
}
