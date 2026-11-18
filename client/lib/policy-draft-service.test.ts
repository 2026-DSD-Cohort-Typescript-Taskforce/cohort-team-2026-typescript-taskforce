import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DRAFT_FORBIDDEN,
  DRAFT_NOT_FOUND,
  DRAFT_VENDOR_NOT_FOUND,
  INTERPRETATION_UNAVAILABLE,
  TOO_MANY_REVISIONS,
  interpretationFailed,
  invalidDraftRequest,
  parseDraftBody,
  staleDraft,
  type DraftAnswer,
  type PolicyDraft,
} from './policy-drafts.ts';
import {
  getDraft,
  postDraft,
  type DraftStore,
  type DraftWrite,
  type Interpret,
} from './policy-draft-service.ts';
import type { InterpretInput, InterpretOutcome } from './policy-interpreter.ts';
import type { ModelOutput, PolicyRuleV1 } from './policy-rule.ts';

const VENDOR = { vendor_id: 7, name: 'Acme' };
const PROPERTIES = [
  { property_id: 1, name: 'Elm St' },
  { property_id: 2, name: 'Oak Ave' },
];

const RULE: PolicyRuleV1 = {
  schema_version: 1,
  vendor_id: 7,
  rules: [{ effect: 'block', when: {} }],
};

function storedDraft(overrides: Partial<PolicyDraft> = {}): PolicyDraft {
  return {
    vendor_id: 7,
    revision: 2,
    status: 'needs_clarification',
    original_sentence: 'O',
    sentence: 'Stored sentence',
    revised_sentence: 'Stored revised',
    interpretation: 'Stored interpretation',
    not_covered: null,
    rule: RULE,
    questions: [{ id: 'q1', topic: 'property', question: 'Which properties?' }],
    unsupported: [],
    conflicts: [],
    answers: [],
    policy_updated_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-02T00:00:00Z',
    ...overrides,
  };
}

const GOOD_OUTPUT: ModelOutput = {
  interpretation: 'Block all bills.',
  revised_sentence: 'Block every bill from Acme.',
  not_covered: null,
  rules: [
    {
      effect: 'block',
      amount: null,
      property_ids: null,
      except_property_ids: null,
      payment_types: null,
    },
  ],
  questions: [],
  unsupported: [],
};

function fakeStore(
  options: { manager?: boolean; draft?: PolicyDraft | null; vendor?: boolean } = {},
) {
  const calls: string[] = [];
  const state = { draft: options.draft ?? null };
  const writes: { start: DraftWrite[]; continue: Array<{ revision: number; values: DraftWrite }> } =
    {
      start: [],
      continue: [],
    };
  const store: DraftStore = {
    async isPolicyManager() {
      calls.push('isPolicyManager');
      return options.manager ?? true;
    },
    async loadVendor() {
      calls.push('loadVendor');
      return options.vendor === false ? null : VENDOR;
    },
    async loadProperties() {
      calls.push('loadProperties');
      return PROPERTIES;
    },
    async loadDraft() {
      calls.push('loadDraft');
      return state.draft;
    },
    async loadPolicyUpdatedAt() {
      calls.push('loadPolicyUpdatedAt');
      return '2026-11-10T00:00:00Z';
    },
    async startDraft(values) {
      calls.push('startDraft');
      writes.start.push(values);
      state.draft = { ...values, revision: 1, updated_at: 'now' };
      return state.draft;
    },
    async continueDraft(vendorId, revision, values) {
      calls.push('continueDraft');
      writes.continue.push({ revision, values });
      if (state.draft === null || state.draft.revision !== revision) return null;
      state.draft = { ...values, revision: revision + 1, updated_at: 'now' };
      return state.draft;
    },
  };
  return { store, calls, state, writes };
}

function fakeInterpret(outcome: InterpretOutcome = { ok: true, output: GOOD_OUTPUT }) {
  const inputs: InterpretInput[] = [];
  const interpret: Interpret = async (input) => {
    inputs.push(input);
    return outcome;
  };
  return { interpret, inputs };
}

const silent = () => {};

