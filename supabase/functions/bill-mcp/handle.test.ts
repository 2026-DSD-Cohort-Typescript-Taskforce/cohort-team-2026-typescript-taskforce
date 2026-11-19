import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleBillMcp, type BillMcpDeps, type RpcName, type RpcReply } from './handle.ts';

const TOKEN = 'mcp-secret';
const USER = 'Bearer user-jwt';

function bill() {
  return {
    bill_id: 12,
    status: 'pending_payment',
    amount: 40.5,
    vendor_id: 3,
    invoice_number: 'INV-1',
    payment_method_id: 5,
  };
}

// The payments row prepare_payment returns for bill 12.
function attempt(overrides: Record<string, unknown> = {}) {
  return {
    payment_id: 31,
    bill_id: 12,
    status: 'pending',
    vendor_id: 3,
    invoice_number: 'INV-1',
    account_reference: null,
    payment_method_id: 5,
    amount_cents: 4050,
    fees_cents: 0,
    total_cents: 4050,
    currency: 'USD',
    payment_date: '2026-11-18',
    idempotency_key: 'key-31',
    ...overrides,
  };
}

// A payment function's own refusal carries a PT code; a lost reply has none.
function rpcError(message: string, details: string | null = null, code?: string): RpcReply {
  return { data: null, error: { message, details, code } };
}

type RpcCall = { name: RpcName; args: Record<string, unknown>; as: 'service' | 'user' };

type Script = {
  bill?: Record<string, unknown>;
  page?: string;
  observe?: (init?: RequestInit) => Response | Promise<Response>;
  execute?: (init?: RequestInit) => Response | Promise<Response>;
  rpc?: Partial<Record<RpcName, (args: Record<string, unknown>) => RpcReply>>;
};

function deps(overrides: Partial<BillMcpDeps> = {}, script: Script = {}) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const rpcCalls: RpcCall[] = [];
  // Requests and payment-function calls, in the order they happened.
  const steps: string[] = [];
  // authorize, start and record answer with the prepared row in its next status.
  let row: Record<string, unknown> = attempt();
  const answers: Record<RpcName, (args: Record<string, unknown>) => RpcReply> = {
    prepare_payment: () => ({ data: attempt(), error: null }),
    authorize_payment: () => ({ data: { ...row, status: 'authorized' }, error: null }),
    authorize_approved_payment: () => ({ data: { ...row, status: 'authorized' }, error: null }),
    start_payment_submission: () => ({ data: { ...row, status: 'processing' }, error: null }),
    record_payment: (args) => ({ data: { ...row, status: args.p_outcome }, error: null }),
    cancel_payment: () => ({ data: { ...row, status: 'canceled' }, error: null }),
    evaluate_bill_policy: () => ({ data: { decision: 'none' }, error: null }),
    send_bill_for_approval: () => ({ data: { decision: 'require_approval' }, error: null }),
  };
  const base: BillMcpDeps = {
    mcpToken: TOKEN,
    clientUrl: 'http://localhost:3000',
    stagehandUrl: 'http://127.0.0.1:5000',
    stagehandSecret: 'stagehand-secret',
    fetch: async (input, init) => {
      const url = String(input);
      calls.push({ url, init });
      steps.push(new URL(url).pathname);
      if (url.endsWith('/api/bills/12')) {
        return new Response(JSON.stringify({ bill: { ...bill(), ...script.bill } }), { status: 200 });
      }
      if (url.endsWith('/api/vendors')) {
        return new Response(JSON.stringify({ vendors: [{ vendor_id: 3, name: 'Power' }] }), { status: 200 });
      }
      if (url.endsWith('/observe')) {
        if (script.observe) return script.observe(init);
        return new Response(JSON.stringify({ pageText: script.page ?? 'Invoice INV-1 total $40.50' }), { status: 200 });
      }
      if (url.endsWith('/execute')) {
        if (script.execute) return script.execute(init);
        return Response.json({ confirmed: true, transactionReference: 'TX-31' });
      }
      return new Response('missing', { status: 404 });
    },
    portalUrl: async () => 'https://portal.example.test/pay',
    callerUserId: async () => 7,
    sleep: async () => {},
    rpc: async (name, args, as) => {
      // The default evaluator answer ('none') is not recorded, so the tests of the payment order stay
      // as they were; a scripted evaluator is.
      if (name !== 'evaluate_bill_policy' || script.rpc?.evaluate_bill_policy) {
        rpcCalls.push({ name, args, as });
        steps.push(name);
      }
      const reply = (script.rpc?.[name] ?? answers[name])(args);
      if (name === 'prepare_payment' && reply.data) row = reply.data as Record<string, unknown>;
      return reply;
    },
  };
  return { calls, rpcCalls, steps, deps: { ...base, ...overrides } };
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

// What the DC-113 dialog showed the admin for bill 12.
const shown = {
  bill_id: 12,
  vendor_id: 3,
  invoice_number: 'INV-1',
  payment_method_id: 5,
  amount: 40.5,
  fees: 0,
  currency: 'USD',
  payment_date: '2026-11-18',
};

function pay(built: ReturnType<typeof deps>, arguments_: Record<string, unknown> = shown) {
  return handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: USER,
      body: { method: 'tools/call', params: { name: 'execute_approved_payment', arguments: arguments_ } },
    },
    built.deps,
  );
}

function rpcNames(built: ReturnType<typeof deps>) {
  return built.rpcCalls.map((rpc) => rpc.name);
}

function executeCalls(built: ReturnType<typeof deps>) {
  return built.calls.filter((call) => call.url.endsWith('/execute'));
}

function recorded(built: ReturnType<typeof deps>) {
  return built.rpcCalls.find((rpc) => rpc.name === 'record_payment')?.args;
}

function workerError(code: string, status: number) {
  return () => Response.json({ code, error: 'The worker refused.' }, { status });
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
    assert.equal(built.rpcCalls.length, 0);
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
  assert.equal(billCall.rpcCalls.length, 0);

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
  assert.equal(vendors.rpcCalls.length, 0);
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
  assert.equal(built.rpcCalls.length, 0);
});

