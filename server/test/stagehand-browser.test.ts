import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import { StagehandBrowser, type PortalProfile } from '../src/payments/stagehand-browser';
import { BrowserWorker } from '../src/payments/worker';
import { ExecutionStore } from '../src/payments/execution-store';

// Explicit opt-in: launches Chrome and needs the Stagehand extension downloaded.
test(
  'real Chrome observes, blocks navigation, rejects mismatches, and confirms one payment',
  {
    skip: process.env.STAGEHAND_BROWSER_TEST !== '1',
    timeout: 180000,
  },
  async () => {
    let submitted = 0;
    let forbidden = 0;
    const server = createServer((req, res) => {
      if (req.url === '/slow') {
        setTimeout(() => res.end('loaded'), 300);
        return;
      }
      if (req.url === '/worker') {
        res.setHeader('content-type', 'text/html');
        res.end(`<body>Worker fixture<img src="/slow"><script>
        new Worker(URL.createObjectURL(new Blob(["fetch('http://${req.headers.host}/submit', {method:'POST'})"], {type:'text/javascript'})));
      </script></body>`);
        return;
      }
      if (req.url === '/other') {
        forbidden++;
        res.end('Forbidden target');
        return;
      }
      if (req.url === '/redirect') {
        res.writeHead(302, { location: '/other' });
        res.end();
        return;
      }
      if (req.url === '/submit' && req.method === 'POST') {
        submitted++;
        res.end('OK');
        return;
      }
      res.setHeader('content-type', 'text/html');
      res.end(`<!doctype html><body>
      <div id="invoice">INV-7</div><div id="total">$125.00</div>
      <button id="pay" disabled onclick="pay()">Pay</button>
      <script>
      // Model checkout hydration restoring state before accepting Pay.
      setTimeout(() => { document.querySelector("#pay").disabled = false; }, 2500);
      async function pay() {
        await fetch('/submit', {method: 'POST'});
        document.body.innerHTML = '<div id="confirmed">Paid</div>' +
          '<div id="receipt-invoice">INV-7</div><div id="receipt-total">$125.00</div>' +
          '<div id="reference">TX-7</div>';
      }</script></body>`);
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const directory = await mkdtemp(join(tmpdir(), 'stagehand-browser-'));
    const profile: PortalProfile = {
      portalUrl: base + '/pay',
      vendorId: 9,
      amountUnit: 'dollars',
      invoiceSelector: '#invoice',
      totalSelector: '#total',
      paySelector: '#pay',
      confirmationSelector: '#confirmed',
      confirmationInvoiceSelector: '#receipt-invoice',
      confirmationTotalSelector: '#receipt-total',
      confirmationReferenceSelector: '#reference',
    };
    const profiles = join(directory, 'profiles.json');
    await writeFile(
      profiles,
      JSON.stringify([
        profile,
        { ...profile, portalUrl: base + '/worker' },
        { ...profile, portalUrl: base + '/redirect' },
      ]),
    );
    const browser = new StagehandBrowser(profiles);
    const worker = new BrowserWorker(browser, new ExecutionStore(join(directory, 'state')));
    const input = {
      billId: 7,
      vendorId: 9,
      portalUrl: profile.portalUrl,
      amount: 125,
      invoiceNumber: 'INV-7',
      idempotencyKey: 'real-payment',
    };
    try {
      const observed = await worker.observe(input);
      assert.match(observed.pageText, /INV-7/);
      assert.equal(submitted, 0);
      await worker.observe({ billId: 7, portalUrl: base + '/worker' }).catch(() => {});
      assert.equal(submitted, 0, 'observation workers must not send a payment POST');
      await assert.rejects(worker.observe({ billId: 7, portalUrl: base + '/redirect' }));
      assert.equal(forbidden, 0, 'redirect must be blocked before requesting its destination');
      await assert.rejects(worker.execute({ ...input, amount: 126, idempotencyKey: 'mismatch' }), {
        code: 'payment_mismatch',
      });
      assert.equal(submitted, 0);
      assert.deepEqual(await worker.execute(input), { confirmed: true });
      assert.equal(submitted, 1);
      assert.deepEqual(await worker.execute(input), { confirmed: true });
      assert.equal(submitted, 1);
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
