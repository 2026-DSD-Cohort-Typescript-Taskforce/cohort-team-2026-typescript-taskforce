/**
 * fetch() for the app's own /api routes, from the browser. A 401 means the access cookie
 * expired or was rejected: GET /api/auth/me has Express refresh the session cookies, and
 * the request is sent once more. If the session can't be refreshed, the user is sent to
 * /login and this returns null, so the caller does nothing more.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response | null> {
  const res = await fetch(path, { cache: "no-store", ...init });
  if (res.status !== 401) return res;

  const me = await fetch("/api/auth/me", { cache: "no-store" });
  if (me.ok) {
    // Safe to repeat: a 401 means the first request never reached the database.
    const retry = await fetch(path, { cache: "no-store", ...init });
    if (retry.status !== 401) return retry;
  }

  // Clear any leftover cookies first, or proxy.ts would send /login straight back to /.
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  window.location.replace("/login");
  return null;
}
