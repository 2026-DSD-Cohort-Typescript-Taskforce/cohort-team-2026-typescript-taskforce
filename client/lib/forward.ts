import "server-only";

import { backend } from "./backend";

/**
 * Sends the request to `path` on Express and returns Express's answer as it is: status,
 * body, content type and every Set-Cookie. Used by routes that rely on the session
 * cookies, which Express sets and reads (server/src/config/cookies.ts).
 */
export async function forward(request: Request, path: string) {
  // A plain object: backend() spreads init.headers, and a Headers instance spreads to {}.
  const headers: Record<string, string> = {};
  const cookie = request.headers.get("cookie");
  if (cookie) headers.cookie = cookie;
  // Keep the browser's content type, so Express only parses a JSON body that was sent as JSON.
  const contentType = request.headers.get("content-type");
  if (contentType) headers["Content-Type"] = contentType;

  try {
    const res = await backend(path, {
      method: request.method,
      headers,
      // GET has no body, and fetch refuses an empty string for it.
      body: (await request.text()) || undefined,
    });

    const out = new Headers({ "Cache-Control": "no-store" });
    const resType = res.headers.get("content-type");
    if (resType) out.set("content-type", resType);
    for (const setCookie of res.headers.getSetCookie()) out.append("set-cookie", setCookie);

    // A 204 (logout) has no body, and a 204 Response can't be given one.
    const body = res.body ? await res.arrayBuffer() : null;
    return new Response(body, { status: res.status, headers: out });
  } catch {
    // Express's error shape, which the login form shows.
    return Response.json(
      { error: "Could not reach the server. Try again." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
