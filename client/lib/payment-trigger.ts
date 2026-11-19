import type { ApiResult } from './bill-api.ts';
import { formatAmount, formatDate, type Bill } from './bill-view.ts';
import type { ShownPayment } from './payment-trigger-service.ts';

export type PaymentTriggerResult = {
  outcome: 'success' | 'ineligible' | 'failed' | 'unknown';
  message: string;
  code?: string;
};

export const canShowPaymentTrigger = (role: string | null | undefined) => role === 'system_admin';

export type PaymentTriggerBill = Pick<
  Bill,
  | 'bill_id'
  | 'status'
  | 'invoice_number'
  | 'amount'
  | 'vendor'
  | 'vendor_id'
  | 'payment_method_id'
  | 'payment'
>;

// bill-mcp prepares every triggered payment with no fees, in US dollars.
const FEES = 0;
const CURRENCY = 'USD';

/** Today in the admin's own time zone, e.g. 2026-11-18. */
export function localDate(now = new Date()) {
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Every value bill-mcp will authorize, as the confirm dialog lists it, and the same values as
 * sent. `shown` is null while the bill cannot be paid or is missing a value.
 */
export function paymentSummary(
  bill: PaymentTriggerBill,
  paymentDate: string,
): { rows: [string, string][]; shown: ShownPayment | null } {
  const { vendor_id, invoice_number, payment_method_id, amount } = bill;
  const rows: [string, string][] = [
    ['Vendor', bill.vendor?.name ?? 'Missing'],
    ['Invoice', invoice_number ?? 'Missing'],
    ['Payment method', bill.payment?.name ?? 'Missing'],
    ['Amount', formatAmount(amount)],
    ['Fees', formatAmount(FEES)],
    ['Total', amount === null ? 'No amount' : formatAmount(amount + FEES)],
    ['Currency', CURRENCY],
    ['Payment date', formatDate(paymentDate)],
  ];
  const payable = bill.status === 'pending_payment' || bill.status === 'payment_failed';
  // A name the dialog could not show leaves the bill unpayable here too.
  if (
    !payable ||
    vendor_id === null ||
    !bill.vendor ||
    invoice_number === null ||
    payment_method_id === null ||
    !bill.payment ||
    amount === null
  ) {
    return { rows, shown: null };
  }
  return {
    rows,
    shown: {
      vendor_id,
      invoice_number,
      payment_method_id,
      amount,
      fees: FEES,
      currency: CURRENCY,
      payment_date: paymentDate,
    },
  };
}

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
  shown: ShownPayment,
): Promise<ApiResult<PaymentTriggerResult> | null> {
  // Kept out of the pure notice/visibility helpers so they can be tested without a browser.
  const { call, sendJson } = await import('./bill-api');
  return call(
    `/api/bills/${billId}/payment-trigger`,
    sendJson('POST', shown),
    (body: PaymentTriggerResult) => body,
    'The automated payment could not be completed.',
  );
}
