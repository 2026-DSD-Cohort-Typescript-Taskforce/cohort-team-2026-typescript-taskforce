import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DELETE_VENDOR_FAILED,
  DUPLICATE_VENDOR_NAME,
  INVALID_LOGO_REPLY,
  LOAD_VENDORS_FAILED,
  LOGO_FAILED,
  SAVE_VENDOR_FAILED,
  VENDOR_FORBIDDEN,
  VENDOR_HAS_BILLS,
  VENDOR_NOT_FOUND,
  canManageVendors,
  displayValue,
  filterVendors,
  invalidVendor,
  matchesVendor,
  parseVendorId,
  removeVendor,
  sortVendorsByName,
  toVendorErrorResponse,
  upsertVendor,
  vendorBanner,
  type Vendor,
} from "./vendors.ts";
import { SIGNED_OUT } from "./submit-errors.ts";

const vendor = (vendor_id: number, name: string, rest: Partial<Vendor> = {}): Vendor => ({
  vendor_id,
  name,
  email: null,
  address: null,
  phone: null,
  logo_url: null,
  ...rest,
});

test("only financial approvers and system admins manage vendors", () => {
  assert.equal(canManageVendors("financial_approver"), true);
  assert.equal(canManageVendors("system_admin"), true);
  for (const role of ["billing_operator", null, undefined, ""]) assert.equal(canManageVendors(role), false);
});

test("parseVendorId accepts positive integers up to the Postgres limit", () => {
  assert.equal(parseVendorId("12"), 12);
  assert.equal(parseVendorId("2147483647"), 2147483647);
  for (const raw of ["0", "-1", "1.5", "abc", "", "2147483648"]) assert.equal(parseVendorId(raw), null, raw);
});

test("matchesVendor searches name, address and email ignoring case", () => {
  const v = vendor(1, "Acme Supply", { address: "12 Oak Street", email: "Ops@Acme.com" });
  assert.equal(matchesVendor(v, "acme"), true);
  assert.equal(matchesVendor(v, "OAK ST"), true);
  assert.equal(matchesVendor(v, "ops@acme"), true);
  assert.equal(matchesVendor(v, "zzz"), false);
});

test("an empty query matches everything", () => {
  assert.equal(matchesVendor(vendor(1, "A"), ""), true);
  assert.equal(matchesVendor(vendor(1, "A"), "   "), true);
});

test("a phone-shaped query compares digits only", () => {
  const v = vendor(1, "Acme", { phone: "555-010-1234" });
  assert.equal(matchesVendor(v, "(555) 010"), true);
  assert.equal(matchesVendor(v, "+555 010 1234"), true);
  assert.equal(matchesVendor(v, "999"), false);
});

test("a query with letters does not match on phone digits", () => {
  const v = vendor(1, "Bravo", { phone: "555-012-1234" });
  assert.equal(matchesVendor(v, "oak 12"), false);
});

test("a digit query still matches text, and a symbol-only query is a plain substring", () => {
  assert.equal(matchesVendor(vendor(1, "Route 66", { phone: "555-010-1234" }), "66"), true);
  assert.equal(matchesVendor(vendor(1, "Acme", { phone: "555-010-1234" }), "-"), true);
  assert.equal(matchesVendor(vendor(1, "Acme"), "-"), false);
});

test("null fields don't throw", () => {
  const v = vendor(1, "Acme");
  assert.equal(matchesVendor(v, "555"), false);
  assert.equal(matchesVendor(v, "oak"), false);
});

test("filterVendors keeps the matches in order", () => {
  const list = [vendor(1, "Acme"), vendor(2, "Bravo"), vendor(3, "Acme West")];
  assert.deepEqual(filterVendors(list, "acme").map((v) => v.vendor_id), [1, 3]);
});

test("sortVendorsByName ignores case and accents, ties by id, and copies", () => {
  const list = [vendor(5, "Bravo"), vendor(4, "acme"), vendor(2, "Ácme"), vendor(3, "Acme")];
  const sorted = sortVendorsByName(list);
  assert.deepEqual(sorted.map((v) => v.vendor_id), [2, 3, 4, 5]);
  assert.deepEqual(list.map((v) => v.vendor_id), [5, 4, 2, 3]);
});

