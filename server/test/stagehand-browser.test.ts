import assert from 'node:assert/strict';
import { captureReceipt } from '../src/payments/capture-receipt';
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
        document.body.innerHTML = '<section id="receipt"><h1 id="confirmed">Paid</h1>' +
          '<div id="receipt-invoice">INV-7</div><div id="receipt-total">$125.00</div>' +
          '<div id="reference">TX-7</div><p>Account 000123456789 Password secret-value</p><input value="4111111111111111"></section>';
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
      receiptSelector: '#receipt',
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
      const paid = await worker.execute(input);
      assert.equal(paid.confirmed, true);
      assert.equal(paid.receipt?.status, 'captured');
      if (paid.receipt?.status === 'captured') {
        assert.equal(paid.receipt.invoiceNumber, 'INV-7');
        assert.equal(paid.receipt.reference, 'TX-7');
        assert.ok(Buffer.from(paid.receipt.pngBase64, 'base64').length > 8);
        if (process.env.RECEIPT_TEST_OUTPUT)
          await writeFile(
            process.env.RECEIPT_TEST_OUTPUT,
            Buffer.from(paid.receipt.pngBase64, 'base64'),
          );
      }
      assert.equal(submitted, 1);
      assert.deepEqual(await worker.execute(input), paid);
      assert.equal(submitted, 1);
    } finally {
      server.closeAllConnections();
      server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'real Chrome receipt capture excludes every non-verified field and rejects changed totals',
  {
    skip: process.env.STAGEHAND_BROWSER_TEST !== '1',
    timeout: 60000,
  },
  async () => {
    const { localBrowser, Stagehand } = await import('@browserbasehq/stagehand');
    const server = createServer((_req, res) => {
      res.setHeader('content-type', 'text/html');
      res.end(
        '<style>*::before{content:"secret-value" !important}</style><dialog id="overlay">Account 000123456789</dialog><script>document.querySelector("dialog").showModal()</script><section id="receipt"><h1 id="done">Paid</h1><p>Password secret-value</p><input value="4111111111111111"><div id="inv" data-secret="secret-value">INV-7</div><div id="amount">$125.00</div><div id="ref">TX-7</div><p>Account 000123456789</p></section>',
      );
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const browser = await localBrowser.launch({ headless: true });
    const stagehand = await Stagehand.create({
      browser,
      model: {
        generate: async () => {
          throw new Error('Model disabled');
        },
      },
    });
    try {
      const [page] = await browser.context.pages();
      await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, {
        timeout: 10000,
      });
      assert.equal(await page.evaluate(() => document.querySelector('dialog')?.open), true);
      let screenshots = 0;
      const renderPage = async () => {
        const isolated = await browser.context.newPage();
        return {
          evaluate: isolated.evaluate.bind(isolated),
          close: () => isolated.close(),
          screenshot: async (options: Parameters<typeof isolated.screenshot>[0]) => {
            const html = await isolated.evaluate(() => document.body.outerHTML);
            for (const secret of [
              'secret-value',
              '4111111111111111',
              '000123456789',
              'data-secret',
              '<input',
              '<dialog',
            ])
              assert.equal(html.includes(secret), false);
            assert.match(
              await isolated.url(),
              /^(?:about:blank|chrome-extension:\/\/[^/]+\/blank\.html)$/,
            );
            assert.notEqual(await isolated.url(), await page.url());
            assert.match(html, /INV-7/);
            screenshots++;
            return isolated.screenshot(options);
          },
        };
      };
      const selectors = {
        receiptSelector: '#receipt',
        confirmationSelector: '#done',
        confirmationInvoiceSelector: '#inv',
        confirmationTotalSelector: '#amount',
        confirmationReferenceSelector: '#ref',
      };
      assert.equal(
        (await captureReceipt(page, selectors, { invoice: 'INV-7', cents: 12500 }, renderPage))
          .reference,
        'TX-7',
      );
      assert.equal(screenshots, 1);
      await assert.rejects(
        captureReceipt(page, selectors, { invoice: 'INV-7', cents: 12600 }, renderPage),
      );
      assert.equal(screenshots, 1);
      assert.equal(
        await page.evaluate(() => !!document.getElementById('dc112-private-receipt-capture')),
        false,
      );
    } finally {
      await stagehand.close();
      await browser.close();
      server.closeAllConnections();
      server.close();
    }
  },
);
