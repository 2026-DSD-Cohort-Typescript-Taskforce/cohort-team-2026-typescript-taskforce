import assert from 'node:assert/strict';
import test from 'node:test';
import {
  demoInvoice,
  demoBank,
  validateDemoBank,
  createDemoReceipt,
  restoreDemoReceipt,
} from './demo-payment.ts';

test('only the synthetic bank fixture is accepted', () => {
  assert.equal(validateDemoBank(demoBank.routingNumber, demoBank.accountNumber), true);
  assert.equal(validateDemoBank('123456789', demoBank.accountNumber), false);
  assert.equal(validateDemoBank(demoBank.routingNumber, '123'), false);
});

test('receipt preserves fixed invoice, total and reference across reloads', () => {
  const receipt = createDemoReceipt('2026-11-16T12:00:00.000Z');
  assert.equal(receipt.invoiceNumber, demoInvoice.invoiceNumber);
  assert.equal(receipt.amountMinor, 12500);
  assert.deepEqual(restoreDemoReceipt(JSON.stringify(receipt)), receipt);
  assert.equal(createDemoReceipt(receipt.paidAt).reference, receipt.reference);
});

test('malformed, mismatched or arbitrary stored receipts are ignored', () => {
  const receipt = createDemoReceipt('2026-11-16T12:00:00.000Z');
  for (const raw of [
    null,
    '{',
    'null',
    '[]',
    JSON.stringify({ ...receipt, amountMinor: 1 }),
    JSON.stringify({ ...receipt, invoiceNumber: 'OTHER' }),
    JSON.stringify({ ...receipt, reference: 'FAKE' }),
    JSON.stringify({ ...receipt, paidAt: 'invalid' }),
  ]) {
    assert.equal(restoreDemoReceipt(raw), null);
  }
});
