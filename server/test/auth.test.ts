// Integration tests for /api/auth/*. They run the Express app against a LOCAL
// Supabase (`supabase start`, then `npm run seed:local-users`) and refuse any other URL.
//
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_PUBLISHABLE_KEY=<Publishable key from `supabase status`> \
//   SEED_USER_PASSWORD=<the password you seeded with> \
//   MAILPIT_URL=<Mailpit URL from `supabase status`, default http://127.0.0.1:54324> \
//   npm test
//
// One run makes about 20 sign-in/sign-up calls; local Auth allows 30 per 5 minutes per IP.
// The email change tests change CHANGE_USER_EMAIL's login and change it back. If a run
// stops halfway, `supabase db reset` and seed again.
import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createClient } from '@supabase/supabase-js';
import app from '../src/app';

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SEED_USER_PASSWORD } = process.env;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? 'alex.morgan@example.com';
// A second seeded login, so changing its email doesn't affect the other tests.
const CHANGE_USER_EMAIL = 'morgan.ellis@example.com';
// A seeded system_admin (supabase/seed.sql), for the invite tests.
const ADMIN_EMAIL = process.env.TEST_ADMIN_EMAIL ?? 'sam.rivera@example.com';
const MAILPIT_URL = process.env.MAILPIT_URL ?? 'http://127.0.0.1:54324';
// Same default as src/config/env.ts. Email confirmation links redirect to its /login.
const CLIENT_URL = process.env.CLIENT_URL ?? 'http://localhost:3000';
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SEED_USER_PASSWORD) {
  throw new Error('Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SEED_USER_PASSWORD.');
}
for (const url of [SUPABASE_URL, MAILPIT_URL]) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Refusing to run auth tests against a non-local Supabase.');
  }
}

// The cookie names are a contract with client/proxy.ts.
const ACCESS = 'sb-access-token';
const REFRESH = 'sb-refresh-token';
const BAD_CREDENTIALS = { error: 'Incorrect email or password.' };
const PROFILE_KEYS = ['email', 'name', 'role', 'user_id', 'user_properties'];

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
});

type Cookie = { value: string; attributes: Map<string, string> };

function setCookies(res: Response): Map<string, Cookie> {
  const cookies = new Map<string, Cookie>();
  for (const header of res.headers.getSetCookie()) {
    const [pair, ...attributes] = header.split(';').map((part) => part.trim());
    const eq = pair.indexOf('=');
    cookies.set(pair.slice(0, eq), {
      value: decodeURIComponent(pair.slice(eq + 1)),
      attributes: new Map(
        attributes.map((attribute) => {
          const [key, value = ''] = attribute.split('=');
          return [key.toLowerCase(), value];
        }),
      ),
    });
  }
  return cookies;
}

function isCleared(cookie: Cookie | undefined) {
  const expires = cookie?.attributes.get('expires');
  return cookie?.value === '' && expires !== undefined && new Date(expires).getTime() <= Date.now();
}

type Request = {
  method?: string;
  json?: unknown;
  rawBody?: string;
  cookies?: Record<string, string>;
};

function api(path: string, { method = 'GET', json, rawBody, cookies = {} }: Request = {}) {
  const headers: Record<string, string> = {};
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  if (cookieHeader) headers.cookie = cookieHeader;
  if (json !== undefined || rawBody !== undefined) headers['content-type'] = 'application/json';
  return fetch(baseUrl + path, {
    method,
    headers,
    body: rawBody ?? (json === undefined ? undefined : JSON.stringify(json)),
  });
}

function login(email: string, password: string) {
  return api('/api/auth/login', { method: 'POST', json: { email, password } });
}

async function signIn(email = TEST_USER_EMAIL) {
  const res = await login(email, SEED_USER_PASSWORD!);
  assert.equal(res.status, 200, 'seeded login failed; did you run npm run seed:local-users?');
  const cookies = setCookies(res);
  return { [ACCESS]: cookies.get(ACCESS)!.value, [REFRESH]: cookies.get(REFRESH)!.value };
}

