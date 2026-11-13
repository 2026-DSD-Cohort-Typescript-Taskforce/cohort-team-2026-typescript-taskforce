import assert from 'node:assert/strict';
import { test } from 'node:test';
import { noticeFor } from './extraction.ts';

test('duplicates and review flags are warnings that link the existing bill', () => {
  const bill = { bill_id: 4, status: 'pending_payment' };
  assert.deepEqual(
    noticeFor({ outcome: 'needs_review', message: 'Kept the original.', bill }, 'a.pdf'),
    { title: 'a.pdf', message: 'Kept the original.', severity: 'warning', billId: 4 },
  );
});

test('rejected and failed are errors', () => {
  assert.equal(noticeFor({ outcome: 'failed', message: 'x' }, 'a.pdf')?.severity, 'error');
  assert.equal(noticeFor({ outcome: 'rejected', message: 'x' }, 'a.pdf')?.severity, 'error');
});

test('submitted, draft and confirm_replace leave no notice', () => {
  for (const outcome of ['submitted', 'draft', 'confirm_replace'] as const) {
    assert.equal(noticeFor({ outcome, message: 'x' }, 'a.pdf'), null);
  }
});