test('GET: 404 for a bad or unknown vendor, else the draft or null', async () => {
  assert.deepEqual(await getDraft(fakeStore().store, null), DRAFT_VENDOR_NOT_FOUND);
  assert.deepEqual(await getDraft(fakeStore({ vendor: false }).store, 7), DRAFT_VENDOR_NOT_FOUND);
  assert.deepEqual(await getDraft(fakeStore().store, 7), { status: 200, body: { draft: null } });
  const draft = storedDraft();
  assert.deepEqual(await getDraft(fakeStore({ draft }).store, 7), {
    status: 200,
    body: { draft },
  });
});

test('POST: checks run in order', async () => {
  const { interpret } = fakeInterpret();

  const forbidden = fakeStore({ manager: false });
  assert.deepEqual(
    await postDraft({ store: forbidden.store, interpret, log: silent }, null, null),
    DRAFT_FORBIDDEN,
  );
  assert.deepEqual(forbidden.calls, ['isPolicyManager']);

  const deps = { store: fakeStore().store, interpret, log: silent };
  assert.deepEqual(await postDraft(deps, null, { sentence: 'S' }), DRAFT_VENDOR_NOT_FOUND);
  assert.deepEqual(await postDraft(deps, 7, null), invalidDraftRequest([]));

  const parsed = parseDraftBody({ sentence: 5 });
  assert.equal(parsed.ok, false);
  assert.deepEqual(
    await postDraft(deps, 7, { sentence: 5 }),
    invalidDraftRequest(parsed.ok ? [] : parsed.fields),
  );

  const unknown = fakeStore({ vendor: false });
  assert.deepEqual(
    await postDraft({ store: unknown.store, interpret, log: silent }, 7, { sentence: 'S' }),
    DRAFT_VENDOR_NOT_FOUND,
  );

  const unavailable = fakeStore();
  assert.deepEqual(
    await postDraft({ store: unavailable.store, interpret: null, log: silent }, 7, {
      sentence: 'S',
    }),
    INTERPRETATION_UNAVAILABLE,
  );
  assert.deepEqual(unavailable.writes, { start: [], continue: [] });
});

test('start writes a new draft', async () => {
  const { store, writes } = fakeStore();
  const { interpret, inputs } = fakeInterpret();
  const reply = await postDraft({ store, interpret, log: silent }, 7, { sentence: 'S' });

  assert.deepEqual(inputs, [
    {
      vendor: VENDOR,
      properties: PROPERTIES,
      originalSentence: 'S',
      sentence: 'S',
      answers: [],
      previousRule: null,
    },
  ]);
  assert.equal(writes.start.length, 1);
  const write = writes.start[0];
  assert.equal(write.vendor_id, 7);
  assert.equal(write.original_sentence, 'S');
  assert.equal(write.sentence, 'S');
  assert.deepEqual(write.answers, []);
  assert.equal(write.policy_updated_at, '2026-11-10T00:00:00Z');
  assert.equal(write.status, 'complete');
  assert.equal(write.interpretation, 'Block all bills.');
  assert.equal(write.revised_sentence, 'Block every bill from Acme.');
  assert.equal(write.rule?.vendor_id, 7);
  assert.equal('revision' in write, false);
  assert.equal('updated_at' in write, false);
  assert.equal(reply.status, 200);
  assert.deepEqual(reply.body, { draft: { ...write, revision: 1, updated_at: 'now' } });
});

test('continue appends answers with their question text and keeps the original', async () => {
  const { store, writes } = fakeStore({ draft: storedDraft() });
  const { interpret, inputs } = fakeInterpret();
  const reply = await postDraft({ store, interpret, log: silent }, 7, {
    revision: 2,
    answers: [{ question_id: 'q1', answer: 'Elm St' }],
  });

  assert.equal(reply.status, 200);
  assert.deepEqual(inputs[0].answers, [{ question: 'Which properties?', answer: 'Elm St' }]);
  assert.deepEqual(inputs[0].previousRule, RULE);
  assert.equal(inputs[0].originalSentence, 'O');
  assert.equal(inputs[0].sentence, 'Stored sentence');
  assert.equal(writes.continue[0].revision, 2);
  const write = writes.continue[0].values;
  assert.equal(write.original_sentence, 'O');
  assert.equal(write.sentence, 'Stored sentence');
  assert.deepEqual(write.answers, [
    { question_id: 'q1', question: 'Which properties?', answer: 'Elm St' },
  ]);
  assert.equal(write.policy_updated_at, '2026-11-01T00:00:00Z');
});

