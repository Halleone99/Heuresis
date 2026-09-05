import { supabase } from "./supabase";

const STALE_AFTER_MS = 90 * 60 * 1000;

type OpenSession = { id: string; started_at: string };
type SessionEvent = { session_id: string; created_at: string };

/**
 * Repairs abandoned sessions without inventing study time. A stale session is
 * closed at its last persisted event, or at started_at if it recorded none.
 */
export async function reconcileStaleHeuresisSessions(now = Date.now()) {
  const client = supabase;
  if (!client) return 0;
  const { data: authData } = await client.auth.getUser();
  const user = authData.user;
  if (!user) return 0;

  const cutoff = new Date(now - STALE_AFTER_MS).toISOString();
  const { data: sessions, error: sessionError } = await client
    .from("heuresis_sessions")
    .select("id,started_at")
    .eq("user_id", user.id)
    .is("ended_at", null)
    .lt("started_at", cutoff);
  if (sessionError) throw sessionError;

  const stale = (sessions ?? []) as OpenSession[];
  if (!stale.length) return 0;

  const ids = stale.map((session) => session.id);
  const { data: events, error: eventError } = await client
    .from("heuresis_card_events")
    .select("session_id,created_at")
    .eq("user_id", user.id)
    .in("session_id", ids)
    .order("created_at", { ascending: true });
  if (eventError) throw eventError;

  const lastEventBySession = new Map<string, string>();
  for (const event of (events ?? []) as SessionEvent[]) {
    lastEventBySession.set(event.session_id, event.created_at);
  }

  await Promise.all(stale.map(async (session) => {
    const endedAt = lastEventBySession.get(session.id) ?? session.started_at;
    const { error } = await client
      .from("heuresis_sessions")
      .update({ ended_at: endedAt })
      .eq("id", session.id)
      .eq("user_id", user.id)
      .is("ended_at", null);
    if (error) throw error;
  }));

  return stale.length;
}
