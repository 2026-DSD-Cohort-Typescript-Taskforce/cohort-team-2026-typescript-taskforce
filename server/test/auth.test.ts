// Integration tests for /api/auth/*. They run the Express app against a LOCAL
// Supabase (`supabase start`, then `npm run seed:local-users`) and refuse any other URL.
//
//   SUPABASE_URL=http://127.0.0.1:54321 \
//   SUPABASE_PUBLISHABLE_KEY=<Publishable key from `supabase status`> \
//   SEED_USER_PASSWORD=<the password you seeded with> \
//   npm test
//
// One run makes about 10 sign-in/sign-up calls; local Auth allows 30 per 5 minutes per IP.
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
if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY || !SEED_USER_PASSWORD) {
  throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY and SEED_USER_PASSWORD.");
}
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(SUPABASE_URL).hostname)) {
  throw new Error("Refusing to run auth tests against a non-local Supabase.");
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

async function signIn() {
  const res = await login(TEST_USER_EMAIL, SEED_USER_PASSWORD!);
  assert.equal(res.status, 200, "seeded login failed; did you run npm run seed:local-users?");
  const cookies = setCookies(res);
  return { [ACCESS]: cookies.get(ACCESS)!.value, [REFRESH]: cookies.get(REFRESH)!.value };
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
    const { error } = await anon.auth.signUp({ email, password: SEED_USER_PASSWORD });
    if (error?.code === "signup_disabled") return t.skip("Auth sign-up is off in this stack");
    assert.ifError(error);

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

describe("routes", () => {
  it("has no sign-up route", async () => {
    for (const path of ["/api/auth/signup", "/api/auth/sign-up", "/api/auth/register", "/api/users"]) {
      const res = await api(path, { method: "POST", json: { email: "a@example.com", password: "x" } });
      assert.equal(res.status, 404, path);
    }
  });
});
