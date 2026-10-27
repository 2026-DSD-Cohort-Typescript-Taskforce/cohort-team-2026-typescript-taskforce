import {
  isAuthApiError,
  isAuthSessionMissingError,
  type AuthError,
  type Session,
  type User,
} from "@supabase/supabase-js";
import { createAnonClient } from "../config/supabase";
import { HttpError } from "../middleware/errorHandler";

const unavailable = () => new HttpError(503, "The sign-in service is unavailable. Try again shortly.");

/** True when Supabase Auth refused the request (bad password, expired token, signed out, ...). */
function isRejection(error: AuthError) {
  // auth-js reports a token whose session was signed out as AuthSessionMissingError.
  if (isAuthSessionMissingError(error)) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await createAnonClient().auth.signInWithPassword({ email, password });
  if (!error) return data.session;
  if (error.status === 429) throw new HttpError(429, "Too many sign-in attempts. Try again later.");
  // One message for every refusal, so the response never says whether the email exists.
  if (isRejection(error)) throw new HttpError(401, "Incorrect email or password.");
  throw unavailable();
}

/** The user for a valid access token, or null if Supabase Auth rejects it (expired, signed out). */
export async function getUser(accessToken: string): Promise<User | null> {
  const { data, error } = await createAnonClient().auth.getUser(accessToken);
  if (!error) return data.user;
  if (isRejection(error)) return null;
  throw unavailable();
}

/** A new session for a refresh token, or null if it was revoked or already used. */
export async function refreshSession(refreshToken: string): Promise<Session | null> {
  const { data, error } = await createAnonClient().auth.refreshSession({ refresh_token: refreshToken });
  if (!error) return data.session;
  if (isRejection(error)) return null;
  throw unavailable();
}

/** Revokes this session's refresh tokens. Returns false if the access token is no longer valid. */
export async function signOut(accessToken: string): Promise<boolean> {
  const { error } = await createAnonClient().auth.admin.signOut(accessToken, "local");
  if (!error) return true;
  if (isRejection(error)) return false;
  throw unavailable();
}
