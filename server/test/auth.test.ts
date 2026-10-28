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
import "dotenv/config";
import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";
import { createClient } from "@supabase/supabase-js";
import app from "../src/app";

const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SEED_USER_PASSWORD } = process.env;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL ?? "alex.morgan@example.com";
// A second seeded login, so changing its email doesn't affect the other tests.
const CHANGE_USER_EMAIL = "morgan.ellis@example.com";
const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://127.0.0.1:54324";
// Same default as src/config/env.ts. Email confirmation links redirect to its /login.
const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000";
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SEED_USER_PASSWORD) {
  throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SEED_USER_PASSWORD.");
}
for (const url of [SUPABASE_URL, MAILPIT_URL]) {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) {
    throw new Error("Refusing to run auth tests against a non-local Supabase.");
  }
}

// The cookie names are a contract with client/proxy.ts.
const ACCESS = "sb-access-token";
const REFRESH = "sb-refresh-token";
const BAD_CREDENTIALS = { error: "Incorrect email or password." };
const PROFILE_KEYS = ["id", "property_id", "user_email", "user_name", "user_role"];

let server: Server;
let baseUrl: string;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
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
    const [pair, ...attributes] = header.split(";").map((part) => part.trim());
    const eq = pair.indexOf("=");
    cookies.set(pair.slice(0, eq), {
      value: decodeURIComponent(pair.slice(eq + 1)),
      attributes: new Map(
        attributes.map((attribute) => {
          const [key, value = ""] = attribute.split("=");
          return [key.toLowerCase(), value];
        }),
      ),
    });
  }
  return cookies;
}

function isCleared(cookie: Cookie | undefined) {
  const expires = cookie?.attributes.get("expires");
  return cookie?.value === "" && expires !== undefined && new Date(expires).getTime() <= Date.now();
}

type Request = { method?: string; json?: unknown; rawBody?: string; cookies?: Record<string, string> };

function api(path: string, { method = "GET", json, rawBody, cookies = {} }: Request = {}) {
  const headers: Record<string, string> = {};
  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("; ");
  if (cookieHeader) headers.cookie = cookieHeader;
  if (json !== undefined || rawBody !== undefined) headers["content-type"] = "application/json";
  return fetch(baseUrl + path, {
    method,
    headers,
    body: rawBody ?? (json === undefined ? undefined : JSON.stringify(json)),
  });
}

function login(email: string, password: string) {
  return api("/api/auth/login", { method: "POST", json: { email, password } });
}

async function signIn(email = TEST_USER_EMAIL) {
  const res = await login(email, SEED_USER_PASSWORD!);
  assert.equal(res.status, 200, "seeded login failed; did you run npm run seed:local-users?");
  const cookies = setCookies(res);
  return { [ACCESS]: cookies.get(ACCESS)!.value, [REFRESH]: cookies.get(REFRESH)!.value };
}

