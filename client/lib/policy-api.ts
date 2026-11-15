// The browser's calls to the app's policy routes (DC-85), through the same `call` as the
// bill routes. Each returns the data, a failure with a readable message, or null while
// apiFetch sends the user to /login.

import { call, sendJson } from "./bill-api";
import {
  LOAD_POLICIES_FAILED,
  SAVE_POLICY_FAILED,
  TOGGLE_POLICY_FAILED,
  type Policy,
  type PolicyVendor,
} from "./policies";
import type { PolicyInput } from "./policy-validation";

const readPolicy = (body: { policy: Policy }) => body.policy;

// Local: widening sendJson's method type would touch the line PR #35 also edits.
const putJson = (body: unknown): RequestInit => ({
  method: "PUT",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function loadPolicyVendors() {
  return call("/api/policies", undefined, (body: { vendors: PolicyVendor[] }) => body.vendors, LOAD_POLICIES_FAILED);
}

export function savePolicy(vendorId: number, input: PolicyInput) {
  return call(`/api/policies/${vendorId}`, putJson(input), readPolicy, SAVE_POLICY_FAILED);
}

export function setPolicyActive(vendorId: number, isActive: boolean) {
  return call(
    `/api/policies/${vendorId}`,
    sendJson("PATCH", { is_active: isActive }),
    readPolicy,
    TOGGLE_POLICY_FAILED,
  );
}
