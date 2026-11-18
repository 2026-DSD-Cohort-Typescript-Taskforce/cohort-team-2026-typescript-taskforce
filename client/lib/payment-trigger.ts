import type { ApiResult } from './bill-api.ts';

export type PaymentTriggerResult = {
  outcome: 'success' | 'ineligible' | 'failed' | 'unknown';
  message: string;
  code?: string;
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
