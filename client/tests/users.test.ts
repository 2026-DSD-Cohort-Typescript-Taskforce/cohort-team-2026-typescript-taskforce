import 'next/dist/server/node-environment.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  workAsyncStorage,
  type WorkStore,
} from 'next/dist/server/app-render/work-async-storage.external.js';
import {
  workUnitAsyncStorage,
  type RequestStore,
} from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import { fetchUserById, fetchUsers, updateUser, UserRequestError } from '../lib/users.js';
import type { User } from '../types/users.js';

test('user helpers use the signed-in session', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.invalid/';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';

  const user: User = {
    user_id: 7,
    name: 'Test user',
    role: 'billing_operator',
    property_id: 1,
    phone: null,
    email: null,
    auth_user_id: 'test-auth-user',
    created_at: '2026-11-09T12:00:00Z',
    updated_at: null,
  };
  let token: string | undefined = 'session-jwt';
  let authStatus = 200;
  let userStatus = 200;
  let rows: User[] = [user];
  const calls: { url: URL; method: string; headers: Headers; body?: BodyInit | null }[] = [];

  globalThis.fetch = async (url, init) => {
    const call = {
      url: new URL(String(url)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    calls.push(call);
    if (call.url.pathname === '/api/auth/me') {
      assert.equal(call.headers.get('cookie'), 'sb-access-token=session-jwt');
      return new Response(null, { status: authStatus });
    }
    assert.equal(call.url.origin, 'https://supabase.invalid');
    assert.equal(call.url.pathname, '/rest/v1/users');
    assert.equal(init?.cache, 'no-store');
    assert.equal(call.headers.get('authorization'), 'Bearer session-jwt');
    assert.equal(call.headers.get('apikey'), 'test-key');
    return userStatus === 204
      ? new Response(null, { status: 204 })
      : Response.json(rows, { status: userStatus });
  };

  function request<T>(operation: () => Promise<T>) {
    const store = {
      type: 'request',
      phase: 'render',
      cookies: {
        get: (name: string) =>
          token && name === 'sb-access-token' ? { name, value: token } : undefined,
      },
    } as unknown as RequestStore;
    return workAsyncStorage.run(
      { route: '/test', isStaticGeneration: false } as unknown as WorkStore,
      () => workUnitAsyncStorage.run(store, operation),
    );
  }

  try {
    await t.test('reads validate the session before querying users', async () => {
      calls.length = 0;
      assert.deepEqual(await request(fetchUsers), [user]);
      assert.deepEqual(
        calls.map((call) => call.url.pathname),
        ['/api/auth/me', '/rest/v1/users'],
      );
      assert.deepEqual(await request(() => fetchUserById('7')), user);
      assert.equal(calls.at(-1)?.url.searchParams.get('user_id'), 'eq.7');
      assert.equal(calls.at(-1)?.url.searchParams.get('limit'), '1');
    });
    await t.test('empty reads return an empty list or null', async () => {
      rows = [];
      assert.deepEqual(await request(fetchUsers), []);
      assert.equal(await request(() => fetchUserById('999')), null);
      rows = [user];
    });
    await t.test('update filters by user_id and sends only the requested changes', async () => {
      assert.deepEqual(
        await request(() => updateUser('7', { name: 'Renamed', phone: undefined })),
        user,
      );
      const call = calls.at(-1)!;
      assert.equal(call.method, 'PATCH');
      assert.equal(call.url.searchParams.get('user_id'), 'eq.7');
      assert.equal(call.url.searchParams.has('bill_id'), false);
      assert.equal(call.headers.get('prefer'), 'return=representation');
      assert.deepEqual(JSON.parse(String(call.body)), { name: 'Renamed' });
      rows = [];
      assert.equal(await request(() => updateUser('999', { phone: null })), null);
      rows = [user];
    });
    await t.test('update accepts names up to 255 Unicode characters', async () => {
      const name = '😀'.repeat(255);
      assert.deepEqual(await request(() => updateUser('7', { name })), user);
      assert.deepEqual(JSON.parse(String(calls.at(-1)?.body)), { name });
    });
    await t.test(
      'updates reject protected fields, empty patches and invalid values before queries',
      async () => {
        for (const data of [
          { role: 'admin' },
          { email: 'new@example.test' },
          { property_id: 2 },
          { auth_user_id: 'other' },
          { name: 'ok', role: 'admin' },
          {},
          { name: undefined },
          { name: null },
          { name: '' },
          { name: '   ' },
          { phone: 123 },
          { name: 'x'.repeat(256) },
          { name: '😀'.repeat(256) },
        ]) {
          calls.length = 0;
          await assert.rejects(
            request(() =>
              updateUser('7', data as unknown as import('../types/users.js').UpdateUserInput),
            ),
            (error: unknown) => error instanceof UserRequestError && error.status === 400,
          );
          assert.equal(calls.length, 0);
        }
      },
    );
    await t.test(
      'all operations reject missing or invalid sessions before user queries',
      async () => {
        const operations: (() => Promise<unknown>)[] = [
          fetchUsers,
          () => fetchUserById('7'),
          () => updateUser('7', { name: 'Changed' }),
        ];
        for (const scenario of ['missing', 'invalid', 'no-profile']) {
          token = scenario === 'missing' ? undefined : 'session-jwt';
          authStatus = scenario === 'invalid' ? 401 : scenario === 'no-profile' ? 403 : 200;
          for (const operation of operations) {
            calls.length = 0;
            await assert.rejects(
              request(operation),
              (error: unknown) => error instanceof UserRequestError && error.status === 401,
            );
            assert.ok(calls.every((call) => call.url.pathname === '/api/auth/me'));
            if (!token) assert.equal(calls.length, 0);
          }
        }
        token = 'session-jwt';
        authStatus = 200;
      },
    );
    await t.test('auth outages prevent user queries without pretending to be a 401', async () => {
      authStatus = 503;
      calls.length = 0;
      await assert.rejects(request(fetchUsers), /Could not verify your session/);
      assert.equal(calls.length, 1);
      authStatus = 200;
    });
    await t.test('missing server settings fail before user queries', async () => {
      for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] as const) {
        const saved = process.env[key];
        delete process.env[key];
        calls.length = 0;
        try {
          await assert.rejects(request(fetchUsers), /Set SUPABASE_URL/);
          assert.ok(calls.every((call) => call.url.pathname === '/api/auth/me'));
        } finally {
          process.env[key] = saved;
        }
      }
    });
    await t.test('database failures preserve RLS and constraint error statuses', async () => {
      for (const status of [403, 409, 500]) {
        userStatus = status;
        await assert.rejects(
          request(() => updateUser('7', { name: 'Changed' })),
          (error: unknown) =>
            error instanceof UserRequestError &&
            error.status === status &&
            error.name === 'UserRequestError' &&
            error.message === `User request failed: ${status}`,
        );
      }
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
