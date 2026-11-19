import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleBillMcp, type BillMcpDeps, type PaymentAttempt, type PaymentOutcome } from './handle.ts';

const TOKEN = 'mcp-secret';
const USER = 'Bearer user-jwt';
const PAID = { payment_id: 9, bill_id: 12, status: 'success', idempotency_key: 'attempt-12' };

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
  const steps: string[] = [];
  const outcomes: PaymentOutcome[] = [];
  const base: BillMcpDeps = {
    mcpToken: TOKEN,
    clientUrl: 'http://localhost:3000',
    stagehandUrl: 'http://127.0.0.1:5000',
    stagehandSecret: 'stagehand-secret',
    canRecord: true,
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/execute')) steps.push('execute');
      if (url.endsWith('/api/bills/12')) {
        return new Response(JSON.stringify({ bill: bill() }), { status: 200 });
      }
      if (url.endsWith('/api/vendors')) {
        return new Response(JSON.stringify({ vendors: [{ vendor_id: 3, name: 'Power' }] }), { status: 200 });
      }
      if (url.endsWith('/observe')) {
        return new Response(JSON.stringify({ pageText: 'Invoice INV-1 total $40.50' }), { status: 200 });
      }
      if (url.endsWith('/execute')) {
        return new Response('paid', { status: 200 });
      }
      return new Response('missing', { status: 404 });
    },
    portalUrl: async () => 'https://portal.example.test/pay',
    latestApproval: async () => 'approved',
    preparePayment: async (billId) => {
      steps.push('prepare');
      return {
        attempt: {
          paymentId: 9,
          billId,
          idempotencyKey: 'attempt-12',
          summary: { bill_id: billId, amount_cents: 4050 },
        },
      };
    },
    authorizePayment: async (attempt: PaymentAttempt) => {
      steps.push('authorize');
      return attempt.summary.bill_id === attempt.billId ? {} : { error: 'authorize_payment failed' };
    },
    pendingBillIds: async () => [12],
    billForAutomation: async (billId) => ({ ...bill(), bill_id: billId }),
    prepareAutomatedPayment: async (billId) => {
      steps.push('prepare');
      return {
        attempt: {
          paymentId: 9,
          billId,
          idempotencyKey: `attempt-${billId}`,
          summary: { bill_id: billId, amount_cents: 4050 },
        },
      };
    },
    authorizeAutomatedPayment: async () => {
      steps.push('authorize');
      return {};
    },
    startSubmission: async () => {
      steps.push('start');
      return {};
    },
    recordOutcome: async (outcome) => {
      steps.push('record');
      outcomes.push(outcome);
      return {
        payment: {
          payment_id: outcome.paymentId,
          bill_id: 12,
          status: outcome.outcome === 'success' ? 'success' : outcome.outcome,
          idempotency_key: 'attempt-12',
        },
      };
    },
  };
  return { calls, steps, outcomes, deps: { ...base, ...overrides } };
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
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    const { built, run } = call({ method: 'tools/list' }, 'Bearer wrong');
    const result = await run();
    assert.deepEqual(result, { status: 401, body: { error: 'unauthorized' } });
    assert.equal(built.calls.length, 0);
    assert.equal(built.outcomes.length, 0);
    assert.match(lines.join('\n'), /\[bill-mcp\] 401/);
    assert.equal(lines.join('\n').includes('wrong'), false);
  } finally {
    console.error = original;
  }
});

test('initialize and tools/list name available tools', async () => {
  const listed = await call({ method: 'tools/list' }).run();
  assert.equal(listed.status, 200);
  assert.deepEqual(
    (listed.body as { tools: { name: string }[] }).tools.map((tool) => tool.name),
    ['get_bill', 'list_vendors', 'observe_portal', 'execute_approved_payment', 'retry_payment_receipt'],
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
  assert.equal(billCall.outcomes.length, 0);

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
  assert.equal(vendors.outcomes.length, 0);
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
  assert.deepEqual(result.body, { observation: '{"pageText":"Invoice INV-1 total $40.50"}' });
  const sent = JSON.parse(String(built.calls.at(-1)?.init?.body));
  assert.equal(sent.portalUrl, 'https://portal.example.test/pay');
  assert.equal(built.calls.at(-1)?.url, 'http://127.0.0.1:5000/observe');
  assert.equal(built.outcomes.length, 0);
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
  assert.equal(built.outcomes.length, 0);
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
  assert.deepEqual(result.body, { payment: PAID });
  const sent = JSON.parse(String(built.calls.find((call) => call.url.endsWith('/execute'))?.init?.body));
  assert.equal(sent.portalUrl, 'https://portal.example.test/pay');
  assert.equal(sent.amount, 40.5);
  assert.equal(sent.idempotencyKey, 'attempt-12');
  assert.deepEqual(built.steps, ['prepare', 'authorize', 'start', 'execute', 'record']);
  assert.deepEqual(built.outcomes[0], {
    paymentId: 9,
    outcome: 'success',
    outcomeCode: 'confirmed',
    transactionReference: 'attempt-12',
    message: null,
  });
});

test('a start failure does not charge', async () => {
  const built = deps({
    startSubmission: async () => ({ error: 'start_payment_submission failed' }),
  });
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'execute_approved_payment', arguments: { bill_id: 12 } } },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { error: 'start_payment_submission failed' });
  assert.equal(built.calls.some((call) => call.url.endsWith('/execute')), false);
  assert.equal(built.outcomes.length, 0);
});

