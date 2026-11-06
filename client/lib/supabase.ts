import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { NO_PROFILE, SAVE_FAILED, toWriteErrorResponse } from "./bill-errors";
import { SIGNED_OUT, toErrorResponse, type ErrorResponse, type SupabaseError } from "./submit-errors";

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
  return replyWithLogged(error, toErrorResponse(error, fallback));
}

/** As replyWithError, for an insert or update on bills (lib/bill-errors.ts). */
export function replyWithWriteError(error: SupabaseError, fallback?: string) {
  return replyWithLogged(error, toWriteErrorResponse(error, fallback));
}

function replyWithLogged(error: SupabaseError, response: ErrorResponse) {
  if (response.status === 500) console.error("Supabase request failed:", error);
  return reply(response);
}

/** The request's JSON body when it is an object, else null. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

/**
 * The caller's profile id (users.user_id), or a reply to send instead. The Auth user id is read
 * from the access token without checking it here: the query runs with that same token,
 * and PostgREST refuses it unless it is valid.
 */
export async function getProfileId(request: NextRequest, supabase: SupabaseClient): Promise<number | Response> {
  const authUserId = tokenSubject(request.cookies.get(ACCESS_COOKIE)?.value);
  if (!authUserId) return reply(SIGNED_OUT);

  const { data, error } = await supabase.from("users").select("user_id").eq("auth_user_id", authUserId).maybeSingle();
  if (error) return replyWithError(error, SAVE_FAILED);
  return data ? data.user_id : reply(NO_PROFILE);
}

// The JWT's sub claim: the Auth user id.
function tokenSubject(token: string | undefined): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token?.split(".")[1] ?? "", "base64url").toString());
    return typeof payload?.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}
