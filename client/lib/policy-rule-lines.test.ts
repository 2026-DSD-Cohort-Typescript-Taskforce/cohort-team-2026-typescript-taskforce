import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ruleLines } from './policy-rule-lines.ts';
import type { PolicyRuleV1 } from './policy-rule.ts';

const props = [
  { property_id: 3, name: 'Maple Court' },
  { property_id: 4, name: 'Oak Row' },
];
const one = (effect: PolicyRuleV1['rules'][number]['effect'], when: object): PolicyRuleV1 => ({
  schema_version: 1,
  vendor_id: 12,
  rules: [{ effect, when }],
});

test('ADR complete example', () => {
  const rule = one('require_approval', {
    amount_cents: { gt: 50000 },
    except_property_ids: [3],
  });
  assert.deepEqual(ruleLines(rule, props), [
    'Need approval · over $500.00 · every property except Maple Court · any payment method',
  ]);
});

test('empty conditions', () => {
  assert.deepEqual(ruleLines(one('block', {}), props), [
    'Block · any amount · every property · any payment method',
  ]);
});

test('range, property and payment type', () => {
  const rule = one('allow', {
    amount_cents: { gte: 10000, lte: 50000 },
    property_ids: [3],
    payment_types: ['bank'],
  });
  assert.deepEqual(ruleLines(rule, props), [
    'Allow · $100.00 to $500.00 · Maple Court · bank only',
  ]);
});

test('amount words', () => {
  const amount = (a: object) => ruleLines(one('block', { amount_cents: a }), props)[0];
  assert.match(amount({ gte: 100000 }), /^Block · \$1,000\.00 or more · /);
  assert.match(amount({ lt: 2500 }), /^Block · under \$25\.00 · /);
  assert.match(amount({ lte: 2505 }), /^Block · \$25\.05 or less · /);
  assert.match(amount({ gt: 100, lt: 900 }), /^Block · over \$1\.00 and under \$9\.00 · /);
  assert.match(amount({ gte: 100, lt: 900 }), /^Block · \$1\.00 or more and under \$9\.00 · /);
  assert.match(amount({ gt: 100, lte: 900 }), /^Block · over \$1\.00 and \$9\.00 or less · /);
});

test('unknown property, several properties, several payment types, several rules', () => {
  assert.match(
    ruleLines(one('block', { property_ids: [9, 4] }), props)[0],
    / · property 9, Oak Row · /,
  );
  assert.match(
    ruleLines(one('block', { payment_types: ['card', 'bank'] }), props)[0],
    / · card or bank only$/,
  );
  const rule: PolicyRuleV1 = {
    schema_version: 1,
    vendor_id: 12,
    rules: [
      { effect: 'block', when: {} },
      { effect: 'allow', when: {} },
    ],
  };
  assert.equal(ruleLines(rule, props).length, 2);
});
