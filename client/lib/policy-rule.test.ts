import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DRAFT_STATUSES,
  GENERIC_NOT_COVERED,
  MODEL_OUTPUT_JSON_SCHEMA,
  NO_RULE_QUESTION,
  UNKNOWN_PROPERTY_QUESTION,
  findConflicts,
  formatCents,
  isPolicyRuleV1,
  modelOutputSchema,
  normalizeModelOutput,
  type ModelOutput,
  type PolicyRuleEntry,
} from './policy-rule.ts';

const ctx = { vendorId: 4, propertyIds: new Set([1, 2]) };
const nullAmount = { gt: null, gte: null, lt: null, lte: null };

type ModelRule = ModelOutput['rules'][number];

function modelRule(overrides: Partial<ModelRule> = {}): ModelRule {
  return {
    effect: 'require_approval',
    amount: { ...nullAmount, gt: 50000 },
    property_ids: null,
    except_property_ids: null,
    payment_types: null,
    ...overrides,
  };
}

function modelOutput(overrides: Partial<ModelOutput> = {}): ModelOutput {
  return {
    interpretation: 'Bills over $500 need approval.',
    revised_sentence: 'Bills over $500 need approval.',
    not_covered: null,
    rules: [modelRule()],
    questions: [],
    unsupported: [],
    ...overrides,
  };
}

function normalize(overrides: Partial<ModelOutput> = {}) {
  return normalizeModelOutput(modelOutput(overrides), ctx);
}

function draftOf(overrides: Partial<ModelOutput> = {}) {
  const result = normalize(overrides);
  assert.ok(result.ok, 'expected ok');
  return result.draft;
}

const rule = (
  effect: PolicyRuleEntry['effect'],
  when: PolicyRuleEntry['when'],
): PolicyRuleEntry => ({
  effect,
  when,
});

test('accepts a minimal complete rule', () => {
  assert.equal(
    isPolicyRuleV1({
      schema_version: 1,
      vendor_id: 4,
      rules: [{ effect: 'require_approval', when: { amount_cents: { gt: 50000 } } }],
    }),
    true,
  );
});

test('rejects bad rules', () => {
  const ok = { effect: 'allow', when: {} };
  const wrap = (when: unknown, rules: unknown[] = [{ effect: 'allow', when }]) => ({
    schema_version: 1,
    vendor_id: 4,
    rules,
  });
  const bad: unknown[] = [
    wrap(null, []),
    wrap(
      null,
      Array.from({ length: 11 }, () => ok),
    ),
    wrap({ amount_cents: {} }),
    wrap({ amount_cents: { gt: 1, gte: 2 } }),
    wrap({ amount_cents: { lt: 1, lte: 2 } }),
    wrap({ amount_cents: { gt: -1 } }),
    wrap({ property_ids: [1], except_property_ids: [2] }),
    wrap({ property_ids: [] }),
    wrap({ property_ids: [3, 3] }),
    wrap({ payment_types: ['cash'] }),
    wrap({ surprise: true }),
    { ...wrap({}), schema_version: 2 },
  ];
  for (const value of bad) assert.equal(isPolicyRuleV1(value), false, JSON.stringify(value));
});

test('rejects string ids and fractional cents as malformed', () => {
  const stringIds = modelOutput({ rules: [modelRule({ property_ids: ['3'] as never })] });
  assert.equal(modelOutputSchema.safeParse(stringIds).success, false);

  const fractional = modelOutput({
    rules: [modelRule({ amount: { ...nullAmount, gt: 500.5 } })],
  });
  assert.equal(normalizeModelOutput(fractional, ctx).ok, false);

  const fractionalId = modelOutput({ rules: [modelRule({ property_ids: [1.5] })] });
  assert.equal(normalizeModelOutput(fractionalId, ctx).ok, false);
});

test('normalises nulls away and sets vendor and version', () => {
  const draft = draftOf({
    rules: [
      modelRule({
        effect: 'allow',
        amount: { ...nullAmount, lt: 50000 },
        payment_types: ['card'],
      }),
    ],
  });
  assert.deepEqual(draft.rule?.rules, [
    { effect: 'allow', when: { amount_cents: { lt: 50000 }, payment_types: ['card'] } },
  ]);
  assert.equal(draft.rule?.vendor_id, ctx.vendorId);
  assert.equal(draft.rule?.schema_version, 1);
  assert.equal(draft.status, 'complete');
});

test('treats an all-null amount and empty lists as absent', () => {
  const draft = draftOf({
    rules: [modelRule({ amount: { ...nullAmount }, property_ids: [], payment_types: [] })],
  });
  assert.deepEqual(draft.rule?.rules[0]?.when, {});
});

