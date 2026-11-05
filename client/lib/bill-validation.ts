// The rules a bill's details must meet before they're saved (DC-72). The bill form runs
// them as the user types and before saving; POST and PATCH /api/bills run them again on
// the request body. Only imports with a .ts extension, so `npm test` (node --test) can
// load it.

import { FIELD_LABELS } from "./bill-view.ts";

/** The bill fields a user can enter. Everything else (status, user_id, …) is the server's. */
export const BILL_FIELDS = ["vendor_id", "property_id", "payment_id", "invoice_number", "amount", "date_due"] as const;

export type BillField = (typeof BILL_FIELDS)[number];

/** A bill's details as the API takes them. */
export type BillInput = {
  vendor_id: number | null;
  property_id: number | null;
  payment_id: number | null;
  invoice_number: string | null;
  /** A decimal string with two places, e.g. "1234.50", so no precision is lost. */
  amount: string;
  /** A date, e.g. 2026-11-16. */
  date_due: string | null;
};

/** What a form or a request body holds: strings from inputs, or JSON values. */
export type BillValues = Partial<Record<BillField, unknown>>;

/** One readable message per field that failed. */
export type FieldErrors = Partial<Record<BillField, string>>;

export type ValidationResult<T> = { input: T; errors?: undefined } | { input?: undefined; errors: FieldErrors };

// bills.amount is NUMERIC(12, 2); ids are Postgres integers; invoice_number is VARCHAR(255).
const MAX_AMOUNT_DIGITS = 10;
const MAX_ID = 2147483647;
const MAX_INVOICE_LENGTH = 255;

// 1234, 1234.5, 1,234.56. Commas only as thousands separators.
const AMOUNT_PATTERN = /^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Checks every field and returns the details to send, or an error per failing field.
 * An amount is always needed, since bills.amount can't be empty. With `partial` (an
 * edit), fields that aren't in `values` are left out instead.
 */
export function validateBill(values: BillValues, options?: { partial?: false }): ValidationResult<BillInput>;
export function validateBill(values: BillValues, options: { partial: true }): ValidationResult<Partial<BillInput>>;
export function validateBill(
  values: BillValues,
  { partial = false }: { partial?: boolean } = {},
): ValidationResult<Partial<BillInput>> {
  const input: Partial<BillInput> = {};
  const errors: FieldErrors = {};

  for (const field of BILL_FIELDS) {
    if (partial && !(field in values)) continue;
    const result = checkers[field](values[field]);
    if ("error" in result) errors[field] = result.error;
    else Object.assign(input, { [field]: result.value });
  }

  return Object.keys(errors).length > 0 ? { errors } : { input };
}

/**
 * The fields submit_bill() requires that these details leave out, in its order. Saving a
 * draft doesn't need them.
 */
export function missingForSubmit(input: Partial<BillInput>): BillField[] {
  const missing: BillField[] = [];
  if (input.vendor_id == null) missing.push("vendor_id");
  if (input.property_id == null) missing.push("property_id");
  if (!input.invoice_number) missing.push("invoice_number");
  if (input.amount == null || Number(input.amount) <= 0) missing.push("amount");
  if (!input.date_due) missing.push("date_due");
  return missing;
}

/** ["vendor_id", "date_due"] → "Add vendor and due date to submit." */
export function submitHint(missing: BillField[]): string {
  const labels = missing.map((field) => FIELD_LABELS[field]?.toLowerCase() ?? field);
  if (labels.length === 0) return "";
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
  return `Add ${list} to submit.`;
}

type Checked<T> = { value: T } | { error: string };

const checkers: Record<BillField, (value: unknown) => Checked<unknown>> = {
  vendor_id: (value) => checkId(value, "Choose a vendor from the list."),
  property_id: (value) => checkId(value, "Choose a property from the list."),
  payment_id: (value) => checkId(value, "Choose a payment method from the list."),
  invoice_number: checkInvoiceNumber,
  amount: checkAmount,
  date_due: checkDate,
};

/** "" or null is no choice; otherwise a positive integer, as a number or a select's string. */
function checkId(value: unknown, error: string): Checked<number | null> {
  if (value == null || value === "") return { value: null };
  const id = typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : value;
  return Number.isInteger(id) && (id as number) > 0 && (id as number) <= MAX_ID ? { value: id as number } : { error };
}

/** Stored trimmed; a blank one is no invoice number, as the database stores it. */
function checkInvoiceNumber(value: unknown): Checked<string | null> {
  if (value == null) return { value: null };
  if (typeof value !== "string") return { error: "Enter the invoice number as text." };
  const invoiceNumber = value.trim();
  if (invoiceNumber.length > MAX_INVOICE_LENGTH) return { error: `Use ${MAX_INVOICE_LENGTH} characters or fewer.` };
  return { value: invoiceNumber || null };
}

function checkAmount(value: unknown): Checked<string> {
  const text = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (text == null || (typeof text === "string" && text.trim() === "")) return { error: "Enter an amount." };
  if (typeof text !== "string") return { error: "Enter an amount like 1234.56." };

  const amount = text.trim().replace(/^\$/, "");
  if (!AMOUNT_PATTERN.test(amount)) return { error: "Enter an amount like 1234.56, with at most 2 decimal places." };

  const [whole, fraction = ""] = amount.replaceAll(",", "").split(".");
  const digits = whole.replace(/^0+(?=\d)/, "");
  if (digits.length > MAX_AMOUNT_DIGITS) return { error: "Enter an amount up to 9,999,999,999.99." };
  const normalized = `${digits}.${fraction.padEnd(2, "0")}`;
  if (Number(normalized) <= 0) return { error: "Enter an amount above 0." };
  return { value: normalized };
}

/** A real calendar date as a date input gives it, e.g. 2026-11-16; past dates are fine. */
function checkDate(value: unknown): Checked<string | null> {
  if (value == null || value === "") return { value: null };
  const match = typeof value === "string" ? DATE_PATTERN.exec(value) : null;
  if (match) {
    const [, year, month, day] = match.map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year >= 1 && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return { value: match[0] };
  }
  return { error: "Enter a valid date." };
}