function changeEmail(email: unknown, cookies: Record<string, string>) {
  return api('/api/auth/email', { method: 'PATCH', json: { email }, cookies });
}

// Local Supabase Auth delivers its emails to Mailpit.
async function mailIds(to: string): Promise<Set<string>> {
  const query = encodeURIComponent(`to:"${to}"`);
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}&limit=100`);
  assert.equal(res.status, 200, `Mailpit is not reachable at ${MAILPIT_URL}`);
  const { messages } = (await res.json()) as { messages: Array<{ ID: string }> };
  return new Set(messages.map((message) => message.ID));
}

/** The link in the first email to `to` that isn't in `seen`, waiting up to 10 s for it. */
async function nextLink(to: string, seen: Set<string>): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const id = [...(await mailIds(to))].find((messageId) => !seen.has(messageId));
    if (id) {
      const { HTML } = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as {
        HTML: string;
      };
      const href = HTML.match(/href="([^"]+)"/)?.[1];
      assert.ok(href, `the email to ${to} has a link`);
      return href.replaceAll('&amp;', '&');
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No new email to ${to}`);
}

/** Opens a link from an email the way a browser would, and returns where it redirects. */
async function follow(link: string) {
  const res = await fetch(link, { redirect: 'manual' });
  assert.equal(res.status, 303);
  return res.headers.get('location') ?? '';
}

describe('POST /api/auth/login', () => {
  it('signs a seeded user in and sets httpOnly, SameSite=Lax session cookies', async () => {
    const res = await login(TEST_USER_EMAIL, SEED_USER_PASSWORD);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.email, TEST_USER_EMAIL);

    const cookies = setCookies(res);
    for (const name of [ACCESS, REFRESH]) {
      const cookie = cookies.get(name);
      assert.ok(cookie?.value, `${name} is set`);
      assert.ok(cookie.attributes.has('httponly'), `${name} is HttpOnly`);
      assert.equal(
        cookie.attributes.get('samesite')?.toLowerCase(),
        'lax',
        `${name} is SameSite=Lax`,
      );
      assert.equal(cookie.attributes.get('path'), '/');
      assert.ok(!cookie.attributes.has('secure'), `${name} is not Secure outside production`);
    }
    // The access cookie lives as long as the JWT; the refresh cookie lasts until the browser closes.
    assert.ok(Number(cookies.get(ACCESS)!.attributes.get('max-age')) > 0);
    assert.ok(!cookies.get(REFRESH)!.attributes.has('max-age'));
    assert.ok(!cookies.get(REFRESH)!.attributes.has('expires'));
  });

  it('marks the session cookies Secure when NODE_ENV=production', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const res = await login(TEST_USER_EMAIL, SEED_USER_PASSWORD);
      assert.equal(res.status, 200);
      const cookies = setCookies(res);
      assert.ok(cookies.get(ACCESS)?.attributes.has('secure'));
      assert.ok(cookies.get(REFRESH)?.attributes.has('secure'));
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('returns one generic 401 for a wrong password', async () => {
    const res = await login(TEST_USER_EMAIL, `${SEED_USER_PASSWORD}-wrong`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), BAD_CREDENTIALS);
    assert.equal(setCookies(res).size, 0);
  });

  it('returns the same 401 for an email that has no login', async () => {
    const res = await login('nobody-here@example.com', SEED_USER_PASSWORD);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), BAD_CREDENTIALS);
  });

  it('returns 400 for a missing or invalid body', async (t) => {
    const cases: Array<[string, Request]> = [
      ['no body', {}],
      ['empty object', { json: {} }],
      ['missing password', { json: { email: TEST_USER_EMAIL } }],
      ['empty password', { json: { email: TEST_USER_EMAIL, password: '' } }],
      ['invalid email', { json: { email: 'not-an-email', password: 'x' } }],
      ['non-string fields', { json: { email: 42, password: true } }],
      ['array body', { json: [TEST_USER_EMAIL, 'x'] }],
      ['malformed JSON', { rawBody: '{not json' }],
    ];
    for (const [name, request] of cases) {
      await t.test(name, async () => {
        const res = await api('/api/auth/login', { method: 'POST', ...request });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(typeof body.error, 'string');
        assert.equal(setCookies(res).size, 0);
      });
    }
  });

  it('rejects a login with no linked profile with 403 and sets no session', async (t) => {
    // Auth sign-up is on in config.toml for the demo, so anyone holding the publishable
    // key can create a login that has no public.users row.
    const email = `no-profile-${Date.now()}@example.com`;
    const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signUp({ email, password: SEED_USER_PASSWORD });
    if (error?.code === 'signup_disabled') return t.skip('Auth sign-up is off in this stack');
    assert.ifError(error);
    // With email confirmations on, the new login can't sign in until its link is opened.
    if (!data.session) await follow(await nextLink(email, new Set()));

    const res = await login(email, SEED_USER_PASSWORD);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, 'profile_not_found');
    assert.equal(typeof body.error, 'string');
    assert.ok(![...setCookies(res).values()].some((cookie) => cookie.value));
  });
});

