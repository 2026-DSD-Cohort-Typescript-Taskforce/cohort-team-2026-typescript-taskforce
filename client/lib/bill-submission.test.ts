import assert from "node:assert/strict";
import { test } from "node:test";
import type { ApiFailure } from "./bill-api.ts";
import {
  MESSAGES,
  checkSubmittable,
  describeFailure,
  initialSubmission,
  submissionReducer,
  type Submission,
  type SubmissionEvent,
} from "./bill-submission.ts";
import { validateBill } from "./bill-validation.ts";
import type { Bill } from "./bill-view.ts";

const draft: Bill = {
  bill_id: 41,
  status: "draft",
  invoice_number: "INV-1",
  amount: 120,
  date_due: "2026-11-30",
  date_issued: null,
  date_received: "2026-11-05T15:00:00",
  vendor_id: 1,
  property_id: 2,
  payment_id: 1,
  vendor: { name: "Alder Creek Landscaping" },
  property: { name: "Alder Creek Workshop" },
  payment: null,
};

function run(events: SubmissionEvent[], start: Submission = initialSubmission()) {
  return events.reduce(submissionReducer, start);
}

const failure = (code: string | undefined, error: string, extra: Partial<ApiFailure> = {}): ApiFailure => ({
  status: 400,
  error,
  code,
  ...extra,
});

test("it starts idle, with no message", () => {
  assert.deepEqual(initialSubmission(), { state: "idle", message: "", fieldErrors: {}, errorCode: null, bill: null });
  assert.equal(initialSubmission(draft).bill, draft);
});

test("saving a new draft: saving, then saved with the bill", () => {
  const saving = run([{ type: "start", action: "save" }]);
  assert.equal(saving.state, "saving");
  assert.equal(saving.message, "Saving the bill…");

  const saved = run([
    { type: "start", action: "save" },
    { type: "stored", bill: draft },
    { type: "saved", step: "create" },
  ]);
  assert.deepEqual(saved, { state: "saved", message: "Draft saved.", fieldErrors: {}, errorCode: null, bill: draft });
});

test("saving changes to a draft says the bill was updated", () => {
  const saved = run([
    { type: "start", action: "save" },
    { type: "stored", bill: draft },
    { type: "saved", step: "update" },
  ]);
  assert.equal(saved.message, "Bill updated.");
});

test("submitting: the draft is stored, then the bill is submitted for payment", () => {
  const submitting = run([{ type: "start", action: "submit" }, { type: "stored", bill: draft }]);
  assert.equal(submitting.state, "submitting");
  assert.equal(submitting.message, "Submitting the bill…");

  const submitted = run([
    { type: "start", action: "submit" },
    { type: "stored", bill: draft },
    { type: "submitted", status: "pending_payment" },
  ]);
  assert.equal(submitted.state, "submitted");
  assert.equal(submitted.message, "Bill submitted for payment.");
  assert.equal(submitted.bill?.status, "pending_payment");
  assert.equal(submitted.bill?.bill_id, 41);
});

test("a refused submit after the draft saved is partial: the draft is kept", () => {
  const partial = run([
    { type: "start", action: "submit" },
    { type: "stored", bill: draft },
    {
      type: "failed",
      step: "submit",
      failure: failure("forbidden", "Only billing operators can submit bills.", { status: 403 }),
    },
  ]);
  assert.deepEqual(partial, {
    state: "partial",
    message: "Draft saved, but it couldn't be submitted: only billing operators can submit bills.",
    fieldErrors: {},
    errorCode: "forbidden",
    bill: draft,
  });
});

test("a retry after a partial failure keeps the saved draft, so it isn't saved twice", () => {
  const partial = run([
    { type: "start", action: "submit" },
    { type: "stored", bill: draft },
    { type: "failed", step: "submit", failure: failure(undefined, "Could not reach the server. Try again.", { status: 0 }) },
  ]);
  const retrying = submissionReducer(partial, { type: "start", action: "submit" });
  assert.equal(retrying.state, "submitting");
  assert.equal(retrying.bill, draft);
  assert.equal(retrying.message, "Submitting the bill…");
  assert.equal(retrying.errorCode, null);
});