test('keeps exclusions', () => {
  const draft = draftOf({ rules: [modelRule({ except_property_ids: [2] })] });
  assert.deepEqual(draft.rule?.rules[0]?.when.except_property_ids, [2]);
  const both = normalize({ rules: [modelRule({ property_ids: [1], except_property_ids: [2] })] });
  assert.equal(both.ok, false);
});

test('drops unknown property ids and asks', () => {
  const draft = draftOf({ rules: [modelRule({ property_ids: [1, 999] })] });
  assert.deepEqual(draft.rule?.rules[0]?.when.property_ids, [1]);
  assert.deepEqual(draft.questions, [
    { id: 'q1', topic: 'property', question: UNKNOWN_PROPERTY_QUESTION },
  ]);
  assert.equal(draft.status, 'needs_clarification');
});

test('drops a rule whose property ids are all unknown, never widening it', () => {
  for (const scoped of [{ property_ids: [999] }, { except_property_ids: [999] }]) {
    const draft = draftOf({ rules: [modelRule(scoped)] });
    assert.equal(draft.rule, null);
    assert.equal(draft.status, 'needs_clarification');
    assert.notEqual(draft.status, 'complete');
    assert.deepEqual(draft.questions, [
      { id: 'q1', topic: 'property', question: UNKNOWN_PROPERTY_QUESTION },
    ]);
  }
  const mixed = draftOf({
    rules: [modelRule({ property_ids: [999] }), modelRule({ amount: null, property_ids: [1] })],
  });
  assert.equal(mixed.rule?.rules.length, 1);
  assert.deepEqual(mixed.rule?.rules[0]?.when.property_ids, [1]);
  assert.equal(mixed.status, 'needs_clarification');
});

test('ignores blank or overlong unsupported entries', () => {
  const blank = [{ text: '', reason: ' ' }];
  assert.notEqual(draftOf({ unsupported: blank }).status, 'unsupported');
  assert.deepEqual(draftOf({ unsupported: blank }).unsupported, []);
  const half = [{ text: 'every Friday', reason: '  ' }];
  assert.deepEqual(draftOf({ unsupported: half }).unsupported, []);
  const long = [{ text: 'x'.repeat(501), reason: 'Too long.' }];
  assert.deepEqual(draftOf({ unsupported: long }).unsupported, []);
  const good = { text: 'every Friday', reason: 'Dates are not supported.' };
  const kept = draftOf({ unsupported: [...blank, good] });
  assert.equal(kept.status, 'unsupported');
  assert.deepEqual(kept.unsupported, [good]);
});

test('numbers questions q1..qn and keeps at most 5', () => {
  const questions = Array.from({ length: 7 }, (_, i) => ({
    topic: 'amount' as const,
    question: `Question ${i + 1}?`,
  }));
  const draft = draftOf({ questions });
  assert.deepEqual(
    draft.questions.map((q) => q.id),
    ['q1', 'q2', 'q3', 'q4', 'q5'],
  );
});

test('computes status in the spec order', () => {
  const unsupported = [{ text: 'every Friday', reason: 'Dates are not supported.' }];
  const questions = [{ topic: 'scope' as const, question: 'Which vendor?' }];
  const conflicting = [
    modelRule({ effect: 'allow', amount: null }),
    modelRule({ effect: 'block', amount: null }),
  ];

  assert.equal(draftOf({ unsupported, questions, rules: conflicting }).status, 'unsupported');
  assert.equal(draftOf({ questions, rules: conflicting }).status, 'conflicting');
  assert.equal(draftOf({ questions }).status, 'needs_clarification');
  assert.equal(draftOf().status, 'complete');

  const empty = draftOf({ rules: [] });
  assert.equal(empty.status, 'needs_clarification');
  assert.equal(empty.rule, null);
  assert.deepEqual(empty.questions, [{ id: 'q1', topic: 'effect', question: NO_RULE_QUESTION }]);
});

test('fills not_covered', () => {
  assert.equal(draftOf({ not_covered: null }).not_covered, GENERIC_NOT_COVERED);
  assert.equal(draftOf({ not_covered: '  ' }).not_covered, GENERIC_NOT_COVERED);
  assert.equal(
    draftOf({ not_covered: '  Small bills are skipped.  ' }).not_covered,
    'Small bills are skipped.',
  );
  const everything = draftOf({
    not_covered: 'Something',
    rules: [modelRule({ amount: null })],
  });
  assert.equal(everything.not_covered, null);
});

test('rejects blank or overlong text', () => {
  assert.equal(normalize({ interpretation: '' }).ok, false);
  assert.equal(normalize({ revised_sentence: 'a'.repeat(2001) }).ok, false);
  assert.equal(normalize({ not_covered: 'a'.repeat(1001) }).ok, false);
});