describe('GET /api/auth/me', () => {
  it("returns the caller's profile when signed in", async () => {
    const res = await api('/api/auth/me', { cookies: await signIn() });
    assert.equal(res.status, 200);
    const { user } = await res.json();
    assert.deepEqual(Object.keys(user).sort(), PROFILE_KEYS);
    assert.equal(user.email, TEST_USER_EMAIL);
  });

  it('returns 401 without a session cookie', async () => {
    const res = await api('/api/auth/me');
    assert.equal(res.status, 401);
    assert.equal(typeof (await res.json()).error, 'string');
  });

  it('returns 401 and clears cookies for an invalid access token with no refresh token', async () => {
    const res = await api('/api/auth/me', { cookies: { [ACCESS]: 'not-a-jwt' } });
    assert.equal(res.status, 401);
    assert.ok(isCleared(setCookies(res).get(ACCESS)));
    assert.ok(isCleared(setCookies(res).get(REFRESH)));
  });

  it('refreshes the session when only the refresh cookie is left', async () => {
    // The browser drops the access cookie when the JWT expires (its Max-Age).
    const session = await signIn();
    const res = await api('/api/auth/me', { cookies: { [REFRESH]: session[REFRESH] } });
    assert.equal(res.status, 200);
    const cookies = setCookies(res);
    const access = cookies.get(ACCESS)?.value;
    const refresh = cookies.get(REFRESH)?.value;
    assert.ok(access && access !== session[ACCESS], 'a new access token is set');
    assert.ok(refresh && refresh !== session[REFRESH], 'the refresh token is rotated');

    const again = await api('/api/auth/me', { cookies: { [ACCESS]: access } });
    assert.equal(again.status, 200, 'the new access token works on its own');
  });

  it('refreshes the session when the access token is rejected', async () => {
    const session = await signIn();
    const res = await api('/api/auth/me', {
      cookies: { [ACCESS]: 'expired-or-tampered', [REFRESH]: session[REFRESH] },
    });
    assert.equal(res.status, 200);
    assert.ok(setCookies(res).get(ACCESS)?.value);
  });
});

describe('POST /api/auth/logout', () => {
  it('ends the session so /me returns 401, even with the old cookies replayed', async () => {
    const session = await signIn();
    const res = await api('/api/auth/logout', { method: 'POST', cookies: session });
    assert.equal(res.status, 204);
    const cookies = setCookies(res);
    assert.ok(isCleared(cookies.get(ACCESS)));
    assert.ok(isCleared(cookies.get(REFRESH)));

    assert.equal((await api('/api/auth/me')).status, 401);
    assert.equal((await api('/api/auth/me', { cookies: session })).status, 401);
    assert.equal(
      (await api('/api/auth/me', { cookies: { [REFRESH]: session[REFRESH] } })).status,
      401,
    );
  });

  it('returns 204 when there is no session', async () => {
    const res = await api('/api/auth/logout', { method: 'POST' });
    assert.equal(res.status, 204);
  });
});

