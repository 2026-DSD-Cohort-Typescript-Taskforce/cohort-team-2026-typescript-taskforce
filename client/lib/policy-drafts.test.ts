import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  interpretationFailed,
  invalidDraftRequest,
  parseDraftBody,
  staleDraft,
  type PolicyDraft,
} from './policy-drafts.ts';

const fields = (body: Record<string, unknown>) => {
  const result = parseDraftBody(body);
  assert.equal(result.ok, false);
  return result.ok ? [] : result.fields;
};

test('parses a start body', () => {
  assert.deepEqual(parseDraftBody({ sentence: '  Bills over $500 need approval  ' }), {
    ok: true,
    body: { kind: 'start', sentence: 'Bills over $500 need approval' },
  });
});

test('parses a continue body', () => {
  assert.deepEqual(
    parseDraftBody({ revision: 3, answers: [{ question_id: 'q1', answer: ' Elm St ' }] }),
    {
      ok: true,
      body: {
        kind: 'continue',
        revision: 3,
        answers: [{ question_id: 'q1', answer: 'Elm St' }],
        sentence: null,
      },
    },
  );
  assert.deepEqual(parseDraftBody({ revision: 2, sentence: '  New text ' }), {
    ok: true,
    body: { kind: 'continue', revision: 2, answers: [], sentence: 'New text' },
  });
});

test('counts characters, not UTF-16 units, and rejects blank sentences', () => {
  assert.deepEqual(fields({ sentence: '   ' }), ['sentence']);
  assert.equal(parseDraftBody({ sentence: '😀'.repeat(1000) }).ok, true);
  assert.deepEqual(fields({ sentence: '😀'.repeat(1001) }), ['sentence']);
});

test('rejects bad bodies with the failing field names', () => {
  const a = { question_id: 'q1', answer: 'x' };
  assert.ok(fields({ sentence: 'ok', foo: 1 }).includes('foo'));
  assert.deepEqual(fields({ sentence: 'ok', answers: [a] }), ['answers']);
  for (const revision of [0, 1.5, '3', -1, 2147483648]) {
    assert.deepEqual(fields({ revision, sentence: 'ok' }), ['revision']);
  }
  assert.deepEqual(fields({ revision: 1 }), ['answers']);
  assert.deepEqual(fields({ revision: 1, answers: [] }), ['answers']);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ question_id: `q${i}`, answer: 'x' }));
  assert.deepEqual(fields({ revision: 1, answers: eleven }), ['answers']);
  assert.deepEqual(
    fields({ revision: 1, answers: [{ question_id: 'q1', answer: 'x'.repeat(501) }] }),
    ['answers'],
  );
  assert.deepEqual(fields({ revision: 1, answers: [{ question_id: 'q1', answer: '  ' }] }), [
    'answers',
  ]);
  assert.deepEqual(fields({ revision: 1, answers: [{ ...a, extra: 1 }] }), ['answers']);
  assert.deepEqual(fields({ revision: 1, answers: [{ answer: 'x' }] }), ['answers']);
  assert.deepEqual(fields({ revision: 1, answers: [a, a] }), ['answers']);
  assert.deepEqual(fields({ revision: 1, answers: 'nope' }), ['answers']);
});

test('reply bodies carry the exact copy and codes', () => {
  const d = { vendor_id: 1 } as PolicyDraft;
  const stale = staleDraft(d);
  assert.equal(stale.status, 409);
  assert.equal((stale.body as { draft: unknown }).draft, d);
  assert.deepEqual(interpretationFailed(null).body, {
    error: "Couldn't interpret the policy. Try again.",
    code: 'interpretation_failed',
    draft: null,
  });
  assert.deepEqual((invalidDraftRequest(['sentence']).body as { fields: string[] }).fields, [
    'sentence',
  ]);
});
