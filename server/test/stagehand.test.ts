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
import { errorHandler, HttpError } from '../src/middleware/errorHandler';
import { BrowserWorker, type PortalBrowser, type PortalSession } from '../src/payments/worker';
import { ExecutionStore } from '../src/payments/execution-store';
import { dollarsToCents, executeSchema } from '../src/payments/worker-input';
import {
  parsePortalProfiles,
  preparationSteps,
  selectObserveProfile,
  StagehandBrowser,
} from '../src/payments/stagehand-browser';
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
    submit: async (_expected, markSubmitting) => {
      await markSubmitting();
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
      const malformed = await fetch(url + '/observe', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer shared-secret',
        },
        body: '{',
      });
      assert.equal(malformed.status, 400);
      assert.deepEqual(await malformed.json(), {
        error: 'The request body is not valid JSON.',
        code: 'invalid_request',
      });
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

test('observation rejects a URL absent from operator portal profiles before Chrome opens', async () => {
  const path = await mkdtemp(join(tmpdir(), 'stagehand-profile-test-'));
  try {
    const profiles = join(path, 'profiles.json');
    await writeFile(
      profiles,
      JSON.stringify([
        {
          portalUrl: request.portalUrl,
          vendorId: 9,
          amountUnit: 'dollars',
          invoiceSelector: '#invoice',
          totalSelector: '#total',
          paySelector: '#pay',
          confirmationSelector: '#confirmed',
          confirmationInvoiceSelector: '#receipt-invoice',
          confirmationTotalSelector: '#receipt-total',
          confirmationReferenceSelector: '#reference',
        },
      ]),
    );
    const browser = new StagehandBrowser(profiles);
    await assert.rejects(
      browser.open({ billId: 7, portalUrl: 'http://127.0.0.1:3000/internal' }, 'observe'),
      { status: 422, code: 'invalid_request' },
    );
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test('checked-in portal profiles are pinned to exact vendor URLs', async () => {
  const profiles = parsePortalProfiles(await readFile(join(__dirname, '../profiles.json'), 'utf8'));
  assert.equal(profiles.length, 9);
  assert.ok(profiles.every((profile) => profile.portalUrl && profile.vendorId));

  const profile = selectObserveProfile(profiles, 'https://copper-ridge-utility-demo.vercel.app');
  assert.ok(profile);
  assert.equal(profile.vendorId, 3);
  assert.equal(profile.capture?.[0]?.selector, "footer a[href='#signin/account']");
  assert.equal(selectObserveProfile(profiles, 'https://unconfigured.example'), undefined);
});

test('execution prepares login and checkout but leaves the final payment click to submit', async () => {
  const profiles = parsePortalProfiles(await readFile(join(__dirname, '../profiles.json'), 'utf8'));
  const profile = selectObserveProfile(profiles, 'https://brightwater-utility-demo.vercel.app');
  assert.ok(profile);

  assert.deepEqual(preparationSteps(profile, 'observe'), profile.capture);
  assert.deepEqual(preparationSteps(profile, 'execute'), [...profile.capture!, ...profile.pay!]);
  assert.ok(
    !preparationSteps(profile, 'execute').some((step) => step.selector === profile.paySelector),
  );
  assert.ok(profile.pay!.some((step) => step.action === 'select' && step.value === 'success'));
  assert.throws(() =>
    parsePortalProfiles(
      JSON.stringify([{ ...profile, pay: [{ action: 'select', selector: 'select' }] }]),
    ),
  );
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

test('a known pre-submission failure permits the same request to retry safely', async () => {
  await withWorker(async (worker, _path, f) => {
    const originalReview = f.session.review;
    let attempts = 0;
    f.session.review = async () => {
      attempts++;
      if (attempts === 1) throw new Error('portal was not ready');
      return originalReview();
    };

    await assert.rejects(worker.execute(request), { code: 'portal_error' });
    assert.equal(f.calls.submitted, 0);
    assert.deepEqual(await worker.execute(request), { confirmed: true });
    assert.equal(f.calls.submitted, 1);
  });
});

test('a mismatch in the final pre-click check remains safely retryable', async () => {
  await withWorker(async (worker, _path, f) => {
    let mismatch = true;
    f.session.submit = async (_expected, markSubmitting) => {
      if (mismatch) {
        mismatch = false;
        throw new HttpError(422, 'Payment details changed.', 'payment_mismatch');
      }
      await markSubmitting();
      f.calls.submitted++;
    };

    await assert.rejects(worker.execute(request), { code: 'payment_mismatch' });
    assert.equal(f.calls.submitted, 0);
    assert.deepEqual(await worker.execute(request), { confirmed: true });
    assert.equal(f.calls.submitted, 1);
  });
});

test('concurrent retries after a known pre-submission failure still submit once', async () => {
  await withWorker(async (worker, _path, f) => {
    f.session.review = async () => {
      throw new Error('portal was not ready');
    };
    await assert.rejects(worker.execute(request), { code: 'portal_error' });
    f.session.review = async () => f.review;

    const results = await Promise.allSettled([worker.execute(request), worker.execute(request)]);
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(f.calls.submitted, 1);
  });
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

test('receipt capture failure cannot undo a confirmed payment or allow another submission', async () => {
  await withWorker(async (worker, _path, f) => {
    Object.assign(f.session, {
      captureReceipt: async () => {
        throw new Error('capture failed');
      },
    });
    const result = await worker.execute(request);
    assert.equal(result.confirmed, true);
    assert.deepEqual((result as { receipt?: unknown }).receipt, { status: 'failed' });
    assert.deepEqual(await worker.execute(request), result);
    assert.equal(f.calls.submitted, 1);
  });
});

test('stored receipt can be retrieved for upload without opening or paying again', async () => {
  await withWorker(async (worker, path, f) => {
    const artifact = { pngBase64: 'synthetic-png', sha256: 'synthetic-sha', reference: 'TX-7' };
    Object.assign(f.session, { captureReceipt: async () => artifact });
    const result = await worker.execute(request);
    assert.equal(result.confirmed, true);
    const store = new ExecutionStore(path) as ExecutionStore & {
      receipt(billId: number, key: string): Promise<unknown>;
    };
    const receipt = await store.receipt(request.billId, request.idempotencyKey);
    assert.deepEqual(receipt, (result as { receipt?: unknown }).receipt);
    await assert.rejects(store.receipt(999, request.idempotencyKey));
    assert.equal(f.calls.submitted, 1);
    assert.equal(f.calls.opened, 1);
  });
});

test('receipt HTTP endpoint authenticates, validates identity, and never submits', async () => {
  await withWorker(async (worker, _path, f) => {
    Object.assign(f.session, {
      captureReceipt: async () => ({ pngBase64: 'synthetic', sha256: 'hash', reference: 'TX' }),
    });
    await worker.execute(request);
    const app = express();
    app.use(createStagehandRoutes(worker, () => 'receipt-test-secret'));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/receipt`;
    try {
      const post = (body: unknown, secret = 'receipt-test-secret') =>
        fetch(url, {
          method: 'POST',
          headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      const input = { billId: request.billId, idempotencyKey: request.idempotencyKey };
      assert.equal((await post(input, 'wrong')).status, 401);
      assert.equal((await post({ ...input, selector: '#anything' })).status, 400);
      assert.equal((await post({ ...input, billId: 999 })).status, 404);
      const response = await post(input);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).receipt.status, 'captured');
      assert.equal(f.calls.submitted, 1);
      assert.equal(f.calls.opened, 1);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
