import assert from 'node:assert/strict';
import { test } from 'node:test';
import { StagehandBrowser } from '../src/payments/stagehand-browser';
import { configuredExecutionRepository } from '../src/routes/stagehand.routes';

const portalUrl = 'https://portal.example.test/pay';
const profile = {
  portalUrl,
  vendorId: 9,
  amountUnit: 'dollars',
  invoiceSelector: '#invoice',
  totalSelector: '#total',
  paySelector: '#pay',
  confirmationSelector: '#confirmed',
  confirmationInvoiceSelector: '#receipt-invoice',
  confirmationTotalSelector: '#receipt-total',
  confirmationReferenceSelector: '#reference',
} as const;

test('inline portal profiles are validated and pinned without a deployment file', async () => {
  const browser = new StagehandBrowser(undefined, {
    profilesJson: JSON.stringify([profile]),
    provider: 'browserbase',
    browserbaseApiKey: 'test-key',
  });
  const execution = await browser.prepareExecution({
    billId: 7,
    vendorId: 9,
    portalUrl,
    amount: 125,
    invoiceNumber: 'INV-7',
    idempotencyKey: 'payment-7',
  });
  assert.equal(execution.unit, 'dollars');
});

test('malformed inline profiles fail closed instead of falling back to a file', async () => {
  const browser = new StagehandBrowser('/does/not/matter.json', {
    profilesJson: '[{"portalUrl":"https://portal.example.test/pay"}]',
    provider: 'browserbase',
    browserbaseApiKey: 'test-key',
  });
  await assert.rejects(browser.open({ billId: 7, portalUrl }, 'observe'), {
    status: 503,
    code: 'portal_error',
  });
});

test('Browserbase mode fails closed before launch when its API key is absent', async () => {
  const browser = new StagehandBrowser(undefined, {
    profilesJson: JSON.stringify([profile]),
    provider: 'browserbase',
  });
  await assert.rejects(browser.open({ billId: 7, portalUrl }, 'observe'), {
    status: 503,
    code: 'portal_error',
  });
});

test('Supabase state cannot replace a legacy journal without reconciliation acknowledgement', () => {
  const previous = {
    backend: process.env.STAGEHAND_STATE_BACKEND,
    acknowledgement: process.env.STAGEHAND_STATE_CUTOVER_ACK,
  };
  process.env.STAGEHAND_STATE_BACKEND = 'supabase';
  delete process.env.STAGEHAND_STATE_CUTOVER_ACK;
  try {
    assert.throws(configuredExecutionRepository, /Reconcile every legacy Stagehand file-journal/);
  } finally {
    if (previous.backend === undefined) delete process.env.STAGEHAND_STATE_BACKEND;
    else process.env.STAGEHAND_STATE_BACKEND = previous.backend;
    if (previous.acknowledgement === undefined) delete process.env.STAGEHAND_STATE_CUTOVER_ACK;
    else process.env.STAGEHAND_STATE_CUTOVER_ACK = previous.acknowledgement;
  }
});

test(
  'Browserbase observes the configured synthetic portal through the production adapter',
  { skip: process.env.BROWSERBASE_TEST !== '1', timeout: 120_000 },
  async () => {
    const url = process.env.BROWSERBASE_TEST_URL;
    const apiKey = process.env.BROWSERBASE_API_KEY;
    assert.ok(url, 'BROWSERBASE_TEST_URL is required');
    assert.ok(apiKey, 'BROWSERBASE_API_KEY is required');
    const browser = new StagehandBrowser(undefined, {
      profilesJson: JSON.stringify([{ ...profile, portalUrl: url }]),
      provider: 'browserbase',
      browserbaseApiKey: apiKey,
    });
    const session = await browser.open({ billId: 7, portalUrl: url }, 'observe');
    try {
      assert.match(await session.text(), /INV-7/);
    } finally {
      await session.close();
    }
  },
);
