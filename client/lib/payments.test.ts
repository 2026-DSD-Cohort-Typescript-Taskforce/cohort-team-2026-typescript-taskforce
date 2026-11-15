import 'next/dist/server/node-environment.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { register } from 'node:module';
import {
  workAsyncStorage,
  type WorkStore,
} from 'next/dist/server/app-render/work-async-storage.external.js';
import {
  workUnitAsyncStorage,
  type RequestStore,
} from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import type { PaymentMethod } from '../types/paymentMethods.js';

// Load server helpers using the Node loader API supported by the project's types.
register('../tests/payment-test-loader.mjs', import.meta.url);

const { fetchPaymentMethodById, fetchPaymentMethods } = await import('./paymentMethods.ts');
const { PaymentRequestError } = await import('./paymentRequest.ts');

test('payment method reads use the signed-in session', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.invalid/';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';

  const paymentMethod: PaymentMethod = { payment_id: 7, payment_type: 'card', name: 'Demo' };
  let token: string | undefined = 'session-jwt';
  let authStatus = 200;
  let dataStatus = 200;
  let rows: PaymentMethod[] = [paymentMethod];
  const calls: { url: URL; method: string; headers: Headers }[] = [];

  t.beforeEach(() => {
    token = 'session-jwt';
    authStatus = 200;
    dataStatus = 200;
    rows = [paymentMethod];
    calls.length = 0;
    process.env.SUPABASE_URL = 'https://supabase.invalid/';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
  });

  globalThis.fetch = async (input, init) => {
    const call = {
      url: new URL(String(input)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
    };
    calls.push(call);
    if (call.url.pathname === '/api/auth/me') {
      assert.equal(call.headers.get('cookie'), 'sb-access-token=session-jwt');
      return new Response(null, { status: authStatus });
    }
    assert.equal(call.url.origin, 'https://supabase.invalid');
    assert.equal(call.url.pathname, '/rest/v1/payment_methods');
    assert.equal(call.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    assert.equal(call.headers.get('apikey'), 'test-key');
    assert.equal(call.headers.get('authorization'), 'Bearer session-jwt');
    return Response.json(rows, { status: dataStatus });
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
    await t.test('lists only the permitted payment method fields', async () => {
      assert.deepEqual(await request(fetchPaymentMethods), [paymentMethod]);
      assert.equal(calls.at(-1)?.url.pathname, '/rest/v1/payment_methods');
      assert.equal(calls.at(-1)?.url.search, '?select=payment_id%2Cpayment_type%2Cname');
    });

    await t.test('fetches one payment method by id', async () => {
      assert.deepEqual(await request(() => fetchPaymentMethodById('7')), paymentMethod);
      assert.equal(calls.at(-1)?.url.pathname, '/rest/v1/payment_methods');
      assert.equal(
        calls.at(-1)?.url.search,
        '?payment_id=eq.7&limit=1&select=payment_id%2Cpayment_type%2Cname',
      );
    });

    await t.test(
      'returns null when the requested payment method is hidden or missing',
      async () => {
        rows = [];
        assert.equal(await request(() => fetchPaymentMethodById('999')), null);
      },
    );

    await t.test(
      'rejects missing or invalid sessions before querying payment methods',
      async () => {
        for (const scenario of ['missing', 'invalid', 'no-profile']) {
          token = scenario === 'missing' ? undefined : 'session-jwt';
          authStatus = scenario === 'invalid' ? 401 : scenario === 'no-profile' ? 403 : 200;
          calls.length = 0;
          await assert.rejects(
            request(fetchPaymentMethods),
            (error: unknown) => error instanceof PaymentRequestError && error.status === 401,
          );
          assert.ok(calls.every((call) => call.url.pathname === '/api/auth/me'));
          if (!token) assert.equal(calls.length, 0);
        }
      },
    );

    await t.test('stops on auth outages and missing server configuration', async () => {
      authStatus = 503;
      await assert.rejects(request(fetchPaymentMethods), /Could not verify/);
      assert.equal(calls.length, 1);

      authStatus = 200;
      calls.length = 0;
      const savedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
      try {
        delete process.env.SUPABASE_PUBLISHABLE_KEY;
        await assert.rejects(request(fetchPaymentMethods), /Set SUPABASE_URL/);
        assert.deepEqual(
          calls.map((call) => call.url.pathname),
          ['/api/auth/me'],
        );
      } finally {
        process.env.SUPABASE_PUBLISHABLE_KEY = savedKey;
      }
    });

    await t.test('preserves database error status without exposing response details', async () => {
      for (const status of [401, 403, 409, 500]) {
        dataStatus = status;
        await assert.rejects(
          request(fetchPaymentMethods),
          (error: unknown) =>
            error instanceof PaymentRequestError &&
            error.status === status &&
            !error.message.includes('private'),
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
