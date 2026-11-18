import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_OPENROUTER_BASE_URL,
  DEFAULT_POLICY_MODEL,
  SYSTEM_PROMPT,
  buildMessages,
  callInterpreter,
  interpreterConfigFromEnv,
  type InterpretInput,
  type InterpreterConfig,
} from './policy-interpreter.ts';
import { MODEL_OUTPUT_JSON_SCHEMA, type ModelOutput } from './policy-rule.ts';

const KEY = 'sk-or-secret-key-123';

const input: InterpretInput = {
  vendor: { vendor_id: 7, name: 'Acme Plumbing' },
  properties: [
    { property_id: 1, name: 'Maple Court' },
    { property_id: 2, name: 'Oak Terrace' },
  ],
  originalSentence: 'Pay Acme bills over $500 with approval',
  sentence: 'Pay Acme bills over $500 with approval, except Oak Terrace',
  answers: [{ question: 'Which payment types?', answer: 'Bank only' }],
  previousRule: {
    schema_version: 1,
    vendor_id: 7,
    rules: [{ effect: 'require_approval', when: { amount_cents: { gt: 50000 } } }],
  },
};

const validOutput: ModelOutput = {
  interpretation: 'Bills over $500 need approval.',
  revised_sentence: 'Bills over $500 need approval.',
  not_covered: 'Bills of $500 or less follow the normal flow.',
  rules: [
    {
      effect: 'require_approval',
      amount: { gt: 50000, gte: null, lt: null, lte: null },
      property_ids: null,
      except_property_ids: null,
      payment_types: null,
    },
  ],
  questions: [],
  unsupported: [],
};

type Recorded = { url: string; init: RequestInit };

function fakeFetch(respond: (init: RequestInit) => Promise<Response> | Response) {
  const calls: Recorded[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond(init ?? {});
  }) as typeof fetch;
  return { calls, fetchFn };
}

function config(fetchFn: typeof fetch, extra: Partial<InterpreterConfig> = {}): InterpreterConfig {
  return {
    apiKey: KEY,
    model: 'test/model',
    baseUrl: 'http://fake.test/v1',
    fetch: fetchFn,
    ...extra,
  };
}

function completion(content: string | null): Response {
  return Response.json({ choices: [{ message: { content } }] });
}

describe('interpreterConfigFromEnv', () => {
  it('reads config from env', () => {
    assert.equal(interpreterConfigFromEnv({}), null);
    assert.equal(interpreterConfigFromEnv({ OPENROUTER_API_KEY: '   ' }), null);
    assert.deepEqual(interpreterConfigFromEnv({ OPENROUTER_API_KEY: 'k' }), {
      apiKey: 'k',
      model: DEFAULT_POLICY_MODEL,
      baseUrl: DEFAULT_OPENROUTER_BASE_URL,
    });
    assert.deepEqual(
      interpreterConfigFromEnv({
        OPENROUTER_API_KEY: 'k',
        OPENROUTER_POLICY_MODEL: 'custom/model',
        OPENROUTER_BASE_URL: 'http://127.0.0.1:9999/v1/',
      }),
      { apiKey: 'k', model: 'custom/model', baseUrl: 'http://127.0.0.1:9999/v1' },
    );
    assert.equal(
      interpreterConfigFromEnv({
        OPENROUTER_API_KEY: 'k',
        OPENROUTER_POLICY_MODEL: ' ',
        OPENROUTER_BASE_URL: '',
      })?.model,
      DEFAULT_POLICY_MODEL,
    );
  });
});

