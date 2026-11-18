import assert from 'node:assert/strict';
import test from 'node:test';
import { persistReceipt, type ReceiptStorage } from './receipt.ts';

const input = { billId: 7, vendorId: 9, amount: 125, invoiceNumber: 'INV-7', idempotencyKey: 'key-7' };
const payment = { payment_id: 3, bill_id: 7, status: 'success', idempotency_key: 'key-7' };
const bytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=', 'base64'));
async function artifact() {
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
  return { ...input, amountMinor: 12500, status: 'captured', reference: 'TX-7', pngBase64: Buffer.from(bytes).toString('base64'), sha256 };
}
function fixture(overrides: Partial<ReceiptStorage> = {}) {
  const writes: unknown[] = [];
  let uploads = 0;
  const storage: ReceiptStorage = {
    upload: async () => { uploads++; return uploads > 1 ? 'exists' : 'stored'; },
    download: async () => bytes,
    attach: async (...args) => { writes.push(args); },
    ...overrides,
  };
  return { storage, writes, uploads: () => uploads };
}

test('same receipt retries use one deterministic path and verify existing bytes', async () => {
  const f = fixture();
  const result = { status: 'stored', path: 'payments/3/receipt.png' };
  assert.deepEqual(await persistReceipt(input, payment, await artifact(), f.storage), result);
  assert.deepEqual(await persistReceipt(input, payment, await artifact(), f.storage), result);
  assert.equal(f.writes.length, 2);
});

test('wrong payment or receipt identity never uploads', async () => {
  for (const receipt of [{ ...(await artifact()), billId: 8 }, { ...(await artifact()), amountMinor: 1 }, { ...(await artifact()), invoiceNumber: 'OTHER' }, { ...(await artifact()), sha256: 'bad' }]) {
    const f = fixture();
    assert.equal((await persistReceipt(input, payment, receipt, f.storage)).status, 'failed');
    assert.equal(f.uploads(), 0);
  }
  const f = fixture();
  assert.equal((await persistReceipt(input, { ...payment, bill_id: 8 }, await artifact(), f.storage)).status, 'failed');
  assert.equal(f.writes.length, 0);
});

test('capture/upload failure is separate and an upload can later succeed', async () => {
  const captured = await artifact();
  const f = fixture({ upload: async () => { throw new Error('offline'); } });
  assert.deepEqual(await persistReceipt(input, payment, captured, f.storage), { status: 'failed', error: 'upload_failed' });
  assert.deepEqual(await persistReceipt(input, payment, { status: 'failed' }, f.storage), { status: 'failed', error: 'capture_failed' });
  const recovered = fixture();
  assert.equal((await persistReceipt(input, payment, captured, recovered.storage)).status, 'stored');
});

test('a conflicting existing object is never associated with this payment', async () => {
  const f = fixture({ upload: async () => 'exists', download: async () => new Uint8Array([1, 2, 3]) });
  assert.deepEqual(await persistReceipt(input, payment, await artifact(), f.storage), { status: 'failed', error: 'upload_failed' });
  assert.equal((f.writes[0] as unknown[])[2], null);
});
