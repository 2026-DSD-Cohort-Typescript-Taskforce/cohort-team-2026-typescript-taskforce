import assert from 'node:assert/strict';
import test from 'node:test';
import { runPaymentTrigger, type ShownPayment } from './payment-trigger-service.ts';

const shown: ShownPayment = { vendor_id: 3, invoice_number: 'INV-1', amount: 40.5 };

test('only system admins can reach bill-mcp', async () => {
  for (const role of [null, 'viewer', 'billing_operator', 'financial_approver']) {
    let calls = 0;
    const reply = await runPaymentTrigger({
      billId: 12,
      shown,
      role,
      invoke: async () => {
        calls += 1;
        return { ok: true, status: 200, body: { payment: { payment_id: 9 } } };
      },
    });
    assert.equal(reply.status, 403);
    assert.equal(reply.body.code, 'forbidden');
    assert.equal(calls, 0);
  }
});

test('system admin invokes the existing bill-mcp payment tool once', async () => {
  const calls: [number, ShownPayment][] = [];
  const reply = await runPaymentTrigger({
    billId: 12,
    shown,
    role: 'system_admin',
    invoke: async (billId, sent) => {
      calls.push([billId, sent]);
      return {
        ok: true,
        status: 200,
        body: {
          payment: { payment_id: 9, bill_id: 12, status: 'success' },
          receipt: { status: 'stored' },
        },
      };
    },
  });
  assert.deepEqual(calls, [[12, shown]]);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, {
    outcome: 'success',
    message: 'Payment completed.',
    payment: { payment_id: 9, bill_id: 12, status: 'success' },
    receipt: { status: 'stored' },
  });
});

test('success requires a successful payment row for the requested bill', async () => {
  for (const payment of [
    { payment_id: 9, bill_id: 99, status: 'success' },
    { payment_id: 9, bill_id: 12, status: 'failure' },
    { payment_id: 9, status: 'success' },
  ]) {
    const reply = await runPaymentTrigger({
      billId: 12,
      shown,
      role: 'system_admin',
      invoke: async () => ({ ok: true, status: 200, body: { payment } }),
    });
    assert.equal(reply.status, 502);
    assert.equal(reply.body.outcome, 'failed');
  }
});

test('outcome_unknown is distinct and tells the admin not to retry', async () => {
  const reply = await runPaymentTrigger({
    billId: 12,
    shown,
    role: 'system_admin',
    invoke: async () => ({ ok: true, status: 200, body: { error: 'outcome_unknown' } }),
  });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.outcome, 'unknown');
  assert.equal(reply.body.code, 'outcome_unknown');
  assert.match(reply.body.message, /do not retry/i);
});

const ineligible = 'This bill is not eligible for automated payment.';
const changed = 'The bill changed. Reload it and check the details before paying.';
const notStarted = 'The payment did not start. Try again.';
const uncertainMessage = 'The payment outcome is uncertain. Do not retry; reconcile it first.';

test('bill-mcp result codes map to safe replies without exposing upstream text', async () => {
  const cases: [string | number, number, string | undefined, string | undefined, string][] = [
    ['outcome_unknown', 409, 'unknown', 'outcome_unknown', uncertainMessage],
    ['record_payment failed', 409, 'unknown', 'outcome_unknown', uncertainMessage],
    ['payment_in_progress', 409, 'unknown', 'outcome_unknown', uncertainMessage],
    [
      'payment_failed',
      502,
      'failed',
      'payment_failed',
      'The portal did not take the payment. The bill is marked payment failed.',
    ],
    ['not_payable', 409, 'ineligible', 'not_payable', ineligible],
    ['snapshot_mismatch', 409, 'ineligible', 'snapshot_mismatch', ineligible],
    ['no portal url', 409, 'ineligible', 'no portal url', ineligible],
    ['already_paid', 409, 'ineligible', 'already_paid', ineligible],
    ['summary_mismatch', 409, 'ineligible', 'summary_mismatch', changed],
    ['summary_stale', 409, 'ineligible', 'summary_stale', changed],
    ['authorization_expired', 409, 'failed', 'authorization_expired', notStarted],
    ['not_authorized', 409, 'failed', 'not_authorized', notStarted],
    ['forbidden', 403, undefined, 'forbidden', 'Only system administrators can run a payment.'],
    [
      'worker not configured',
      503,
      'failed',
      'payment_service_unavailable',
      'Payment automation is not configured.',
    ],
    [
      'worker failed',
      502,
      'failed',
      'payment_failed',
      'The automated payment could not be completed.',
    ],
    ['not_found', 502, 'failed', 'payment_failed', 'The automated payment could not be completed.'],
    [
      'invalid arguments',
      502,
      'failed',
      'payment_failed',
      'The automated payment could not be completed.',
    ],
    [401, 502, 'failed', 'payment_failed', 'The automated payment could not be completed.'],
  ];
  for (const [error, status, outcome, code, message] of cases) {
    const reply = await runPaymentTrigger({
      billId: 12,
      role: 'system_admin',
      shown,
      invoke: async () => ({
        ok: true,
        status: 200,
        body: {
          error,
          secret: 'hidden',
          payment: { payment_id: 9, bill_id: 12, status: 'failure' },
        },
      }),
    });
    assert.equal(reply.status, status, String(error));
    assert.equal(reply.body.outcome, outcome, String(error));
    assert.equal(reply.body.code, code, String(error));
    assert.equal(reply.body.message, message, String(error));
    assert.equal(reply.body.payment, undefined, String(error));
    assert.equal(JSON.stringify(reply.body).includes('hidden'), false);
  }
});

