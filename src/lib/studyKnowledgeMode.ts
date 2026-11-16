/** Study knowledge modes are independent of New / Learn / Review stages. */
export type KnowledgeMode = "languages" | "applied";

export const KNOWLEDGE_MODE_KEY = "heuresis.study.knowledge-mode.v1";
export const KNOWLEDGE_MODES: ReadonlyArray<{ id: KnowledgeMode; label: string }> = [
  { id: "languages", label: "Languages" },
  { id: "applied", label: "Applied" },
];

export function isKnowledgeMode(value: unknown): value is KnowledgeMode {
  return value === "languages" || value === "applied";
}

export function readKnowledgeMode(): KnowledgeMode {
  try {
    const stored = localStorage.getItem(KNOWLEDGE_MODE_KEY);
    return isKnowledgeMode(stored) ? stored : "languages";
  } catch {
    return "languages";
  }
}

export function writeKnowledgeMode(mode: KnowledgeMode): void {
  try { localStorage.setItem(KNOWLEDGE_MODE_KEY, mode); } catch { /* visual preference only */ }
}

export function studySelectionKey(mode: KnowledgeMode): string {
  return `heuresis.study.selection.v2.${mode}`;
}
