import assert from "node:assert/strict";
import { test } from "node:test";
import { BILL_NOT_FOUND, SIGNED_OUT, SUBMIT_FAILED, toErrorResponse } from "./submit-errors.ts";

// Errors as supabase-js .rpc('submit_bill') returns them (see the migration's error contract).

test("incomplete_bill lists every missing field from the details string", () => {
  const reply = toErrorResponse({
    code: "PT400",
    message: "incomplete_bill",
    details: '["invoice_number","date_due"]',
  });
  assert.deepEqual(reply, {
    status: 400,
    body: {
      error: "This bill is missing required details.",
      code: "incomplete_bill",
      fields: ["invoice_number", "date_due"],
    },
  });
});

test("incomplete_bill with unreadable details still answers 400, with no fields", () => {
  for (const details of [null, undefined, "", "not json", '{"a":1}', "[1,2]"]) {
    const reply = toErrorResponse({ code: "PT400", message: "incomplete_bill", details });
    assert.equal(reply.status, 400);
    assert.deepEqual(reply.body.fields, []);
  }
});

test("forbidden is a 403", () => {
  assert.deepEqual(toErrorResponse({ code: "PT403", message: "forbidden", details: null }), {
    status: 403,
    body: { error: "Only billing operators can submit bills.", code: "forbidden" },
  });
});

test("not_found is a 404", () => {
  assert.deepEqual(toErrorResponse({ code: "PT404", message: "not_found", details: null }), BILL_NOT_FOUND);
  assert.deepEqual(BILL_NOT_FOUND, { status: 404, body: { error: "Bill not found.", code: "not_found" } });
});

test("not_draft is a 409 with the bill's current status", () => {
  assert.deepEqual(toErrorResponse({ code: "PT409", message: "not_draft", details: "pending_payment" }), {
    status: 409,
    body: { error: "Only draft bills can be submitted.", code: "not_draft", status: "pending_payment" },
  });
});

test("an invalid, expired or missing JWT is a 401, so the browser refreshes the session", () => {
  for (const code of ["PGRST301", "PGRST302", "PGRST303"]) {
    assert.deepEqual(toErrorResponse({ code, message: "JWT expired", details: null }), SIGNED_OUT);
  }
  assert.deepEqual(SIGNED_OUT, { status: 401, body: { error: "You are not signed in." } });
});

test("anything else is a 500 that leaves out the database's text", () => {
  const errors = [
    { code: "23514", message: 'new row for relation "bills" violates check constraint', details: "Failing row" },
    { code: "42501", message: "permission denied for function submit_bill", details: null },
    { code: "", message: "TypeError: fetch failed", details: "connect ECONNREFUSED" },
    {},
  ];
  for (const error of errors) {
    const reply = toErrorResponse(error);
    assert.deepEqual(reply, { status: 500, body: { error: SUBMIT_FAILED } });
    assert.equal(SUBMIT_FAILED, "Couldn't submit the bill. Try again.");
  }
});

test("a 500 can carry another message, for the routes that only read bills", () => {
  assert.deepEqual(toErrorResponse({ code: "XX000" }, "Couldn't load the bills. Try again."), {
    status: 500,
    body: { error: "Couldn't load the bills. Try again." },
  });
});
