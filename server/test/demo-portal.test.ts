import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import express from 'express';
import { StagehandBrowser } from '../src/payments/stagehand-browser';
import { BrowserWorker } from '../src/payments/worker';
import { ExecutionStore } from '../src/payments/execution-store';
import { createStagehandRoutes } from '../src/routes/stagehand.routes';
import { errorHandler } from '../src/middleware/errorHandler';

test(
  'DC96 demo: authenticated observe, mismatches, confirmation and durable replay',
  {
    skip: !process.env.STAGEHAND_DEMO_URL,
    timeout: 180000,
  },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'stagehand-demo-'));
    const profiles = JSON.parse(
      await readFile(join(__dirname, 'fixtures/demo-portals.json'), 'utf8'),
    );
    profiles[0].portalUrl = process.env.STAGEHAND_DEMO_URL;
    const profilesPath = join(directory, 'profiles.json');
    await writeFile(profilesPath, JSON.stringify(profiles));
    let opens = 0;
    class CountingBrowser extends StagehandBrowser {
      override async open(...args: Parameters<StagehandBrowser['open']>) {
        opens++;
        return super.open(...args);
      }
    }
    const browser = new CountingBrowser(profilesPath);
    const statePath = join(directory, 'state');
    const worker = new BrowserWorker(browser, new ExecutionStore(statePath));
    const app = express();
    app.use(createStagehandRoutes(worker, () => 'synthetic-test-secret'));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const input = {
      billId: 7,
      vendorId: 9,
      portalUrl: profiles[0].portalUrl,
      amount: 125,
      invoiceNumber: 'INV-7',
      idempotencyKey: 'demo-confirmed',
    };
    async function post(path: string, body: unknown, authorized = true) {
      return fetch(base + path, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(authorized ? { authorization: 'Bearer synthetic-test-secret' } : {}),
        },
        body: JSON.stringify(body),
      });
    }
    try {
      assert.equal((await post('/execute', input, false)).status, 401);
      assert.equal(opens, 0);
      const observed = await post('/observe', { billId: 7, portalUrl: input.portalUrl });
      assert.equal(observed.status, 200);
      assert.match((await observed.json()).pageText, /INV-7/);
      for (const mismatch of [{ amount: 126 }, { invoiceNumber: 'OTHER' }]) {
        const response = await post('/execute', {
          ...input,
          ...mismatch,
          idempotencyKey: JSON.stringify(mismatch),
        });
        assert.equal(response.status, 422);
        assert.equal((await response.json()).code, 'payment_mismatch');
      }
      const paid = await post('/execute', input);
      assert.equal(paid.status, 200);
      assert.deepEqual(await paid.json(), { confirmed: true });
      const afterPayment = opens;
      // A fresh store instance must replay without opening another browser.
      const restarted = new BrowserWorker(browser, new ExecutionStore(statePath));
      assert.deepEqual(await restarted.execute(input), { confirmed: true });
      assert.equal(opens, afterPayment);
      const replay = await post('/execute', input);
      assert.equal(replay.status, 200);
      assert.equal(opens, afterPayment);
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
