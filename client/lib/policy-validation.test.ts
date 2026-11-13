import assert from "node:assert/strict";
import { test } from "node:test";
import { parseActiveFlag, validatePolicyInput } from "./policy-validation.ts";

const good = { name: "Auto", description: "Pay on due date." };
const missing = { name: "Enter a policy name.", description: "Describe the policy." };

test("blank, whitespace or non-string values are missing", () => {
  assert.deepEqual(validatePolicyInput({}), { errors: missing });
  assert.deepEqual(validatePolicyInput({ name: "  ", description: "\n" }), { errors: missing });
  assert.deepEqual(validatePolicyInput({ ...good, name: 5 }), { errors: { name: missing.name } });
});

test("values are trimmed", () => {
  assert.deepEqual(validatePolicyInput({ ...good, name: "  Auto  " }), { input: good });
});

test("names up to 100 characters pass, counted per code point", () => {
  assert.ok("input" in validatePolicyInput({ ...good, name: "a".repeat(100) }));
  assert.ok("input" in validatePolicyInput({ ...good, name: "😀".repeat(100) }));
  assert.deepEqual(validatePolicyInput({ ...good, name: "a".repeat(101) }), {
    errors: { name: "Keep the name to 100 characters or fewer." },
  });
});

test("descriptions up to 1000 characters pass", () => {
  assert.ok("input" in validatePolicyInput({ ...good, description: "a".repeat(1000) }));
  assert.deepEqual(validatePolicyInput({ ...good, description: "a".repeat(1001) }), {
    errors: { description: "Keep the policy to 1000 characters or fewer." },
  });
});

test("parseActiveFlag accepts only booleans", () => {
  assert.equal(parseActiveFlag({ is_active: true }), true);
  assert.equal(parseActiveFlag({ is_active: false }), false);
  for (const body of [{ is_active: "true" }, { is_active: 1 }, {}]) assert.equal(parseActiveFlag(body), null);
});