test('a worker failure does not record a payment', async () => {
  const built = deps({
    fetch: async (input) => {
      const url = String(input);
      if (url.endsWith('/api/bills/12')) return new Response(JSON.stringify({ bill: bill() }), { status: 200 });
      return new Response('nope', { status: 502 });
    },
  });
  const result = await pay(built, { ...shown, idempotency_key: 'pay-1' });
  assert.deepEqual(result.body, { error: 'worker failed' });
  assert.equal(built.rpcCalls.length, 0);
});

test('success runs prepare, authorize, claim, execute and record in order', async () => {
  const built = deps();
  const result = await pay(built, {
    ...shown,
    idempotency_key: 'pay-1',
    portalUrl: 'https://evil.example/pay',
  });
  assert.deepEqual(built.steps, [
    '/api/bills/12',
    '/observe',
    'prepare_payment',
    'authorize_payment',
    'start_payment_submission',
    '/execute',
    'record_payment',
  ]);
  assert.deepEqual(rpcNames(built), [
    'prepare_payment',
    'authorize_payment',
    'start_payment_submission',
    'record_payment',
  ]);
  assert.deepEqual(
    built.rpcCalls.map((rpc) => rpc.as),
    ['service', 'user', 'service', 'service'],
  );
  const [prepare, authorize, start, record] = built.rpcCalls;
  assert.deepEqual(prepare.args, {
    p_bill_id: 12,
    p_prepared_by: 7,
    p_fees_cents: 0,
    p_payment_date: '2026-11-18',
    p_account_reference: null,
  });
  assert.deepEqual(authorize.args, {
    p_payment_id: 31,
    p_summary: {
      bill_id: 12,
      vendor_id: 3,
      invoice_number: 'INV-1',
      account_reference: null,
      payment_method_id: 5,
      amount_cents: 4050,
      fees_cents: 0,
      total_cents: 4050,
      currency: 'USD',
      payment_date: '2026-11-18',
    },
  });
  assert.deepEqual(start.args, { p_payment_id: 31 });
  const [executed] = executeCalls(built);
  assert.deepEqual(JSON.parse(String(executed.init?.body)), {
    billId: 12,
    portalUrl: 'https://portal.example.test/pay',
    amount: 40.5,
    vendorId: 3,
    invoiceNumber: 'INV-1',
    idempotencyKey: 'key-31',
  });
  assert.ok(executed.init?.signal instanceof AbortSignal);
  assert.deepEqual(record.args, {
    p_payment_id: 31,
    p_outcome: 'success',
    p_outcome_code: 'confirmed',
    p_transaction_reference: 'TX-31',
    p_message: null,
  });
  assert.deepEqual(result.body, { payment: attempt({ status: 'success' }) });
});

test("the receipt is stored through the attempt's own key", async () => {
  const receipt = { status: 'captured', reference: 'TX-31' };
  const built = deps(
    {},
    { execute: () => Response.json({ confirmed: true, transactionReference: 'TX-31', receipt }) },
  );
  const stored: unknown[][] = [];
  built.deps.persistReceipt = async (...args) => {
    stored.push(args);
    return { status: 'stored', path: 'payments/31/receipt.png' };
  };
  const result = await pay(built);
  assert.equal(stored.length, 1);
  const [input, payment, sent] = stored[0];
  assert.deepEqual(input, {
    billId: 12,
    amount: 40.5,
    vendorId: 3,
    invoiceNumber: 'INV-1',
    idempotencyKey: 'key-31',
  });
  assert.deepEqual(payment, attempt({ status: 'success' }));
  assert.deepEqual(sent, receipt);
  assert.deepEqual(result.body, {
    payment: attempt({ status: 'success' }),
    receipt: { status: 'stored', path: 'payments/31/receipt.png' },
  });
});

test('payment_failed bills are payable again', async () => {
  const built = deps({}, { bill: { status: 'payment_failed' } });
  const result = await pay(built);
  assert.equal((result.body as { payment: { status: string } }).payment.status, 'success');
  assert.equal(executeCalls(built).length, 1);
});

test('other statuses are not_payable and call nothing', async () => {
  for (const status of ['draft', 'pending_approval', 'approval_denied', 'processing', 'payment_success']) {
    const built = deps({}, { bill: { status } });
    const result = await pay(built);
    assert.deepEqual(result.body, { error: 'not_payable' }, status);
    assert.deepEqual(built.steps, ['/api/bills/12'], status);
  }
});

test('values the admin saw that differ from the bill stop before preparing', async () => {
  const built = deps();
  const result = await pay(built, { ...shown, amount: '40.51' });
  assert.deepEqual(result.body, { error: 'summary_mismatch', fields: ['amount'] });
  assert.deepEqual(built.steps, ['/api/bills/12']);

  const all = deps();
  const differs = await pay(all, {
    ...shown,
    vendor_id: 4,
    invoice_number: 'INV-2',
    payment_method_id: 6,
    amount: 1,
  });
  assert.deepEqual(differs.body, {
    error: 'summary_mismatch',
    fields: ['vendor_id', 'invoice_number', 'payment_method_id', 'amount'],
  });
  assert.equal(all.rpcCalls.length, 0);
});

test('a prepared attempt that differs from what was shown is cancelled', async () => {
  const built = deps(
    {},
    {
      rpc: {
        prepare_payment: () => ({ data: attempt({ amount_cents: 4000, total_cents: 4000 }), error: null }),
      },
    },
  );
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'summary_mismatch', fields: ['amount', 'total'] });
  assert.deepEqual(rpcNames(built), ['prepare_payment', 'cancel_payment']);
  assert.deepEqual(built.rpcCalls[1], {
    name: 'cancel_payment',
    args: { p_payment_id: 31, p_note: 'summary_mismatch' },
    as: 'user',
  });
  assert.equal(executeCalls(built).length, 0);
});

