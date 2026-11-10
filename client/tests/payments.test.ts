import 'next/dist/server/node-environment.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external.js';
import { workUnitAsyncStorage, type RequestStore } from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import * as methods from '../lib/paymentMethods.js';
import * as cards from '../lib/cards.js';
import * as banks from '../lib/bankAccounts.js';
import { PaymentRequestError } from '../lib/paymentRequest.js';

test('payment helpers use the session and preserve table restrictions', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.invalid/';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
  let token: string | undefined = 'session-jwt';
  let authStatus = 200;
  let dataStatus = 200;
  let rows: unknown[] = [];
  const calls: { url: URL; method: string; headers: Headers; body?: BodyInit | null }[] = [];
  globalThis.fetch = async (input, init) => {
    const call = { url: new URL(String(input)), method: init?.method ?? 'GET', headers: new Headers(init?.headers), body: init?.body };
    calls.push(call);
    if (call.url.pathname === '/api/auth/me') {
      assert.equal(call.headers.get('cookie'), 'sb-access-token=session-jwt');
      return new Response(null, { status: authStatus });
    }
    assert.equal(call.url.origin, 'https://supabase.invalid');
    assert.equal(init?.cache, 'no-store');
    assert.equal(call.headers.get('apikey'), 'test-key');
    assert.equal(call.headers.get('authorization'), 'Bearer session-jwt');
    return dataStatus === 204 ? new Response(null, { status: 204 }) : Response.json(rows, { status: dataStatus });
  };

  function request<T>(operation: () => Promise<T>) {
    const store = {
      type: 'request', phase: 'render',
      cookies: { get: (name: string) => token && name === 'sb-access-token' ? { name, value: token } : undefined },
    } as unknown as RequestStore;
    return workAsyncStorage.run({ route: '/test', isStaticGeneration: false } as unknown as WorkStore,
      () => workUnitAsyncStorage.run(store, operation));
  }
  const methodInput = { payment_type: 'card' as const, name: 'Demo', billing_zip: '00000' };
  const cardInput = { payment_id: 7, card_brand: 'Demo', card_number: 'synthetic-card', cvc: '000', exp_date: '2030-01-01', is_credit: true };
  const bankInput = { payment_id: 7, bank_name: 'Demo', account_number: 'synthetic-account', routing_number: 'synthetic-routing' };
  const tables = [
    {
      table: 'payment_methods', select: 'payment_id,payment_type,name',
      list: methods.fetchPaymentMethods, one: () => methods.fetchPaymentMethodById('7'),
      create: () => methods.createPaymentMethod(methodInput), input: methodInput,
      update: () => methods.updatePaymentMethod('7', { name: 'Renamed' }), patch: { name: 'Renamed' },
      remove: () => methods.deletePaymentMethod('7'),
    },
    {
      table: 'cards', select: 'payment_id,card_brand,exp_date,is_credit,created_at',
      list: cards.fetchCards, one: () => cards.fetchCardById('7'),
      create: () => cards.createCard(cardInput), input: cardInput,
      update: () => cards.updateCard('7', { is_credit: false }), patch: { is_credit: false },
      remove: () => cards.deleteCard('7'),
    },
    {
      table: 'bank_accounts', select: 'payment_id,bank_name,created_at',
      list: banks.fetchBankAccounts, one: () => banks.fetchBankAccountById('7'),
      create: () => banks.createBankAccount(bankInput), input: bankInput,
      update: () => banks.updateBankAccount('7', { bank_name: 'Renamed' }), patch: { bank_name: 'Renamed' },
      remove: () => banks.deleteBankAccount('7'),
    },
  ];
  try {
    for (const spec of tables) {
      await t.test(`${spec.table}: reads select only summary fields and handle hidden rows`, async () => {
        calls.length = 0;
        rows = [];
        assert.deepEqual(await request<unknown>(spec.list), []);
        assert.equal(await request<unknown>(spec.one), null);
        assert.equal(calls.at(-1)?.url.pathname, `/rest/v1/${spec.table}`);
        assert.equal(calls.at(-1)?.url.searchParams.get('select'), spec.select);
        assert.equal(calls.at(-1)?.url.searchParams.get('payment_id'), 'eq.7');
        assert.equal(calls.at(-1)?.url.searchParams.get('limit'), '1');
        assert.ok(!spec.select.includes('billing_zip'));
        assert.ok(!spec.select.includes('card_number'));
        assert.ok(!spec.select.includes('cvc'));
        assert.ok(!spec.select.includes('account_number'));
        assert.ok(!spec.select.includes('routing_number'));
      });
      await t.test(`${spec.table}: create preserves payload and policy denial`, async () => {
        dataStatus = 403;
        await assert.rejects(request<unknown>(spec.create), (error: unknown) => error instanceof PaymentRequestError && error.status === 403);
        const call = calls.at(-1)!;
        assert.equal(call.method, 'POST');
        assert.equal(call.headers.get('prefer'), 'return=representation');
        assert.deepEqual(JSON.parse(String(call.body)), spec.input);
        assert.equal(call.url.searchParams.get('select'), spec.select);
        dataStatus = 200;
        await assert.rejects(request<unknown>(spec.create), /No created/);
      });
      await t.test(`${spec.table}: update sends only changes and handles zero RLS matches`, async () => {
        assert.equal(await request<unknown>(spec.update), null);
        const call = calls.at(-1)!;
        assert.equal(call.method, 'PATCH');
        assert.equal(call.url.searchParams.get('payment_id'), 'eq.7');
        assert.equal(call.headers.get('prefer'), 'return=representation');
        assert.deepEqual(JSON.parse(String(call.body)), spec.patch);
      });
      await t.test(`${spec.table}: delete returns status without assuming a row was deleted`, async () => {
        dataStatus = 204;
        assert.equal(await request(spec.remove), 204);
        const call = calls.at(-1)!;
        assert.equal(call.method, 'DELETE');
        assert.equal(call.url.searchParams.get('payment_id'), 'eq.7');
        assert.equal(call.body, undefined);
        dataStatus = 200;
      });
    }
    await t.test('payment method reads return the permitted fields', async () => {
      rows = [{ payment_id: 7, payment_type: 'card', name: 'Demo' }];
      assert.deepEqual(await request(methods.fetchPaymentMethods), rows);
      assert.deepEqual(await request(() => methods.fetchPaymentMethodById('7')), rows[0]);
    });
    await t.test('all helpers reject missing/invalid sessions before data queries', async () => {
      for (const scenario of ['missing', 'invalid', 'no-profile']) {
        token = scenario === 'missing' ? undefined : 'session-jwt';
        authStatus = scenario === 'invalid' ? 401 : scenario === 'no-profile' ? 403 : 200;
        for (const spec of tables) {
          for (const operation of [spec.list, spec.one, spec.create, spec.update, spec.remove]) {
            calls.length = 0;
            await assert.rejects(request<unknown>(operation), (error: unknown) => error instanceof PaymentRequestError && error.status === 401);
            assert.ok(calls.every((call) => call.url.pathname === '/api/auth/me'));
            if (!token) assert.equal(calls.length, 0);
          }
        }
      }
      token = 'session-jwt';
      authStatus = 200;
    });
    await t.test('auth outages and missing configuration stop data requests', async () => {
      authStatus = 503;
      calls.length = 0;
      await assert.rejects(request(methods.fetchPaymentMethods), /Could not verify/);
      assert.equal(calls.length, 1);
      authStatus = 200;
      delete process.env.SUPABASE_PUBLISHABLE_KEY;
      calls.length = 0;
      await assert.rejects(request(methods.fetchPaymentMethods), /Set SUPABASE_URL/);
      assert.equal(calls.length, 1);
      process.env.SUPABASE_PUBLISHABLE_KEY = 'test-key';
    });
    await t.test('database error status is preserved without exposing raw details', async () => {
      rows = [{ secret: 'private database details' }];
      for (const status of [401, 403, 409, 500]) {
        dataStatus = status;
        await assert.rejects(request(methods.fetchPaymentMethods), (error: unknown) =>
          error instanceof PaymentRequestError && error.status === status && !error.message.includes('private'));
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
