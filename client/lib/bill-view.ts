// Bills as the /api/bills route handlers return them and the View Bill page shows them.
// A draft's vendor, property, payment method and amount may be empty until it's finished.

/**
 * The columns the routes select and return, with the vendor and property names and the
 * payment method's type and name embedded.
 */
export const BILL_SELECT =
  'bill_id, status, invoice_number, amount, date_due, date_issued, date_received, vendor_id, property_id, payment_id, vendor:vendors(name), property:properties(name), payment:payment_methods(payment_type, name)';

export type Bill = {
  bill_id: number;
  status: string;
  invoice_number: string | null;
  amount: number | null;
  /** A date, e.g. 2026-11-16. */
  date_due: string | null;
  /** Timestamps with a zone (timestamptz since DC-53), e.g. 2026-11-02T18:55:59.123+00:00. */
  date_issued: string | null;
  date_received: string;
  vendor_id: number | null;
  property_id: number | null;
  payment_id: number | null;
  vendor: { name: string } | null;
  property: { name: string } | null;
  /** payment_type is card or bank (payment_methods' valid_payment_type). */
  payment: { payment_type: string; name: string } | null;
};

/** The bill form's choices, as GET /api/bills/form-options returns them. */
export type FormOptions = {
  vendors: { id: number; name: string; payment_portal_url: string | null }[];
  properties: { id: number; name: string }[];
  paymentMethods: { id: number; type: string; name: string }[];
};

// bills.bill_id is a Postgres integer.
const MAX_BILL_ID = 2147483647;

/** The bill id in a URL, or null when it can't be one, so the route answers 404. */
export function parseBillId(id: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(id)) return null;
  const billId = Number(id);
  return billId <= MAX_BILL_ID ? billId : null;
}

/** Names for the fields submit_bill() reports as missing. */
export const FIELD_LABELS: Record<string, string> = {
  vendor_id: 'Vendor',
  property_id: 'Property',
  payment_id: 'Payment type',
  invoice_number: 'Invoice number',
  amount: 'Amount',
  date_due: 'Due date',
};

/** pending_payment → "Pending payment". */
export function statusLabel(status: string) {
  const words = status.replaceAll('_', ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export function formatAmount(amount: number | null) {
  return amount == null ? 'No amount' : currency.format(amount);
}

// Dates are shown as stored (UTC), so a due date never moves to the day before.
const dateFormat = new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' });

/** 2026-11-16 or 2026-11-16T09:30:00 → "Nov 16, 2026". */
export function formatDate(value: string) {
  return dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}
