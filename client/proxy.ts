import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:5000';

// Set by the Express server (server/src/config/cookies.ts). These checks are optimistic:
// they only look for the cookies. Express verifies the session on every /api call.
const ACCESS_COOKIE = 'sb-access-token';
const REFRESH_COOKIE = 'sb-refresh-token';
const SESSION_COOKIES = [ACCESS_COOKIE, REFRESH_COOKIE];

// The access cookie expires with the JWT. Express refreshes the session inside any
// authenticated call and answers with new Set-Cookie headers, but a server component
// can't pass those to the browser, and Supabase rotates refresh tokens, so the browser
// would keep a dead one. Refresh once here instead, where we can change both the
// request (so this render sees the new tokens) and the response (so the browser stores them).
async function refreshSession(request: NextRequest): Promise<string[]> {
  try {
    const res = await fetch(`${API_URL}/api/auth/me`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
    return res.headers.getSetCookie();
  } catch {
    return []; // Express unreachable: carry on, the page handles being signed out.
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const jar = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));
  const requestHeaders = new Headers(request.headers);
  const setCookies: string[] = [];

  if (pathname === '/dashboard' && !jar.has(ACCESS_COOKIE) && jar.has(REFRESH_COOKIE)) {
    for (const raw of await refreshSession(request)) {
      const pair = raw.split(';')[0];
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      // An empty value is Express clearing a cookie (the refresh was rejected).
      if (value) jar.set(name, value);
      else jar.delete(name);
      setCookies.push(raw);
    }
    requestHeaders.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  }

  const signedIn = SESSION_COOKIES.some((name) => jar.has(name));

  let response: NextResponse;

  if (pathname === '/' || (pathname === '/dashboard' && !signedIn)) {
    response = NextResponse.redirect(new URL('/login', request.url));
  } else if (pathname === '/login' && signedIn) {
    response = NextResponse.redirect(new URL('/dashboard', request.url));
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }
  for (const raw of setCookies) response.headers.append('set-cookie', raw);
  return response;
}

export const config = {
  matcher: ['/', '/login', '/dashboard'],
};