test("upsertVendor replaces by id or inserts in order", () => {
  const list = [vendor(1, "Acme"), vendor(2, "Cobalt")];
  const renamed = upsertVendor(list, vendor(1, "Delta"));
  assert.deepEqual(renamed.map((v) => v.name), ["Cobalt", "Delta"]);
  const added = upsertVendor(list, vendor(3, "Bravo"));
  assert.deepEqual(added.map((v) => v.name), ["Acme", "Bravo", "Cobalt"]);
  assert.equal(list.length, 2);
});

test("removeVendor drops one by id", () => {
  assert.deepEqual(removeVendor([vendor(1, "A"), vendor(2, "B")], 1).map((v) => v.vendor_id), [2]);
});

test("banners name the vendor", () => {
  assert.equal(vendorBanner("saved", "Acme"), "Saved Acme.");
  assert.equal(vendorBanner("added", "Acme"), "Added Acme.");
  assert.equal(vendorBanner("deleted", "Acme"), "Deleted Acme.");
});

test("displayValue shows an em dash for null and blank", () => {
  assert.equal(displayValue(null), "—");
  assert.equal(displayValue("  "), "—");
  assert.equal(displayValue("x"), "x");
});

test("fixed replies and messages", () => {
  assert.deepEqual(VENDOR_FORBIDDEN, {
    status: 403,
    body: { error: "Only financial approvers and system admins can change vendors.", code: "forbidden" },
  });
  assert.deepEqual(VENDOR_NOT_FOUND, {
    status: 404,
    body: { error: "This vendor no longer exists.", code: "vendor_not_found" },
  });
  assert.deepEqual(VENDOR_HAS_BILLS, {
    status: 409,
    body: { error: "This vendor has bills, so it can't be deleted.", code: "vendor_has_bills" },
  });
  assert.deepEqual(DUPLICATE_VENDOR_NAME, {
    status: 409,
    body: { error: "A vendor with this name already exists.", code: "duplicate_vendor_name", fields: ["name"] },
  });
  assert.deepEqual(INVALID_LOGO_REPLY, {
    status: 400,
    body: { error: "Choose a PNG, JPEG or WebP image up to 1 MB.", code: "invalid_logo" },
  });
  assert.deepEqual(invalidVendor(["name"]), {
    status: 400,
    body: { error: "Some of the vendor's details aren't valid.", code: "invalid_vendor", fields: ["name"] },
  });
  assert.equal(LOAD_VENDORS_FAILED, "Couldn't load vendors. Try again.");
  assert.equal(SAVE_VENDOR_FAILED, "Couldn't save the vendor. Try again.");
  assert.equal(DELETE_VENDOR_FAILED, "Couldn't delete the vendor. Try again.");
  assert.equal(LOGO_FAILED, "Vendor saved, but the logo didn't upload. Try again.");
});

test("toVendorErrorResponse maps database codes", () => {
  assert.deepEqual(toVendorErrorResponse({ code: "23505" }), DUPLICATE_VENDOR_NAME);
  assert.deepEqual(toVendorErrorResponse({ code: "23503" }), VENDOR_HAS_BILLS);
  assert.deepEqual(toVendorErrorResponse({ code: "42501" }), VENDOR_FORBIDDEN);
  assert.deepEqual(toVendorErrorResponse({ code: "23514" }), invalidVendor([]));
  assert.deepEqual(toVendorErrorResponse({ code: "22001" }), invalidVendor([]));
  assert.deepEqual(toVendorErrorResponse({ code: "PGRST303" }), SIGNED_OUT);
});

test("an unknown error is a 500 with the fallback and no database text", () => {
  assert.deepEqual(toVendorErrorResponse({ code: "XX000", message: "secret" }), {
    status: 500,
    body: { error: SAVE_VENDOR_FAILED },
  });
  assert.deepEqual(toVendorErrorResponse({ message: "x" }, DELETE_VENDOR_FAILED), {
    status: 500,
    body: { error: DELETE_VENDOR_FAILED },
  });
});
