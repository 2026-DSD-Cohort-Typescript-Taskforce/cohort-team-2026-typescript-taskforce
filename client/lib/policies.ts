// Policy types, role check, search, copy and the replies for /api/policies (DC-85).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { toErrorResponse, type ErrorResponse, type SupabaseError } from './submit-errors.ts';

export type ActiveVersion = {
  version_id: number;
  version: number;
  interpretation: string;
  confirmed_at: string;
  confirmed_by_name: string | null;
};

export type Policy = {
  policy_id: number;
  name: string;
  description: string;
  is_active: boolean;
  updated_at: string;
  active_version: ActiveVersion | null;
};

type Confirmer = { name: string | null };

/** A policies row as PostgREST sends it: the active version with the confirmer embedded. */
export type PolicyRow = Omit<Policy, 'active_version'> & {
  active_version:
    | (Omit<ActiveVersion, 'confirmed_by_name'> & { confirmer: Confirmer | Confirmer[] | null })
    | null;
};

export type PolicyVendor = {
  vendor_id: number;
  name: string;
  supported_payment_methods: string | null;
  payment_portal_url: string | null;
  policy: Policy | null;
};

/** A vendors row with its policy embedded; PostgREST sends an object or an array. */
export type PolicyVendorRow = Omit<PolicyVendor, 'policy'> & {
  policies: PolicyRow | PolicyRow[] | null;
};

const MANAGER_ROLES = ['financial_approver', 'system_admin'];
const MAX_ID = 2147483647;

export function canManagePolicies(role: string | null | undefined): boolean {
  return !!role && MANAGER_ROLES.includes(role);
}

/** A route's [vendorId] segment as a vendor id, or null when it can't be one. */
export function parseVendorId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_ID ? id : null;
}

/** Flattens the embedded confirmer to `confirmed_by_name` (null when RLS hides the user). */
export function toPolicy(row: PolicyRow): Policy {
  const { active_version: version, ...policy } = row;
  if (!version) return { ...policy, active_version: null };
  const { confirmer, ...rest } = version;
  const one = Array.isArray(confirmer) ? (confirmer[0] ?? null) : confirmer;
  return { ...policy, active_version: { ...rest, confirmed_by_name: one?.name ?? null } };
}

export function toPolicyVendor(row: PolicyVendorRow): PolicyVendor {
  const { policies, ...vendor } = row;
  const one = Array.isArray(policies) ? (policies[0] ?? null) : policies;
  return { ...vendor, policy: one ? toPolicy(one) : null };
}

/** Case-insensitive substring match on the vendor name and its policy's name and description. */
export function matchesPolicyVendor(v: PolicyVendor, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [v.name, v.policy?.name, v.policy?.description].some((field) =>
    field?.toLowerCase().includes(needle),
  );
}

export function filterPolicyVendors(list: PolicyVendor[], query: string): PolicyVendor[] {
  return list.filter((v) => matchesPolicyVendor(v, query));
}

export function replacePolicy(
  list: PolicyVendor[],
  vendorId: number,
  policy: Policy,
): PolicyVendor[] {
  return list.map((v) => (v.vendor_id === vendorId ? { ...v, policy } : v));
}

/** Applied: on with a confirmed version. Not applied: on, nothing confirmed yet. */
export function appliedState(policy: Policy | null): 'applied' | 'not_applied' | 'off' {
  if (!policy?.is_active) return 'off';
  return policy.active_version ? 'applied' : 'not_applied';
}

export function checkboxLabel(v: PolicyVendor): string {
  return v.policy ? `Run ${v.policy.name} for ${v.name}` : `${v.name} has no policy yet`;
}

/** "Pays by Card, ACH via the vendor portal"; null unless both values are present. The page adds the ↗. */
export function paymentLine(v: PolicyVendor): string | null {
  const methods = v.supported_payment_methods?.trim();
  if (!methods || !v.payment_portal_url?.trim()) return null;
  return `Pays by ${methods} via the vendor portal`;
}

export function policyBanner(action: 'updated' | 'added' | 'on' | 'off', subject: string): string {
  switch (action) {
    case 'updated':
      return 'Policy successfully updated.';
    case 'added':
      return `Policy added for ${subject}.`;
    case 'on':
      return `Turned on ${subject}.`;
    case 'off':
      return `Turned off ${subject}.`;
  }
}

export const LOAD_POLICIES_FAILED = "Couldn't load policies. Try again.";
export const SAVE_POLICY_FAILED = "Couldn't save the policy. Try again.";
export const TOGGLE_POLICY_FAILED = "Couldn't change the policy. Try again.";

export const POLICY_FORBIDDEN: ErrorResponse = {
  status: 403,
  body: {
    error: 'Only financial approvers and system admins can change policies.',
    code: 'forbidden',
  },
};

export const POLICY_VENDOR_NOT_FOUND: ErrorResponse = {
  status: 404,
  body: { error: 'This vendor no longer exists.', code: 'vendor_not_found' },
};

export const POLICY_NOT_FOUND: ErrorResponse = {
  status: 404,
  body: { error: 'This policy no longer exists.', code: 'policy_not_found' },
};

/** A 400 naming the fields that failed; the modal shows its own message for each. */
export function invalidPolicy(fields: string[]): ErrorResponse {
  return {
    status: 400,
    body: { error: "Some of the policy's details aren't valid.", code: 'invalid_policy', fields },
  };
}

export function toPolicyErrorResponse(
  error: SupabaseError,
  fallback = SAVE_POLICY_FAILED,
): ErrorResponse {
  switch (error.code) {
    case '42501':
      return POLICY_FORBIDDEN;
    case '23503':
      return POLICY_VENDOR_NOT_FOUND;
    case '23514':
    case '22001':
      return invalidPolicy([]);
  }
  return toErrorResponse(error, fallback);
}