test('finds amount conflicts with inclusive and exclusive bounds', () => {
  const conflicts = (a: PolicyRuleEntry['when'], b: PolicyRuleEntry['when']) =>
    findConflicts([rule('allow', { amount_cents: a.amount_cents }), rule('block', b)]).length;
  assert.equal(conflicts({ amount_cents: { gt: 50000 } }, { amount_cents: { lte: 50000 } }), 0);
  assert.equal(conflicts({ amount_cents: { gte: 50000 } }, { amount_cents: { lte: 50000 } }), 1);
  assert.equal(conflicts({ amount_cents: { gt: 50000 } }, { amount_cents: { lt: 50001 } }), 0);
  const same = findConflicts([
    rule('allow', { amount_cents: { gt: 100 } }),
    rule('allow', { amount_cents: { gt: 200 } }),
  ]);
  assert.deepEqual(same, []);
});

test('finds property scope conflicts', () => {
  const count = (a: PolicyRuleEntry['when'], b: PolicyRuleEntry['when']) =>
    findConflicts([rule('allow', a), rule('block', b)]).length;
  assert.equal(count({ property_ids: [1] }, { property_ids: [2] }), 0);
  assert.equal(count({ property_ids: [1, 2] }, { property_ids: [2] }), 1);
  assert.equal(count({ property_ids: [1] }, { except_property_ids: [1] }), 0);
  assert.equal(count({ property_ids: [1, 2] }, { except_property_ids: [1] }), 1);
  assert.equal(count({ except_property_ids: [1] }, { except_property_ids: [2] }), 1);
  assert.equal(count({}, { property_ids: [5] }), 1);
});

test('finds payment type conflicts', () => {
  const count = (a: PolicyRuleEntry['when'], b: PolicyRuleEntry['when']) =>
    findConflicts([rule('allow', a), rule('block', b)]).length;
  assert.equal(count({ payment_types: ['card'] }, { payment_types: ['bank'] }), 0);
  assert.equal(count({}, { payment_types: ['bank'] }), 1);
});

test('reports an empty amount range as a self-conflict', () => {
  assert.deepEqual(findConflicts([rule('allow', { amount_cents: { gt: 50000, lt: 10000 } })]), [
    { rules: [0, 0], explanation: 'Rule 1 can never apply: its amount range is empty.' },
  ]);
});

test('explains conflicts in plain words', () => {
  assert.deepEqual(findConflicts([rule('allow', {}), rule('block', {})]), [
    {
      rules: [0, 1],
      explanation: 'Rule 1 (auto-pay) and rule 2 (blocked) can both apply to the same bill.',
    },
  ]);
  assert.equal(
    findConflicts([rule('require_approval', {}), rule('allow', {})])[0]?.explanation,
    'Rule 1 (needs approval) and rule 2 (auto-pay) can both apply to the same bill.',
  );
});

test('formats cents', () => {
  assert.equal(formatCents(50000), '$500');
  assert.equal(formatCents(50050), '$500.50');
  assert.equal(formatCents(100000), '$1,000');
  assert.equal(formatCents(5), '$0.05');
});

test('json schema lists every property as required', () => {
  const seen: string[] = [];
  const walk = (node: unknown, path: string) => {
    if (!node || typeof node !== 'object') return;
    const schema = node as Record<string, unknown>;
    const properties = schema.properties as Record<string, unknown> | undefined;
    if (properties) {
      seen.push(path);
      assert.deepEqual(
        [...(schema.required as string[])].sort(),
        Object.keys(properties).sort(),
        path,
      );
      assert.equal(schema.additionalProperties, false, path);
      for (const [key, child] of Object.entries(properties)) walk(child, `${path}.${key}`);
    }
    if (schema.items) walk(schema.items, `${path}[]`);
  };
  walk(MODEL_OUTPUT_JSON_SCHEMA, 'root');
  assert.ok(seen.length >= 4, seen.join(','));
});

test('ADR examples are valid', () => {
  const adr = readFileSync(
    new URL('../../docs/adr/0003-policy-rule-schema.md', import.meta.url),
    'utf8',
  );
  const blocks = [...adr.matchAll(/```json\n([\s\S]*?)\n```/g)].map((m) => JSON.parse(m[1]!));
  assert.equal(blocks.length, 4);
  const keys = [
    'vendor_id',
    'revision',
    'status',
    'original_sentence',
    'sentence',
    'revised_sentence',
    'interpretation',
    'not_covered',
    'rule',
    'questions',
    'unsupported',
    'conflicts',
    'answers',
    'policy_updated_at',
    'updated_at',
  ];
  for (const draft of blocks) {
    assert.deepEqual(Object.keys(draft).sort(), [...keys].sort());
    assert.ok((DRAFT_STATUSES as readonly string[]).includes(draft.status), draft.status);
    if (draft.rule !== null) assert.ok(isPolicyRuleV1(draft.rule), JSON.stringify(draft.rule));
  }
  assert.deepEqual(blocks.map((d) => d.status).sort(), [...DRAFT_STATUSES].sort());
});
