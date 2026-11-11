import 'next/dist/server/node-environment.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external.js';
import { workUnitAsyncStorage, type RequestStore } from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import { createVendor, deleteVendor, fetchVendorById, fetchVendors, updateVendor, VendorRequestError } from '../lib/vendors.js';
import type { CreateVendorInput, Vendor } from '../types/vendors.js';

test('vendor helpers use the signed-in session', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.invalid/';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';

  const input: CreateVendorInput = {
    name: 'Test vendor', payment_portal_url: 'https://vendor.invalid', supported_payment_methods: 'ACH',
  };
  const vendor: Vendor = {
    ...input, vendor_id: 7, address: null, contact_name: null, phone: null,
    created_at: '2026-11-09T12:00:00Z', updated_at: null,
  };
  let token: string | undefined = 'session-jwt';
  let authStatus = 200;
  let vendorStatus = 200;
  let rows: Vendor[] = [vendor];
  const calls: { url: URL; method: string; headers: Headers; body?: BodyInit | null }[] = [];

  globalThis.fetch = async (url, init) => {
    const call = {
      url: new URL(String(url)), method: init?.method ?? 'GET',
      headers: new Headers(init?.headers), body: init?.body,
    };
    calls.push(call);
    if (call.url.pathname === '/api/auth/me') {
      assert.equal(call.headers.get('cookie'), 'sb-access-token=session-jwt');
      return new Response(null, { status: authStatus });
    }
    assert.equal(call.url.origin, 'https://supabase.invalid');
    assert.equal(call.url.pathname, '/rest/v1/vendors');
    assert.equal(init?.cache, 'no-store');
    assert.equal(call.headers.get('authorization'), 'Bearer session-jwt');
    assert.equal(call.headers.get('apikey'), 'test-key');
    return vendorStatus === 204 ? new Response(null, { status: 204 }) : Response.json(rows, { status: vendorStatus });
  };

  function request<T>(operation: () => Promise<T>) {
    const store = {
      type: 'request', phase: 'render',
      cookies: { get: (name: string) => token && name === 'sb-access-token' ? { name, value: token } : undefined },
    } as unknown as RequestStore;
    return workAsyncStorage.run({ route: '/test', isStaticGeneration: false } as unknown as WorkStore,
      () => workUnitAsyncStorage.run(store, operation));
  }

  try {
    await t.test('reads validate the session before querying vendors', async () => {
      calls.length = 0;
      assert.deepEqual(await request(fetchVendors), [vendor]);
      assert.deepEqual(calls.map((call) => call.url.pathname), ['/api/auth/me', '/rest/v1/vendors']);
      assert.deepEqual(await request(() => fetchVendorById('7')), vendor);
      assert.equal(calls.at(-1)?.url.searchParams.get('vendor_id'), 'eq.7');
      assert.equal(calls.at(-1)?.url.searchParams.get('limit'), '1');
    });
    await t.test('empty reads return an empty list or null', async () => {
      rows = [];
      assert.deepEqual(await request(fetchVendors), []);
      assert.equal(await request(() => fetchVendorById('999')), null);
      rows = [vendor];
    });
    await t.test('create sends the input and preserves the representation header', async () => {
      assert.deepEqual(await request(() => createVendor(input)), vendor);
      const call = calls.at(-1)!;
      assert.equal(call.method, 'POST');
      assert.equal(call.headers.get('prefer'), 'return=representation');
      assert.equal(call.headers.get('content-type'), 'application/json');
      assert.deepEqual(JSON.parse(String(call.body)), input);
    });
    await t.test('create rejects an unexpectedly empty successful response', async () => {
      rows = [];
      await assert.rejects(request(() => createVendor(input)), /No created vendor/);
      rows = [vendor];
    });
    await t.test('update filters by vendor_id and sends only the requested changes', async () => {
      assert.deepEqual(await request(() => updateVendor('7', { name: 'Renamed' })), vendor);
      const call = calls.at(-1)!;
      assert.equal(call.method, 'PATCH');
      assert.equal(call.url.searchParams.get('vendor_id'), 'eq.7');
      assert.equal(call.url.searchParams.has('bill_id'), false);
      assert.equal(call.headers.get('prefer'), 'return=representation');
      assert.deepEqual(JSON.parse(String(call.body)), { name: 'Renamed' });
      rows = [];
      assert.equal(await request(() => updateVendor('999', { phone: null })), null);
      rows = [vendor];
    });
    await t.test('delete uses vendor_id and handles a bodyless 204', async () => {
      vendorStatus = 204;
      assert.equal(await request(() => deleteVendor('7')), 204);
      const call = calls.at(-1)!;
      assert.equal(call.method, 'DELETE');
      assert.equal(call.url.searchParams.get('vendor_id'), 'eq.7');
      assert.equal(call.url.searchParams.has('bill_id'), false);
      assert.equal(call.body, undefined);
      vendorStatus = 200;
    });
    await t.test('all operations reject missing or invalid sessions before vendor queries', async () => {
      const operations: (() => Promise<unknown>)[] = [fetchVendors, () => fetchVendorById('7'),
        () => createVendor(input), () => updateVendor('7', { name: 'Changed' }), () => deleteVendor('7')];
      for (const scenario of ['missing', 'invalid', 'no-profile']) {
        token = scenario === 'missing' ? undefined : 'session-jwt';
        authStatus = scenario === 'invalid' ? 401 : scenario === 'no-profile' ? 403 : 200;
        for (const operation of operations) {
          calls.length = 0;
          await assert.rejects(request(operation), (error: unknown) => error instanceof VendorRequestError && error.status === 401);
          assert.ok(calls.every((call) => call.url.pathname === '/api/auth/me'));
          if (!token) assert.equal(calls.length, 0);
        }
      }
      token = 'session-jwt';
      authStatus = 200;
    });
    await t.test('auth outages prevent vendor queries without pretending to be a 401', async () => {
      authStatus = 503;
      calls.length = 0;
      await assert.rejects(request(fetchVendors), /Could not verify your session/);
      assert.equal(calls.length, 1);
      authStatus = 200;
    });
    await t.test('missing server settings fail before vendor queries', async () => {
      for (const key of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'] as const) {
        const saved = process.env[key];
        delete process.env[key];
        calls.length = 0;
        try {
          await assert.rejects(request(fetchVendors), /Set SUPABASE_URL/);
          assert.ok(calls.every((call) => call.url.pathname === '/api/auth/me'));
        } finally {
          process.env[key] = saved;
        }
      }
    });
    await t.test('database failures preserve RLS and constraint error statuses', async () => {
      for (const status of [403, 409, 500]) {
        vendorStatus = status;
        await assert.rejects(request(() => deleteVendor('7')), (error: unknown) =>
          error instanceof VendorRequestError && error.status === status && error.name === 'VendorRequestError');
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
