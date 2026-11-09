// The approvals queue (DC-81): the decisions an approver can make, the request check and
// error replies for POST /api/bills/[id]/decision, and the queue's table rows.
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import type { Bill } from "./bill-view.ts";
import { BILL_NOT_FOUND, parseFields, toErrorResponse, type ErrorResponse, type SupabaseError } from "./submit-errors.ts";

export type Decision = "approved" | "needs_revision" | "denied";

// In the order the modal lists them.
export const DECISIONS: { value: Decision; label: string; description: string }[] = [
  { value: "approved", label: "Bill Approved", description: "This bill may be processed for payment." },
  {
    value: "needs_revision",
    label: "Bill Needs Revision",
    description: "This bill requires revisions prior to approval.",
  },
  {
    value: "denied",
    label: "Bill Not Approved",
    description: "This bill may not be processed for payment at this time.",
  },
];

/** users.role of the people who may decide bills. */
export const FINANCIAL_APPROVER = "financial_approver";

/** decide_bill() refuses a longer note (counted as char_length, i.e. code points). */
export const NOTE_MAX = 500;

export const DECISION_FAILED = "Couldn't save the decision. Try again.";

/** payment_methods.payment_type as the queue shows it; null when the bill has no method. */
export function paymentTypeLabel(type: string | null): string {
  if (type === null) return "—";
  if (type === "card") return "Credit/Debit Card";
  if (type === "bank") return "Bank account";
  return type;
}

export function decisionBanner(decision: Decision, billId: number): string {
  switch (decision) {
    case "approved":
      return `Bill ${billId} approved.`;
    case "needs_revision":
      return `Bill ${billId} sent back for revision.`;
    case "denied":
      return `Bill ${billId} not approved.`;
  }
}

// Spread, not .length: Postgres counts code points, JavaScript counts UTF-16 units.
/** The trimmed note's length in code points, which the modal's counter shows. */
export function noteLength(note: string): number {
  return [...note.trim()].length;
}

/** Checks the request body; every bad field is named, decision first. */
export function validateDecisionInput(
  body: Record<string, unknown>,
): { input: { decision: Decision; note: string | null } } | { fields: string[] } {
  const fields: string[] = [];
  const decision = DECISIONS.find((d) => d.value === body.decision)?.value;
  if (!decision) fields.push("decision");

  let note: string | null = null;
  if (body.note !== null && body.note !== undefined) {
    if (typeof body.note !== "string") {
      fields.push("note");
    } else {
      const trimmed = body.note.trim();
      if (noteLength(trimmed) > NOTE_MAX) fields.push("note");
      else note = trimmed === "" ? null : trimmed;
    }
  }

  return decision && fields.length === 0 ? { input: { decision, note } } : { fields };
}

const FIELD_MESSAGES: Record<string, string> = {
  decision: "Choose an approval decision.",
  note: `Keep the note to ${NOTE_MAX} characters or fewer.`,
};

/** A 400 whose message is for the first bad field. */
export function invalidDecision(fields: string[]): ErrorResponse {
  return {
    status: 400,
    body: {
      error: FIELD_MESSAGES[fields[0]] ?? FIELD_MESSAGES.decision,
      code: "invalid_decision",
      fields,
    },
  };
}

/**
 * Maps the error to a reply. The PTxyz codes come from decide_bill(); session errors and
 * anything unexpected go through toErrorResponse(), the latter as a 500.
 */
export function toDecisionErrorResponse(error: SupabaseError): ErrorResponse {
  switch (error.code) {
    case "PT400":
      return invalidDecision(parseFields(error.details));
    case "PT403":
      return { status: 403, body: { error: "Only financial approvers can decide bills.", code: "forbidden" } };
    case "PT404":
      return BILL_NOT_FOUND;
    case "PT409":
      return {
        status: 409,
        body: {
          error: "This bill has already been decided.",
          code: "not_pending_approval",
          ...(error.details ? { status: error.details } : {}),
        },
      };
    default:
      return toErrorResponse(error, DECISION_FAILED);
  }
}

/** One line of the approvals table, with the bill kept for the decision modal. */
export type ApprovalRow = {
  bill_id: number;
  vendor: string;
  property: string;
  date_due: string | null;
  payment_type: string;
  amount: number;
  status: string;
  bill: Bill;
};

export function approvalRow(bill: Bill): ApprovalRow {
  return {
    bill_id: bill.bill_id,
    vendor: bill.vendor?.name ?? "—",
    property: bill.property?.name ?? "—",
    date_due: bill.date_due,
    payment_type: paymentTypeLabel(bill.payment?.payment_type ?? null),
    amount: bill.amount,
    status: bill.status,
    bill,
  };
}

// Plain objects, not TanStack's SortingState, so this module needs no package.
/** Earliest due date first. */
export const APPROVALS_DEFAULT_SORT: { id: string; desc: boolean }[] = [{ id: "date_due", desc: false }];
