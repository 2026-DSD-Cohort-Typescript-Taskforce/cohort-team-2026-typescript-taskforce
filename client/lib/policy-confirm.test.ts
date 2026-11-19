import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Policy, ActiveVersion } from './policies.ts';
import {
  DRAFT_FORBIDDEN,
  DRAFT_NOT_FOUND,
  DRAFT_VENDOR_NOT_FOUND,
  type PolicyDraft,
} from './policy-drafts.ts';
import { confirmDraft, type ConfirmStore } from './policy-confirm.ts';
import type { PolicyRuleV1 } from './policy-rule.ts';

const RULE: PolicyRuleV1 = {
  schema_version: 1,
  vendor_id: 12,
  rules: [
    {
      effect: 'require_approval',
      when: { amount_cents: { gt: 50000 }, except_property_ids: [3] },
    },
  ],
};

// Two rules with different effects that can match the same bill.
const CONFLICTING: PolicyRuleV1 = {
  schema_version: 1,
  vendor_id: 12,
  rules: [
    { effect: 'block', when: { amount_cents: { gt: 10000 } } },
    { effect: 'require_approval', when: { amount_cents: { gt: 50000 } } },
  ],
};

function draft(overrides: Partial<PolicyDraft> = {}): PolicyDraft {
  return {
    vendor_id: 12,
    revision: 3,
    status: 'complete',
    original_sentence: 'O',
    sentence: 'S',
    revised_sentence: 'R',
    interpretation: 'Bills over $500.00 need approval.',
    not_covered: null,
    rule: RULE,
    questions: [],
    unsupported: [],
    conflicts: [],
    answers: [],
    policy_updated_at: null,
    updated_at: '2026-11-18T00:00:00Z',
    ...overrides,
  };
}

const VERSION: ActiveVersion = {
  version_id: 5,
  version: 1,
  interpretation: 'Bills over $500.00 need approval.',
  confirmed_at: '2026-11-18T01:00:00Z',
  confirmed_by_name: 'Pat',
};
const POLICY: Policy = {
  policy_id: 9,
  name: 'Limits',
  description: 'R',
  is_active: true,
  updated_at: '2026-11-18T01:00:00Z',
  active_version: VERSION,
};

type Fake = ConfirmStore & { confirmCalls: Array<[number, number, string]>; draftReads: number };

function fakeStore(overrides: Partial<ConfirmStore> & { draft?: PolicyDraft | null } = {}): Fake {
  const { draft: stored, ...rest } = overrides;
  const current = stored === undefined ? draft() : stored;
  const store: Fake = {
    confirmCalls: [],
    draftReads: 0,
    isPolicyManager: async () => true,
    loadVendor: async (id) => ({ vendor_id: id, name: 'Acme' }),
    loadDraft: async () => {
      store.draftReads += 1;
      return current;
    },
    confirm: async (id, revision, name) => {
      store.confirmCalls.push([id, revision, name]);
      return { policy: POLICY, version: VERSION };
    },
    ...rest,
  };
  return store;
}

const BODY = { revision: 3, name: ' Limits ' };

test('a non-manager gets 403 before the body is read', async () => {
  const store = fakeStore({ isPolicyManager: async () => false });
  assert.deepEqual(await confirmDraft(store, 12, { junk: 1 }), DRAFT_FORBIDDEN);
});

test('an unusable vendor id or unknown vendor is 404', async () => {
  assert.deepEqual(await confirmDraft(fakeStore(), null, BODY), DRAFT_VENDOR_NOT_FOUND);
  const store = fakeStore({ loadVendor: async () => null });
  assert.deepEqual(await confirmDraft(store, 12, BODY), DRAFT_VENDOR_NOT_FOUND);
});

test('a bad body is 400 naming the fields', async () => {
  const fields = async (body: Record<string, unknown> | null) => {
    const reply = await confirmDraft(fakeStore(), 12, body);
    assert.equal(reply.status, 400);
    return (reply.body as { code: string; fields: string[] }).fields;
  };
  assert.deepEqual(await fields(null), []);
  assert.deepEqual(await fields({ ...BODY, extra: 1 }), ['extra']);
  assert.deepEqual(await fields({ name: 'A' }), ['revision']);
  assert.deepEqual(await fields({ revision: 0, name: 'A' }), ['revision']);
  assert.deepEqual(await fields({ revision: 1.5, name: 'A' }), ['revision']);
  assert.deepEqual(await fields({ revision: 1, name: '   ' }), ['name']);
  assert.deepEqual(await fields({ revision: 1, name: 'x'.repeat(101) }), ['name']);
  assert.deepEqual(await fields({ revision: 1, name: 5 }), ['name']);
  assert.deepEqual(await fields({}), ['revision', 'name']);
});

