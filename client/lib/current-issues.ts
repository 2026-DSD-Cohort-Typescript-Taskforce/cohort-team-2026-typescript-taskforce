// Current issues: drafts that are missing details they need before they can be submitted.
// Built from the bills list, so they persist across reloads, with a status message naming
// what's missing. A draft missing everything is one extraction couldn't read at all.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { BILL_FIELDS, missingForSubmit, type BillField } from './bill-validation.ts';
import { FIELD_LABELS, type Bill } from './bill-view.ts';

export type CurrentIssue = {
  billId: number;
  title: string;
  message: string;
  severity: 'warning' | 'error';
};

export const UNREADABLE = "We couldn't read this PDF. Enter the details by hand.";

/** The submit-required fields this bill leaves out. */
export function billMissing(bill: Bill): BillField[] {
  return missingForSubmit({
    vendor_id: bill.vendor_id,
    property_id: bill.property_id,
    payment_id: bill.payment_id,
    invoice_number: bill.invoice_number,
    amount: bill.amount == null ? null : String(bill.amount),
    date_due: bill.date_due,
  });
}

/** ["payment_id", "date_due"] -> "Missing payment type and due date." */
export function issueMessage(missing: BillField[]): string {
  if (missing.length === BILL_FIELDS.length) return UNREADABLE;
  const labels = missing.map((field) => FIELD_LABELS[field].toLowerCase());
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
  return `Missing ${list}.`;
}

export function currentIssues(bills: Bill[]): CurrentIssue[] {
  return bills.flatMap((bill) => {
    if (bill.status !== 'draft') return [];
    const missing = billMissing(bill);
    if (missing.length === 0) return [];
    return [
      {
        billId: bill.bill_id,
        title: `Bill Vendor ${bill.vendor?.name ?? 'unknown'}`,
        message: issueMessage(missing),
        severity: missing.length === BILL_FIELDS.length ? 'error' : 'warning',
      },
    ];
  });
}
