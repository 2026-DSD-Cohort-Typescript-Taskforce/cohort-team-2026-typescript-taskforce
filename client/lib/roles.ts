// Contract with server/src/config/roles.ts. Change both together.

export const ROLES = ['viewer', 'billing_operator', 'financial_approver', 'system_admin'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  viewer: 'Viewer',
  billing_operator: 'Billing Operator',
  financial_approver: 'Financial Approver',
  system_admin: 'System Administrator',
};

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export const canManageUsers = (role: string | null | undefined): boolean => role === 'system_admin';

/** Better define who may submit a bill, because it wasn't before. Matches submit_bill() (20261118184316). */
export const canSubmitBills = (role: string | null | undefined): boolean =>
  role === 'billing_operator' || role === 'financial_approver' || role === 'system_admin';

/** Better define who may approve, deny or send back a bill. Matches decide_bill() (20261118184316). */
export const canDecideBills = (role: string | null | undefined): boolean =>
  role === 'financial_approver' || role === 'system_admin';

/**
 * Whether to offer Delete for a bill. Matches the bills delete policies (20261118235000):
 * anyone deletes a draft, and approvers and admins also delete a bill in review or denied.
 * A sent-back draft is approvers-only too; the database refuses it for anyone else.
 */
export const canDeleteBill = (role: string | null | undefined, status: string): boolean =>
  status === 'draft' ||
  (canDecideBills(role) && (status === 'pending_approval' || status === 'approval_denied'));

/** A role for display: its label when known, the raw value otherwise, '—' when there is none. */
export function roleLabel(role: string | null): string {
  if (role === null) return '—';
  return isRole(role) ? ROLE_LABELS[role] : role;
}