test('every authorized value must be one the admin was shown', async () => {
  const cases: [Record<string, unknown>, Record<string, unknown>, string[]][] = [
    [{}, { payment_method_id: 6 }, ['payment_method_id']],
    [{}, { fees_cents: 150, total_cents: 4200 }, ['fees', 'total']],
    [{}, { currency: 'CAD' }, ['currency']],
    [{}, { payment_date: '2026-11-19' }, ['payment_date']],
    [{}, { account_reference: 'ACCT-9' }, ['account_reference']],
    [{ fees: 1.5 }, {}, ['fees', 'total']],
    [{ currency: 'EUR' }, {}, ['currency']],
  ];
  for (const [sent, prepared, fields] of cases) {
    const built = deps({}, { rpc: { prepare_payment: () => ({ data: attempt(prepared), error: null }) } });
    const result = await pay(built, { ...shown, ...sent });
    const label = JSON.stringify([sent, prepared]);
    assert.deepEqual(result.body, { error: 'summary_mismatch', fields }, label);
    assert.deepEqual(rpcNames(built), ['prepare_payment', 'cancel_payment'], label);
    assert.equal(executeCalls(built).length, 0, label);
  }
});

test('the attempt is prepared for the payment date the admin was shown', async () => {
  const built = deps({}, { rpc: { prepare_payment: () => ({ data: attempt({ payment_date: '2026-11-19' }), error: null }) } });
  const result = await pay(built, { ...shown, payment_date: '2026-11-19' });
  assert.equal((result.body as { payment: { status: string } }).payment.status, 'success');
  assert.equal(built.rpcCalls[0].args.p_payment_date, '2026-11-19');
  assert.equal((built.rpcCalls[1].args.p_summary as Record<string, unknown>).payment_date, '2026-11-19');
});

test('40.10 shown for a 40.1 bill counts as the same amount', async () => {
  const built = deps(
    {},
    {
      bill: { amount: 40.1 },
      page: 'Invoice INV-1 total $40.10',
      rpc: {
        prepare_payment: () => ({ data: attempt({ amount_cents: 4010, total_cents: 4010 }), error: null }),
      },
    },
  );
  const result = await pay(built, { ...shown, amount: '40.10' });
  assert.equal((result.body as { payment: { status: string } }).payment.status, 'success');
  assert.equal(JSON.parse(String(executeCalls(built)[0].init?.body)).amount, 40.1);
});

test('prepare errors are returned and nothing is executed', async () => {
  // index.ts answers 'worker not configured' for service calls when the service key is unset.
  for (const code of ['payment_in_progress', 'already_paid', 'not_payable', 'worker not configured']) {
    const built = deps({}, { rpc: { prepare_payment: () => rpcError(code, '9') } });
    const result = await pay(built);
    assert.deepEqual(result.body, { error: code });
    assert.deepEqual(rpcNames(built), ['prepare_payment'], code);
    assert.equal(executeCalls(built).length, 0, code);
  }
});

async function refusedClaim(code: string, details: string | null) {
  const built = deps(
    {},
    {
      rpc: {
        start_payment_submission: () => rpcError(code, details),
        cancel_payment: () => rpcError('not_cancelable', 'expired'),
      },
    },
  );
  const result = await pay(built);
  assert.deepEqual(result.body, { error: code });
  assert.deepEqual(rpcNames(built), [
    'prepare_payment',
    'authorize_payment',
    'start_payment_submission',
    'cancel_payment',
  ]);
  assert.deepEqual(built.rpcCalls[3].args, { p_payment_id: 31, p_note: code });
  assert.equal(built.rpcCalls[3].as, 'user');
  assert.equal(executeCalls(built).length, 0);
}

test('a racing trigger whose attempt was superseded never reaches execute', async () => {
  await refusedClaim('not_authorized', 'expired');
});

test('an expired authorization stops before execute', async () => {
  await refusedClaim('authorization_expired', null);
});

test('a stale summary at the claim stops before execute', async () => {
  await refusedClaim('summary_stale', '["amount_cents"]');
});

const lostClaimRecord = {
  p_payment_id: 31,
  p_outcome: 'failure',
  p_outcome_code: 'not_submitted',
  p_transaction_reference: null,
  p_message: 'claim reply lost; worker not called',
};

test('a lost claim reply is recorded as not submitted and never reaches execute', async () => {
  const replies = [
    () => rpcError('fetch failed'),
    () => {
      throw new TypeError('fetch failed');
    },
  ];
  for (const start_payment_submission of replies) {
    const built = deps({}, { rpc: { start_payment_submission } });
    const result = await pay(built);
    assert.deepEqual(result.body, { error: 'payment_not_started' });
    assert.deepEqual(rpcNames(built), [
      'prepare_payment',
      'authorize_payment',
      'start_payment_submission',
      'record_payment',
      'cancel_payment',
    ]);
    assert.deepEqual(built.rpcCalls[3], { name: 'record_payment', args: lostClaimRecord, as: 'service' });
    assert.equal(executeCalls(built).length, 0);
  }
});

test('a claim that never committed is still cancelled after record_payment refuses', async () => {
  const built = deps(
    {},
    {
      rpc: {
        start_payment_submission: () => rpcError('fetch failed'),
        record_payment: () => rpcError('not_processing', 'authorized'),
      },
    },
  );
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'payment_not_started' });
  assert.deepEqual(built.rpcCalls[3].args, lostClaimRecord);
  assert.deepEqual(built.rpcCalls[4], {
    name: 'cancel_payment',
    args: { p_payment_id: 31, p_note: 'payment_not_started' },
    as: 'user',
  });
  assert.equal(executeCalls(built).length, 0);
});

test('an authorize error cancels the attempt and returns its code', async () => {
  const built = deps({}, { rpc: { authorize_payment: () => rpcError('not_pending', 'expired') } });
  assert.deepEqual((await pay(built)).body, { error: 'not_pending' });
  assert.deepEqual(rpcNames(built), ['prepare_payment', 'authorize_payment', 'cancel_payment']);
  assert.deepEqual(built.rpcCalls[2].args, { p_payment_id: 31, p_note: 'not_pending' });
});