test('missing or malformed shown values are refused before bill-mcp', async () => {
  const bad: unknown[] = [
    null,
    undefined,
    'text',
    [],
    {},
    { ...shown, vendor_id: 0 },
    { ...shown, vendor_id: 1.5 },
    { ...shown, vendor_id: '3' },
    { ...shown, invoice_number: '   ' },
    { ...shown, invoice_number: 5 },
    { ...shown, invoice_number: 'x'.repeat(256) },
    { ...shown, amount: 0 },
    { ...shown, amount: -1 },
    { ...shown, amount: Number.NaN },
    { ...shown, amount: Infinity },
    { ...shown, amount: '12.345' },
    { ...shown, amount: '-4' },
    { ...shown, amount: '' },
    { ...shown, amount: null },
    { vendor_id: 3, invoice_number: 'INV-1' },
  ];
  for (const value of bad) {
    let calls = 0;
    const reply = await runPaymentTrigger({
      billId: 12,
      role: 'system_admin',
      shown: value,
      invoke: async () => {
        calls += 1;
        return { ok: true, status: 200, body: {} };
      },
    });
    assert.equal(reply.status, 400, JSON.stringify(value));
    assert.deepEqual(reply.body, {
      code: 'invalid_request',
      message: 'Send the vendor, invoice and amount you confirmed.',
    });
    assert.equal(calls, 0);
  }
});

test('string amounts and a 255-character invoice are accepted', async () => {
  for (const sent of [
    { vendor_id: 3, invoice_number: 'x'.repeat(255), amount: '40.50' },
    { vendor_id: 3, invoice_number: 'INV-1', amount: '40' },
  ]) {
    let got: ShownPayment | null = null;
    const reply = await runPaymentTrigger({
      billId: 12,
      role: 'system_admin',
      shown: sent,
      invoke: async (_id, s) => {
        got = s;
        return { ok: true, status: 200, body: { error: 'worker failed' } };
      },
    });
    assert.equal(reply.status, 502);
    assert.deepEqual(got, sent);
  }
});

test('a lost bill-mcp response is uncertain because payment may have been submitted', async () => {
  const reply = await runPaymentTrigger({
    billId: 12,
    shown,
    role: 'system_admin',
    invoke: async () => {
      throw new DOMException('timed out', 'TimeoutError');
    },
  });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.outcome, 'unknown');
  assert.match(reply.body.message, /do not retry/i);
});

test('invalid ids and unavailable bill-mcp fail before or without a payment result', async () => {
  const invalid = await runPaymentTrigger({
    billId: null,
    shown,
    role: 'system_admin',
    invoke: async () => {
      throw new Error('must not run');
    },
  });
  assert.equal(invalid.status, 404);

  for (const status of [401, 400]) {
    const unavailable = await runPaymentTrigger({
      billId: 12,
      shown,
      role: 'system_admin',
      invoke: async () => ({ ok: false, status, body: { error: 'secret text' } }),
    });
    assert.equal(unavailable.status, 502, String(status));
    assert.equal(unavailable.body.outcome, 'failed', String(status));
    assert.equal(unavailable.body.code, 'payment_service_unavailable', String(status));
    assert.equal(JSON.stringify(unavailable.body).includes('secret text'), false);
  }
});

test('a bill-mcp 5xx is uncertain because it may have stopped after the portal charged', async () => {
  const replies: [number, Record<string, unknown> | null][] = [
    [500, { error: 'secret text' }],
    [546, null],
  ];
  for (const [status, body] of replies) {
    const reply = await runPaymentTrigger({
      billId: 12,
      shown,
      role: 'system_admin',
      invoke: async () => ({ ok: false, status, body }),
    });
    assert.equal(reply.status, 409, String(status));
    assert.deepEqual(
      reply.body,
      { outcome: 'unknown', code: 'outcome_unknown', message: uncertainMessage },
      String(status),
    );
  }
});