test("a failed save is an error, with the field to fix", () => {
  const duplicate = failure("duplicate_invoice", "That invoice number already exists for this vendor.", {
    status: 409,
    fields: ["invoice_number"],
  });
  const failed = run([
    { type: "start", action: "save" },
    { type: "failed", step: "create", failure: duplicate },
  ]);
  assert.deepEqual(failed, {
    state: "error",
    message: "That invoice number already exists for this vendor.",
    fieldErrors: { invoice_number: "That invoice number already exists for this vendor." },
    errorCode: "duplicate_invoice",
    bill: null,
  });
});

test("a failed save during submit is an error, not partial", () => {
  const failed = run([
    { type: "start", action: "submit" },
    { type: "failed", step: "create", failure: failure(undefined, "Couldn't save the bill. Try again.", { status: 500 }) },
  ]);
  assert.equal(failed.state, "error");
  assert.equal(failed.message, "Couldn't save the bill. Try again.");
});

test("starting again clears the last message and field errors", () => {
  const failed = run([
    { type: "invalid", fieldErrors: { amount: "Enter an amount." }, message: MESSAGES.invalid },
  ]);
  assert.equal(failed.state, "error");
  const saving = submissionReducer(failed, { type: "start", action: "save" });
  assert.deepEqual(saving.fieldErrors, {});
  assert.equal(saving.message, "Saving the bill…");
});

test("reset goes back to idle with the given bill", () => {
  const saved = run([
    { type: "start", action: "save" },
    { type: "stored", bill: draft },
    { type: "saved", step: "create" },
  ]);
  assert.deepEqual(submissionReducer(saved, { type: "reset", bill: null }), initialSubmission());
});

test("checkSubmittable names what a submit still needs", () => {
  const input = validateBill({ amount: "5", vendor_id: "1", property_id: "2", payment_id: "3" }).input!;
  assert.deepEqual(checkSubmittable(input), {
    type: "invalid",
    fieldErrors: {
      invoice_number: "Required to submit.",
      date_due: "Required to submit.",
    },
    message: "Add invoice number and due date to submit.",
  });
  const complete = validateBill({
    amount: "5",
    vendor_id: "1",
    property_id: "2",
    payment_id: "3",
    invoice_number: "A",
    date_due: "2026-12-01",
  }).input!;
  assert.equal(checkSubmittable(complete), null);
});

test("describeFailure: route codes become the messages the form shows", () => {
  assert.deepEqual(
    describeFailure(
      failure("incomplete_bill", "This bill is missing required details.", { fields: ["vendor_id", "date_due"] }),
      "submit",
    ),
    {
      message: "Add vendor and due date to submit.",
      fieldErrors: { vendor_id: "Required to submit.", date_due: "Required to submit." },
    },
  );
  assert.deepEqual(
    describeFailure(failure("invalid_bill", "Some of the bill's details aren't valid.", { fields: ["vendor_id"] }), "create"),
    {
      message: "Some of the bill's details aren't valid.",
      fieldErrors: { vendor_id: "Some of the bill's details aren't valid." },
    },
  );
  assert.deepEqual(describeFailure(failure("not_draft", "Only draft bills can be edited.", { status: 409 }), "update"), {
    message: "This bill was submitted and can't be edited anymore.",
    fieldErrors: {},
  });
  assert.equal(
    describeFailure(failure("not_draft", "Only draft bills can be submitted.", { status: 409 }), "submit").message,
    "Only draft bills can be submitted.",
  );
  assert.equal(describeFailure(failure("not_found", "Bill not found.", { status: 404 }), "update").message, "This bill no longer exists.");
  assert.equal(
    describeFailure(failure(undefined, "Could not reach the server. Try again.", { status: 0 }), "create").message,
    "Could not reach the server. Try again.",
  );
});
