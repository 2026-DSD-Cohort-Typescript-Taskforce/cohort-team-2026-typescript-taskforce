import type { Request, RequestHandler, Response } from "express";
import type { User } from "@supabase/supabase-js";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearSessionCookies, setSessionCookies } from "../config/cookies";
import { createUserClient, type UserClient } from "../config/supabase";
import { getUser, refreshSession } from "../services/auth.service";
import { HttpError } from "./errorHandler";

export type AuthContext = {
  user: User;
  accessToken: string;
  /** Missing when the browser sent only the access cookie. */
  refreshToken?: string;
  /** Acts as the signed-in user, so RLS applies to every query made with it. */
  supabase: UserClient;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- the usual way to add fields to Express's Request type.
  namespace Express {
    interface Request {
      /** Set by requireAuth. */
      auth?: AuthContext;
    }
  }
}

/**
 * Resolves the caller's session from the cookies. The access token is checked with
 * Supabase Auth, which also rejects tokens of signed-out sessions. If it is missing or
 * rejected, the refresh token is traded for a new pair and the new cookies are set on
 * `res`. Returns null when there is no usable session.
 */
export async function authenticate(req: Request, res: Response): Promise<AuthContext | null> {
  const accessToken: string | undefined = req.cookies?.[ACCESS_COOKIE];
  const refreshToken: string | undefined = req.cookies?.[REFRESH_COOKIE];

  if (accessToken) {
    const user = await getUser(accessToken);
    if (user) return { user, accessToken, refreshToken, supabase: createUserClient(accessToken) };
  }
  if (refreshToken) {
    const session = await refreshSession(refreshToken);
    if (session) {
      setSessionCookies(res, session);
      return {
        user: session.user,
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
        supabase: createUserClient(session.access_token),
      };
    }
  }
  return null;
}

/** Rejects the request with 401 unless it carries a valid (or refreshable) session. */
export const requireAuth: RequestHandler = async (req, res, next) => {
  const auth = await authenticate(req, res);
  if (!auth) {
    clearSessionCookies(res);
    throw new HttpError(401, "You are not signed in.");
  }
  req.auth = auth;
  next();
};