test('continue with an edited sentence keeps the original', async () => {
  const { store, writes } = fakeStore({ draft: storedDraft() });
  const { interpret } = fakeInterpret();
  await postDraft({ store, interpret, log: silent }, 7, { revision: 2, sentence: 'New' });
  assert.equal(writes.continue[0].values.sentence, 'New');
  assert.equal(writes.continue[0].values.original_sentence, 'O');
});

test('continue needs a stored draft', async () => {
  const { store } = fakeStore();
  const { interpret, inputs } = fakeInterpret();
  const reply = await postDraft({ store, interpret, log: silent }, 7, {
    revision: 1,
    sentence: 'New',
  });
  assert.deepEqual(reply, DRAFT_NOT_FOUND);
  assert.equal(inputs.length, 0);
});

test('continue with an old revision is stale', async () => {
  const draft = storedDraft({ revision: 3 });
  const { store } = fakeStore({ draft });
  const { interpret, inputs } = fakeInterpret();
  const reply = await postDraft({ store, interpret, log: silent }, 7, {
    revision: 2,
    sentence: 'New',
  });
  assert.deepEqual(reply, staleDraft(draft));
  assert.equal(inputs.length, 0);
});

test('rejects answers to questions the stored draft does not ask', async () => {
  const { store } = fakeStore({ draft: storedDraft() });
  const { interpret, inputs } = fakeInterpret();
  const reply = await postDraft({ store, interpret, log: silent }, 7, {
    revision: 2,
    answers: [{ question_id: 'q9', answer: 'x' }],
  });
  assert.deepEqual(reply, invalidDraftRequest(['answers']));
  assert.equal(inputs.length, 0);
});

test('caps answers per draft', async () => {
  const answers: DraftAnswer[] = Array.from({ length: 25 }, (_, i) => ({
    question_id: `a${i}`,
    question: 'Q',
    answer: 'A',
  }));
  const { store } = fakeStore({ draft: storedDraft({ answers }) });
  const { interpret, inputs } = fakeInterpret();
  const questions = Array.from({ length: 6 }, (_, i) => ({
    id: `q${i}`,
    topic: 'scope' as const,
    question: `Q${i}`,
  }));
  const capped = fakeStore({ draft: storedDraft({ answers, questions }) });
  const second = await postDraft({ store: capped.store, interpret, log: silent }, 7, {
    revision: 2,
    answers: questions.map((q) => ({ question_id: q.id, answer: 'x' })),
  });
  assert.deepEqual(second, TOO_MANY_REVISIONS);
  assert.equal(inputs.length, 0);
});

test('a failed interpretation writes nothing', async () => {
  const outcome: InterpretOutcome = { ok: false, reason: 'schema', detail: 'x' };
  const logged: unknown[][] = [];
  const log = (...args: unknown[]) => void logged.push(args);

  const start = fakeStore();
  const { interpret } = fakeInterpret(outcome);
  const startReply = await postDraft({ store: start.store, interpret, log }, 7, { sentence: 'S' });
  assert.deepEqual(startReply, interpretationFailed(null));
  assert.deepEqual(start.writes, { start: [], continue: [] });
  assert.equal(logged.length, 1);

  const draft = storedDraft();
  const cont = fakeStore({ draft });
  const contReply = await postDraft({ store: cont.store, interpret, log }, 7, {
    revision: 2,
    sentence: 'New',
  });
  assert.deepEqual(contReply, interpretationFailed(draft));
  assert.deepEqual(cont.writes, { start: [], continue: [] });
  assert.equal(JSON.stringify(contReply).includes('"x"'), false);
});

