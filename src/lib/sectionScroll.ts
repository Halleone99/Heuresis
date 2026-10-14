import type { WorkspaceSection } from "./workspaceMemory";

export type RememberedSectionScroll = { page: string; y: number };
export type SectionScrollState = Partial<Record<WorkspaceSection, RememberedSectionScroll>>;
const KEY = (userId: string) => `heuresis.scroll.positions.v1:${userId}`;
const sections = new Set(["overview", "study", "notebook", "mistakes", "progress"]);

export function readSectionScroll(userId: string): SectionScrollState {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY(userId)) ?? "null");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: SectionScrollState = {};
    for (const [name, row] of Object.entries(parsed)) {
      if (!sections.has(name) || !row || typeof row !== "object" || Array.isArray(row)) continue;
      const value = row as Record<string, unknown>;
      if (typeof value.page !== "string" || value.page.length > 512 ||
        typeof value.y !== "number" || !Number.isFinite(value.y) || value.y < 0 || value.y > 100_000) continue;
      result[name as WorkspaceSection] = { page: value.page, y: Math.floor(value.y) };
    }
    return result;
  } catch { return {}; }
}
export function writeSectionScroll(userId: string, value: SectionScrollState) {
  try { localStorage.setItem(KEY(userId), JSON.stringify(value)); }
  catch { /* local data may be disabled or full, never block reading */ }
}
