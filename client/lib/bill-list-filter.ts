// What the bills list shows for each bill, and its search and status filter (DC-73).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { formatAmount, formatDate, statusLabel, type Bill } from "./bill-view.ts";

// bills_status_check's order, so the status filter lists them as the lifecycle goes.
const STATUS_ORDER = [
  "draft",
  "pending_approval",
  "approval_denied",
  "pending_payment",
  "processing",
  "payment_success",
  "payment_failed",
];

/** The text of one row. payment is null when the bill has no payment method yet. */
export function billRow(bill: Bill) {
  const vendor = bill.vendor?.vendor_name ?? null;
  return {
    vendor: vendor ?? "No vendor",
    initials: initials(vendor),
    property: bill.property?.property_name ?? "No property",
    // payment_type is card or bank.
    payment: bill.payment ? `${capitalize(bill.payment.payment_type)} · ${bill.payment.name}` : null,
    amount: formatAmount(bill.amount),
    due: bill.date_due ? `Due ${formatDate(bill.date_due)}` : "No due date",
  };
}

/**
 * The bills whose vendor, property, invoice number or due date (as the row shows it)
 * contains `query`, ignoring case, and whose status is `status` ("" for any).
 */
export function filterBills(bills: Bill[], query: string, status: string): Bill[] {
  const needle = query.trim().toLowerCase();
  return bills.filter((bill) => {
    if (status && bill.status !== status) return false;
    if (!needle) return true;
    const haystack = [
      bill.vendor?.vendor_name,
      bill.property?.property_name,
      bill.invoice_number,
      bill.date_due && formatDate(bill.date_due),
    ];
    return haystack.some((text) => text?.toLowerCase().includes(needle));
  });
}

/** The statuses the bills have, for the status filter: only those, in lifecycle order. */
export function statusOptions(bills: Bill[]): { value: string; label: string }[] {
  const present = new Set(bills.map((bill) => bill.status));
  const known = STATUS_ORDER.filter((status) => present.has(status));
  const unknown = [...present].filter((status) => !STATUS_ORDER.includes(status)).sort();
  return [...known, ...unknown].map((value) => ({ value, label: statusLabel(value) }));
}

// "Alder Creek Landscaping" → "AC", "Brightwater" → "B".
function initials(name: string | null) {
  if (!name) return "?";
  const words = name.split(/\s+/).filter((word) => /^[\p{L}\p{N}]/u.test(word));
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("");
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
