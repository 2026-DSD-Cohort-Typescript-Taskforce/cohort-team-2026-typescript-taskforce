import type { CookieOptions, Response } from "express";
import type { Session } from "@supabase/supabase-js";

// client/proxy.ts checks for these names to redirect signed-in and signed-out visits.
export const ACCESS_COOKIE = "sb-access-token";
export const REFRESH_COOKIE = "sb-refresh-token";

function baseOptions(): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    // Read per call so a production process always sends Secure cookies.
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

/**
 * The access cookie expires with the JWT, so the browser stops sending it and the next
 * request refreshes. The refresh cookie has no Max-Age: it ends when the browser closes.
 */
export function setSessionCookies(res: Response, session: Session) {
  res.cookie(ACCESS_COOKIE, session.access_token, {
    ...baseOptions(),
    maxAge: session.expires_in * 1000,
  });
  res.cookie(REFRESH_COOKIE, session.refresh_token, baseOptions());
}

export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, baseOptions());
  res.clearCookie(REFRESH_COOKIE, baseOptions());
}
