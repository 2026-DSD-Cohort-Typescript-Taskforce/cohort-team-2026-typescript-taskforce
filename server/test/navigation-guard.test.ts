import assert from 'node:assert/strict';
import { test } from 'node:test';
import { observeMutationBlocked } from '../src/payments/navigation-guard';

const portal = ['https://copper-ridge-utility-demo.vercel.app'];

test('observation can sign in on the opened portal and still blocks payment posts', () => {
  assert.equal(
    observeMutationBlocked('POST', 'https://copper-ridge-utility-demo.vercel.app/api/login', portal),
    false,
  );
  assert.equal(
    observeMutationBlocked('POST', 'https://copper-ridge-utility-demo.vercel.app/api/payments', portal),
    true,
  );
  assert.equal(observeMutationBlocked('POST', 'https://portal.example/submit', portal), true);
  assert.equal(observeMutationBlocked('GET', 'https://copper-ridge-utility-demo.vercel.app/api/account', portal), false);
});
