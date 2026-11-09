import 'next/dist/server/node-environment.js';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server';
import { getSessionAccessToken } from '../lib/accessToken.js';
import { workAsyncStorage, type WorkStore } from 'next/dist/server/app-render/work-async-storage.external.js';
import { workUnitAsyncStorage, type RequestStore } from 'next/dist/server/app-render/work-unit-async-storage.external.js';
import { proxy } from '../proxy.js';
import {
  BillRequestError, 
  createBill, 
  deleteBill, 
  fetchBillById, 
  fetchBills,
  fetchLastSubmittedBill, 
  fetchLastSubmittedBillByUserId, 
  fetchPendingApprovalBills,
  fetchRecentPaidBills, 
  getBillStatusRows, 
  getBillStatusRowsByUserId, 
  updateBill
} from '../lib/bills.js';

function verifyAccessToken(token: string | undefined) {
  const store = {
    type: 'request', phase: 'render',
    cookies: { get: (name: string) => name === 'sb-access-token' && token ? { name, value: token } : undefined },
  } as unknown as RequestStore;
  return workAsyncStorage.run({ route: '/test', isStaticGeneration: false } as unknown as WorkStore,
    () => workUnitAsyncStorage.run(store, getSessionAccessToken));
}

test('session validation and dashboard refresh', async (t) => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let status = 200;
  let cookies: string[] = [];
  let sentCookie = '';
  globalThis.fetch = async (_input, init) => {
    calls++;
    sentCookie = new Headers(init?.headers).get('cookie') ?? '';
    const headers = new Headers();
    for (const value of cookies) headers.append('set-cookie', value);
    return new Response(null, { status, headers });
  };
  try {
    await t.test('missing token skips auth and returns no token', async () => {
      assert.equal(await verifyAccessToken(undefined), null);
      assert.equal(calls, 0);
    });
    await t.test('returns the same token only after successful validation', async () => {
      assert.equal(await verifyAccessToken('valid-jwt'), 'valid-jwt');
      assert.equal(sentCookie, 'sb-access-token=valid-jwt');
      assert.ok(!sentCookie.includes('refresh'));
    });
    await t.test('rejected tokens or profiles never produce a data-query token', async () => {
      for (status of [401, 403]) assert.equal(await verifyAccessToken('forged-jwt'), null);
    });
    await t.test('auth outage does not masquerade as a signed-out session', async () => {
      status = 503;
      await assert.rejects(verifyAccessToken('valid-jwt'), /Could not verify/);
    });
    await t.test('dashboard validates an existing invalid/expired cookie and uses refreshed cookies', async () => {
      status = 200;
      cookies = ['sb-access-token=new-jwt; Path=/; HttpOnly', 'sb-refresh-token=new-refresh; Path=/; HttpOnly'];
      const response = await proxy(new NextRequest('http://localhost:3000/dashboard', {
        headers: { cookie: 'sb-access-token=expired-jwt; sb-refresh-token=old-refresh' },
      }));
      assert.equal(response.status, 200);
      assert.equal(sentCookie, 'sb-access-token=expired-jwt; sb-refresh-token=old-refresh');
      assert.match(response.headers.get('x-middleware-request-cookie') ?? '', /sb-access-token=new-jwt/);
      assert.equal(response.headers.getSetCookie().length, 2);
    });
    await t.test('refresh-only dashboard visit forwards new access cookie to render', async () => {
      const response = await proxy(new NextRequest('http://localhost:3000/dashboard', {
        headers: { cookie: 'sb-refresh-token=old-refresh' },
      }));
      assert.match(response.headers.get('x-middleware-request-cookie') ?? '', /sb-access-token=new-jwt/);
    });
    await t.test('unrefreshable session redirects and forwards cookie clearing', async () => {
      status = 401;
      cookies = ['sb-access-token=; Max-Age=0; Path=/', 'sb-refresh-token=; Max-Age=0; Path=/'];
      const response = await proxy(new NextRequest('http://localhost:3000/dashboard', {
        headers: { cookie: 'sb-access-token=forged-jwt; sb-refresh-token=invalid' },
      }));
      assert.equal(response.status, 307);
      assert.equal(response.headers.get('location'), 'http://localhost:3000/login');
      assert.ok(response.headers.getSetCookie().length >= 2);
    });
    await t.test('profile rejection clears cookies to avoid a login redirect loop', async () => {
      status = 403;
      cookies = [];
      const response = await proxy(new NextRequest('http://localhost:3000/dashboard', {
        headers: { cookie: 'sb-access-token=valid-jwt' },
      }));
      assert.equal(response.status, 307);
      assert.equal(response.headers.getSetCookie().length, 2);
    });
    await t.test('merged bill routes stay protected without refreshing in the proxy', async () => {
      for (const path of ['/bills', '/bills/11']) {
        const before = calls;
        const signedOut = await proxy(new NextRequest(`http://localhost:3000${path}`));
        assert.equal(signedOut.status, 307);
        assert.equal(signedOut.headers.get('location'), 'http://localhost:3000/login');
        const signedIn = await proxy(new NextRequest(`http://localhost:3000${path}`, {
          headers: { cookie: 'sb-refresh-token=refresh-token' },
        }));
        assert.equal(signedIn.status, 200);
        assert.equal(calls, before);
      }
    });
    await t.test('dashboard fails closed on auth outage without clearing cookies', async () => {
      status = 503;
      const response = await proxy(new NextRequest('http://localhost:3000/dashboard', {
        headers: { cookie: 'sb-access-token=valid-jwt' },
      }));
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.getSetCookie().length, 0);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('bill helpers obtain their own validated session', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  process.env.SUPABASE_URL = 'https://supabase.invalid';
  process.env.SUPABASE_PUBLISHABLE_KEY = 'test-publishable-key';
  let token: string | undefined = 'session-jwt';
  let authStatus = 200;
  let billStatus = 200;
  let rows: unknown[] = [{ bill_id: 1, amount: 10, status: 'draft' }];
  const calls: { url: URL; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    calls.push({ url, init });
    if (url.pathname === '/api/auth/me') {
      assert.equal(new Headers(init?.headers).get('cookie'), 'sb-access-token=session-jwt');
      return new Response(null, { status: authStatus });
    }
    assert.equal(url.origin, 'https://supabase.invalid');
    assert.equal(url.pathname, '/rest/v1/bills');
    assert.equal(init?.cache, 'no-store');
    const headers = new Headers(init?.headers);
    assert.equal(headers.get('authorization'), 'Bearer session-jwt');
    assert.equal(headers.get('apikey'), 'test-publishable-key');
    return billStatus === 204 ? new Response(null, { status: 204 }) : Response.json(rows, { status: billStatus });
  };
  function request<T>(operation: () => Promise<T>) {
    const store = {
      type: 'request', phase: 'render',
      cookies: { get: (name: string) => name === 'sb-access-token' && token ? { name, value: token } : undefined },
    } as unknown as RequestStore;
    return workAsyncStorage.run({ route: '/test', isStaticGeneration: false } as unknown as WorkStore,
      () => workUnitAsyncStorage.run(store, operation));
  }
  try {
    await t.test('all read helpers use the login session without a token argument', async () => {
      for (const operation of [fetchBills, () => fetchBillById('1'), fetchLastSubmittedBill,
        () => fetchLastSubmittedBillByUserId('12'), fetchRecentPaidBills, fetchPendingApprovalBills,
        getBillStatusRows, () => getBillStatusRowsByUserId('12')]) {
        calls.length = 0;
        await request<unknown>(operation);
        assert.deepEqual(calls.map((call) => call.url.pathname), ['/api/auth/me', '/rest/v1/bills']);
      }
    });
    await t.test('create, update, and delete use the same validated session', async () => {
      await request(() => createBill({ amount: 10, property_id: 1, vendor_id: 1, user_id: 12, payment_id: 1 }));
      assert.equal(calls.at(-1)?.init?.method, 'POST');
      assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), { amount: 10, property_id: 1, vendor_id: 1, user_id: 12, payment_id: 1 });
      await request(() => updateBill('1', { amount: 20 }));
      assert.equal(calls.at(-1)?.init?.method, 'PATCH');
      assert.equal(calls.at(-1)?.url.searchParams.get('bill_id'), 'eq.1');
      billStatus = 204;
      assert.equal(await request(() => deleteBill('1')), 204);
      assert.equal(calls.at(-1)?.init?.method, 'DELETE');
      billStatus = 200;
    });
    await t.test('missing or rejected sessions never query bills, including writes', async () => {
      for (const scenario of ['missing', 'rejected', 'profile-missing']) {
        token = scenario === 'missing' ? undefined : 'session-jwt';
        authStatus = scenario === 'rejected' ? 401 : scenario === 'profile-missing' ? 403 : 200;
        for (const operation of [fetchBills, () => createBill({ amount: 1, property_id: 1, vendor_id: 1, user_id: 12, payment_id: 1 }),
          () => updateBill('1', { amount: 1 }), () => deleteBill('1')]) {
          calls.length = 0;
          await assert.rejects(request<unknown>(operation), (error: unknown) => error instanceof BillRequestError && error.status === 401);
          assert.ok(calls.every((call) => call.url.pathname === '/api/auth/me'));
        }
      }
      token = 'session-jwt';
      authStatus = 200;
    });
    await t.test('RLS errors preserve status and absent rows stay empty/null', async () => {
      billStatus = 403;
      await assert.rejects(request(fetchBills), (error: unknown) => error instanceof BillRequestError && error.status === 403);
      billStatus = 200;
      rows = [];
      assert.deepEqual(await request(fetchBills), []);
      assert.equal(await request(() => fetchBillById('999')), null);
      assert.equal(await request(fetchLastSubmittedBill), null);
      assert.equal(await request(() => updateBill('999', { amount: 1 })), null);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY;
    else process.env.SUPABASE_PUBLISHABLE_KEY = originalKey;
  }
});