test('an unexpected payment function error before the claim is payment_not_started', async () => {
  // bill-mcp echoes the prepared row, so authorize's summary_mismatch is a bill-mcp fault, not a changed bill.
  const mismatched = deps({}, { rpc: { authorize_payment: () => rpcError('summary_mismatch', '["payment_date"]') } });
  assert.deepEqual((await pay(mismatched)).body, { error: 'payment_not_started' });
  assert.deepEqual(rpcNames(mismatched), ['prepare_payment', 'authorize_payment', 'cancel_payment']);
  assert.equal(executeCalls(mismatched).length, 0);

  const prepare = deps({}, { rpc: { prepare_payment: () => rpcError('connection refused') } });
  assert.deepEqual((await pay(prepare)).body, { error: 'payment_not_started' });
  assert.deepEqual(rpcNames(prepare), ['prepare_payment']);

  const authorize = deps(
    {},
    {
      rpc: {
        authorize_payment: () => {
          throw new Error('socket hang up');
        },
      },
    },
  );
  assert.deepEqual((await pay(authorize)).body, { error: 'payment_not_started' });
  assert.deepEqual(rpcNames(authorize), ['prepare_payment', 'authorize_payment', 'cancel_payment']);
  assert.deepEqual(authorize.rpcCalls[2].args, { p_payment_id: 31, p_note: 'payment_not_started' });
  assert.equal(executeCalls(authorize).length, 0);
});

test('worker payment_mismatch records failure/payment_mismatch', async () => {
  const built = deps({}, { execute: workerError('payment_mismatch', 409) });
  let receipts = 0;
  built.deps.persistReceipt = async () => {
    receipts++;
    return { status: 'stored', path: 'payments/31/receipt.png' };
  };
  const result = await pay(built);
  assert.deepEqual(recorded(built), {
    p_payment_id: 31,
    p_outcome: 'failure',
    p_outcome_code: 'payment_mismatch',
    p_transaction_reference: null,
    p_message: null,
  });
  assert.deepEqual(result.body, {
    error: 'payment_failed',
    outcome_code: 'payment_mismatch',
    payment: attempt({ status: 'failure' }),
  });
  assert.equal(receipts, 0);
});

test('portal_error records failure/portal_error', async () => {
  const built = deps({}, { execute: workerError('portal_error', 502) });
  const result = await pay(built);
  assert.equal(recorded(built)?.p_outcome, 'failure');
  assert.equal(recorded(built)?.p_outcome_code, 'portal_error');
  assert.deepEqual(result.body, {
    error: 'payment_failed',
    outcome_code: 'portal_error',
    payment: attempt({ status: 'failure' }),
  });
});

test('idempotency_conflict records failure/not_submitted', async () => {
  const built = deps({}, { execute: workerError('idempotency_conflict', 409) });
  const result = await pay(built);
  assert.equal(recorded(built)?.p_outcome, 'failure');
  assert.equal(recorded(built)?.p_outcome_code, 'not_submitted');
  assert.deepEqual(result.body, {
    error: 'payment_failed',
    outcome_code: 'not_submitted',
    payment: attempt({ status: 'failure' }),
  });
});

test('invalid_request and unauthorized also record failure/not_submitted', async () => {
  for (const [code, status] of [['invalid_request', 400], ['unauthorized', 401]] as const) {
    const built = deps({}, { execute: workerError(code, status) });
    const result = await pay(built);
    assert.equal(recorded(built)?.p_outcome_code, 'not_submitted', code);
    assert.equal((result.body as { outcome_code: string }).outcome_code, 'not_submitted', code);
  }
});

const unknownRecord = (message: string | null) => ({
  p_payment_id: 31,
  p_outcome: 'unknown',
  p_outcome_code: 'outcome_unknown',
  p_transaction_reference: null,
  p_message: message,
});

test('worker outcome_unknown records unknown', async () => {
  const built = deps({}, { execute: workerError('outcome_unknown', 409) });
  const result = await pay(built);
  assert.deepEqual(recorded(built), unknownRecord(null));
  assert.deepEqual(result.body, { error: 'outcome_unknown', payment: attempt({ status: 'unknown' }) });
});

test('execution_in_progress, an unlisted code or an unreadable worker error records unknown', async () => {
  const replies = [
    workerError('execution_in_progress', 409),
    workerError('teapot', 418),
    () => new Response('Bad gateway', { status: 502 }),
  ];
  for (const execute of replies) {
    const built = deps({}, { execute });
    const result = await pay(built);
    assert.deepEqual(recorded(built), unknownRecord(null));
    assert.equal((result.body as { error: string }).error, 'outcome_unknown');
  }
});

