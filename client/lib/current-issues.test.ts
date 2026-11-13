import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Bill } from './bill-view.ts';
import { UNREADABLE, currentIssues } from './current-issues.ts';

const complete: Bill = {
  bill_id: 1,
  status: 'draft',
  invoice_number: 'INV-1',
  amount: 10,
  date_due: '2026-12-01',
  date_issued: null,
  date_received: '2026-11-01T00:00:00+00:00',
  vendor_id: 1,
  property_id: 2,
  payment_id: 3,
  vendor: { name: 'Summit Trail' },
  property: { name: 'My Business' },
  payment: null,
};

test('lists drafts missing details, saying what is missing', () => {
  const issues = currentIssues([
    { ...complete, bill_id: 2, payment_id: null, date_due: null },
    complete,
    { ...complete, bill_id: 3, status: 'pending_payment' },
  ]);
  assert.deepEqual(issues, [
    {
      billId: 2,
      title: 'Bill Vendor Summit Trail',
      message: 'Missing payment type and due date.',
      severity: 'warning',
    },
  ]);
});

test('a draft with no details at all could not be read', () => {
  const blank: Bill = {
    ...complete,
    vendor_id: null,
    property_id: null,
    payment_id: null,
    invoice_number: null,
    amount: null,
    date_due: null,
    vendor: null,
  };
  const [issue] = currentIssues([blank]);
  assert.equal(issue.message, UNREADABLE);
  assert.equal(issue.title, 'Bill Vendor unknown');
  assert.equal(issue.severity, 'error');
});
