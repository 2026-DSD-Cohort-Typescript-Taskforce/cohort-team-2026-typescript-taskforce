import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOAD_POLICIES_FAILED,
  NOT_APPLIED_NOTICE,
  POLICY_FORBIDDEN,
  POLICY_NOT_FOUND,
  POLICY_VENDOR_NOT_FOUND,
  SAVE_POLICY_FAILED,
  TOGGLE_POLICY_FAILED,
  canManagePolicies,
  checkboxLabel,
  filterPolicyVendors,
  invalidPolicy,
  matchesPolicyVendor,
  parseVendorId,
  paymentLine,
  policyBanner,
  replacePolicy,
  toPolicyErrorResponse,
  toPolicyVendor,
  type Policy,
  type PolicyVendor,
} from "./policies.ts";

const policy = (policy_id: number, name: string, description = "d", is_active = false): Policy => ({
  policy_id,
  name,
  description,
  is_active,
  updated_at: "2026-11-10T00:00:00Z",
});

const vendor = (vendor_id: number, name: string, p: Policy | null = null, rest: Partial<PolicyVendor> = {}): PolicyVendor => ({
  vendor_id,
  name,
  supported_payment_methods: null,
  payment_portal_url: null,
  policy: p,
  ...rest,
});

test("only financial approvers and system admins manage policies", () => {
  assert.equal(canManagePolicies("financial_approver"), true);
  assert.equal(canManagePolicies("system_admin"), true);
  for (const role of ["billing_operator", null, undefined, ""]) assert.equal(canManagePolicies(role), false);
});

test("parseVendorId accepts positive integers up to the Postgres limit", () => {
  assert.equal(parseVendorId("12"), 12);
  for (const raw of ["0", "-1", "1.5", "abc", "2147483648"]) assert.equal(parseVendorId(raw), null, raw);
});

test("toPolicyVendor unwraps the embedded policy", () => {
  const p = policy(1, "A");
  const base = { vendor_id: 1, name: "V", supported_payment_methods: null, payment_portal_url: null };
  assert.deepEqual(toPolicyVendor({ ...base, policies: p }), vendor(1, "V", p));
  assert.deepEqual(toPolicyVendor({ ...base, policies: [p] }), vendor(1, "V", p));
  assert.equal(toPolicyVendor({ ...base, policies: [] }).policy, null);
  assert.equal(toPolicyVendor({ ...base, policies: null }).policy, null);
});

test("matchesPolicyVendor searches vendor name, policy name and description ignoring case", () => {
  const v = vendor(1, "Acme Supply", policy(1, "Early Pay", "Pay within Ten days"));
  assert.equal(matchesPolicyVendor(v, "ACME"), true);
  assert.equal(matchesPolicyVendor(v, "early"), true);
  assert.equal(matchesPolicyVendor(v, "ten DAYS"), true);
  assert.equal(matchesPolicyVendor(v, "zzz"), false);
  assert.equal(matchesPolicyVendor(v, ""), true);
  assert.equal(matchesPolicyVendor(v, "   "), true);
  const bare = vendor(2, "Globex");
  assert.equal(matchesPolicyVendor(bare, "glob"), true);
  assert.equal(matchesPolicyVendor(bare, "early"), false);
});

test("filterPolicyVendors keeps matches in order", () => {
  const list = [vendor(1, "Acme"), vendor(2, "Globex"), vendor(3, "Acme Two")];
  assert.deepEqual(filterPolicyVendors(list, "acme").map((v) => v.vendor_id), [1, 3]);
});

test("replacePolicy changes only that vendor and keeps the order", () => {
  const list = [vendor(1, "A"), vendor(2, "B"), vendor(3, "C")];
  const p = policy(9, "New");
  const next = replacePolicy(list, 2, p);
  assert.deepEqual(next.map((v) => v.vendor_id), [1, 2, 3]);
  assert.equal(next[1].policy, p);
  assert.equal(next[0], list[0]);
  assert.equal(next[2], list[2]);
});

test("copy helpers", () => {
  assert.equal(checkboxLabel(vendor(1, "Acme", policy(1, "Early Pay"))), "Run Early Pay for Acme");
  assert.equal(checkboxLabel(vendor(1, "Acme")), "Acme has no policy yet");
  const v = vendor(1, "A", null, { supported_payment_methods: "Card, ACH", payment_portal_url: "https://x.test" });
  assert.equal(paymentLine(v), "Pays by Card, ACH via the vendor portal");
  assert.equal(paymentLine({ ...v, payment_portal_url: null }), null);
  assert.equal(paymentLine({ ...v, supported_payment_methods: "  " }), null);
  assert.equal(paymentLine({ ...v, supported_payment_methods: null }), null);
  assert.equal(paymentLine({ ...v, payment_portal_url: "  " }), null);
  assert.equal(policyBanner("updated", "Acme"), "Policy successfully updated.");
  assert.equal(policyBanner("added", "Acme"), "Policy added for Acme.");
  assert.equal(policyBanner("on", "Early Pay"), "Turned on Early Pay.");
  assert.equal(policyBanner("off", "Early Pay"), "Turned off Early Pay.");
  assert.equal(NOT_APPLIED_NOTICE, "Policies are saved here but aren't applied to bills yet.");
  assert.equal(LOAD_POLICIES_FAILED, "Couldn't load policies. Try again.");
  assert.equal(SAVE_POLICY_FAILED, "Couldn't save the policy. Try again.");
  assert.equal(TOGGLE_POLICY_FAILED, "Couldn't change the policy. Try again.");
});

test("toPolicyErrorResponse maps database errors to replies", () => {
  assert.deepEqual(toPolicyErrorResponse({ code: "42501" }), POLICY_FORBIDDEN);
  assert.equal(POLICY_FORBIDDEN.status, 403);
  assert.equal(POLICY_FORBIDDEN.body.error, "Only financial approvers and system admins can change policies.");
  assert.deepEqual(toPolicyErrorResponse({ code: "23503" }), POLICY_VENDOR_NOT_FOUND);
  assert.deepEqual(POLICY_VENDOR_NOT_FOUND, {
    status: 404,
    body: { error: "This vendor no longer exists.", code: "vendor_not_found" },
  });
  assert.deepEqual(POLICY_NOT_FOUND, {
    status: 404,
    body: { error: "This policy no longer exists.", code: "policy_not_found" },
  });
  for (const code of ["23514", "22001"]) assert.deepEqual(toPolicyErrorResponse({ code }), invalidPolicy([]));
  assert.deepEqual(invalidPolicy(["name"]), {
    status: 400,
    body: { error: "Some of the policy's details aren't valid.", code: "invalid_policy", fields: ["name"] },
  });
  assert.equal(toPolicyErrorResponse({ code: "PGRST303" }).status, 401);
  assert.deepEqual(toPolicyErrorResponse({ code: "XX000" }), { status: 500, body: { error: SAVE_POLICY_FAILED } });
  assert.deepEqual(toPolicyErrorResponse({ code: "XX000" }, TOGGLE_POLICY_FAILED).body.error, TOGGLE_POLICY_FAILED);
});