// The timeout keeps a missing /execute signal from hanging the run.
test('a worker that never answers records unknown', { timeout: 5_000 }, async () => {
  const thrown = deps(
    {},
    {
      execute: () => {
        throw new TypeError('fetch failed');
      },
    },
  );
  const result = await pay(thrown);
  assert.deepEqual(recorded(thrown), unknownRecord('no response from the payment worker'));
  assert.deepEqual(result.body, { error: 'outcome_unknown', payment: attempt({ status: 'unknown' }) });

  const timedOut = deps(
    { executeTimeoutMs: 20 },
    {
      execute: (init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    },
  );
  const late = await pay(timedOut);
  assert.deepEqual(recorded(timedOut), unknownRecord('no response from the payment worker'));
  assert.equal((late.body as { error: string }).error, 'outcome_unknown');
});

test('a 2xx without confirmed or reference records unknown', async () => {
  const replies = [
    () => new Response('paid', { status: 200 }),
    () => Response.json({ confirmed: true }),
    () => Response.json({ transactionReference: 'TX-31' }),
    () => Response.json({ confirmed: true, transactionReference: '   ' }),
    () => Response.json({ confirmed: true, transactionReference: 'R'.repeat(256) }),
  ];
  for (const execute of replies) {
    const built = deps({}, { execute });
    let receipts = 0;
    built.deps.persistReceipt = async () => {
      receipts++;
      return { status: 'stored', path: 'payments/31/receipt.png' };
    };
    const result = await pay(built);
    assert.deepEqual(
      recorded(built),
      unknownRecord('worker confirmed without a usable transaction reference'),
    );
    assert.deepEqual(result.body, { error: 'outcome_unknown', payment: attempt({ status: 'unknown' }) });
    assert.equal(receipts, 0);
  }
});

test('the transaction reference is trimmed and may be 255 characters', async () => {
  const reference = 'R'.repeat(255);
  const built = deps(
    {},
    { execute: () => Response.json({ confirmed: true, transactionReference: `  ${reference} ` }) },
  );
  const result = await pay(built);
  assert.equal(recorded(built)?.p_outcome, 'success');
  assert.equal(recorded(built)?.p_transaction_reference, reference);
  assert.equal((result.body as { payment: { status: string } }).payment.status, 'success');
});

test('a failed record_payment call is reported as record_payment failed', async () => {
  const refused = deps({}, { rpc: { record_payment: () => rpcError('not_processing', 'expired', 'PT409') } });
  assert.deepEqual((await pay(refused)).body, { error: 'record_payment failed' });
  assert.equal(executeCalls(refused).length, 1);

  const thrown = deps(
    {},
    {
      rpc: {
        record_payment: () => {
          throw new Error('socket hang up');
        },
      },
    },
  );
  assert.deepEqual((await pay(thrown)).body, { error: 'record_payment failed' });
  assert.equal(rpcNames(thrown).at(-1), 'record_payment');
});

function recordCalls(built: ReturnType<typeof deps>) {
  return built.rpcCalls.filter((rpc) => rpc.name === 'record_payment');
}

const successRecord = {
  p_payment_id: 31,
  p_outcome: 'success',
  p_outcome_code: 'confirmed',
  p_transaction_reference: 'TX-31',
  p_message: null,
};

function sleeps() {
  const slept: number[] = [];
  return { slept, sleep: async (ms: number) => void slept.push(ms) };
}

test('a lost record_payment reply is tried again with the same arguments', async () => {
  const lost = [
    () => rpcError('TypeError: fetch failed', null, ''),
    () => {
      throw new TypeError('fetch failed');
    },
  ];
  for (const first of lost) {
    const { slept, sleep } = sleeps();
    let tries = 0;
    const built = deps(
      { sleep },
      {
        rpc: {
          record_payment: (args) =>
            ++tries === 1 ? first() : { data: attempt({ status: args.p_outcome }), error: null },
        },
      },
    );
    const result = await pay(built);
    assert.deepEqual(result.body, { payment: attempt({ status: 'success' }) });
    assert.deepEqual(
      recordCalls(built).map((rpc) => [rpc.args, rpc.as]),
      [[successRecord, 'service'], [successRecord, 'service']],
    );
    assert.deepEqual(slept, [250]);
  }
});

test('a record_payment refusal with an error code is not tried again', async () => {
  const { slept, sleep } = sleeps();
  const built = deps({ sleep }, { rpc: { record_payment: () => rpcError('not_processing', 'success', 'PT409') } });
  assert.deepEqual((await pay(built)).body, { error: 'record_payment failed' });
  assert.equal(recordCalls(built).length, 1);
  assert.deepEqual(slept, []);
});

test('three lost record_payment replies are record_payment failed', async () => {
  const { slept, sleep } = sleeps();
  const built = deps({ sleep }, { rpc: { record_payment: () => rpcError('TypeError: fetch failed', null, '') } });
  assert.deepEqual((await pay(built)).body, { error: 'record_payment failed' });
  assert.deepEqual(
    recordCalls(built).map((rpc) => rpc.args),
    [successRecord, successRecord, successRecord],
  );
  assert.deepEqual(slept, [250, 1_000]);
});

test('no record_payment retry starts after the payment deadline', async () => {
  const { slept, sleep } = sleeps();
  let clock = 0;
  const built = deps(
    { now: () => clock, sleep },
    {
      rpc: {
        record_payment: () => {
          clock = 125_000;
          return rpcError('TypeError: fetch failed', null, '');
        },
      },
    },
  );
  assert.deepEqual((await pay(built)).body, { error: 'record_payment failed' });
  assert.equal(recordCalls(built).length, 1);
  assert.deepEqual(slept, []);
});

// The delay of every AbortSignal.timeout made while run() is going.
async function timeouts(run: () => Promise<unknown>) {
  const original = AbortSignal.timeout;
  const delays: number[] = [];
  AbortSignal.timeout = (ms: number) => {
    delays.push(ms);
    return original.call(AbortSignal, ms);
  };
  try {
    await run();
  } finally {
    AbortSignal.timeout = original;
  }
  return delays;
}

test('observe gets at most 30 s and /execute only the time left of the 125 s budget', async () => {
  let clock = 0;
  const built = deps(
    { now: () => clock },
    {
      rpc: {
        start_payment_submission: () => {
          clock = 50_000;
          return { data: attempt({ status: 'processing' }), error: null };
        },
      },
    },
  );
  const delays = await timeouts(() => pay(built));
  assert.deepEqual(delays, [30_000, 75_000]);
  assert.equal(recorded(built)?.p_outcome, 'success');
});

test('an observe that never answers or throws is worker failed and prepares nothing', { timeout: 5_000 }, async () => {
  const hung = deps(
    { deadlineMs: 20 },
    {
      observe: (init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    },
  );
  assert.deepEqual((await pay(hung)).body, { error: 'worker failed' });
  assert.equal(hung.rpcCalls.length, 0);
  assert.equal(executeCalls(hung).length, 0);

  const thrown = deps(
    {},
    {
      observe: () => {
        throw new TypeError('fetch failed');
      },
    },
  );
  assert.deepEqual((await pay(thrown)).body, { error: 'worker failed' });
  assert.equal(thrown.rpcCalls.length, 0);
});

test('less than 70 s left before prepare_payment does not start the payment', async () => {
  let clock = 0;
  const late = deps({
    now: () => clock,
    callerUserId: async () => {
      clock = 55_001;
      return 7;
    },
  });
  assert.deepEqual((await pay(late)).body, { error: 'payment_not_started' });
  assert.deepEqual(late.steps, ['/api/bills/12', '/observe']);

  clock = 0;
  const onTime = deps({
    now: () => clock,
    callerUserId: async () => {
      clock = 55_000;
      return 7;
    },
  });
  const paid = await pay(onTime);
  assert.equal((paid.body as { payment: { status: string } }).payment.status, 'success');
});

test('observe_portal gives the worker at most 30 s and a thrown observe is worker failed', async () => {
  const observeCall = (built: ReturnType<typeof deps>) =>
    handleBillMcp(
      {
        httpMethod: 'POST',
        authorization: `Bearer ${TOKEN}`,
        userAuthorization: USER,
        body: { method: 'tools/call', params: { name: 'observe_portal', arguments: { bill_id: 12 } } },
      },
      built.deps,
    );
  const delays = await timeouts(() => observeCall(deps()));
  assert.deepEqual(delays, [30_000]);
  const thrown = deps(
    {},
    {
      observe: () => {
        throw new TypeError('fetch failed');
      },
    },
  );
  assert.deepEqual((await observeCall(thrown)).body, { error: 'worker failed' });
});

async function loggedErrors(run: () => Promise<unknown>) {
  const lines: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    lines.push(args.map(String).join(' '));
  };
  try {
    await run();
  } finally {
    console.error = original;
  }
  return lines.join('\n');
}

test('logged results name the codes but not the payment row', async () => {
  // A recorded row with references, as a reconciled attempt would carry them.
  const record = (args: Record<string, unknown>): RpcReply => ({
    data: attempt({ status: args.p_outcome, transaction_reference: 'TX-LOGGED-31', account_reference: 'ACCT-77' }),
    error: null,
  });
  const failed = deps({}, { execute: workerError('portal_error', 502), rpc: { record_payment: record } });
  const unknown = deps({}, { execute: workerError('outcome_unknown', 409), rpc: { record_payment: record } });
  const mismatched = deps();
  const logged = await loggedErrors(async () => {
    await pay(failed);
    await pay(unknown);
    await pay(mismatched, { ...shown, amount: '1.00' });
  });
  assert.match(logged, /\[bill-mcp\] 200 \{"error":"payment_failed","outcome_code":"portal_error"\}/);
  assert.match(logged, /\[bill-mcp\] 200 \{"error":"outcome_unknown"\}/);
  assert.match(logged, /\[bill-mcp\] 200 \{"error":"summary_mismatch","fields":\["amount"\]\}/);
  for (const secret of ['TX-LOGGED-31', 'ACCT-77', 'key-31']) {
    assert.equal(logged.includes(secret), false, secret);
  }
});

test('no caller profile is forbidden before preparing', async () => {
  const built = deps({ callerUserId: async () => null });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'forbidden' });
  assert.equal(built.rpcCalls.length, 0);
  assert.equal(executeCalls(built).length, 0);
});