test('a worker outcome_unknown is returned and does not record a payment', async () => {
  const built = deps({
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/api/bills/12')) return new Response(JSON.stringify({ bill: bill() }), { status: 200 });
      if (url.endsWith('/observe')) return new Response(JSON.stringify({ pageText: 'Invoice INV-1 total $40.50' }), { status: 200 });
      return new Response(
        JSON.stringify({ error: 'Payment outcome needs reconciliation. Do not resubmit.', code: 'outcome_unknown' }),
        { status: 409 },
      );
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
          arguments: { bill_id: 12, idempotency_key: 'pay-2' },
        },
      },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { error: 'outcome_unknown' });
  assert.deepEqual(built.outcomes[0], {
    paymentId: 9,
    outcome: 'unknown',
    outcomeCode: 'outcome_unknown',
    transactionReference: null,
    message: null,
  });
});

test('a portal page with a different amount does not call execute', async () => {
  const built = deps({
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/api/bills/12')) return new Response(JSON.stringify({ bill: bill() }), { status: 200 });
      if (url.endsWith('/observe')) return new Response(JSON.stringify({ pageText: 'Invoice INV-1 total $1.00' }), { status: 200 });
      if (url.endsWith('/execute')) return new Response('paid', { status: 200 });
      return new Response('missing', { status: 404 });
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
  assert.deepEqual(result.body, { error: 'snapshot_mismatch', fields: ['amount'] });
  assert.equal(built.calls.some((call) => call.url.endsWith('/execute')), false);
  assert.equal(built.outcomes.length, 0);
});

function execute(arguments_: Record<string, unknown>) {
  return handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'execute_approved_payment', arguments: arguments_ } },
    },
    deps().deps,
  );
}

const matching = {
  bill_id: 12,
  amount: 40.5,
  vendor_id: 3,
  invoice_number: 'INV-1',
  idempotency_key: 'pay-1',
};

test('numeric strings for the amount and vendor count as the same snapshot', async () => {
  const result = await execute({ ...matching, amount: '40.50', vendor_id: '3' });
  assert.deepEqual(result.body, { payment: PAID });
});

test('camelCase bill fields count as the same snapshot', async () => {
  const result = await execute({
    billId: 12,
    amount: '40.50',
    vendorId: '3',
    invoiceNumber: 'INV-1',
    idempotencyKey: 'pay-1',
  });
  assert.deepEqual(result.body, { payment: PAID });
});

test('bill_id alone pays when the portal page shows the invoice and amount', async () => {
  const built = deps();
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'execute_approved_payment', arguments: { bill_id: 12 } } },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { payment: PAID });
  assert.equal(built.outcomes[0].transactionReference, 'attempt-12');
  const observed = JSON.parse(String(built.calls.find((call) => call.url.endsWith('/observe'))?.init?.body));
  assert.equal(observed.portalUrl, 'https://portal.example.test/pay');
});

test('a portal page missing the invoice does not call execute', async () => {
  const built = deps({
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/api/bills/12')) return new Response(JSON.stringify({ bill: bill() }), { status: 200 });
      if (url.endsWith('/observe')) return new Response(JSON.stringify({ pageText: 'Total $40.50' }), { status: 200 });
      return new Response('paid', { status: 200 });
    },
  });
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'execute_approved_payment', arguments: { bill_id: 12 } } },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { error: 'snapshot_mismatch', fields: ['invoice_number'] });
  assert.equal(built.calls.some((call) => call.url.endsWith('/execute')), false);
  assert.equal(built.outcomes.length, 0);
});

