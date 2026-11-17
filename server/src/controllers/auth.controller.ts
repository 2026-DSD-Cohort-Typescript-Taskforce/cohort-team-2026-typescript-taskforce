import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearSessionCookies,
  setSessionCookies,
} from '../config/cookies';
import { env } from '../config/env';
import { createUserClient } from '../config/supabase';
import { HttpError } from '../middleware/errorHandler';
import {
  emailInUse,
  linkExpired,
  refreshSession,
  requestEmailChange,
  setPasswordForSession,
  signIn,
  signOut,
} from '../services/auth.service';
import { getProfileByAuthUserId, isEmailUsedByAnotherProfile } from '../services/users.service';

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// 255 is the length of users.email.
const changeEmailSchema = z.object({
  email: z.email().max(255),
});

// The tokens come from the invite link's URL fragment. bcrypt, behind Supabase Auth, reads
// at most 72 bytes of a password.
const setPasswordSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  password: z.string().min(8).max(72),
});

// Supabase Auth sign-up is on for the demo, so a login can exist with no public.users row.
const noProfile = () =>
  new HttpError(
    403,
    'No app profile is linked to this login. Ask an admin to set one up.',
    'profile_not_found',
  );

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Enter a valid email address and password.');

  const session = await signIn(parsed.data.email, parsed.data.password);
  const profile = await getProfileByAuthUserId(
    createUserClient(session.access_token),
    session.user.id,
  );
  if (!profile) {
    await signOut(session.access_token);
    throw noProfile();
  }

  setSessionCookies(res, session);
  res.json({ user: profile });
}

export async function logout(req: Request, res: Response) {
  const accessToken: string | undefined = req.cookies?.[ACCESS_COOKIE];
  const refreshToken: string | undefined = req.cookies?.[REFRESH_COOKIE];
  try {
    // Revoke the session in Supabase Auth. An expired access token can't sign out, so
    // fall back to trading the refresh token for a fresh one first.
    const revoked = accessToken ? await signOut(accessToken) : false;
    if (!revoked && refreshToken) {
      const session = await refreshSession(refreshToken);
      if (session) await signOut(session.access_token);
    }
  } catch (error) {
    // Clearing the cookies still signs this browser out.
    console.error('Could not revoke the session:', error);
  }
  clearSessionCookies(res);
  res.status(204).end();
}

export async function me(req: Request, res: Response) {
  const { user, supabase } = req.auth!;
  const profile = await getProfileByAuthUserId(supabase, user.id);
  if (!profile) throw noProfile();
  res.json({ user: profile });
}

/**
 * Starts a change of the caller's email. Supabase Auth changes the login once the links
 * sent to both addresses are opened, and a database trigger copies it to the profile.
 */
export async function changeEmail(req: Request, res: Response) {
  const parsed = changeEmailSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, 'Enter a valid email address.');
  // Supabase Auth stores emails in lower case.
  const email = parsed.data.email.toLowerCase();

  const { user, accessToken, refreshToken, supabase } = req.auth!;
  if (email === user.email)
    throw new HttpError(400, 'That is already your email address.', 'email_unchanged');
  // Supabase Auth only checks other logins. A profile with no login can also hold the
  // email, and the change would then fail at the last link, so check before sending any.
  if (await isEmailUsedByAnotherProfile(supabase, email, user.id)) throw emailInUse();

  const session = await requestEmailChange(
    accessToken,
    refreshToken,
    email,
    `${env.CLIENT_URL}/login`,
  );
  if (session) setSessionCookies(res, session);
  res.status(202).json({
    message:
      'Check both inboxes: open the link sent to your current email address and the one sent to the new address. Until both are opened, keep signing in with your current email.',
  });
}

/**
 * The last step of an invite (DC-55): sets the password of the session from the invite link
 * and signs the user in. Opening the link already linked the profile to the login.
 */
export async function setPassword(req: Request, res: Response) {
  const parsed = setPasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    if (parsed.error.issues.some((issue) => issue.path[0] === 'password'))
      throw new HttpError(400, 'Choose a password of 8 to 72 characters.');
    throw linkExpired();
  }
  const { accessToken, refreshToken, password } = parsed.data;

  const session = await setPasswordForSession(accessToken, refreshToken, password);
  const profile = await getProfileByAuthUserId(
    createUserClient(session.access_token),
    session.user.id,
  );
  if (!profile) {
    await signOut(session.access_token);
    throw noProfile();
  }

  setSessionCookies(res, session);
  res.json({ user: profile });
}
