import assert from 'node:assert/strict';
import test from 'node:test';
import { runPaymentTrigger } from './payment-trigger-service.ts';

test('only system admins can reach bill-mcp', async () => {
  for (const role of [null, 'viewer', 'billing_operator', 'financial_approver']) {
    let calls = 0;
    const reply = await runPaymentTrigger({
      billId: 12,
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
  const calls: number[] = [];
  const reply = await runPaymentTrigger({
    billId: 12,
    role: 'system_admin',
    invoke: async (billId) => {
      calls.push(billId);
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
  assert.deepEqual(calls, [12]);
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
    role: 'system_admin',
    invoke: async () => ({ ok: true, status: 200, body: { error: 'outcome_unknown' } }),
  });
  assert.equal(reply.status, 409);
  assert.equal(reply.body.outcome, 'unknown');
  assert.equal(reply.body.code, 'outcome_unknown');
  assert.match(reply.body.message, /do not retry/i);
});

test('eligibility and worker failures are mapped without exposing upstream text', async () => {
  const cases = [
    ['not_pending_payment', 409, 'ineligible'],
    ['not_approved', 409, 'ineligible'],
    ['snapshot_mismatch', 409, 'ineligible'],
    ['no portal url', 409, 'ineligible'],
    ['worker not configured', 503, 'failed'],
    ['worker failed', 502, 'failed'],
    ['record_payment failed', 409, 'unknown'],
  ] as const;
  const reasons: Record<string, string> = {
    not_pending_payment: 'not pending payment',
    not_approved: 'not approved',
    snapshot_mismatch: 'invoice number or the amount',
    'no portal url': 'no payment portal URL',
  };
  for (const [error, status, outcome] of cases) {
    const reply = await runPaymentTrigger({
      billId: 12,
      role: 'system_admin',
      invoke: async () => ({
        ok: true,
        status: 200,
        body: { error, fields: ['invoice_number', 'amount'], secret: 'hidden' },
      }),
    });
    assert.equal(reply.status, status, error);
    assert.equal(reply.body.outcome, outcome, error);
    if (reasons[error]) assert.match(reply.body.message, new RegExp(reasons[error], 'i'));
    assert.equal(JSON.stringify(reply.body).includes('hidden'), false);
  }
});

test('a lost bill-mcp response is uncertain because payment may have been submitted', async () => {
  const reply = await runPaymentTrigger({
    billId: 12,
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
    role: 'system_admin',
    invoke: async () => {
      throw new Error('must not run');
    },
  });
  assert.equal(invalid.status, 404);

  const unavailable = await runPaymentTrigger({
    billId: 12,
    role: 'system_admin',
    invoke: async () => ({ ok: false, status: 401, body: { error: 'secret text' } }),
  });
  assert.equal(unavailable.status, 502);
  assert.equal(JSON.stringify(unavailable.body).includes('secret text'), false);
});
