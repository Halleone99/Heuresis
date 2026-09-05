import type { PackWithType } from "./heuresis";

const CAPTURE_STORAGE_PREFIX = "heuresis.capture.v1";

type StoredBlock = {
  id?: string;
  kind?: string;
  value?: string;
  reading?: string;
  meaning?: string;
};

type StoredDraft = {
  id: string;
  packId: string;
  values: Record<string, string>;
  tagIds: string[];
  blocks: StoredBlock[];
  createdAt: string;
};

type StoredCapture = {
  draft?: StoredDraft;
  queue?: StoredDraft[];
};

export type CaptureInboxItem = {
  id: string;
  packId: string;
  packTitle: string;
  state: "draft" | "waiting";
  front: string;
  back: string;
  enrichmentCount: number;
  createdAt: string;
};

function storageKey(packId: string) {
  return `${CAPTURE_STORAGE_PREFIX}:${packId}`;
}

function readStored(packId: string): StoredCapture {
  try {
    const raw = localStorage.getItem(storageKey(packId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as StoredCapture;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function isMeaningfulDraft(draft: StoredDraft | undefined) {
  if (!draft) return false;
  return Object.values(draft.values ?? {}).some((value) => typeof value === "string" && value.trim())
    || (draft.blocks ?? []).some((block) => [block.value, block.reading, block.meaning].some((value) => typeof value === "string" && value.trim()))
    || (draft.tagIds ?? []).length > 0;
}

function summarise(pack: PackWithType, draft: StoredDraft) {
  const fields = pack.cardType?.field_schema ?? [];
  if (!fields.length) {
    const values = Object.values(draft.values ?? {}).filter((value) => typeof value === "string" && value.trim());
    return { front: values[0] ?? "Untitled", back: values.slice(1).join(" · ") };
  }

  const termFields = fields.filter((field) => field.role === "term");
  const frontFields = termFields.length ? termFields : [fields[0]];
  const frontKeys = new Set(frontFields.map((field) => field.key));
  let backFields = fields.filter((field) => !frontKeys.has(field.key) && (field.role === "reading" || field.role === "meaning" || field.required));
  if (!backFields.length) {
    const fallback = fields.find((field) => !frontKeys.has(field.key));
    if (fallback) backFields = [fallback];
  }

  const front = frontFields.map((field) => draft.values?.[field.key]?.trim()).filter(Boolean).join(" · ") || "Untitled";
  const back = backFields.map((field) => draft.values?.[field.key]?.trim()).filter(Boolean).join(" · ");
  return { front, back };
}

export function listCaptureInbox(packs: PackWithType[], collectionId?: string | null): CaptureInboxItem[] {
  if (typeof localStorage === "undefined") return [];
  const relevantPacks = collectionId ? packs.filter((pack) => pack.collection_id === collectionId) : packs;
  const rows: CaptureInboxItem[] = [];

  relevantPacks.forEach((pack) => {
    const stored = readStored(pack.id);
    const add = (draft: StoredDraft | undefined, state: CaptureInboxItem["state"]) => {
      if (!isMeaningfulDraft(draft) || !draft) return;
      const summary = summarise(pack, draft);
      rows.push({
        id: draft.id,
        packId: pack.id,
        packTitle: pack.title,
        state,
        front: summary.front,
        back: summary.back,
        enrichmentCount: (draft.blocks ?? []).filter((block) => [block.value, block.reading, block.meaning].some((value) => typeof value === "string" && value.trim())).length,
        createdAt: draft.createdAt || new Date(0).toISOString(),
      });
    };

    (stored.queue ?? []).forEach((draft) => add(draft, "waiting"));
    add(stored.draft, "draft");
  });

  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function countCaptureInbox(packs: PackWithType[], collectionId: string) {
  return listCaptureInbox(packs, collectionId).length;
}

export function removeCaptureInboxItem(packId: string, itemId: string) {
  const stored = readStored(packId);
  const queue = (stored.queue ?? []).filter((item) => item.id !== itemId);
  const current = stored.draft;
  const removingCurrent = current?.id === itemId;

  if (removingCurrent) delete stored.draft;
  stored.queue = queue;

  const hasCurrent = isMeaningfulDraft(stored.draft);
  if (!queue.length && !hasCurrent) localStorage.removeItem(storageKey(packId));
  else localStorage.setItem(storageKey(packId), JSON.stringify(stored));
}
