import { supabase } from "./supabase";

function db() {
  if (!supabase) throw new Error("Supabase is not configured.");
  return supabase;
}

function sameKeys(left: unknown, right: string[]) {
  return Array.isArray(left) && left.length === right.length && left.every((value, index) => value === right[index]);
}

export async function saveImportStudyLayout(input: {
  packId: string;
  cardTypeId: string;
  name: string;
  front: string[];
  back: string[];
  details: string[];
}) {
  if (!input.front.length || !input.back.length) return null;
  const { data: auth, error: authError } = await db().auth.getUser();
  if (authError) throw authError;
  const userId = auth.user?.id;
  if (!userId) throw new Error("Sign in before saving a study layout.");

  const { data: templates, error: templateError } = await db()
    .from("heuresis_study_templates")
    .select("id,user_id,name,front,back,details,sort_order")
    .eq("card_type_id", input.cardTypeId)
    .order("sort_order");
  if (templateError) throw templateError;

  const exact = (templates ?? []).find((template) =>
    sameKeys(template.front, input.front) && sameKeys(template.back, input.back) && sameKeys(template.details, input.details));
  let templateId = exact?.id as string | undefined;

  if (!templateId) {
    const maxSort = (templates ?? []).reduce((max, template) => Math.max(max, Number(template.sort_order ?? 0)), -1);
    const { data: created, error: createError } = await db().from("heuresis_study_templates").insert({
      user_id: userId,
      card_type_id: input.cardTypeId,
      name: input.name.slice(0, 120),
      front: input.front,
      back: input.back,
      details: input.details,
      sort_order: maxSort + 1,
    }).select("id").single();
    if (createError) throw createError;
    templateId = created.id;
  }

  const { error: packError } = await db().from("heuresis_packs")
    .update({ default_template_id: templateId, updated_at: new Date().toISOString() })
    .eq("id", input.packId);
  if (packError) throw packError;
  return templateId;
}
