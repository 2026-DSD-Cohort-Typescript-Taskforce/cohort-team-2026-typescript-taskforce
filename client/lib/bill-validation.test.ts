import assert from "node:assert/strict";
import { test } from "node:test";
import { missingForSubmit, submitHint, validateBill } from "./bill-validation.ts";

// Values as the bill form holds them: strings from its inputs and selects.
const form = {
  vendor_id: "3",
  property_id: "5",
  payment_id: "",
  invoice_number: "  INV-1001 ",
  amount: "1,234.5",
  date_due: "2026-11-16",
};

test("a complete form becomes the details to send", () => {
  assert.deepEqual(validateBill(form), {
    input: {
      vendor_id: 3,
      property_id: 5,
      payment_id: null,
      invoice_number: "INV-1001",
      amount: "1234.50",
      date_due: "2026-11-16",
    },
  });
});

test("a draft only needs an amount", () => {
  assert.deepEqual(validateBill({ amount: "12" }), {
    input: {
      vendor_id: null,
      property_id: null,
      payment_id: null,
      invoice_number: null,
      amount: "12.00",
      date_due: null,
    },
  });
});

test("amounts: at most 2 decimals, above 0, up to 9,999,999,999.99", () => {
  const amountError = (amount: unknown) => validateBill({ amount }).errors?.amount;
  const amountValue = (amount: unknown) => validateBill({ amount }).input?.amount;

  assert.equal(amountError(""), "Enter an amount.");
  assert.equal(amountError("   "), "Enter an amount.");
  assert.equal(amountError(undefined), "Enter an amount.");
  assert.equal(amountError("0"), "Enter an amount above 0.");
  assert.equal(amountError("0.00"), "Enter an amount above 0.");
  assert.equal(amountError("0.001"), "Enter an amount like 1234.56, with at most 2 decimal places.");
  assert.equal(amountError("-5"), "Enter an amount like 1234.56, with at most 2 decimal places.");
  assert.equal(amountError("12a"), "Enter an amount like 1234.56, with at most 2 decimal places.");
  assert.equal(amountError("1,2,3"), "Enter an amount like 1234.56, with at most 2 decimal places.");
  assert.equal(amountError("10000000000"), "Enter an amount up to 9,999,999,999.99.");
  assert.equal(amountError("10,000,000,000.00"), "Enter an amount up to 9,999,999,999.99.");
  assert.equal(amountError(true), "Enter an amount like 1234.56.");

  assert.equal(amountValue("0.01"), "0.01");
  assert.equal(amountValue("9,999,999,999.99"), "9999999999.99");
  assert.equal(amountValue("$1,234.56"), "1234.56");
  assert.equal(amountValue("007.5"), "7.50");
  assert.equal(amountValue(42.1), "42.10");
});

test("invoice numbers are trimmed, blank is none, and 255 characters is the limit", () => {
  assert.equal(validateBill({ amount: "1", invoice_number: "   " }).input?.invoice_number, null);
  assert.equal(validateBill({ amount: "1", invoice_number: "x".repeat(255) }).input?.invoice_number, "x".repeat(255));
  assert.equal(
    validateBill({ amount: "1", invoice_number: ` ${"x".repeat(255)} ` }).input?.invoice_number,
    "x".repeat(255),
  );
  assert.equal(
    validateBill({ amount: "1", invoice_number: "x".repeat(256) }).errors?.invoice_number,
    "Use 255 characters or fewer.",
  );
  assert.equal(validateBill({ amount: "1", invoice_number: 42 }).errors?.invoice_number, "Enter the invoice number as text.");
});

test("due dates must be real calendar dates; past dates are fine", () => {
  const dateError = (date_due: unknown) => validateBill({ amount: "1", date_due }).errors?.date_due;
  for (const bad of ["2026-02-30", "2026-13-01", "2026-1-5", "11/16/2026", "0000-01-01", 20261116]) {
    assert.equal(dateError(bad), "Enter a valid date.", String(bad));
  }
  assert.equal(validateBill({ amount: "1", date_due: "2028-02-29" }).input?.date_due, "2028-02-29");
  assert.equal(validateBill({ amount: "1", date_due: "2020-01-01" }).input?.date_due, "2020-01-01");
});

test("ids are positive Postgres integers, from a select's string or a number", () => {
  assert.equal(validateBill({ amount: "1", vendor_id: 7 }).input?.vendor_id, 7);
  assert.equal(validateBill({ amount: "1", vendor_id: null }).input?.vendor_id, null);
  for (const bad of ["0", "-1", "1.5", "abc", 0, 2.5, 2147483648, "2147483648"]) {
    assert.equal(validateBill({ amount: "1", vendor_id: bad }).errors?.vendor_id, "Choose a vendor from the list.", String(bad));
  }
  assert.equal(validateBill({ amount: "1", property_id: "x" }).errors?.property_id, "Choose a property from the list.");
  assert.equal(validateBill({ amount: "1", payment_id: "x" }).errors?.payment_id, "Choose a payment method from the list.");
});

test("every failing field gets its own message at once", () => {
  assert.deepEqual(validateBill({ vendor_id: "x", amount: "0", date_due: "soon" }), {
    errors: {
      vendor_id: "Choose a vendor from the list.",
      amount: "Enter an amount above 0.",
      date_due: "Enter a valid date.",
    },
  });
});

test("partial (an edit) checks only the fields it is given", () => {
  assert.deepEqual(validateBill({ invoice_number: " INV-9 " }, { partial: true }), {
    input: { invoice_number: "INV-9" },
  });
  assert.deepEqual(validateBill({}, { partial: true }), { input: {} });
  assert.deepEqual(validateBill({ amount: "" }, { partial: true }), { errors: { amount: "Enter an amount." } });
});

test("anything that isn't a bill field is dropped", () => {
  const values = { amount: "5", status: "pending_payment", user_id: 1, bill_id: 9 } as Record<string, unknown>;
  assert.deepEqual(Object.keys(validateBill(values).input ?? {}).sort(), [
    "amount",
    "date_due",
    "invoice_number",
    "payment_id",
    "property_id",
    "vendor_id",
  ]);
});

test("missingForSubmit lists what submit_bill() requires, in its order", () => {
  const draft = validateBill({ amount: "5" }).input!;
  assert.deepEqual(missingForSubmit(draft), ["vendor_id", "property_id", "invoice_number", "date_due"]);
  assert.deepEqual(missingForSubmit(validateBill(form).input!), []);
  assert.deepEqual(missingForSubmit({ ...validateBill(form).input!, amount: "0.00" }), ["amount"]);
});

test("submitHint names the missing fields", () => {
  assert.equal(submitHint([]), "");
  assert.equal(submitHint(["date_due"]), "Add due date to submit.");
  assert.equal(submitHint(["vendor_id", "date_due"]), "Add vendor and due date to submit.");
  assert.equal(
    submitHint(["vendor_id", "property_id", "invoice_number"]),
    "Add vendor, property and invoice number to submit.",
  );
});
