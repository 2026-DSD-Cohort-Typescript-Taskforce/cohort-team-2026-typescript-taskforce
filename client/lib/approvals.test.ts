import assert from "node:assert/strict";
import { test } from "node:test";
import {
  APPROVALS_DEFAULT_SORT,
  DECISIONS,
  DECISION_FAILED,
  FINANCIAL_APPROVER,
  NOTE_MAX,
  approvalRow,
  decisionBanner,
  invalidDecision,
  noteLength,
  paymentTypeLabel,
  toDecisionErrorResponse,
  validateDecisionInput,
} from "./approvals.ts";
import type { Bill } from "./bill-view.ts";
import { BILL_NOT_FOUND, SIGNED_OUT } from "./submit-errors.ts";

test("payment types read as the mockup labels", () => {
  assert.equal(paymentTypeLabel("card"), "Credit/Debit Card");
  assert.equal(paymentTypeLabel("bank"), "Bank account");
  assert.equal(paymentTypeLabel(null), "—");
  assert.equal(paymentTypeLabel("wire"), "wire");
});

test("the banner names the bill and the outcome", () => {
  assert.equal(decisionBanner("approved", 12), "Bill 12 approved.");
  assert.equal(decisionBanner("needs_revision", 12), "Bill 12 sent back for revision.");
  assert.equal(decisionBanner("denied", 12), "Bill 12 not approved.");
});

test("the decisions, in order, with the mockup copy", () => {
  assert.deepEqual(DECISIONS, [
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
  ]);
  assert.equal(FINANCIAL_APPROVER, "financial_approver");
  assert.equal(NOTE_MAX, 500);
});

test("validation accepts a decision with an optional note", () => {
  assert.deepEqual(validateDecisionInput({ decision: "approved" }), { input: { decision: "approved", note: null } });
  assert.deepEqual(validateDecisionInput({ decision: "denied", note: null }), {
    input: { decision: "denied", note: null },
  });
  assert.deepEqual(validateDecisionInput({ decision: "needs_revision", note: "  hi " }), {
    input: { decision: "needs_revision", note: "hi" },
  });
  assert.deepEqual(validateDecisionInput({ decision: "approved", note: "   " }), {
    input: { decision: "approved", note: null },
  });
});

test("the note limit counts characters, not UTF-16 units", () => {
  assert.ok("input" in validateDecisionInput({ decision: "approved", note: "a".repeat(500) }));
  assert.deepEqual(validateDecisionInput({ decision: "approved", note: "a".repeat(501) }), { fields: ["note"] });
  assert.ok("input" in validateDecisionInput({ decision: "approved", note: "😀".repeat(500) }));
  assert.deepEqual(validateDecisionInput({ decision: "approved", note: "😀".repeat(501) }), { fields: ["note"] });
  assert.equal(noteLength("  😀😀 "), 2);
});

test("validation names every bad field, decision first", () => {
  assert.deepEqual(validateDecisionInput({ decision: "maybe" }), { fields: ["decision"] });
  assert.deepEqual(validateDecisionInput({ decision: "approved", note: 5 }), { fields: ["note"] });
  assert.deepEqual(validateDecisionInput({ note: 5 }), { fields: ["decision", "note"] });
});

test("decide_bill() errors become replies", () => {
  assert.deepEqual(toDecisionErrorResponse({ code: "PT403", message: "forbidden", details: null }), {
    status: 403,
    body: { error: "Only financial approvers can decide bills.", code: "forbidden" },
  });
  assert.deepEqual(toDecisionErrorResponse({ code: "PT409", message: "not_pending_approval", details: "draft" }), {
    status: 409,
    body: { error: "This bill has already been decided.", code: "not_pending_approval", status: "draft" },
  });
  assert.deepEqual(toDecisionErrorResponse({ code: "PT409", message: "not_pending_approval", details: null }), {
    status: 409,
    body: { error: "This bill has already been decided.", code: "not_pending_approval" },
  });
  assert.deepEqual(toDecisionErrorResponse({ code: "PT400", message: "invalid_decision", details: '["note"]' }), {
    status: 400,
    body: { error: "Keep the note to 500 characters or fewer.", code: "invalid_decision", fields: ["note"] },
  });
  assert.deepEqual(toDecisionErrorResponse({ code: "PT400", message: "invalid_decision", details: '["decision"]' }), {
    status: 400,
    body: { error: "Choose an approval decision.", code: "invalid_decision", fields: ["decision"] },
  });
  assert.equal(
    toDecisionErrorResponse({ code: "PT400", details: '["decision","note"]' }).body.error,
    "Choose an approval decision.",
  );
  assert.deepEqual(toDecisionErrorResponse({ code: "PT400", details: "oops" }), invalidDecision([]));
  assert.equal(invalidDecision([]).body.error, "Choose an approval decision.");
  assert.equal(toDecisionErrorResponse({ code: "PT404", message: "not_found" }), BILL_NOT_FOUND);
  assert.equal(toDecisionErrorResponse({ code: "PGRST303" }), SIGNED_OUT);
  assert.deepEqual(toDecisionErrorResponse({ code: "XX000", message: "boom" }), {
    status: 500,
    body: { error: DECISION_FAILED },
  });
  assert.equal(DECISION_FAILED, "Couldn't save the decision. Try again.");
});

test("an approvals row flattens the names and labels the payment type", () => {
  const bill: Bill = {
    bill_id: 7,
    status: "pending_approval",
    invoice_number: "INV-7",
    amount: 120.5,
    date_due: "2026-11-20",
    date_issued: null,
    date_received: "2026-11-01T00:00:00+00:00",
    vendor_id: 1,
    property_id: 2,
    payment_id: 3,
    vendor: { name: "Acme" },
    property: { name: "Elm Court" },
    payment: { payment_type: "card", name: "Visa" },
  };
  assert.deepEqual(approvalRow(bill), {
    bill_id: 7,
    vendor: "Acme",
    property: "Elm Court",
    date_due: "2026-11-20",
    payment_type: "Credit/Debit Card",
    amount: 120.5,
    status: "pending_approval",
    bill,
  });
  const bare = approvalRow({ ...bill, vendor: null, property: null, payment: null, date_due: null });
  assert.equal(bare.vendor, "—");
  assert.equal(bare.property, "—");
  assert.equal(bare.payment_type, "—");
  assert.equal(bare.date_due, null);
});

test("the default sort is due date, earliest first", () => {
  assert.deepEqual(APPROVALS_DEFAULT_SORT, [{ id: "date_due", desc: false }]);
});