test('a failed restart over a stored draft replies with that draft and writes nothing', async () => {
  const draft = storedDraft();
  const { store, writes, state } = fakeStore({ draft });
  const { interpret, inputs } = fakeInterpret({ ok: false, reason: 'schema', detail: 'x' });
  const reply = await postDraft({ store, interpret, log: silent }, 7, { sentence: 'Restart' });
  assert.deepEqual(reply, interpretationFailed(draft));
  assert.deepEqual(writes, { start: [], continue: [] });
  assert.equal(state.draft, draft);
  // The stored draft only shapes the failure reply; it never feeds the new interpretation.
  assert.equal(inputs[0]?.originalSentence, 'Restart');
  assert.deepEqual(inputs[0]?.answers, []);
  assert.equal(inputs[0]?.previousRule, null);
});

test('a malformed normalisation on restart replies with the stored draft', async () => {
  const bad: ModelOutput = {
    ...GOOD_OUTPUT,
    rules: [
      {
        effect: 'block',
        amount: null,
        property_ids: [1],
        except_property_ids: [2],
        payment_types: null,
      },
    ],
  };
  const draft = storedDraft();
  const { store, writes } = fakeStore({ draft });
  const { interpret } = fakeInterpret({ ok: true, output: bad });
  const reply = await postDraft({ store, interpret, log: silent }, 7, { sentence: 'Restart' });
  assert.deepEqual(reply, interpretationFailed(draft));
  assert.deepEqual(writes, { start: [], continue: [] });
});

test('logs the missing API key once, and only when the service reports it', async () => {
  const logged: unknown[][] = [];
  const log = (...args: unknown[]) => void logged.push(args);
  const hint = 'Set OPENROUTER_API_KEY. See client/.env.example.';

  const forbidden = fakeStore({ manager: false });
  await postDraft({ store: forbidden.store, interpret: null, log }, 7, { sentence: 'S' });
  assert.deepEqual(logged, []);

  const bad = fakeStore();
  await postDraft({ store: bad.store, interpret: null, log }, 7, { sentence: 5 });
  assert.deepEqual(logged, []);

  const unavailable = fakeStore();
  const reply = await postDraft({ store: unavailable.store, interpret: null, log }, 7, {
    sentence: 'S',
  });
  assert.deepEqual(reply, INTERPRETATION_UNAVAILABLE);
  assert.deepEqual(logged, [[hint]]);
});

test('a malformed normalisation writes nothing', async () => {
  const bad: ModelOutput = {
    ...GOOD_OUTPUT,
    rules: [
      {
        effect: 'block',
        amount: null,
        property_ids: [1],
        except_property_ids: [2],
        payment_types: null,
      },
    ],
  };
  const { store, writes } = fakeStore();
  const { interpret } = fakeInterpret({ ok: true, output: bad });
  const reply = await postDraft({ store, interpret, log: silent }, 7, { sentence: 'S' });
  assert.deepEqual(reply, interpretationFailed(null));
  assert.deepEqual(writes, { start: [], continue: [] });
});

test('returns 409 with the current draft when the revision moved during the model call', async () => {
  const fake = fakeStore({ draft: storedDraft() });
  const interpret: Interpret = async () => {
    fake.state.draft = storedDraft({ revision: 3, sentence: 'Someone else' });
    return { ok: true, output: GOOD_OUTPUT };
  };
  const reply = await postDraft({ store: fake.store, interpret, log: silent }, 7, {
    revision: 2,
    sentence: 'New',
  });
  assert.deepEqual(reply, staleDraft(storedDraft({ revision: 3, sentence: 'Someone else' })));
});

test('never writes policies', async () => {
  const allowed = new Set([
    'isPolicyManager',
    'loadVendor',
    'loadProperties',
    'loadDraft',
    'loadPolicyUpdatedAt',
    'startDraft',
    'continueDraft',
  ]);
  const { interpret } = fakeInterpret();

  const start = fakeStore();
  await postDraft({ store: start.store, interpret, log: silent }, 7, { sentence: 'S' });
  const cont = fakeStore({ draft: storedDraft() });
  await postDraft({ store: cont.store, interpret, log: silent }, 7, {
    revision: 2,
    sentence: 'New',
  });
  for (const call of [...start.calls, ...cont.calls]) assert.ok(allowed.has(call), call);
  assert.ok(start.calls.includes('startDraft'));
  assert.ok(cont.calls.includes('continueDraft'));
});
