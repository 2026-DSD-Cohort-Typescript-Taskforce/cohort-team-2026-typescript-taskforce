import "server-only";

import { createClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { SIGNED_OUT, toErrorResponse, type SupabaseError } from "./submit-errors";

// Set by Express at sign-in and on every refresh (server/src/config/cookies.ts).
const ACCESS_COOKIE = "sb-access-token";

// As in server/src/config/supabase.ts: the session lives in the browser's cookies and
// Express refreshes it, so this client never keeps or refreshes one.
const auth = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };

/**
 * A client for this request that acts as the signed-in user, so RLS applies. Without an
 * access cookie it returns a 401 reply instead and Supabase isn't called; the browser
 * then refreshes the session through /api/auth/me and retries (lib/api-fetch.ts).
 */
export function createUserClient(request: NextRequest) {
  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!accessToken) return reply(SIGNED_OUT);

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. See client/.env.example.");
  }
  return createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth,
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

/** A JSON reply that is never cached: every answer depends on the caller's session. */
export function reply({ status = 200, body }: { status?: number; body: unknown }) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Replies to a Supabase error with a readable message. Unexpected ones are logged here. */
export function replyWithError(error: SupabaseError, fallback?: string) {
  const response = toErrorResponse(error, fallback);
  if (response.status === 500) console.error("Supabase request failed:", error);
  return reply(response);
}
