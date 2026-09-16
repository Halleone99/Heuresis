import { createClient } from "@supabase/supabase-js";
import { offlineFetch } from "./offlineFetch";
import { readOfflineSession, rememberOfflineSession } from "./offlineSession";

// Heuresis is a first-party desktop client for the existing Personal OS data.
// These are public client credentials (the same values already exposed to the
// browser build and GitHub Actions), not a service-role secret. Environment
// variables can still override them for development/testing, but the packaged
// desktop app must never depend on a local .env file existing on the user's PC.
const PERSONAL_OS_SUPABASE_URL = "https://qbxyiamrbqmdaubzcxpk.supabase.co";
const PERSONAL_OS_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_EyQguSeCT2BVi04m_DtlyA_9bcMp-R9";
const NETWORK_TIMEOUT_MS = 7_000;

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || PERSONAL_OS_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || PERSONAL_OS_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

async function timedOfflineFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const upstream = init?.signal;
  const abortFromUpstream = () => controller.abort(upstream?.reason);
  if (upstream?.aborted) abortFromUpstream();
  else upstream?.addEventListener("abort", abortFromUpstream, { once: true });
  const timer = window.setTimeout(() => controller.abort(new DOMException("Heuresis network timeout", "TimeoutError")), NETWORK_TIMEOUT_MS);
  try {
    return await offlineFetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    upstream?.removeEventListener("abort", abortFromUpstream);
  }
}

function createHeuresisClient() {
  const client = createClient(url, key, {
    global: { fetch: timedOfflineFetch },
    auth: {
      storage: localStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });

  const originalGetSession = client.auth.getSession.bind(client.auth);
  client.auth.getSession = (async () => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const cached = readOfflineSession();
      if (cached) return { data: { session: cached }, error: null };
    }
    try {
      const result = await originalGetSession();
      if (result.data.session) {
        rememberOfflineSession(result.data.session);
        return result;
      }
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const cached = readOfflineSession();
        if (cached) return { data: { session: cached }, error: null };
      }
      return result;
    } catch (error) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const cached = readOfflineSession();
        if (cached) return { data: { session: cached }, error: null };
      }
      throw error;
    }
  }) as typeof client.auth.getSession;

  const originalGetUser = client.auth.getUser.bind(client.auth);
  client.auth.getUser = (async (...args: Parameters<typeof originalGetUser>) => {
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      const cached = readOfflineSession();
      if (cached?.user) return { data: { user: cached.user }, error: null };
    }
    try {
      const result = await originalGetUser(...args);
      if (result.data.user) return result;
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const cached = readOfflineSession();
        if (cached?.user) return { data: { user: cached.user }, error: null };
      }
      return result;
    } catch (error) {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        const cached = readOfflineSession();
        if (cached?.user) return { data: { user: cached.user }, error: null };
      }
      throw error;
    }
  }) as typeof client.auth.getUser;

  return client;
}

export const supabase = supabaseConfigured ? createHeuresisClient() : null;