describe('prompt', () => {
  it('the system prompt states the vocabulary', () => {
    for (const word of [
      'allow',
      'require_approval',
      'block',
      'cents',
      'gt',
      'gte',
      'lt',
      'lte',
      'except_property_ids',
      'not_covered',
      'revised_sentence',
      'schedule',
      'per-user',
      'total',
      'other vendors',
      'other actions',
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(word), `missing ${word}`);
    }
  });

  it('the system prompt states the threshold readings', () => {
    for (const reading of [
      '"over $500" and "more than $500" mean gt 50000',
      '"$500 or more" and "at least $500" mean gte 50000',
      '"under $500" means lt 50000',
      '"$500 or less" and "up to $500" mean lte 50000',
      '"between $100 and $500" means gte 10000 and lte 50000',
    ]) {
      assert.ok(SYSTEM_PROMPT.includes(reading), `missing reading: ${reading}`);
    }
  });

  it('the user message carries the inputs as data', () => {
    const [system, user] = buildMessages(input);
    assert.equal(system.role, 'system');
    assert.equal(user.role, 'user');
    for (const text of [
      'Acme Plumbing',
      'Maple Court',
      'Oak Terrace',
      input.originalSentence,
      input.sentence,
      'Which payment types?',
      'Bank only',
      JSON.stringify(input.previousRule),
    ]) {
      assert.ok(user.content.includes(text), `user message missing ${text}`);
    }
    for (const id of input.properties.map((p) => p.property_id)) {
      assert.ok(user.content.includes(`"property_id":${id}`));
    }
    for (const text of ['Acme Plumbing', input.sentence, 'Bank only', 'Oak Terrace']) {
      assert.ok(!system.content.includes(text));
    }
  });
});

describe('callInterpreter', () => {
  it('posts a strict json_schema request', async () => {
    const { calls, fetchFn } = fakeFetch(() => completion(JSON.stringify(validOutput)));
    await callInterpreter(input, config(fetchFn));
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, 'http://fake.test/v1/chat/completions');
    assert.equal(init.method, 'POST');
    assert.equal((init.headers as Record<string, string>).Authorization, `Bearer ${KEY}`);
    const body = JSON.parse(String(init.body));
    assert.equal(body.model, 'test/model');
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.response_format, {
      type: 'json_schema',
      json_schema: { name: 'policy_draft', strict: true, schema: MODEL_OUTPUT_JSON_SCHEMA },
    });
    assert.deepEqual(body.messages, buildMessages(input));
  });

  it('returns the parsed output', async () => {
    const { fetchFn } = fakeFetch(() => completion(JSON.stringify(validOutput)));
    assert.deepEqual(await callInterpreter(input, config(fetchFn)), {
      ok: true,
      output: validOutput,
    });
  });

  it('parses JSON wrapped in a code fence', async () => {
    for (const fence of ['```json\n', '```\n']) {
      const { fetchFn } = fakeFetch(() =>
        completion(`${fence}${JSON.stringify(validOutput, null, 2)}\n\`\`\``),
      );
      const outcome = await callInterpreter(input, config(fetchFn));
      assert.equal(outcome.ok, true);
    }
  });

  describe('failures', () => {
    const { revised_sentence: _dropped, ...missingField } = validOutput;
    const cases: Array<
      [
        string,
        (init: RequestInit) => Promise<Response> | Response,
        string,
        Partial<InterpreterConfig>?,
      ]
    > = [
      [
        'network',
        () => {
          throw new TypeError(`connect failed for key ${KEY}`);
        },
        'network',
      ],
      [
        'timeout',
        (init) =>
          new Promise<Response>((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
          }),
        'timeout',
      ],
      ['http', () => new Response(`upstream error, key ${KEY}`, { status: 500 }), 'http'],
      ['no_content (no choices)', () => Response.json({}), 'no_content'],
      ['no_content (empty)', () => completion(''), 'no_content'],
      ['not_json', () => completion('not json'), 'not_json'],
      ['schema', () => completion(JSON.stringify(missingField)), 'schema'],
    ];

    it('maps failures and never puts the key in the detail', async () => {
      for (const [label, respond, reason] of cases) {
        const { fetchFn } = fakeFetch(respond);
        const outcome = await callInterpreter(
          input,
          config(fetchFn, label === 'timeout' ? { timeoutMs: 5 } : {}),
        );
        assert.equal(outcome.ok, false, label);
        if (outcome.ok) continue;
        assert.equal(outcome.reason, reason, label);
        assert.ok(!outcome.detail.includes(KEY), `${label} leaked the key`);
      }
    });
  });
});
