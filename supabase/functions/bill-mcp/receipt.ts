import type { PaymentInput } from './handle.ts';

export type ReceiptResult = { status: 'stored'; path: string } | { status: 'failed'; error: 'capture_failed' | 'upload_failed' | 'unavailable' };
export type ReceiptStorage = {
  upload(path: string, bytes: Uint8Array): Promise<'stored' | 'exists'>;
  download(path: string): Promise<Uint8Array>;
  attach(paymentId: number, input: PaymentInput, path: string | null, error: string | null): Promise<void>;
};

export async function persistReceipt(input: PaymentInput, payment: unknown, receipt: unknown, storage: ReceiptStorage): Promise<ReceiptResult> {
  const row = payment as Record<string, unknown> | null;
  if (!row || !Number.isSafeInteger(row.payment_id) || Number(row.payment_id) <= 0 || row.bill_id !== input.billId || row.status !== 'success' || row.idempotency_key !== input.idempotencyKey) {
    return { status: 'failed', error: 'upload_failed' };
  }
  const paymentId = Number(row.payment_id);
  const data = receipt as Record<string, unknown> | null;
  let failure: 'capture_failed' | 'upload_failed' | 'unavailable' = data?.status === 'failed' ? 'capture_failed' : 'unavailable';
  try {
    if (!data || data.status !== 'captured') throw new Error('No captured receipt');
    failure = 'upload_failed';
    if (data.billId !== input.billId || data.vendorId !== input.vendorId || data.invoiceNumber !== input.invoiceNumber || data.amountMinor !== Math.round(input.amount * 100) || typeof data.reference !== 'string' || !data.reference.trim() || data.reference.length > 255) throw new Error('Receipt snapshot mismatch');
    if (typeof data.pngBase64 !== 'string' || data.pngBase64.length > 2796204 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.pngBase64)) throw new Error('Invalid receipt bytes');
    const bytes = Uint8Array.from(atob(data.pngBase64), (char) => char.charCodeAt(0));
    const magic = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length < 33 || bytes.length > 2097152 || magic.some((value, i) => bytes[i] !== value)) throw new Error('Invalid PNG');
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (value) => value.toString(16).padStart(2, '0')).join('');
    if (data.sha256 !== hash) throw new Error('Receipt hash mismatch');
    const path = `payments/${paymentId}/receipt.png`;
    const uploaded = await storage.upload(path, bytes);
    if (uploaded === 'exists') {
      const existing = await storage.download(path);
      const existingHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(existing).buffer)), (value) => value.toString(16).padStart(2, '0')).join('');
      if (hash !== existingHash) throw new Error('Existing evidence differs');
    }
    await storage.attach(paymentId, input, path, null);
    return { status: 'stored', path };
  } catch {
    await storage.attach(paymentId, input, null, failure).catch(() => {});
    return { status: 'failed', error: failure };
  }
}
