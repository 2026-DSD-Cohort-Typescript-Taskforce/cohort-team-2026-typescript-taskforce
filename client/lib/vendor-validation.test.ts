import assert from "node:assert/strict";
import { test } from "node:test";
import { INVALID_LOGO, logoExtension, validateVendorInput } from "./vendor-validation.ts";

const good = { name: "Acme", email: "a@b.co", address: "1 Oak St", phone: "(555) 010-1234" };

test("blank, whitespace or non-string values are missing", () => {
  const missing = {
    name: "Enter the vendor's name.",
    email: "Enter the vendor's email.",
    address: "Enter the vendor's address.",
    phone: "Enter the vendor's phone number.",
  };
  assert.deepEqual(validateVendorInput({ name: "", email: "  ", address: "\n", phone: "" }), { errors: missing });
  assert.deepEqual(validateVendorInput({}), { errors: missing });
  assert.deepEqual(validateVendorInput({ ...good, phone: 5550101234 }), {
    errors: { phone: missing.phone },
  });
});

test("values are trimmed", () => {
  assert.deepEqual(validateVendorInput({ ...good, name: "  Acme  " }), { input: { ...good, name: "Acme" } });
});

test("names up to 255 characters pass, counted per code point", () => {
  assert.ok("input" in validateVendorInput({ ...good, name: "a".repeat(255) }));
  assert.ok("input" in validateVendorInput({ ...good, name: "😀".repeat(255) }));
  const message = "Keep the name to 255 characters or fewer.";
  assert.deepEqual(validateVendorInput({ ...good, name: "a".repeat(256) }), { errors: { name: message } });
  assert.deepEqual(validateVendorInput({ ...good, name: "😀".repeat(256) }), { errors: { name: message } });
});

test("addresses up to 500 characters pass", () => {
  assert.ok("input" in validateVendorInput({ ...good, address: "a".repeat(500) }));
  assert.deepEqual(validateVendorInput({ ...good, address: "a".repeat(501) }), {
    errors: { address: "Keep the address to 500 characters or fewer." },
  });
});

test("valid emails pass and keep their case", () => {
  for (const email of ["a@b.co", "Ops.Team@Vendor.Example.com"]) {
    assert.deepEqual(validateVendorInput({ ...good, email }), { input: { ...good, email } });
  }
});

test("malformed emails fail", () => {
  const bad = ["ab.co", "a@@b.co", "a@b", "a@.co", "a@b.", "a b@c.co", "a".repeat(243) + "@example.com"];
  assert.equal(bad[6].length, 255);
  for (const email of bad) {
    assert.deepEqual(validateVendorInput({ ...good, email }), { errors: { email: "Enter a valid email address." } }, email);
  }
});

test("phones with 10 to 15 digits and common punctuation pass", () => {
  for (const phone of ["(555) 010-1234", "+1 555.010.1234", "555-0101-234", "(+1) 555 010 1234", "1".repeat(15)]) {
    assert.deepEqual(validateVendorInput({ ...good, phone }), { input: { ...good, phone } }, phone);
  }
});

test("other phones fail", () => {
  for (const phone of ["555-010-123", "1".repeat(16), "555-010-ABCD", "555/010/1234", "555\t010 1234"]) {
    assert.deepEqual(validateVendorInput({ ...good, phone }), { errors: { phone: "Enter a valid phone number." } }, phone);
  }
});

test("logoExtension maps the three image types", () => {
  assert.equal(logoExtension({ type: "image/png", size: 10 }), "png");
  assert.equal(logoExtension({ type: "image/jpeg", size: 10 }), "jpg");
  assert.equal(logoExtension({ type: "image/webp", size: 10 }), "webp");
});

test("logoExtension refuses other types, empty files and files over 1 MB", () => {
  assert.equal(logoExtension({ type: "image/svg+xml", size: 10 }), null);
  assert.equal(logoExtension({ type: "image/png", size: 0 }), null);
  assert.equal(logoExtension({ type: "image/png", size: 1_048_576 }), "png");
  assert.equal(logoExtension({ type: "image/png", size: 1_048_577 }), null);
  assert.equal(INVALID_LOGO, "Choose a PNG, JPEG or WebP image up to 1 MB.");
});