test('an unset STAGEHAND_URL calls no worker and writes nothing', async () => {
  const built = deps({ stagehandUrl: undefined });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'worker not configured' });
  assert.deepEqual(built.steps, ['/api/bills/12']);
});

test('a portal page with a different amount does not call execute', async () => {
  const built = deps({}, { page: 'Invoice INV-1 total $1.00' });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'snapshot_mismatch', fields: ['amount'] });
  assert.equal(executeCalls(built).length, 0);
  assert.equal(built.rpcCalls.length, 0);
});

test('numeric strings for the amount and vendor count as the same snapshot', async () => {
  const built = deps();
  const result = await pay(built, { ...shown, amount: '40.50', vendor_id: '3' });
  assert.equal((result.body as { payment: { status: string } }).payment.status, 'success');
});

test('camelCase bill fields count as the same snapshot', async () => {
  const built = deps();
  const result = await pay(built, {
    billId: 12,
    amount: '40.50',
    vendorId: '3',
    invoiceNumber: 'INV-1',
    paymentMethodId: '5',
    fees: '0',
    currency: 'USD',
    paymentDate: '2026-11-18',
    idempotencyKey: 'pay-1',
  });
  assert.equal((result.body as { payment: { status: string } }).payment.status, 'success');
  assert.equal(JSON.parse(String(executeCalls(built)[0].init?.body)).idempotencyKey, 'key-31');
});

test('bill_id alone returns invalid arguments and calls nothing', async () => {
  const without = (key: string) => Object.fromEntries(Object.entries(shown).filter(([name]) => name !== key));
  const missing = [
    { bill_id: 12 },
    ...Object.keys(shown).map(without),
    { ...shown, amount: '40.555' },
    { ...shown, invoice_number: ' ' },
    { ...shown, payment_method_id: 0 },
    { ...shown, fees: -1 },
    { ...shown, fees: '0.001' },
    { ...shown, currency: 'usd' },
    { ...shown, currency: 'US' },
    { ...shown, payment_date: '2026-02-30' },
    { ...shown, payment_date: '11/18/2026' },
  ];
  for (const arguments_ of missing) {
    const built = deps();
    const result = await pay(built, arguments_);
    assert.deepEqual(result.body, { error: 'invalid arguments' }, JSON.stringify(arguments_));
    assert.equal(built.calls.length, 0);
    assert.equal(built.rpcCalls.length, 0);
  }
});

test('a portal page missing the invoice does not call execute', async () => {
  const built = deps({}, { page: 'Total $40.50' });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'snapshot_mismatch', fields: ['invoice_number'] });
  assert.equal(executeCalls(built).length, 0);
  assert.equal(built.rpcCalls.length, 0);
});

