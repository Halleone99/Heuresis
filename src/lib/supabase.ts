import { createClient } from "@supabase/supabase-js";

// Heuresis is a first-party desktop client for the existing Personal OS data.
// These are public client credentials (the same values already exposed to the
// browser build and GitHub Actions), not a service-role secret. Environment
// variables can still override them for development/testing, but the packaged
// desktop app must never depend on a local .env file existing on the user's PC.
const PERSONAL_OS_SUPABASE_URL = "https://qbxyiamrbqmdaubzcxpk.supabase.co";
const PERSONAL_OS_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_EyQguSeCT2BVi04m_DtlyA_9bcMp-R9";

const url = import.meta.env.VITE_SUPABASE_URL?.trim() || PERSONAL_OS_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() || PERSONAL_OS_SUPABASE_PUBLISHABLE_KEY;

export const supabaseConfigured = Boolean(url && key);

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      auth: {
        storage: localStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
