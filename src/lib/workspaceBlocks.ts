/**
 * Workspace blocks saved by Capture (v2) and the older desktop panels (v1).
 * Keep the original JSON for untouched blocks: future or language-specific
 * metadata must survive an edit in another surface.
 */
export const WORKSPACE_BLOCKS_KEY = "_workspace_blocks";

export type WorkspaceDimension = "neighbours" | "components" | "examples" | "structure" | "origin" | "facts" | "notes";
export type WorkspaceTextBlock = {
  id: string;
  type: "text";
  text: string;
  dim: WorkspaceDimension;
  raw?: string;
};
export type WorkspaceImageBlock = {
  id: string;
  type: "image";
  path: string;
  caption: string;
  dim: WorkspaceDimension;
  raw?: string;
};
export type WorkspaceExampleBlock = {
  id: string;
  type: "example";
  source: string;
  reading: string;
  translation: string;
  text: string;
  provenance: string;
  dim: WorkspaceDimension;
  raw?: string;
};
export type WorkspaceBlock = WorkspaceTextBlock | WorkspaceImageBlock | WorkspaceExampleBlock;

const VALID_DIMS = new Set<WorkspaceDimension>(["neighbours", "components", "examples", "structure", "origin", "facts", "notes"]);
const DEFAULT_DIM: Record<string, WorkspaceDimension> = {
  text: "notes",
  image: "notes",
  note: "notes",
  grammar: "structure",
  parts: "components",
  origin: "origin",
  fact: "facts",
  example: "examples",
};

function dimension(value: unknown, type: string): WorkspaceDimension {
  if (value === "contrast") return "neighbours";
  if (typeof value === "string" && VALID_DIMS.has(value as WorkspaceDimension)) return value as WorkspaceDimension;
  return DEFAULT_DIM[type] ?? "notes";
}

function parseEntry(entry: string): WorkspaceBlock | null {
  try {
    const value: unknown = JSON.parse(entry);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== "string" || !row.id) return null;
    const type = typeof row.type === "string" ? row.type : "";
    const dim = dimension(row.dim, type);
    if (type === "image" && typeof row.path === "string") {
      return { id: row.id, type: "image", path: row.path, caption: typeof row.caption === "string" ? row.caption : "", dim, raw: entry };
    }
    if (type === "example" && (typeof row.source === "string" || typeof row.text === "string")) {
      const text = typeof row.text === "string" ? row.text : "";
      const source = typeof row.source === "string" ? row.source : text.split("\n")[0] ?? "";
      return {
        id: row.id, type: "example", source,
        reading: typeof row.reading === "string" ? row.reading : "",
        translation: typeof row.translation === "string" ? row.translation : "",
        provenance: typeof row.provenance === "string" ? row.provenance : "",
        text, dim, raw: entry,
      };
    }
    if (["text", "grammar", "parts", "origin", "fact", "note"].includes(type) && typeof row.text === "string") {
      return { id: row.id, type: "text", text: row.text, dim, raw: entry };
    }
    return null;
  } catch {
    return null;
  }
}

export function parseWorkspaceBlocks(value: unknown): WorkspaceBlock[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => typeof entry === "string" ? (parseEntry(entry) ? [parseEntry(entry)!] : []) : []);
}

export function canRoundTripWorkspaceEntry(entry: string): boolean {
  return parseEntry(entry) !== null;
}

export function serialiseWorkspaceBlocks(blocks: WorkspaceBlock[]): string[] {
  return blocks.map((block) => block.raw ?? JSON.stringify(block));
}