test('upload failure returns confirmed payment and retry tool never invokes execute or records payment', async () => {
  const built = deps();
  let receiptWrites = 0;
  built.deps.persistReceipt = async () => { receiptWrites++; throw new Error('offline'); };
  const request = { httpMethod: 'POST', authorization: `Bearer ${TOKEN}`, userAuthorization: USER,
    body: { method: 'tools/call', params: { name: 'execute_approved_payment', arguments: shown } } };
  const paid = await handleBillMcp(request, built.deps);
  assert.deepEqual(paid.body, {
    payment: attempt({ status: 'success' }),
    receipt: { status: 'failed', error: 'upload_failed' },
  });
  assert.equal(receiptWrites, 1);
  const rpcBefore = built.rpcCalls.length;
  const calls: string[] = [];
  built.deps.receiptPayment = async () => ({ billId: 12, bill_id: 12, payment_id: 9, status: 'success', amount: 40.5, vendorId: 3, invoiceNumber: 'INV-1', idempotencyKey: 'portal-12' });
  built.deps.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).endsWith('/api/bills/12')) return Response.json({ bill: { ...bill(), status: 'payment_success' } });
    if (String(url).endsWith('/receipt')) return Response.json({ receipt: { status: 'captured' } });
    throw new Error('Retry must not call execute or observe');
  };
  built.deps.persistReceipt = async () => ({ status: 'stored', path: 'payments/9/receipt.png' });
  const retried = await handleBillMcp({ ...request, body: { method: 'tools/call', params: { name: 'retry_payment_receipt', arguments: { bill_id: 12, payment_id: 9 } } } }, built.deps);
  assert.deepEqual(retried.body, { receipt: { status: 'stored', path: 'payments/9/receipt.png' } });
  assert.ok(calls.every(url => !url.endsWith('/execute')));
  assert.equal(built.rpcCalls.length, rpcBefore);
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

test('receipt retry rejects an unauthorized or mismatched payment before worker access', async () => {
  const built = deps();
  built.deps.receiptPayment = async () => null;
  built.deps.persistReceipt = async () => { throw new Error('Must not upload'); };
  const response = await handleBillMcp({ httpMethod: 'POST', authorization: `Bearer ${TOKEN}`, userAuthorization: USER,
    body: { method: 'tools/call', params: { name: 'retry_payment_receipt', arguments: { bill_id: 12, payment_id: 9 } } } }, built.deps);
  assert.deepEqual(response.body, { error: 'receipt not found' });
  assert.equal(built.calls.length, 1);
});

// The hourly sweep's service-client readers: bill 12 is pending_payment and user 21 approved it.
function sweepDeps(overrides: Partial<BillMcpDeps> = {}, script: Script = {}) {
  return deps(
    {
      pendingBillIds: async () => [12],
      serviceBill: async (billId) => ({ ...bill(), bill_id: billId }),
      latestApprover: async () => 21,
      now: () => Date.parse('2026-11-18T15:00:00Z'),
      ...overrides,
    },
    script,
  );
}

type SweepBody = { ok?: boolean; error?: string; deferred?: number[]; results?: { bill_id: number; outcome: Record<string, unknown> }[] };

async function sweep(built: ReturnType<typeof deps>) {
  const response = await handleBillMcp(
    {
      httpMethod: 'POST',
      authorization: `Bearer ${TOKEN}`,
      userAuthorization: '',
      body: { method: 'sweep_approved_payments' },
    },
    built.deps,
  );
  return response.body as SweepBody;
}

test('the hourly sweep pays a pending bill for its newest approver without a user session', async () => {
  const built = sweepDeps();
  const body = await sweep(built);
  assert.equal(body.ok, true);
  assert.deepEqual(body.deferred, []);
  assert.equal(body.results?.length, 1);
  assert.equal(body.results?.[0].bill_id, 12);
  assert.equal((body.results?.[0].outcome.payment as { status?: string }).status, 'success');
  assert.deepEqual(built.steps, ['/observe', 'prepare_payment', 'authorize_approved_payment', 'start_payment_submission',
    '/execute', 'record_payment']);
  assert.ok(built.rpcCalls.every((rpc) => rpc.as === 'service'));
  const prepare = built.rpcCalls[0].args;
  assert.equal(prepare.p_prepared_by, 21);
  assert.equal(prepare.p_payment_date, '2026-11-18');
  assert.equal(prepare.p_fees_cents, 0);
  assert.deepEqual(built.rpcCalls[1].args, { p_payment_id: 31 });
  assert.equal(recorded(built)?.p_transaction_reference, 'TX-31');
  assert.equal(built.calls.some((call) => call.url.includes('/api/')), false);
});

test('the hourly sweep refuses without its service-client readers and calls nothing', async () => {
  const built = deps();
  assert.deepEqual(await sweep(built), { error: 'automation not configured' });
  assert.equal(built.calls.length, 0);
  assert.equal(built.rpcCalls.length, 0);
});

test('the hourly sweep skips an unapproved bill and a bill that is not pending_payment', async () => {
  const built = sweepDeps({
    pendingBillIds: async () => [12, 14],
    serviceBill: async (billId) => ({ ...bill(), bill_id: billId, status: billId === 14 ? 'payment_failed' : 'pending_payment' }),
    latestApprover: async () => null,
  });
  const body = await sweep(built);
  assert.deepEqual(body.results?.map((row) => [row.bill_id, row.outcome.error]), [
    [12, 'not_approved'],
    [14, 'not_payable'],
  ]);
  assert.equal(built.calls.length, 0);
  assert.equal(built.rpcCalls.length, 0);
});

test('the hourly sweep does not prepare when the portal page lacks the invoice', async () => {
  const built = sweepDeps({}, { page: 'total $40.50' });
  const body = await sweep(built);
  assert.equal(body.results?.[0].outcome.error, 'snapshot_mismatch');
  assert.equal(built.rpcCalls.length, 0);
  assert.equal(executeCalls(built).length, 0);
});

test('a sweep attempt that differs from the bill is left pending and unpaid', async () => {
  const built = sweepDeps({}, {
    rpc: { prepare_payment: () => ({ data: attempt({ amount_cents: 4000, total_cents: 4000 }), error: null }) },
  });
  const body = await sweep(built);
  assert.deepEqual(body.results?.[0].outcome, { error: 'summary_mismatch', fields: ['amount', 'total'] });
  // cancel_payment needs a signed-in user; the next prepare_payment expires the attempt.
  assert.deepEqual(rpcNames(built), ['prepare_payment']);
  assert.equal(executeCalls(built).length, 0);
});

