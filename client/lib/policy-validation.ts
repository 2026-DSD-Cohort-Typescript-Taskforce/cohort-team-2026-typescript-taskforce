// The rules a policy's name and description must meet (DC-85). The policy modal runs them
// before saving; PUT /api/policies/[vendorId] runs them again on the request. Only imports
// with a .ts extension, so `npm test` (node --test) can load it.

export type PolicyField = "name" | "description";

export const POLICY_FIELDS: PolicyField[] = ["name", "description"];

/** A policy's details as the API takes them. */
export type PolicyInput = Record<PolicyField, string>;

/** One readable message per field that failed. */
export type PolicyErrors = Partial<Record<PolicyField, string>>;

export const POLICY_NAME_MAX = 100;
export const POLICY_TEXT_MAX = 1000;

const MISSING: Record<PolicyField, string> = { name: "Enter a policy name.", description: "Describe the policy." };

const length = (value: string) => [...value].length;

/** Checks both fields; returns the trimmed details to save, or an error per failing field. */
export function validatePolicyInput(body: Record<string, unknown>): { input: PolicyInput } | { errors: PolicyErrors } {
  const input = {} as PolicyInput;
  const errors: PolicyErrors = {};

  for (const field of POLICY_FIELDS) {
    const raw = body[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    const error = value ? check(field, value) : MISSING[field];
    if (error) errors[field] = error;
    else input[field] = value;
  }

  return Object.keys(errors).length > 0 ? { errors } : { input };
}

function check(field: PolicyField, value: string): string | null {
  if (field === "name") {
    return length(value) > POLICY_NAME_MAX ? `Keep the name to ${POLICY_NAME_MAX} characters or fewer.` : null;
  }
  return length(value) > POLICY_TEXT_MAX ? `Keep the policy to ${POLICY_TEXT_MAX} characters or fewer.` : null;
}

/** The `is_active` of a PATCH body when it is a real boolean, else null. */
export function parseActiveFlag(body: Record<string, unknown>): boolean | null {
  return typeof body.is_active === "boolean" ? body.is_active : null;
}