describe('PATCH /api/auth/email', () => {
  let session: Record<string, string>;

  before(async () => {
    session = await signIn(CHANGE_USER_EMAIL);
  });

  it('returns 401 without a session cookie', async () => {
    const res = await changeEmail('new-address@example.com', {});
    assert.equal(res.status, 401);
    assert.equal(typeof (await res.json()).error, 'string');
  });

  it('returns 401 with only an access cookie: Supabase Auth needs the whole session', async () => {
    const res = await changeEmail('new-address@example.com', { [ACCESS]: session[ACCESS] });
    assert.equal(res.status, 401);
    assert.equal(typeof (await res.json()).error, 'string');
  });

  it('returns 400 for a missing or invalid email', async (t) => {
    const cases: Array<[string, Request]> = [
      ['no body', {}],
      ['empty object', { json: {} }],
      ['empty email', { json: { email: '' } }],
      ['invalid email', { json: { email: 'not-an-email' } }],
      ['non-string email', { json: { email: 42 } }],
      [
        'longer than users.email allows',
        { json: { email: `a@${'b'.repeat(60).concat('.').repeat(5)}com` } },
      ],
      ['array body', { json: ['new-address@example.com'] }],
      ['malformed JSON', { rawBody: '{not json' }],
    ];
    for (const [name, request] of cases) {
      await t.test(name, async () => {
        const res = await api('/api/auth/email', { method: 'PATCH', cookies: session, ...request });
        assert.equal(res.status, 400);
        assert.equal(typeof (await res.json()).error, 'string');
      });
    }
  });

  it("returns 400 email_unchanged for the caller's own email, in any case", async () => {
    for (const email of [CHANGE_USER_EMAIL, CHANGE_USER_EMAIL.toUpperCase()]) {
      const res = await changeEmail(email, session);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, 'email_unchanged');
    }
  });

  it("returns 409 email_in_use for another user's email and sends no email", async () => {
    const seen = await mailIds(TEST_USER_EMAIL);
    const res = await changeEmail(TEST_USER_EMAIL, session);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, 'email_in_use');
    assert.equal(typeof body.error, 'string');
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.deepEqual(await mailIds(TEST_USER_EMAIL), seen);
  });

  it('returns 409 email_in_use for the email of a login with no profile', async (t) => {
    const email = `no-profile-${Date.now()}@example.com`;
    const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.auth.signUp({ email, password: SEED_USER_PASSWORD });
    if (error?.code === 'signup_disabled') return t.skip('Auth sign-up is off in this stack');
    assert.ifError(error);

    const res = await changeEmail(email, session);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'email_in_use');
  });

  it('changes the login email once both addresses confirm, and the profile follows', async () => {
    const newEmail = `morgan.ellis+${Date.now()}@example.com`;
    const seenOld = await mailIds(CHANGE_USER_EMAIL);

    const res = await changeEmail(newEmail, session);
    assert.equal(res.status, 202);
    assert.match((await res.json()).message, /both/);

    const oldLink = await nextLink(CHANGE_USER_EMAIL, seenOld);
    const newLink = await nextLink(newEmail, new Set());
    for (const link of [oldLink, newLink]) {
      assert.equal(new URL(link).searchParams.get('redirect_to'), `${CLIENT_URL}/login`);
    }

    // One link isn't enough: the login keeps the old email until the other is opened.
    let location = await follow(oldLink);
    assert.ok(location.startsWith(`${CLIENT_URL}/login#`), location);
    assert.match(location, /message=Confirmation\+link\+accepted/);
    assert.equal((await login(newEmail, SEED_USER_PASSWORD)).status, 401);
    assert.equal((await login(CHANGE_USER_EMAIL, SEED_USER_PASSWORD)).status, 200);

    location = await follow(newLink);
    assert.ok(location.startsWith(`${CLIENT_URL}/login#`), location);
    assert.doesNotMatch(location, /error/);

    const newLogin = await login(newEmail, SEED_USER_PASSWORD);
    assert.equal(newLogin.status, 200);
    assert.equal((await newLogin.json()).user.email, newEmail);
    assert.equal((await login(CHANGE_USER_EMAIL, SEED_USER_PASSWORD)).status, 401);

    const newCookies = setCookies(newLogin);
    const me = await api('/api/auth/me', {
      cookies: {
        [ACCESS]: newCookies.get(ACCESS)!.value,
        [REFRESH]: newCookies.get(REFRESH)!.value,
      },
    });
    assert.equal((await me.json()).user.email, newEmail);
    // The session from before the change sees the updated profile too.
    assert.equal(
      (await (await api('/api/auth/me', { cookies: session })).json()).user.email,
      newEmail,
    );

    // Change it back, sending only the refresh cookie as a browser does once the access
    // cookie expires. That also leaves the seeded login as it was.
    const seenNew = await mailIds(newEmail);
    const seenOriginal = await mailIds(CHANGE_USER_EMAIL);
    // Auth sends a user at most one email per max_frequency (1s in config.toml).
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const back = await changeEmail(CHANGE_USER_EMAIL, {
      [REFRESH]: newCookies.get(REFRESH)!.value,
    });
    assert.equal(back.status, 202);
    assert.ok(setCookies(back).get(ACCESS)?.value, 'the refreshed session is set');
    await follow(await nextLink(newEmail, seenNew));
    await follow(await nextLink(CHANGE_USER_EMAIL, seenOriginal));
    const restored = await login(CHANGE_USER_EMAIL, SEED_USER_PASSWORD);
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).user.email, CHANGE_USER_EMAIL);
  });
});

