import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_PROFILE, SAVE_FAILED, invalidBill, notDraft, toWriteErrorResponse } from "./bill-errors.ts";
import { SIGNED_OUT } from "./submit-errors.ts";

// Errors as supabase-js returns them for an insert or update on bills.

test("a duplicate invoice number for the vendor is a 409 on invoice_number", () => {
  const reply = toWriteErrorResponse({
    code: "23505",
    message: 'duplicate key value violates unique constraint "bills_vendor_id_invoice_number_key"',
    details: "Key (vendor_id, lower(invoice_number::text))=(3, inv-1) already exists.",
  });
  assert.deepEqual(reply, {
    status: 409,
    body: {
      error: "That invoice number already exists for this vendor.",
      code: "duplicate_invoice",
      fields: ["invoice_number"],
    },
  });
});

test("an unknown vendor, property or payment method is a 400 naming the field", () => {
  // As Postgres reports it under RLS: the details leave out the key.
  for (const field of ["vendor_id", "property_id", "payment_id"]) {
    const reply = toWriteErrorResponse({
      code: "23503",
      message: `insert or update on table "bills" violates foreign key constraint "bills_${field}_fkey"`,
      details: 'Key is not present in table "x".',
    });
    assert.deepEqual(reply, invalidBill([field]));
  }
  assert.deepEqual(
    toWriteErrorResponse({ code: "23503", message: 'violates foreign key constraint "bills_user_id_fkey"' }),
    invalidBill(),
  );
  assert.deepEqual(toWriteErrorResponse({ code: "23503", details: null }), invalidBill());
});

test("values the database can't store are a 400 with no raw text", () => {
  for (const code of ["22P02", "22003", "22007", "22008", "22001", "23514"]) {
    const reply = toWriteErrorResponse({ code, message: "invalid input syntax", details: "Failing row contains (…)" });
    assert.deepEqual(reply, {
      status: 400,
      body: { error: "Some of the bill's details aren't valid.", code: "invalid_bill", fields: [] },
    });
  }
});

test("session errors are still a 401, and anything else a 500 with the fallback", () => {
  assert.deepEqual(toWriteErrorResponse({ code: "PGRST303", message: "JWT expired" }), SIGNED_OUT);
  assert.deepEqual(toWriteErrorResponse({ code: "42501", message: "new row violates row-level security policy" }), {
    status: 500,
    body: { error: SAVE_FAILED },
  });
  assert.deepEqual(toWriteErrorResponse({}, "Couldn't update the bill. Try again."), {
    status: 500,
    body: { error: "Couldn't update the bill. Try again." },
  });
  assert.equal(SAVE_FAILED, "Couldn't save the bill. Try again.");
});

test("not_draft carries the bill's current status", () => {
  assert.deepEqual(notDraft("pending_payment"), {
    status: 409,
    body: { error: "Only draft bills can be edited.", code: "not_draft", status: "pending_payment" },
  });
});

test("a login with no profile is a 403 in Express's wording", () => {
  assert.deepEqual(NO_PROFILE, {
    status: 403,
    body: { error: "No app profile is linked to this login. Ask an admin to set one up.", code: "profile_not_found" },
  });
});
