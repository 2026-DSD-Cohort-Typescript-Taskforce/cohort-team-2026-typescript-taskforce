import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import app from '../src/app';
import express from 'express';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStagehandRoutes } from '../src/routes/stagehand.routes';
import { errorHandler } from '../src/middleware/errorHandler';
import { BrowserWorker, type PortalBrowser, type PortalSession } from '../src/payments/worker';
import { ExecutionStore } from '../src/payments/execution-store';
import { dollarsToCents, executeSchema } from '../src/payments/worker-input';
import { StagehandBrowser } from '../src/payments/stagehand-browser';
import { readFile, writeFile } from 'node:fs/promises';

const request = {
  billId: 7,
  vendorId: 9,
  portalUrl: 'https://portal.invalid/pay',
  amount: 125,
  invoiceNumber: 'INV-7',
  idempotencyKey: 'payment-7',
};

function fixture() {
  const calls = { opened: 0, submitted: 0, closed: 0, confirmed: 0 };
  const review = { invoice: 'INV-7', total: '$125.00' };
  const session: PortalSession = {
    text: async () => 'Invoice INV-7, $125.00',
    review: async () => review,
    submit: async () => {
      calls.submitted++;
    },
    confirm: async () => {
      calls.confirmed++;
    },
    close: async () => {
      calls.closed++;
    },
  };
  const browser: PortalBrowser = {
    prepareExecution: async () => ({
      unit: 'dollars',
      open: async () => {
        calls.opened++;
        return session;
      },
    }),
    open: async () => {
      calls.opened++;
      return session;
    },
  };
  return { calls, review, session, browser };
}

