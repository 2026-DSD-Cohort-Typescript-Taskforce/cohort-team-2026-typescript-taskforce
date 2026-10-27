import type { Request, Response } from "express";
import { z } from "zod";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from "../config/cookies";
import { createUserClient } from "../config/supabase";
import { HttpError } from "../middleware/errorHandler";
import { refreshSession, signIn, signOut } from "../services/auth.service";
import { getProfileByAuthUserId } from "../services/users.service";

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

// Supabase Auth sign-up is on for the demo, so a login can exist with no public.users row.
const noProfile = () =>
  new HttpError(403, "No app profile is linked to this login. Ask an admin to set one up.", "profile_not_found");

export async function login(req: Request, res: Response) {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) throw new HttpError(400, "Enter a valid email address and password.");

  const session = await signIn(parsed.data.email, parsed.data.password);
  const profile = await getProfileByAuthUserId(createUserClient(session.access_token), session.user.id);
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
    console.error("Could not revoke the session:", error);
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
