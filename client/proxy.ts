import { NextResponse, type NextRequest } from 'next/server';

const API_URL = process.env.API_URL ?? 'http://localhost:5000';

// Set by the Express server (server/src/config/cookies.ts). These checks are optimistic:
// they only look for the cookies. Express and Supabase verify the session on every /api call.
const ACCESS_COOKIE = 'sb-access-token';
const REFRESH_COOKIE = 'sb-refresh-token';
const SESSION_COOKIES = [ACCESS_COOKIE, REFRESH_COOKIE];

// The access cookie expires with the JWT. Express refreshes the session inside any
// authenticated call and answers with new Set-Cookie headers, but a server component
// can't pass those to the browser, and Supabase rotates refresh tokens, so the browser
// would keep a dead one. Refresh once here instead, where we can change both the
// request (so this render sees the new tokens) and the response (so the browser stores them).
async function refreshSession(request: NextRequest): Promise<Response | null> {
  try {
    return await fetch(`${API_URL}/api/auth/me`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
    });
  } catch {
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const jar = new Map(request.cookies.getAll().map((c) => [c.name, c.value]));
  const requestHeaders = new Headers(request.headers);
  const setCookies: string[] = [];

  let dashboardSignedIn = false;
  if (pathname === '/dashboard' && SESSION_COOKIES.some((name) => jar.has(name))) {
    const session = await refreshSession(request);
    if (!session || (!session.ok && session.status !== 401 && session.status !== 403)) {
      return new NextResponse('Could not verify your session. Try again.', {
        status: 503,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    dashboardSignedIn = session.ok;
    for (const raw of session.headers.getSetCookie()) {
      const pair = raw.split(';')[0];
      const eq = pair.indexOf('=');
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1);
      // An empty value is Express clearing a cookie (the refresh was rejected).
      if (value) jar.set(name, value);
      else jar.delete(name);
      setCookies.push(raw);
    }
    if (!session.ok) {
      for (const name of SESSION_COOKIES) {
        jar.delete(name);
        setCookies.push(`${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
      }
    }
    requestHeaders.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
  }

  const signedIn = SESSION_COOKIES.some((name) => jar.has(name));
  // The /bills and /approvals pages load their data in the browser through apiFetch, which
  // refreshes an expired session itself, so they only need the signed-out check.
  const protectedPage =
    pathname === '/dashboard' ||
    pathname === '/bills' ||
    pathname.startsWith('/bills/') ||
    pathname === '/approvals';

  let response: NextResponse;

  if (pathname === '/' || (pathname === '/dashboard' && !dashboardSignedIn) || (protectedPage && !signedIn)) {
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
  matcher: ['/', '/login', '/dashboard', '/bills', '/bills/:id', '/approvals'],
};