test('authorize_approved_payment refusing stops a sweep payment before the claim', async () => {
  const built = sweepDeps({}, {
    rpc: { authorize_approved_payment: () => rpcError('not_approved', null, 'PT409') },
  });
  const body = await sweep(built);
  assert.deepEqual(body.results?.[0].outcome, { error: 'not_approved' });
  assert.deepEqual(rpcNames(built), ['prepare_payment', 'authorize_approved_payment']);
  assert.equal(executeCalls(built).length, 0);
});

test('the hourly sweep defers bills that no longer fit its payment budget', async () => {
  let clock = Date.parse('2026-11-18T15:00:00Z');
  const built = sweepDeps(
    { pendingBillIds: async () => [12, 14], now: () => clock },
    {
      execute: () => {
        clock += 60_000;
        return Response.json({ confirmed: true, transactionReference: 'TX-31' });
      },
    },
  );
  const body = await sweep(built);
  assert.deepEqual(body.results?.map((row) => row.bill_id), [12]);
  assert.deepEqual(body.deferred, [14]);
  assert.equal(executeCalls(built).length, 1);
});

// DC-92: the vendor policy check.
const POLICY = { policy_id: 4, version_id: 9, version: 2, rule_index: 0, policy_name: 'Power', interpretation: 'Pay under $500 only' };
const blockDecision = { decision: 'block', ...POLICY };
const approvalDecision = { decision: 'require_approval', ...POLICY };
const evaluates = (decision: Record<string, unknown>) => () => ({ data: decision, error: null }) as RpcReply;
const refusal = (message: string, decision: Record<string, unknown>) => () => rpcError(message, JSON.stringify(decision), 'PT409');

test('policy block stops before the portal and prepare', async () => {
  const built = deps({}, { rpc: { evaluate_bill_policy: evaluates(blockDecision) } });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'policy_blocked', policy: blockDecision });
  assert.deepEqual(rpcNames(built), ['evaluate_bill_policy']);
  assert.deepEqual(built.rpcCalls[0].args, { p_bill_id: 12 });
  assert.equal(built.rpcCalls[0].as, 'service');
  assert.equal(built.calls.some((c) => c.url.endsWith('/observe') || c.url.endsWith('/execute')), false);
});

test('policy require_approval sends the bill back before the portal', async () => {
  const built = deps({}, { rpc: { evaluate_bill_policy: evaluates(approvalDecision), send_bill_for_approval: evaluates(approvalDecision) } });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'sent_for_approval', policy: approvalDecision });
  assert.deepEqual(rpcNames(built), ['evaluate_bill_policy', 'send_bill_for_approval']);
  assert.deepEqual(built.rpcCalls[1].args, { p_bill_id: 12, p_requested_by: 7 });
  assert.equal(built.rpcCalls[1].as, 'service');
  assert.equal(built.calls.some((c) => c.url.endsWith('/observe')), false);
});

test('send-back answering approval_not_required continues the payment', async () => {
  const built = deps({}, {
    rpc: {
      evaluate_bill_policy: evaluates(approvalDecision),
      send_bill_for_approval: refusal('approval_not_required', approvalDecision),
    },
  });
  const result = await pay(built);
  assert.equal((result.body as { error?: string }).error, undefined);
  assert.deepEqual(rpcNames(built).slice(0, 3), ['evaluate_bill_policy', 'send_bill_for_approval', 'prepare_payment']);
  assert.equal(executeCalls(built).length, 1);
});

test('prepare_payment policy_blocked passes through', async () => {
  const built = deps({}, { rpc: { prepare_payment: refusal('policy_blocked', blockDecision) } });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'policy_blocked', policy: blockDecision });
  assert.equal(executeCalls(built).length, 0);
});

test('prepare_payment approval_required sends the bill back', async () => {
  const built = deps({}, {
    rpc: { prepare_payment: refusal('approval_required', approvalDecision), send_bill_for_approval: evaluates(approvalDecision) },
  });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'sent_for_approval', policy: approvalDecision });
  assert.equal(rpcNames(built).includes('send_bill_for_approval'), true);
  assert.equal(executeCalls(built).length, 0);
});

test('prepare_payment does not receive caller-made policy refs', async () => {
  const built = deps();
  await pay(built);
  const prepare = built.rpcCalls.find((r) => r.name === 'prepare_payment');
  assert.equal('p_policy_refs' in (prepare?.args ?? {}), false);
});

test('start_payment_submission policy_changed cancels and returns policy_changed', async () => {
  const built = deps({}, { rpc: { start_payment_submission: refusal('policy_changed', approvalDecision) } });
  const result = await pay(built);
  assert.equal((result.body as { error: string }).error, 'policy_changed');
  assert.equal(rpcNames(built).includes('cancel_payment'), true);
  assert.equal(executeCalls(built).length, 0);
});

test('start_payment_submission policy_blocked cancels and returns policy_blocked', async () => {
  const built = deps({}, { rpc: { start_payment_submission: refusal('policy_blocked', blockDecision) } });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'policy_blocked', policy: blockDecision });
  assert.equal(rpcNames(built).includes('cancel_payment'), true);
  assert.equal(executeCalls(built).length, 0);
});

test('start_payment_submission approval_required cancels and sends the bill back', async () => {
  const built = deps({}, {
    rpc: { start_payment_submission: refusal('approval_required', approvalDecision), send_bill_for_approval: evaluates(approvalDecision) },
  });
  const result = await pay(built);
  assert.deepEqual(result.body, { error: 'sent_for_approval', policy: approvalDecision });
  const names = rpcNames(built);
  assert.equal(names.includes('cancel_payment'), true);
  assert.equal(names.includes('send_bill_for_approval'), true);
  assert.equal(executeCalls(built).length, 0);
});
