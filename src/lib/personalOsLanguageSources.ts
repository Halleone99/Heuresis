import { supabase } from "./supabase";

/**
 * Read-only bridge to Personal OS language data. Do not copy or overwrite
 * legacy data while Heuresis and Personal OS share the same Supabase project.
 */
export type LanguageIdentity = { id: string; name: string };
export type LanguageObjective = {
  id: string;
  languageId: string;
  kind: "counted" | "stepped";
  title: string;
  description: string;
  current: number;
  target: number;
  unit: string;
  steps: Array<{ id: string; label: string; done: boolean }>;
  targetDate: string;
  status: "active" | "paused" | "completed";
  lastWorkedAt: string;
  updatedAt: string;
};
export type LanguageObjectivesSnapshot = {
  activeLanguageId: string;
  languages: LanguageIdentity[];
  objectives: LanguageObjective[];
  focusByLanguage: Record<string, string>;
  updatedAt: string | null;
};
export type LanguageLesson = {
  id: string;
  language_id: string;
  language_name: string;
  lesson_date: string;
  title: string;
};
export type CapturedLanguageEntry = {
  id: string;
  entry_type: "definition" | "pair" | "note";
  front: string;
  back: string | null;
  third_side: string | null;
  source_id: string | null;
  subject: string | null;
  lesson_id: string | null;
  status: string;
  created_at: string;
};
export type LegacyAnkiReviewDay = { date: string; reviews: number; notes: string | null };

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function str(value: unknown): string { return typeof value === "string" ? value : ""; }
function number(value: unknown): number { return typeof value === "number" && Number.isFinite(value) ? value : 0; }

/** Read the cloud snapshot; browser-local Personal OS caches are not shared across app origins. */
export async function loadLanguageObjectives(userId: string): Promise<LanguageObjectivesSnapshot> {
  if (!userId) throw new Error("A signed-in user is required.");
  const { data, error } = await db()
    .from("language_notebooks")
    .select("data,updated_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  const snapshot = object(data?.data);
  const languages: LanguageIdentity[] = Array.isArray(snapshot.languages)
    ? snapshot.languages.flatMap((entry) => {
        const row = object(entry);
        return str(row.id) && str(row.name) ? [{ id: str(row.id), name: str(row.name) }] : [];
      })
    : [];
  const objectives: LanguageObjective[] = Array.isArray(snapshot.objectives)
    ? snapshot.objectives.flatMap((entry) => {
        const row = object(entry);
        if (!str(row.id) || !str(row.languageId) || !str(row.title)) return [];
        const steps = Array.isArray(row.steps) ? row.steps.flatMap((step) => {
          const s = object(step);
          return str(s.id) && str(s.label) ? [{ id: str(s.id), label: str(s.label), done: s.done === true }] : [];
        }) : [];
        return [{
          id: str(row.id), languageId: str(row.languageId),
          kind: row.kind === "stepped" ? "stepped" as const : "counted" as const,
          title: str(row.title), description: str(row.description),
          current: number(row.current), target: number(row.target),
          unit: str(row.unit), steps, targetDate: str(row.targetDate),
          status: row.status === "paused" ? "paused" as const : row.status === "completed" ? "completed" as const : "active" as const,
          lastWorkedAt: str(row.lastWorkedAt), updatedAt: str(row.updatedAt),
        }];
      })
    : [];
  const rawFocus = object(snapshot.focusByLanguage);
  const focusByLanguage = Object.fromEntries(Object.entries(rawFocus).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  return {
    activeLanguageId: str(snapshot.activeLanguageId), languages, objectives, focusByLanguage,
    updatedAt: typeof data?.updated_at === "string" ? data.updated_at : null,
  };
}

/** Existing Personal OS lesson rows and captured notes are suitable for a read-only Notebook preview. */
export async function loadLanguageLessons(userId: string): Promise<LanguageLesson[]> {
  if (!userId) throw new Error("A signed-in user is required.");
  const { data, error } = await db().from("language_lessons")
    .select("id,language_id,language_name,lesson_date,title")
    .eq("user_id", userId).order("lesson_date", { ascending: false }).limit(500);
  if (error) throw error;
  return (data ?? []) as LanguageLesson[];
}

export async function loadCapturedLanguageEntries(userId: string): Promise<CapturedLanguageEntry[]> {
  if (!userId) throw new Error("A signed-in user is required.");
  const { data, error } = await db().from("knowledge_entries")
    .select("id,entry_type,front,back,third_side,source_id,subject,lesson_id,status,created_at")
    .eq("user_id", userId).eq("source_type", "language")
    .order("created_at", { ascending: false }).limit(3000);
  if (error) throw error;
  return (data ?? []) as CapturedLanguageEntry[];
}

/** Manually logged external Anki counts; not Heuresis study-event counts. */
export async function loadLegacyAnkiReviews(): Promise<LegacyAnkiReviewDay[]> {
  const { data, error } = await db().from("anki_review_days")
    .select("date,reviews,notes")
    .order("date", { ascending: false }).limit(365);
  if (error) throw error;
  return (data ?? []) as LegacyAnkiReviewDay[];
}
