import type { ApiResult } from './bill-api.ts';

export type PaymentTriggerResult = {
  outcome: 'success' | 'ineligible' | 'failed' | 'unknown';
  message: string;
  code?: string;
  paymentId?: number;
  receiptStatus?: 'stored' | 'failed' | 'unavailable';
};

export type PaymentReceiptDetails = {
  paymentId: number;
  status: 'stored' | 'failed' | 'unavailable';
};

export const canShowPaymentTrigger = (role: string | null | undefined) => role === 'system_admin';

export function paymentTriggerNotice(result: PaymentTriggerResult): {
  tone: 'success' | 'warning' | 'error';
  message: string;
} {
  return {
    tone:
      result.outcome === 'success' ? 'success' : result.outcome === 'unknown' ? 'warning' : 'error',
    message: result.message,
  };
}

export function paymentReceiptDetails(result: PaymentTriggerResult): PaymentReceiptDetails | null {
  if (
    result.outcome !== 'success' ||
    !Number.isInteger(result.paymentId) ||
    (result.paymentId ?? 0) <= 0
  )
    return null;
  return {
    paymentId: result.paymentId!,
    status: result.receiptStatus ?? 'unavailable',
  };
}

export async function triggerBillPayment(
  billId: number,
): Promise<ApiResult<PaymentTriggerResult> | null> {
  // Kept out of the pure notice/visibility helpers so they can be tested without a browser.
  const { call } = await import('./bill-api');
  return call(
    `/api/bills/${billId}/payment-trigger`,
    { method: 'POST' },
    (body: PaymentTriggerResult) => body,
    'The automated payment could not be completed.',
  );
}

export async function loadPaymentReceipt(
  billId: number,
  paymentId: number,
): Promise<ApiResult<{ url: string }> | null> {
  const { call } = await import('./bill-api');
  return call(
    `/api/bills/${billId}/payments/${paymentId}/receipt`,
    undefined,
    (body: { url: string }) => body,
    'The receipt could not be loaded.',
  );
}
