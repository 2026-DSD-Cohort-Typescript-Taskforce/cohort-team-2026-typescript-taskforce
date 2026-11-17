import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleBillMcp, type BillMcpDeps, type PaymentInput } from './handle.ts';

const TOKEN = 'mcp-secret';
const USER = 'Bearer user-jwt';

function bill() {
  return {
    bill_id: 12,
    status: 'pending_payment',
    amount: 40.5,
    vendor_id: 3,
    invoice_number: 'INV-1',
  };
}

function deps(overrides: Partial<BillMcpDeps> = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const recorded: PaymentInput[] = [];
  const base: BillMcpDeps = {
    mcpToken: TOKEN,
    clientUrl: 'http://localhost:3000',
    stagehandUrl: 'http://127.0.0.1:5000',
    stagehandSecret: 'stagehand-secret',
    canRecord: true,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/api/bills/12')) {
        return new Response(JSON.stringify({ bill: bill() }), { status: 200 });
      }
      if (url.endsWith('/api/vendors')) {
        return new Response(JSON.stringify({ vendors: [{ vendor_id: 3, name: 'Power' }] }), { status: 200 });
      }
      if (url.endsWith('/observe') || url.endsWith('/execute')) {
        return new Response('page text', { status: 200 });
      }
      return new Response('missing', { status: 404 });
    },
    portalUrl: async () => 'https://portal.example.test/pay',
    latestApproval: async () => 'approved',
    recordPayment: async (input) => {
      recorded.push(input);
      return { payment: { payment_id: 9 } };
    },
  };
  return { calls, recorded, deps: { ...base, ...overrides } };
}

function call(body: unknown, authorization: string | null = `Bearer ${TOKEN}`, httpMethod = 'POST') {
  const built = deps();
  return {
    built,
    run: () =>
      handleBillMcp(
        { httpMethod, authorization, userAuthorization: USER, body },
        built.deps,
      ),
  };
}

test('a request without the MCP token is refused and calls nothing', async () => {
  const { built, run } = call({ method: 'tools/list' }, 'Bearer wrong');
  const result = await run();
  assert.deepEqual(result, { status: 401, body: { error: 'unauthorized' } });
  assert.equal(built.calls.length, 0);
  assert.equal(built.recorded.length, 0);
});

test('initialize and tools/list name the four tools', async () => {
  const listed = await call({ method: 'tools/list' }).run();
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (listed.body as { tools: { name: string }[] }).tools.map((tool) => tool.name),
    ['get_bill', 'list_vendors', 'observe_portal', 'execute_approved_payment'],
  );
  const started = await call({ method: 'initialize' }).run();
  assert.deepEqual(started.body, { server: 'bill-mcp', tools: true });
});

test('get_bill and list_vendors forward the user cookie and write nothing', async () => {
  const billCall = deps();
  const loaded = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'get_bill', arguments: { bill_id: 12 } } },
    },
    billCall.deps,
  );
  assert.equal(loaded.status, 200);
  assert.equal(billCall.calls[0].url, 'http://localhost:3000/api/bills/12');
  assert.equal(new Headers(billCall.calls[0].init?.headers).get('cookie'), 'sb-access-token=user-jwt');
  assert.equal(billCall.recorded.length, 0);

  const vendors = deps();
  await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'list_vendors', arguments: {} } },
    },
    vendors.deps,
  );
  assert.equal(vendors.calls[0].url, 'http://localhost:3000/api/vendors');
  assert.equal(vendors.recorded.length, 0);
});

test('observe_portal posts the stored portal URL and ignores a URL in the arguments', async () => {
  const built = deps();
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: {
        method: 'tools/call',
        params: {
          name: 'observe_portal',
          arguments: { bill_id: 12, portalUrl: 'https://evil.example/pay' },
        },
      },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { observation: 'page text' });
  const sent = JSON.parse(String(built.calls.at(-1)?.init?.body));
  assert.equal(sent.portalUrl, 'https://portal.example.test/pay');
  assert.equal(built.calls.at(-1)?.url, 'http://127.0.0.1:5000/observe');
  assert.equal(built.recorded.length, 0);
});

test('a worker failure does not record a payment', async () => {
  const built = deps({
    fetch: async (input, init) => {
      const url = String(input);
      if (url.endsWith('/api/bills/12')) return new Response(JSON.stringify({ bill: bill() }), { status: 200 });
      return new Response('nope', { status: 502, ...(init ? {} : {}) });
    },
  });
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: {
        method: 'tools/call',
        params: {
          name: 'execute_approved_payment',
          arguments: {
            bill_id: 12,
            amount: 40.5,
            vendor_id: 3,
            invoice_number: 'INV-1',
            idempotency_key: 'pay-1',
          },
        },
      },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { error: 'worker failed' });
  assert.equal(built.recorded.length, 0);
});

test('a matching approved bill records the database snapshot after the worker succeeds', async () => {
  const built = deps();
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: {
        method: 'tools/call',
        params: {
          name: 'execute_approved_payment',
          arguments: {
            bill_id: 12,
            amount: 40.5,
            vendor_id: 3,
            invoice_number: 'INV-1',
            idempotency_key: 'pay-1',
            portalUrl: 'https://evil.example/pay',
          },
        },
      },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { payment: { payment_id: 9 } });
  const sent = JSON.parse(String(built.calls.find((call) => call.url.endsWith('/execute'))?.init?.body));
  assert.equal(sent.portalUrl, 'https://portal.example.test/pay');
  assert.equal(sent.amount, 40.5);
  assert.deepEqual(built.recorded[0], {
    billId: 12,
    amount: 40.5,
    vendorId: 3,
    invoiceNumber: 'INV-1',
    idempotencyKey: 'pay-1',
  });
});

test('a different amount does not call the worker', async () => {
  const built = deps();
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: {
        method: 'tools/call',
        params: {
          name: 'execute_approved_payment',
          arguments: {
            bill_id: 12,
            amount: 1,
            vendor_id: 3,
            invoice_number: 'INV-1',
            idempotency_key: 'pay-1',
          },
        },
      },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { error: 'snapshot_mismatch' });
  assert.equal(built.calls.some((call) => call.url.endsWith('/execute')), false);
  assert.equal(built.recorded.length, 0);
});