test('no draft is 404 draft_not_found', async () => {
  assert.deepEqual(await confirmDraft(fakeStore({ draft: null }), 12, BODY), DRAFT_NOT_FOUND);
});

test('a draft the route cannot trust is 409 draft_not_complete and never confirmed', async () => {
  const bad = [
    draft({ rule: { ...RULE, vendor_id: 99 } }),
    draft({ rule: CONFLICTING }),
    draft({ rule: null }),
    draft({ rule: { schema_version: 2 } as unknown as PolicyRuleV1 }),
  ];
  for (const d of bad) {
    const store = fakeStore({ draft: d });
    const reply = await confirmDraft(store, 12, BODY);
    assert.equal(reply.status, 409);
    assert.equal((reply.body as { code: string }).code, 'draft_not_complete');
    assert.deepEqual((reply.body as { draft: PolicyDraft }).draft, d);
    assert.equal(store.confirmCalls.length, 0);
  }
});

test('success confirms with the trimmed name and returns policy and version', async () => {
  const store = fakeStore();
  const reply = await confirmDraft(store, 12, BODY);
  assert.deepEqual(reply, { status: 200, body: { policy: POLICY, version: VERSION } });
  assert.deepEqual(store.confirmCalls, [[12, 3, 'Limits']]);
});

test('store errors map to replies', async () => {
  const run = (message: string, details: string | null = null) =>
    confirmDraft(
      fakeStore({ confirm: async () => ({ error: { code: 'PT409', message, details } }) }),
      12,
      BODY,
    );
  const reread = draft({ revision: 4 });
  const rerun = (message: string) =>
    confirmDraft(
      fakeStore({
        draft: reread,
        confirm: async () => ({ error: { code: 'PT409', message } }),
      }),
      12,
      BODY,
    );

  assert.deepEqual(await run('vendor_not_found'), DRAFT_VENDOR_NOT_FOUND);
  assert.deepEqual(await run('draft_not_found'), DRAFT_NOT_FOUND);
  assert.deepEqual(await run('forbidden'), DRAFT_FORBIDDEN);

  const invalid = await run('invalid_policy', '["name"]');
  assert.equal(invalid.status, 400);
  assert.deepEqual((invalid.body as { code: string; fields: string[] }).fields, ['name']);
  assert.equal((invalid.body as { code: string }).code, 'invalid_policy');

  const stale = await rerun('stale_draft');
  assert.equal(stale.status, 409);
  assert.equal((stale.body as { code: string }).code, 'stale_draft');
  assert.deepEqual((stale.body as { draft: PolicyDraft }).draft, reread);

  const changed = await rerun('policy_changed');
  assert.equal(changed.status, 409);
  assert.deepEqual(changed.body, {
    error: 'This policy changed since the draft started. Check the policy again.',
    code: 'policy_changed',
    draft: reread,
  });

  for (const code of ['draft_not_complete', 'invalid_rule']) {
    const reply = await rerun(code);
    assert.deepEqual(reply.body, {
      error: "This draft isn't ready to turn on yet.",
      code,
      draft: reread,
    });
    assert.equal(reply.status, 409);
  }
});

test('stale_draft carries null when the draft is gone', async () => {
  const store = fakeStore({
    confirm: async () => ({ error: { code: 'PT409', message: 'stale_draft' } }),
  });
  // Read once before confirming, then the draft disappears.
  let reads = 0;
  store.loadDraft = async () => (reads++ === 0 ? draft() : null);
  const reply = await confirmDraft(store, 12, BODY);
  assert.equal(reply.status, 409);
  assert.equal((reply.body as { draft: unknown }).draft, null);
});

test('an unknown store error is a 500', async () => {
  const store = fakeStore({
    confirm: async () => ({ error: { code: 'PT500', message: 'surprise' } }),
  });
  assert.equal((await confirmDraft(store, 12, BODY)).status, 500);
});
