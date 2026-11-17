import { z } from 'zod';
import { HttpError } from '../middleware/errorHandler';

const portalUrl = z
  .url()
  .max(4096)
  .refine((value) => {
    const url = new URL(value);
    return (
      ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash
    );
  });

export const observeSchema = z.strictObject({ billId: z.number().int().positive(), portalUrl });
export const executeSchema = observeSchema.extend({
  amount: z.number().positive().max(Number.MAX_SAFE_INTEGER),
  vendorId: z.number().int().positive(),
  invoiceNumber: z.string().min(1).max(255),
  idempotencyKey: z.string().min(1).max(255),
});

/** Parse exact USD decimal text into cents; never round a payment amount. */
export function dollarsToCents(value: string): number {
  const match = /^(?:USD\s*|\$\s*)?(\d+|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new HttpError(422, 'Invalid payment amount.', 'payment_mismatch');
  const cents =
    BigInt(match[1].replaceAll(',', '')) * 100n + BigInt((match[2] ?? '').padEnd(2, '0'));
  if (cents <= 0n || cents > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new HttpError(422, 'Invalid payment amount.', 'payment_mismatch');
  }
  return Number(cents);
}

export function requestedCents(amount: number, unit: 'dollars' | 'cents'): number {
  if (unit === 'dollars') return dollarsToCents(String(amount));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new HttpError(400, 'Amount must be positive integer cents.', 'invalid_request');
  }
  return amount;
}

export function assertPaymentMatch(
  actual: { invoice: string; total: string },
  expected: { invoice: string; cents: number },
): void {
  if (
    actual.invoice.trim() !== expected.invoice ||
    dollarsToCents(actual.total) !== expected.cents
  ) {
    throw new HttpError(422, 'Portal total or invoice does not match.', 'payment_mismatch');
  }
}
