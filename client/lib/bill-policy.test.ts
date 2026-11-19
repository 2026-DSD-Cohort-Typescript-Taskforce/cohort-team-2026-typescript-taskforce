import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  blockedMessage,
  decisionLabel,
  forcedApprovalMessage,
  parsePolicyDecision,
  sentBackMessage,
  type PolicyDecision,
} from './bill-policy.ts';

const base: PolicyDecision = {
  decision: 'block',
  policy_id: 3,
  version_id: 9,
  version: 2,
  rule_index: 0,
  policy_name: 'Acme',
  interpretation: 'Bills over $500 are blocked',
};

test('parsePolicyDecision reads an object and a JSON string', () => {
  assert.deepEqual(parsePolicyDecision(base), base);
  assert.deepEqual(parsePolicyDecision(JSON.stringify(base)), base);
});

test('parsePolicyDecision accepts nulls on a none decision', () => {
  const none = {
    decision: 'none',
    policy_id: null,
    version_id: null,
    version: null,
    rule_index: null,
    policy_name: null,
    interpretation: null,
  };
  assert.deepEqual(parsePolicyDecision(none), none);
});

test('parsePolicyDecision rejects bad shapes', () => {
  for (const raw of [
    null,
    undefined,
    '',
    'not json',
    '[]',
    42,
    {},
    { ...base, decision: 'maybe' },
    { ...base, policy_id: '3' },
    { ...base, version: 1.5 },
    { ...base, policy_name: 7 },
    { ...base, interpretation: {} },
    { decision: 'allow' },
  ]) {
    assert.equal(parsePolicyDecision(raw), null, JSON.stringify(raw));
  }
});

test('blockedMessage', () => {
  assert.equal(blockedMessage(base), 'Blocked by the Acme policy: Bills over $500 are blocked');
  assert.equal(
    blockedMessage({ ...base, policy_name: null, interpretation: null }),
    "Blocked by this vendor's policy.",
  );
  assert.equal(blockedMessage({ ...base, interpretation: null }), 'Blocked by the Acme policy.');
  assert.ok(!blockedMessage({ ...base, policy_name: null }).includes('null'));
});

test('forcedApprovalMessage', () => {
  assert.equal(
    forcedApprovalMessage({ ...base, decision: 'require_approval' }),
    'Bill sent for approval: the Acme policy needs approval.',
  );
  assert.equal(
    forcedApprovalMessage({ ...base, decision: 'require_approval', policy_name: null }),
    "Bill sent for approval: this vendor's policy needs approval.",
  );
});

test('sentBackMessage', () => {
  assert.equal(
    sentBackMessage(base),
    'Sent for approval: the Acme policy needs approval from someone other than the submitter.',
  );
  assert.equal(
    sentBackMessage({ ...base, policy_name: null }),
    "Sent for approval: this vendor's policy needs approval from someone other than the submitter.",
  );
});

test('decisionLabel', () => {
  assert.equal(decisionLabel(base), 'Blocks this bill');
  assert.equal(decisionLabel({ ...base, decision: 'require_approval' }), 'Needs approval');
  assert.equal(decisionLabel({ ...base, decision: 'allow' }), 'Allows this bill');
  assert.equal(decisionLabel({ ...base, decision: 'none' }), 'No rule applies');
  assert.equal(decisionLabel({ ...base, policy_id: null }), null);
});
