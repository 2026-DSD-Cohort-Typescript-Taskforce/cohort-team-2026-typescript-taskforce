import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canShowPaymentTrigger,
  localDate,
  paymentSummary,
  paymentTriggerNotice,
  type PaymentTriggerBill,
} from './payment-trigger.ts';

const bill: PaymentTriggerBill = {
  bill_id: 12,
  status: 'pending_payment',
  invoice_number: 'INV-1',
  amount: 40.5,
  vendor_id: 3,
  vendor: { name: 'Power Co' },
  payment_method_id: 5,
  payment: { payment_type: 'card', name: 'Ops Visa' },
};

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

test('the dialog lists every value bill-mcp authorizes and sends the same values', () => {
  const { rows, shown } = paymentSummary(bill, '2026-11-18');
  assert.deepEqual(rows, [
    ['Vendor', 'Power Co'],
    ['Invoice', 'INV-1'],
    ['Payment method', 'Ops Visa'],
    ['Amount', '$40.50'],
    ['Fees', '$0.00'],
    ['Total', '$40.50'],
    ['Currency', 'USD'],
    ['Payment date', 'Nov 18, 2026'],
  ]);
  assert.deepEqual(shown, {
    vendor_id: 3,
    invoice_number: 'INV-1',
    payment_method_id: 5,
    amount: 40.5,
    fees: 0,
    currency: 'USD',
    payment_date: '2026-11-18',
  });
  assert.equal(
    paymentSummary({ ...bill, status: 'payment_failed' }, '2026-11-18').shown?.amount,
    40.5,
  );
});

test('a bill that is not payable or misses a shown value sends nothing', () => {
  for (const changed of [
    { status: 'processing' },
    { vendor_id: null },
    { vendor: null },
    { invoice_number: null },
    { payment_method_id: null },
    { payment: null },
    { amount: null },
  ]) {
    assert.equal(
      paymentSummary({ ...bill, ...changed }, '2026-11-18').shown,
      null,
      JSON.stringify(changed),
    );
  }
  const { rows } = paymentSummary({ ...bill, payment: null, amount: null }, '2026-11-18');
  assert.deepEqual(rows[2], ['Payment method', 'Missing']);
  assert.deepEqual(rows[5], ['Total', 'No amount']);
});

test('the payment date is the local calendar day', () => {
  assert.equal(localDate(new Date(2026, 10, 18, 23, 30)), '2026-11-18');
  assert.equal(localDate(new Date(2026, 0, 5, 0, 5)), '2026-01-05');
});