// DC-55: inviting users. Each run adds two invited test profiles (dc55-...@example.com);
// `supabase db reset` and seeding again clears them.
describe('inviting users', () => {
  let admin: Record<string, string>;
  let operator: Record<string, string>;
  /** The user the invite flow test creates, and its signed-in session, for the edit tests. */
  let invitee: { userId: number; session: Record<string, string> } | undefined;

  before(async () => {
    admin = await signIn(ADMIN_EMAIL);
    operator = await signIn();
  });

  const invite = (json: unknown, cookies: Record<string, string>) =>
    api('/api/admin/users', { method: 'POST', json, cookies });

  describe('POST /api/admin/users', () => {
    it('returns 401 without a session', async () => {
      const res = await invite({ name: 'X', email: 'dc55-x@example.com', role: 'viewer' }, {});
      assert.equal(res.status, 401);
    });

    it('returns 403 forbidden to a user who is not a system admin, and sends nothing', async () => {
      const email = `dc55-forbidden-${Date.now()}@example.com`;
      const res = await invite({ name: 'X', email, role: 'viewer' }, operator);
      assert.equal(res.status, 403);
      assert.equal((await res.json()).code, 'forbidden');
      await new Promise((resolve) => setTimeout(resolve, 1000));
      assert.equal((await mailIds(email)).size, 0);
    });

    it('returns 400 for invalid details', async (t) => {
      const valid = { name: 'Valid Name', email: 'dc55-valid@example.com', role: 'viewer' };
      const cases: Array<[string, Request]> = [
        ['no body', {}],
        ['blank name', { json: { ...valid, name: '  ' } }],
        ['invalid email', { json: { ...valid, email: 'not-an-email' } }],
        ['unknown role', { json: { ...valid, role: 'superuser' } }],
        ['property ids that are not integers', { json: { ...valid, propertyIds: ['1'] } }],
        ['a property id past the integer column', { json: { ...valid, propertyIds: [3e9] } }],
        ['malformed JSON', { rawBody: '{not json' }],
      ];
      for (const [name, request] of cases) {
        await t.test(name, async () => {
          const res = await api('/api/admin/users', { method: 'POST', cookies: admin, ...request });
          assert.equal(res.status, 400);
          assert.equal(typeof (await res.json()).error, 'string');
        });
      }
    });

    it('returns 409 email_in_use for an email a profile has, in any case', async () => {
      const res = await invite(
        { name: 'Dup', email: TEST_USER_EMAIL.toUpperCase(), role: 'viewer' },
        admin,
      );
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'email_in_use');
    });

    it('returns 409 login_exists for the email of a confirmed login with no profile', async () => {
      // A self sign-up, confirmed by its owner (or by someone tricked into opening the link).
      const email = `dc55-selfsignup-${Date.now()}@example.com`;
      const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      assert.ifError((await anon.auth.signUp({ email, password: SEED_USER_PASSWORD })).error);
      await follow(await nextLink(email, new Set()));

      const res = await invite({ name: 'Self Signup', email, role: 'viewer' }, admin);
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'login_exists');
    });

    it('returns 400 unknown_property for a property that does not exist', async () => {
      const res = await invite(
        {
          name: 'No Such Property',
          email: `dc55-noprop-${Date.now()}@example.com`,
          role: 'viewer',
          propertyIds: [999999999],
        },
        admin,
      );
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, 'unknown_property');
    });
  });

  it('the invitee opens the resent link, sets a password, becomes active and can sign in', async () => {
    const email = `dc55-invitee-${Date.now()}@example.com`;
    const res = await invite(
      { name: ' Invited Person ', email: email.toUpperCase(), role: 'viewer', propertyIds: [] },
      admin,
    );
    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.inviteSent, true);
    assert.equal(body.user.email, email);
    assert.equal(body.user.name, 'Invited Person');
    assert.equal(body.user.auth_user_id, null, 'the new profile is pending');

    const firstLink = await nextLink(email, new Set());
    assert.equal(new URL(firstLink).searchParams.get('redirect_to'), `${CLIENT_URL}/set-password`);

    // Resending to the pending user, before any link is opened, sends a new one.
    const seen = await mailIds(email);
    // Auth sends a user at most one email per max_frequency (1s in config.toml).
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const resent = await api(`/api/admin/users/${body.user.user_id}/invite`, {
      method: 'POST',
      cookies: admin,
    });
    assert.equal(resent.status, 202);
    const link = await nextLink(email, seen);
    assert.equal(new URL(link).searchParams.get('redirect_to'), `${CLIENT_URL}/set-password`);
    const location = await follow(link);
    assert.ok(location.startsWith(`${CLIENT_URL}/set-password#`), location);
    const fragment = new URLSearchParams(new URL(location).hash.slice(1));

    const password = `Invited-${Date.now()}!`;
    const set = await api('/api/auth/set-password', {
      method: 'POST',
      json: {
        accessToken: fragment.get('access_token'),
        refreshToken: fragment.get('refresh_token'),
        password,
      },
    });
    assert.equal(set.status, 200);
    assert.equal((await set.json()).user.email, email);
    assert.ok(setCookies(set).get(ACCESS)?.value, 'the invitee is signed in');

    const signedIn = await login(email, password);
    assert.equal(signedIn.status, 200);
    assert.equal((await signedIn.json()).user.role, 'viewer');
    const cookies = setCookies(signedIn);
    invitee = {
      userId: body.user.user_id,
      session: { [ACCESS]: cookies.get(ACCESS)!.value, [REFRESH]: cookies.get(REFRESH)!.value },
    };
  });

  describe('PATCH /api/admin/users/:id', () => {
    const edit = (id: number | string, json: unknown, cookies: Record<string, string>) =>
      api(`/api/admin/users/${id}`, { method: 'PATCH', json, cookies });
    const valid = { name: 'Edited Name', role: 'billing_operator', propertyIds: [] };

    it('returns 403 forbidden to a user who is not a system admin', async () => {
      const res = await edit(1, valid, operator);
      assert.equal(res.status, 403);
    });

    it('returns 404 for a user that does not exist', async () => {
      for (const id of ['999999999', 'abc', '3000000000']) {
        assert.equal((await edit(id, valid, admin)).status, 404, id);
      }
    });

    it('returns 400 for invalid details', async () => {
      for (const json of [{ ...valid, name: ' ' }, { ...valid, role: 'superuser' }, {}]) {
        assert.equal((await edit(1, json, admin)).status, 400, JSON.stringify(json));
      }
    });

    it('returns 409 own_role when an admin would remove their own admin role', async () => {
      const me = await (await api('/api/auth/me', { cookies: admin })).json();
      const res = await edit(me.user.user_id, { ...valid, name: me.user.name }, admin);
      assert.equal(res.status, 409);
      assert.equal((await res.json()).code, 'own_role');
    });

    it('changes the name, phone, role and properties, and not the email', async (t) => {
      if (!invitee) return t.skip('the invite flow test did not create a user');
      const res = await edit(
        invitee.userId,
        {
          name: ' Edited Person ',
          phone: '214-555-0199',
          role: 'billing_operator',
          email: 'ignored@example.com',
          propertyIds: [1, 2, 1],
        },
        admin,
      );
      assert.equal(res.status, 200);
      const { user } = await res.json();
      assert.equal(user.name, 'Edited Person');
      assert.equal(user.phone, '214-555-0199');
      assert.equal(user.role, 'billing_operator');
      assert.match(user.email, /^dc55-invitee-/);

      // The edited user sees the change on their next request.
      const me = await (await api('/api/auth/me', { cookies: invitee.session })).json();
      assert.equal(me.user.role, 'billing_operator');
      assert.deepEqual(
        me.user.user_properties.map((link: { property_id: number }) => link.property_id).sort(),
        [1, 2],
      );
    });
  });

  describe('POST /api/admin/users/:id/invite', () => {
    it('returns 403 forbidden to a user who is not a system admin', async () => {
      const res = await api('/api/admin/users/1/invite', { method: 'POST', cookies: operator });
      assert.equal(res.status, 403);
    });

    it('returns 404 for a user that does not exist', async () => {
      for (const id of ['999999999', 'abc', '3000000000']) {
        const res = await api(`/api/admin/users/${id}/invite`, { method: 'POST', cookies: admin });
        assert.equal(res.status, 404, id);
      }
    });
  });

  describe('POST /api/auth/set-password', () => {
    it('returns 400 for a password shorter than 8 characters', async () => {
      const res = await api('/api/auth/set-password', {
        method: 'POST',
        json: { accessToken: 'a', refreshToken: 'r', password: 'short' },
      });
      assert.equal(res.status, 400);
    });

    it('returns 401 link_expired for a session that is not valid', async () => {
      const res = await api('/api/auth/set-password', {
        method: 'POST',
        json: { accessToken: 'not-a-jwt', refreshToken: 'not-a-token', password: 'long enough' },
      });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).code, 'link_expired');
      assert.equal(setCookies(res).get(ACCESS)?.value || undefined, undefined);
    });
  });
});

describe('routes', () => {
  it('has no sign-up route', async () => {
    for (const path of [
      '/api/auth/signup',
      '/api/auth/sign-up',
      '/api/auth/register',
      '/api/users',
    ]) {
      const res = await api(path, {
        method: 'POST',
        json: { email: 'a@example.com', password: 'x' },
      });
      assert.equal(res.status, 404, path);
    }
  });
});