function changeEmail(email: unknown, cookies: Record<string, string>) {
  return api("/api/auth/email", { method: "PATCH", json: { email }, cookies });
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
      const { HTML } = (await (await fetch(`${MAILPIT_URL}/api/v1/message/${id}`)).json()) as { HTML: string };
      const href = HTML.match(/href="([^"]+)"/)?.[1];
      assert.ok(href, `the email to ${to} has a link`);
      return href.replaceAll("&amp;", "&");
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No new email to ${to}`);
}

/** Opens a link from an email the way a browser would, and returns where it redirects. */
async function follow(link: string) {
  const res = await fetch(link, { redirect: "manual" });
  assert.equal(res.status, 303);
  return res.headers.get("location") ?? "";
}

describe("POST /api/auth/login", () => {
  it("signs a seeded user in and sets httpOnly, SameSite=Lax session cookies", async () => {
    const res = await login(TEST_USER_EMAIL, SEED_USER_PASSWORD);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.user.user_email, TEST_USER_EMAIL);

    const cookies = setCookies(res);
    for (const name of [ACCESS, REFRESH]) {
      const cookie = cookies.get(name);
      assert.ok(cookie?.value, `${name} is set`);
      assert.ok(cookie.attributes.has("httponly"), `${name} is HttpOnly`);
      assert.equal(cookie.attributes.get("samesite")?.toLowerCase(), "lax", `${name} is SameSite=Lax`);
      assert.equal(cookie.attributes.get("path"), "/");
      assert.ok(!cookie.attributes.has("secure"), `${name} is not Secure outside production`);
    }
    // The access cookie lives as long as the JWT; the refresh cookie lasts until the browser closes.
    assert.ok(Number(cookies.get(ACCESS)!.attributes.get("max-age")) > 0);
    assert.ok(!cookies.get(REFRESH)!.attributes.has("max-age"));
    assert.ok(!cookies.get(REFRESH)!.attributes.has("expires"));
  });

  it("marks the session cookies Secure when NODE_ENV=production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const res = await login(TEST_USER_EMAIL, SEED_USER_PASSWORD);
      assert.equal(res.status, 200);
      const cookies = setCookies(res);
      assert.ok(cookies.get(ACCESS)?.attributes.has("secure"));
      assert.ok(cookies.get(REFRESH)?.attributes.has("secure"));
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it("returns one generic 401 for a wrong password", async () => {
    const res = await login(TEST_USER_EMAIL, `${SEED_USER_PASSWORD}-wrong`);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), BAD_CREDENTIALS);
    assert.equal(setCookies(res).size, 0);
  });

  it("returns the same 401 for an email that has no login", async () => {
    const res = await login("nobody-here@example.com", SEED_USER_PASSWORD);
    assert.equal(res.status, 401);
    assert.deepEqual(await res.json(), BAD_CREDENTIALS);
  });

  it("returns 400 for a missing or invalid body", async (t) => {
    const cases: Array<[string, Request]> = [
      ["no body", {}],
      ["empty object", { json: {} }],
      ["missing password", { json: { email: TEST_USER_EMAIL } }],
      ["empty password", { json: { email: TEST_USER_EMAIL, password: "" } }],
      ["invalid email", { json: { email: "not-an-email", password: "x" } }],
      ["non-string fields", { json: { email: 42, password: true } }],
      ["array body", { json: [TEST_USER_EMAIL, "x"] }],
      ["malformed JSON", { rawBody: "{not json" }],
    ];
    for (const [name, request] of cases) {
      await t.test(name, async () => {
        const res = await api("/api/auth/login", { method: "POST", ...request });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(typeof body.error, "string");
        assert.equal(setCookies(res).size, 0);
      });
    }
  });

  it("rejects a login with no linked profile with 403 and sets no session", async (t) => {
    // Auth sign-up is on in config.toml for the demo, so anyone holding the publishable
    // key can create a login that has no public.users row.
    const email = `no-profile-${Date.now()}@example.com`;
    const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await anon.auth.signUp({ email, password: SEED_USER_PASSWORD });
    if (error?.code === "signup_disabled") return t.skip("Auth sign-up is off in this stack");
    assert.ifError(error);
    // With email confirmations on, the new login can't sign in until its link is opened.
    if (!data.session) await follow(await nextLink(email, new Set()));

    const res = await login(email, SEED_USER_PASSWORD);
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.code, "profile_not_found");
    assert.equal(typeof body.error, "string");
    assert.ok(![...setCookies(res).values()].some((cookie) => cookie.value));
  });
});

describe("GET /api/auth/me", () => {
  it("returns the caller's profile when signed in", async () => {
    const res = await api("/api/auth/me", { cookies: await signIn() });
    assert.equal(res.status, 200);
    const { user } = await res.json();
    assert.deepEqual(Object.keys(user).sort(), PROFILE_KEYS);
    assert.equal(user.user_email, TEST_USER_EMAIL);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await api("/api/auth/me");
    assert.equal(res.status, 401);
    assert.equal(typeof (await res.json()).error, "string");
  });

  it("returns 401 and clears cookies for an invalid access token with no refresh token", async () => {
    const res = await api("/api/auth/me", { cookies: { [ACCESS]: "not-a-jwt" } });
    assert.equal(res.status, 401);
    assert.ok(isCleared(setCookies(res).get(ACCESS)));
    assert.ok(isCleared(setCookies(res).get(REFRESH)));
  });

  it("refreshes the session when only the refresh cookie is left", async () => {
    // The browser drops the access cookie when the JWT expires (its Max-Age).
    const session = await signIn();
    const res = await api("/api/auth/me", { cookies: { [REFRESH]: session[REFRESH] } });
    assert.equal(res.status, 200);
    const cookies = setCookies(res);
    const access = cookies.get(ACCESS)?.value;
    const refresh = cookies.get(REFRESH)?.value;
    assert.ok(access && access !== session[ACCESS], "a new access token is set");
    assert.ok(refresh && refresh !== session[REFRESH], "the refresh token is rotated");

    const again = await api("/api/auth/me", { cookies: { [ACCESS]: access } });
    assert.equal(again.status, 200, "the new access token works on its own");
  });

  it("refreshes the session when the access token is rejected", async () => {
    const session = await signIn();
    const res = await api("/api/auth/me", {
      cookies: { [ACCESS]: "expired-or-tampered", [REFRESH]: session[REFRESH] },
    });
    assert.equal(res.status, 200);
    assert.ok(setCookies(res).get(ACCESS)?.value);
  });
});

describe("POST /api/auth/logout", () => {
  it("ends the session so /me returns 401, even with the old cookies replayed", async () => {
    const session = await signIn();
    const res = await api("/api/auth/logout", { method: "POST", cookies: session });
    assert.equal(res.status, 204);
    const cookies = setCookies(res);
    assert.ok(isCleared(cookies.get(ACCESS)));
    assert.ok(isCleared(cookies.get(REFRESH)));

    assert.equal((await api("/api/auth/me")).status, 401);
    assert.equal((await api("/api/auth/me", { cookies: session })).status, 401);
    assert.equal((await api("/api/auth/me", { cookies: { [REFRESH]: session[REFRESH] } })).status, 401);
  });

  it("returns 204 when there is no session", async () => {
    const res = await api("/api/auth/logout", { method: "POST" });
    assert.equal(res.status, 204);
  });
});

describe("PATCH /api/auth/email", () => {
  let session: Record<string, string>;

  before(async () => {
    session = await signIn(CHANGE_USER_EMAIL);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await changeEmail("new-address@example.com", {});
    assert.equal(res.status, 401);
    assert.equal(typeof (await res.json()).error, "string");
  });

  it("returns 401 with only an access cookie: Supabase Auth needs the whole session", async () => {
    const res = await changeEmail("new-address@example.com", { [ACCESS]: session[ACCESS] });
    assert.equal(res.status, 401);
    assert.equal(typeof (await res.json()).error, "string");
  });

  it("returns 400 for a missing or invalid email", async (t) => {
    const cases: Array<[string, Request]> = [
      ["no body", {}],
      ["empty object", { json: {} }],
      ["empty email", { json: { email: "" } }],
      ["invalid email", { json: { email: "not-an-email" } }],
      ["non-string email", { json: { email: 42 } }],
      ["longer than users.user_email allows", { json: { email: `a@${"b".repeat(60).concat(".").repeat(5)}com` } }],
      ["array body", { json: ["new-address@example.com"] }],
      ["malformed JSON", { rawBody: "{not json" }],
    ];
    for (const [name, request] of cases) {
      await t.test(name, async () => {
        const res = await api("/api/auth/email", { method: "PATCH", cookies: session, ...request });
        assert.equal(res.status, 400);
        assert.equal(typeof (await res.json()).error, "string");
      });
    }
  });

  it("returns 400 email_unchanged for the caller's own email, in any case", async () => {
    for (const email of [CHANGE_USER_EMAIL, CHANGE_USER_EMAIL.toUpperCase()]) {
      const res = await changeEmail(email, session);
      assert.equal(res.status, 400);
      assert.equal((await res.json()).code, "email_unchanged");
    }
  });

  it("returns 409 email_in_use for another user's email and sends no email", async () => {
    const seen = await mailIds(TEST_USER_EMAIL);
    const res = await changeEmail(TEST_USER_EMAIL, session);
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.equal(body.code, "email_in_use");
    assert.equal(typeof body.error, "string");
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.deepEqual(await mailIds(TEST_USER_EMAIL), seen);
  });

  it("returns 409 email_in_use for the email of a login with no profile", async (t) => {
    const email = `no-profile-${Date.now()}@example.com`;
    const anon = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await anon.auth.signUp({ email, password: SEED_USER_PASSWORD });
    if (error?.code === "signup_disabled") return t.skip("Auth sign-up is off in this stack");
    assert.ifError(error);

    const res = await changeEmail(email, session);
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, "email_in_use");
  });

  it("changes the login email once both addresses confirm, and the profile follows", async () => {
    const newEmail = `morgan.ellis+${Date.now()}@example.com`;
    const seenOld = await mailIds(CHANGE_USER_EMAIL);

    const res = await changeEmail(newEmail, session);
    assert.equal(res.status, 202);
    assert.match((await res.json()).message, /both/);

    const oldLink = await nextLink(CHANGE_USER_EMAIL, seenOld);
    const newLink = await nextLink(newEmail, new Set());
    for (const link of [oldLink, newLink]) {
      assert.equal(new URL(link).searchParams.get("redirect_to"), `${CLIENT_URL}/login`);
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
    assert.equal((await newLogin.json()).user.user_email, newEmail);
    assert.equal((await login(CHANGE_USER_EMAIL, SEED_USER_PASSWORD)).status, 401);

    const newCookies = setCookies(newLogin);
    const me = await api("/api/auth/me", {
      cookies: { [ACCESS]: newCookies.get(ACCESS)!.value, [REFRESH]: newCookies.get(REFRESH)!.value },
    });
    assert.equal((await me.json()).user.user_email, newEmail);
    // The session from before the change sees the updated profile too.
    assert.equal((await (await api("/api/auth/me", { cookies: session })).json()).user.user_email, newEmail);

    // Change it back, sending only the refresh cookie as a browser does once the access
    // cookie expires. That also leaves the seeded login as it was.
    const seenNew = await mailIds(newEmail);
    const seenOriginal = await mailIds(CHANGE_USER_EMAIL);
    // Auth sends a user at most one email per max_frequency (1s in config.toml).
    await new Promise((resolve) => setTimeout(resolve, 1100));
    const back = await changeEmail(CHANGE_USER_EMAIL, { [REFRESH]: newCookies.get(REFRESH)!.value });
    assert.equal(back.status, 202);
    assert.ok(setCookies(back).get(ACCESS)?.value, "the refreshed session is set");
    await follow(await nextLink(newEmail, seenNew));
    await follow(await nextLink(CHANGE_USER_EMAIL, seenOriginal));
    const restored = await login(CHANGE_USER_EMAIL, SEED_USER_PASSWORD);
    assert.equal(restored.status, 200);
    assert.equal((await restored.json()).user.user_email, CHANGE_USER_EMAIL);
  });
});

describe("routes", () => {
  it("has no sign-up route", async () => {
    for (const path of ["/api/auth/signup", "/api/auth/sign-up", "/api/auth/register", "/api/users"]) {
      const res = await api(path, { method: "POST", json: { email: "a@example.com", password: "x" } });
      assert.equal(res.status, 404, path);
    }
  });
});
