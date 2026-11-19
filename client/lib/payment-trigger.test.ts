import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canShowPaymentTrigger,
  paymentReceiptDetails,
  paymentTriggerNotice,
} from './payment-trigger.ts';

test('the trigger is visible only after the system-admin role is known', () => {
  assert.equal(canShowPaymentTrigger('system_admin'), true);
  for (const role of [null, undefined, 'viewer', 'billing_operator', 'financial_approver'])
    assert.equal(canShowPaymentTrigger(role), false);
});

test('result notices keep success, failure and uncertain outcomes distinct', () => {
  assert.deepEqual(paymentTriggerNotice({ outcome: 'success', message: 'Payment completed.' }), {
    tone: 'success',
    message: 'Payment completed.',
  });
  assert.deepEqual(
    paymentTriggerNotice({ outcome: 'unknown', message: 'Do not retry this payment.' }),
    { tone: 'warning', message: 'Do not retry this payment.' },
  );
  assert.deepEqual(paymentTriggerNotice({ outcome: 'failed', message: 'Payment failed.' }), {
    tone: 'error',
    message: 'Payment failed.',
  });
});

test('receipt details are available only for a successful payment with a valid id', () => {
  assert.deepEqual(
    paymentReceiptDetails({
      outcome: 'success',
      message: 'Payment completed.',
      paymentId: 9,
      receiptStatus: 'stored',
    }),
    { paymentId: 9, status: 'stored' },
  );
  assert.equal(
    paymentReceiptDetails({ outcome: 'success', message: 'Paid.', receiptStatus: 'stored' }),
    null,
  );
  assert.equal(
    paymentReceiptDetails({
      outcome: 'failed',
      message: 'Failed.',
      paymentId: 9,
      receiptStatus: 'stored',
    }),
    null,
  );
});