test('upload failure returns confirmed payment and retry tool never invokes execute or records payment', async () => {
  const built = deps();
  let receiptWrites = 0;
  built.deps.persistReceipt = async () => { receiptWrites++; throw new Error('offline'); };
  const request = { httpMethod: 'POST', authorization: `Bearer ${TOKEN}`, userAuthorization: USER,
    body: { method: 'tools/call', params: { name: 'execute_approved_payment', arguments: { bill_id: 12 } } } };
  const paid = await handleBillMcp(request, built.deps);
  assert.deepEqual((paid.body as { payment: unknown }).payment, PAID);
  assert.equal(receiptWrites, 1);
  const calls: string[] = [];
  built.deps.receiptPayment = async () => ({ billId: 12, bill_id: 12, payment_id: 9, status: 'success', amount: 40.5, vendorId: 3, invoiceNumber: 'INV-1', idempotencyKey: 'portal-12' });
  built.deps.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/bills/12')) return Response.json({ bill: { ...bill(), status: 'payment_success' } });
    if (String(url).endsWith('/receipt')) return Response.json({ receipt: { status: 'captured' } });
    throw new Error('Retry must not call execute or observe');
  };
  built.deps.recordOutcome = async () => { throw new Error('Retry must not record payment'); };
  built.deps.persistReceipt = async () => ({ status: 'stored', path: 'payments/9/receipt.png' });
  const retried = await handleBillMcp({ ...request, body: { method: 'tools/call', params: { name: 'retry_payment_receipt', arguments: { bill_id: 12, payment_id: 9 } } } }, built.deps);
  assert.deepEqual(retried.body, { receipt: { status: 'stored', path: 'payments/9/receipt.png' } });
  assert.ok(calls.every(url => !url.endsWith('/execute')));
});

test('the agent tool call cannot start the hourly sweep', async () => {
  const built = deps();
  const result = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'sweep_approved_payments', arguments: {} } },
    },
    built.deps,
  );
  assert.deepEqual(result.body, { error: 'unknown tool' });
  assert.equal(built.calls.length, 0);
  const listed = await call({ method: 'tools/list' }).run();
  const names = (listed.body as { tools: { name: string }[] }).tools.map((tool) => tool.name);
  assert.equal(names.includes('sweep_approved_payments'), false);
});

test('the hourly sweep pays each pending bill through execute_approved_payment', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const built = deps({
    canRecord: false,
    pendingBillIds: async () => [2, 4],
    billForAutomation: async (billId) => ({ ...bill(), bill_id: billId }),
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      if (url.endsWith('/observe')) return Response.json({ pageText: 'Invoice INV-1 total $40.50' });
      if (url.endsWith('/execute')) {
        const body = JSON.parse(String(init?.body)) as { billId?: number };
        if (body.billId === 2) return Response.json({ code: 'outcome_unknown' }, { status: 409 });
        return Response.json({ confirmed: true });
      }
      return new Response('missing', { status: 404 });
    },
  });
  const stopped = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: '',
      body: { method: 'sweep_approved_payments' },
    },
    built.deps,
  );
  const stoppedBody = stopped.body as { results: { bill_id: number; outcome: { error?: string } }[] };
  assert.deepEqual(
    stoppedBody.results.map((row) => row.bill_id),
    [2, 4],
  );
  assert.equal(stoppedBody.results[0].outcome.error, 'worker not configured');
  assert.equal(calls.some((entry) => entry.url.endsWith('/execute')), false);

  built.deps.canRecord = true;
  calls.length = 0;
  const continued = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: '',
      body: { method: 'sweep_approved_payments' },
    },
    built.deps,
  );
  const executeIds = calls
    .filter((entry) => entry.url.endsWith('/execute'))
    .map((entry) => (JSON.parse(String(entry.init?.body)) as { billId: number }).billId);
  assert.deepEqual(executeIds, [2, 4]);
  const continuedBody = continued.body as { results: { bill_id: number; outcome: { error?: string } }[] };
  assert.equal(continuedBody.results[0].outcome.error, 'outcome_unknown');
  assert.equal(continuedBody.results[1].bill_id, 4);
  assert.deepEqual(built.outcomes.map((outcome) => outcome.outcome), ['unknown', 'success']);
  assert.equal(built.outcomes[1].transactionReference, 'attempt-4');
});

test('receipt retry rejects an unauthorized or mismatched payment before worker access', async () => {
  const built = deps();
  built.deps.receiptPayment = async () => null;
  built.deps.persistReceipt = async () => { throw new Error('Must not upload'); };
  const response = await handleBillMcp({ httpMethod: 'POST', authorization: `Bearer ${TOKEN}`, userAuthorization: USER,
    body: { method: 'tools/call', params: { name: 'retry_payment_receipt', arguments: { bill_id: 12, payment_id: 9 } } } }, built.deps);
  assert.deepEqual(response.body, { error: 'receipt not found' });
  assert.equal(built.calls.length, 1);
});