async function withWorker(
  run: (worker: BrowserWorker, path: string, f: ReturnType<typeof fixture>) => Promise<void>,
) {
  const path = await mkdtemp(join(tmpdir(), 'stagehand-test-'));
  const f = fixture();
  try {
    await run(new BrowserWorker(f.browser, new ExecutionStore(path)), path, f);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

test('worker rejects unauthorized requests before opening a browser', async () => {
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    for (const path of ['/observe', '/execute']) {
      const response = await fetch(
        `http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ billId: 1, portalUrl: 'https://example.invalid' }),
        },
      );
      assert.equal(response.status, 401);
    }
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('HTTP routes enforce bearer authentication and strict request bodies', async () => {
  await withWorker(async (worker, _path, f) => {
    const service = express()
      .use(createStagehandRoutes(worker, () => 'shared-secret'))
      .use(errorHandler);
    const server = service.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    async function post(path: string, body: unknown, token = 'shared-secret') {
      return fetch(url + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    }
    try {
      assert.equal((await post('/observe', request, 'wrong')).status, 401);
      assert.equal(f.calls.opened, 0);
      for (const body of [
        { billId: 7, portalUrl: request.portalUrl, steps: ['pay'] },
        { billId: 7, portalUrl: request.portalUrl, selector: '#pay' },
        { billId: 7, portalUrl: 'file:///etc/passwd' },
        { billId: 7, portalUrl: 'https://user:pass@portal.invalid' },
        { billId: '7', portalUrl: request.portalUrl },
      ])
        assert.equal((await post('/observe', body)).status, 400);
      assert.equal((await post('/execute', { ...request, steps: ['pay'] })).status, 400);
      assert.equal(f.calls.opened, 0);
      const observed = await post('/observe', { billId: 7, portalUrl: request.portalUrl });
      assert.equal(observed.status, 200);
      assert.deepEqual(await observed.json(), { pageText: 'Invoice INV-7, $125.00' });
      assert.equal(f.calls.submitted, 0);
      const executed = await post('/execute', request);
      assert.equal(executed.status, 200);
      assert.deepEqual(await executed.json(), { confirmed: true });
      const replayed = await post('/execute', request);
      assert.equal(replayed.status, 200);
      assert.equal(f.calls.submitted, 1);
      const mismatch = await post('/execute', { ...request, amount: 126 });
      assert.equal(mismatch.status, 409);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});

test('exact decimal parsing never rounds or accepts ambiguous amounts', () => {
  assert.equal(dollarsToCents('$1,234.50'), 123450);
  assert.equal(dollarsToCents('USD 0.01'), 1);
  for (const value of ['1.001', '-1.00', '1e3', '$1,23.00', '0', '9007199254740991']) {
    assert.throws(() => dollarsToCents(value));
  }
  assert.equal(executeSchema.safeParse({ ...request, amount: NaN }).success, false);
});

test('mismatching invoice or total never submits', async () => {
  for (const changed of [{ invoice: 'INV-8' }, { total: '$125.01' }]) {
    await withWorker(async (worker, _path, f) => {
      Object.assign(f.review, changed);
      await assert.rejects(worker.execute(request), { code: 'payment_mismatch' });
      assert.equal(f.calls.submitted, 0);
      assert.equal(f.calls.closed, 1);
    });
  }
});

test('concurrent requests with one key submit once; confirmed result survives restart', async () => {
  await withWorker(async (worker, path, f) => {
    const results = await Promise.allSettled([worker.execute(request), worker.execute(request)]);
    assert.ok(results.some((r) => r.status === 'fulfilled'));
    assert.equal(f.calls.submitted, 1);
    const restarted = new BrowserWorker(f.browser, new ExecutionStore(path));
    assert.deepEqual(await restarted.execute(request), { confirmed: true });
    assert.equal(f.calls.opened, 1);
  });
});

test('confirmation timeout remains blocked after restart and never reports success', async () => {
  await withWorker(async (worker, path, f) => {
    f.session.confirm = async () => {
      throw new Error('timeout after charge');
    };
    await assert.rejects(worker.execute(request), { code: 'outcome_unknown' });
    const restarted = new BrowserWorker(f.browser, new ExecutionStore(path));
    await assert.rejects(restarted.execute(request), { code: 'outcome_unknown' });
    assert.equal(f.calls.submitted, 1);
    assert.equal(f.calls.closed, 1);
  });
});

test('success waits for confirmation rather than the submit click', async () => {
  await withWorker(async (worker, _path, f) => {
    let release!: () => void;
    const confirmed = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.session.confirm = () => confirmed;
    let completed = false;
    const result = worker.execute(request).then((r) => {
      completed = true;
      return r;
    });
    while (!f.calls.submitted) await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(completed, false);
    release();
    assert.deepEqual(await result, { confirmed: true });
  });
});

test('execution pins the validated profile across asynchronous configuration changes', async () => {
  await withWorker(async (_worker, path, f) => {
    const file = join(path, 'profiles.json');
    const profile = {
      portalUrl: request.portalUrl,
      vendorId: 9,
      amountUnit: 'dollars',
      invoiceSelector: '#invoice',
      totalSelector: '#total',
      paySelector: '#pay',
      confirmationSelector: '#confirmed',
      confirmationInvoiceSelector: '#invoice',
      confirmationTotalSelector: '#total',
      confirmationReferenceSelector: '#reference',
    };
    await writeFile(file, JSON.stringify([profile]));
    const browser = new StagehandBrowser(file);
    browser.open = async (_input, _mode, pinned) => {
      assert.equal(pinned?.vendorId, 9);
      assert.equal(pinned?.amountUnit, 'dollars');
      return f.session;
    };
    const execution = await browser.prepareExecution(request);
    await writeFile(file, JSON.stringify([{ ...profile, vendorId: 10, amountUnit: 'cents' }]));
    assert.equal(execution.unit, 'dollars');
    assert.equal(await execution.open(), f.session);
  });
});

test('a click profile without a vendor id or url still prepares execution', async () => {
  await withWorker(async (_worker, path, f) => {
    const file = join(path, 'profiles.json');
    await writeFile(
      file,
      JSON.stringify([
        {
          amountUnit: 'dollars',
          capture: [{ action: 'click', selector: "a[href='#business']" }],
          pay: [{ action: 'click', selector: '#sample-details' }],
          invoiceSelector: '#invoice',
          totalSelector: '#total',
          paySelector: '#pay',
          confirmationSelector: '#confirmed',
          confirmationInvoiceSelector: '#invoice',
          confirmationTotalSelector: '#total',
          confirmationReferenceSelector: '#reference',
        },
      ]),
    );
    const browser = new StagehandBrowser(file);
    browser.open = async (_input, _mode, pinned) => {
      assert.equal(pinned?.capture?.[0]?.selector, "a[href='#business']");
      assert.equal(pinned?.pay?.[0]?.selector, '#sample-details');
      return f.session;
    };
    const execution = await browser.prepareExecution({
      ...request,
      vendorId: 3,
      portalUrl: 'https://copper-ridge-utility-demo.vercel.app',
    });
    assert.equal(execution.unit, 'dollars');
    assert.equal(await execution.open(), f.session);
  });
});

test('the portal file signs in from the shared footer and omits vendor id and url', async () => {
  const profiles = JSON.parse(await readFile(join(__dirname, '../profiles.json'), 'utf8')) as {
    portalUrl?: string;
    vendorId?: number;
    capture: { action: string; selector: string }[];
    pay: { action: string; selector: string }[];
  }[];
  assert.equal(profiles.length, 1);
  assert.equal(profiles[0].portalUrl, undefined);
  assert.equal(profiles[0].vendorId, undefined);
  assert.deepEqual(
    [...profiles[0].capture, ...profiles[0].pay].map((step) => `${step.action} ${step.selector}`),
    [
      "click footer a[href='#signin/account']",
      'login #login-form',
      'wait .balance-amount',
      "click a.button[href^='#pay/'], a.button[href^='#statement/']",
      'click #sample-details',
      "check input[name='authorized']",
    ],
  );
});

test('confirmed keys reject a changed amount convention instead of replaying the wrong amount', async () => {
  await withWorker(async (worker, path, f) => {
    await worker.execute(request);
    f.browser.prepareExecution = async () => ({ unit: 'cents', open: async () => f.session });
    await assert.rejects(new BrowserWorker(f.browser, new ExecutionStore(path)).execute(request), {
      code: 'idempotency_conflict',
    });
    assert.equal(f.calls.submitted, 1);
  });
});
