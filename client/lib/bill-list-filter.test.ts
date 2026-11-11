import assert from "node:assert/strict";
import { test } from "node:test";
import { billRow, filterBills, statusOptions } from "./bill-list-filter.ts";
import type { Bill } from "./bill-view.ts";

function bill(overrides: Partial<Bill>): Bill {
  return {
    bill_id: 1,
    status: "draft",
    invoice_number: null,
    amount: 100,
    date_due: null,
    date_issued: null,
    date_received: "2026-11-01T12:00:00",
    vendor_id: 1,
    property_id: 1,
    payment_id: 1,
    vendor: null,
    property: null,
    payment: null,
    ...overrides,
  };
}

const alder = bill({
  bill_id: 1,
  status: "pending_payment",
  invoice_number: "BILL-2001",
  amount: 212.4,
  date_due: "2026-11-16",
  vendor: { name: "Alder Creek Landscaping" },
  property: { name: "Alder Creek Workshop" },
  payment: { payment_type: "card", name: "Alder Creek Demo Card" },
});
const bright = bill({
  bill_id: 2,
  status: "draft",
  invoice_number: "INV-77",
  amount: 1234.5,
  date_due: "2026-12-01",
  vendor: { name: "Brightwater Water & Sewer" },
  property: { name: "Brightwater Print Studio" },
});
const blank = bill({ bill_id: 3 });
const bills = [alder, bright, blank];

test("a row shows vendor, property, payment, amount and due date", () => {
  assert.deepEqual(billRow(alder), {
    vendor: "Alder Creek Landscaping",
    initials: "AC",
    property: "Alder Creek Workshop",
    payment: "Card · Alder Creek Demo Card",
    amount: "$212.40",
    due: "Due Nov 16, 2026",
  });
});

test("a draft with hidden related rows and no due date still reads as a row", () => {
  assert.deepEqual(billRow(blank), {
    vendor: "No vendor",
    initials: "?",
    property: "No property",
    payment: null,
    amount: "$100.00",
    due: "No due date",
  });
  assert.equal(billRow(bright).initials, "BW");
  assert.equal(billRow(bill({ vendor: { name: "Brightwater" } })).initials, "B");
});

test("search matches vendor, property, invoice number or the shown due date, ignoring case", () => {
  const ids = (query: string) => filterBills(bills, query, "").map((b) => b.bill_id);
  assert.deepEqual(ids(""), [1, 2, 3]);
  assert.deepEqual(ids("   "), [1, 2, 3]);
  assert.deepEqual(ids("ALDER"), [1]);
  assert.deepEqual(ids("print studio"), [2]);
  assert.deepEqual(ids("inv-77"), [2]);
  assert.deepEqual(ids("nov 16"), [1]);
  assert.deepEqual(ids("2026"), [1, 2]);
  assert.deepEqual(ids("zzz"), []);
});

test("search leaves out amounts, statuses and payment methods", () => {
  assert.deepEqual(filterBills(bills, "212", ""), []);
  assert.deepEqual(filterBills(bills, "pending", ""), []);
  assert.deepEqual(filterBills(bills, "demo card", ""), []);
});

test("the status filter keeps one status, and combines with search", () => {
  assert.deepEqual(
    filterBills(bills, "", "draft").map((b) => b.bill_id),
    [2, 3],
  );
  assert.deepEqual(
    filterBills(bills, "brightwater", "draft").map((b) => b.bill_id),
    [2],
  );
  assert.deepEqual(filterBills(bills, "alder", "draft"), []);
});

test("status options list only the statuses present, in lifecycle order", () => {
  assert.deepEqual(statusOptions(bills), [
    { value: "draft", label: "Draft" },
    { value: "pending_payment", label: "Pending payment" },
  ]);
  assert.deepEqual(statusOptions([]), []);
  assert.deepEqual(
    statusOptions([bill({ status: "payment_success" }), bill({ status: "zzz_new" }), bill({ status: "draft" })]),
    [
      { value: "draft", label: "Draft" },
      { value: "payment_success", label: "Payment success" },
      { value: "zzz_new", label: "Zzz new" },
    ],
  );
});
