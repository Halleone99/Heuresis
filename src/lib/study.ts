import { supabase } from "./supabase";

export type StudyGrade = "again" | "hard" | "good" | "easy";
export type StudyEventType = "encountered" | "revealed" | StudyGrade;
export type HeuresisSessionMode = "flashcards" | "sort" | "browse" | "related";

export type StudyTemplate = {
  id: string;
  card_type_id: string;
  name: string;
  front: string[];
  back: string[];
  details: string[];
  sort_order: number;
};

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function loadStudySetup(packId: string, cardTypeId: string) {
  const [packResult, templatesResult] = await Promise.all([
    db().from("heuresis_packs").select("default_template_id").eq("id", packId).maybeSingle(),
    db()
      .from("heuresis_study_templates")
      .select("id,card_type_id,name,front,back,details,sort_order")
      .eq("card_type_id", cardTypeId)
      .order("sort_order")
      .order("name"),
  ]);

  if (packResult.error) throw packResult.error;
  if (templatesResult.error) throw templatesResult.error;

  const templates: StudyTemplate[] = (templatesResult.data ?? []).map((row) => ({
    id: row.id,
    card_type_id: row.card_type_id,
    name: row.name,
    front: stringArray(row.front),
    back: stringArray(row.back),
    details: stringArray(row.details),
    sort_order: Number(row.sort_order ?? 0),
  }));

  return {
    templates,
    defaultTemplateId: packResult.data?.default_template_id ?? templates[0]?.id ?? null,
  };
}

export async function startHeuresisSession(packId: string, mode: HeuresisSessionMode, templateId: string | null = null) {
  const { data, error } = await db()
    .from("heuresis_sessions")
    .insert({ pack_id: packId, mode, template_id: templateId })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function startStudySession(packId: string, templateId: string | null) {
  return startHeuresisSession(packId, "flashcards", templateId);
}

export async function finishStudySession(sessionId: string) {
  const { error } = await db()
    .from("heuresis_sessions")
    .update({ ended_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (error) throw error;
}

export async function recordStudyEvent(input: {
  cardId: string;
  packId: string;
  sessionId: string;
  templateId: string | null;
  eventType: StudyEventType;
}) {
  const { error } = await db().from("heuresis_card_events").insert({
    client_event_id: crypto.randomUUID(),
    card_id: input.cardId,
    pack_id: input.packId,
    session_id: input.sessionId,
    template_id: input.templateId,
    event_type: input.eventType,
  });
  if (error) throw error;
}
