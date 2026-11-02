// Bills as the /api/bills route handlers return them and the View Bill page shows them.

/** The columns both GET routes select, with the vendor and property names embedded. */
export const BILL_SELECT =
  "bill_id, status, invoice_number, amount, date_due, date_issued, date_received, vendor:vendors(vendor_name), property:properties(property_name)";

export type Bill = {
  bill_id: number;
  status: string;
  invoice_number: string | null;
  amount: number;
  /** A date, e.g. 2026-11-16. */
  date_due: string | null;
  /** Timestamps in UTC with no zone, e.g. 2026-11-02T18:55:59.123. */
  date_issued: string | null;
  date_received: string;
  vendor: { vendor_name: string } | null;
  property: { property_name: string } | null;
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
  vendor_id: "Vendor",
  property_id: "Property",
  invoice_number: "Invoice number",
  amount: "Amount",
  date_due: "Due date",
};

/** pending_payment → "Pending payment". */
export function statusLabel(status: string) {
  const words = status.replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

export function formatAmount(amount: number) {
  return currency.format(amount);
}

// Dates are shown as stored (UTC), so a due date never moves to the day before.
const dateFormat = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone: "UTC" });

/** 2026-11-16 or 2026-11-16T09:30:00 → "Nov 16, 2026". */
export function formatDate(value: string) {
  return dateFormat.format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}
