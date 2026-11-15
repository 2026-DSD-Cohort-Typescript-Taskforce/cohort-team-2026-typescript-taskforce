import {
  AuthInvalidJwtError,
  isAuthApiError,
  isAuthSessionMissingError,
  type AuthError,
  type Session,
  type User,
} from '@supabase/supabase-js';
import { createAnonClient } from '../config/supabase';
import { HttpError } from '../middleware/errorHandler';

const unavailable = () =>
  new HttpError(503, 'The sign-in service is unavailable. Try again shortly.');

/** True when Supabase Auth refused the request (bad password, expired token, signed out, ...). */
function isRejection(error: AuthError) {
  // auth-js reports a token whose session was signed out as AuthSessionMissingError, and
  // refuses a malformed token itself, before calling Supabase Auth.
  if (isAuthSessionMissingError(error) || error instanceof AuthInvalidJwtError) return true;
  return isAuthApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 429;
}

export async function signIn(email: string, password: string): Promise<Session> {
  const { data, error } = await createAnonClient().auth.signInWithPassword({ email, password });
  if (!error) return data.session;
  if (error.status === 429) throw new HttpError(429, 'Too many sign-in attempts. Try again later.');
  // One message for every refusal, so the response never says whether the email exists.
  if (isRejection(error)) throw new HttpError(401, 'Incorrect email or password.');
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
  const { data, error } = await createAnonClient().auth.refreshSession({
    refresh_token: refreshToken,
  });
  if (!error) return data.session;
  if (isRejection(error)) return null;
  throw unavailable();
}

/** Revokes this session's refresh tokens. Returns false if the access token is no longer valid. */
export async function signOut(accessToken: string): Promise<boolean> {
  const { error } = await createAnonClient().auth.admin.signOut(accessToken, 'local');
  if (!error) return true;
  if (isRejection(error)) return false;
  throw unavailable();
}

export const emailInUse = () =>
  new HttpError(409, 'That email address is already in use.', 'email_in_use');

const signInAgain = () => new HttpError(401, 'Sign in again to change your email address.');

/**
 * A client holding the caller's session, for the Auth calls that act on it (updateUser).
 * Throws `rejected()` if Supabase Auth refuses the session.
 */
async function sessionClient(accessToken: string, refreshToken: string, rejected: () => HttpError) {
  const supabase = createAnonClient();
  const { error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw isRejection(error) ? rejected() : unavailable();
  return supabase;
}

/**
 * Asks Supabase Auth to change the signed-in user's email. It emails a link to the current
 * and the new address, and changes the login once both are opened; each link then
 * redirects to `redirectTo`. Returns the new session if the old one had to be refreshed.
 */
export async function requestEmailChange(
  accessToken: string,
  refreshToken: string | undefined,
  email: string,
  redirectTo: string,
): Promise<Session | null> {
  // updateUser acts on the client's own session, so load the caller's. Without the refresh
  // token, supabase-js can't hold a session.
  if (!refreshToken) throw signInAgain();
  const supabase = await sessionClient(accessToken, refreshToken, signInAgain);

  const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: redirectTo });
  if (error) {
    if (error.code === 'email_exists') throw emailInUse();
    if (error.status === 429)
      throw new HttpError(429, 'Too many email change requests. Try again later.');
    if (error.status === 400 || error.status === 422)
      throw new HttpError(400, 'Enter a valid email address.');
    if (isRejection(error)) throw signInAgain();
    throw unavailable();
  }

  // updateUser refreshes a session that is about to expire, which rotates the refresh token.
  const { data } = await supabase.auth.getSession();
  return data.session && data.session.refresh_token !== refreshToken ? data.session : null;
}

/**
 * Emails `email` a sign-in link that redirects to `redirectTo`, creating its login first if
 * it has none (DC-55 invites). The publishable key can do this because Auth sign-up is on.
 * Opening the link confirms the email, which links the pending profile to the login.
 */
export async function sendInvite(email: string, redirectTo: string): Promise<void> {
  const { error } = await createAnonClient().auth.signInWithOtp({
    email,
    options: { shouldCreateUser: true, emailRedirectTo: redirectTo },
  });
  if (!error) return;
  if (error.status === 429) throw new HttpError(429, 'Too many emails sent. Try again later.');
  console.error('Could not send the invite:', error);
  throw new HttpError(502, "The invite email couldn't be sent. Try again.", 'invite_not_sent');
}

export const linkExpired = () =>
  new HttpError(
    401,
    'This link has expired or was already used. Ask an admin to send you a new invite.',
    'link_expired',
  );

/**
 * Sets the password of the session from an invite link. Returns the session to keep, which
 * Supabase Auth may have refreshed.
 */
export async function setPasswordForSession(
  accessToken: string,
  refreshToken: string,
  password: string,
): Promise<Session> {
  const supabase = await sessionClient(accessToken, refreshToken, linkExpired);
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    // 422: the password breaks Auth's rules; its message says which.
    if (error.status === 422) throw new HttpError(400, error.message, error.code);
    throw isRejection(error) ? linkExpired() : unavailable();
  }
  const { data } = await supabase.auth.getSession();
  return data.session!;
}
