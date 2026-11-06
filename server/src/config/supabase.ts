import { createClient } from "@supabase/supabase-js";
import { env } from "./env";

// Server-side clients never keep a session or refresh in the background: the session
// lives in the browser's cookies and requireAuth refreshes it explicitly.
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/** A client with no user, for Supabase Auth calls (sign in, refresh, sign out). */
export function createAnonClient() {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, { auth });
}

/** A per-request client that acts as the signed-in user, so RLS policies apply. */
export function createUserClient(accessToken: string) {
  return createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    auth,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export type UserClient = ReturnType<typeof createUserClient>;
