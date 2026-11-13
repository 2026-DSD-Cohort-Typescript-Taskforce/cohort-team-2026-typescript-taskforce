// Contract with server/src/config/roles.ts. Change both together.

export const ROLES = ['billing_operator', 'financial_approver', 'system_admin'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  billing_operator: 'Billing Operator',
  financial_approver: 'Financial Approver',
  system_admin: 'System Administrator',
};

export const isRole = (value: unknown): value is Role =>
  typeof value === 'string' && (ROLES as readonly string[]).includes(value);

export const canManageUsers = (role: string | null | undefined): boolean => role === 'system_admin';

/** A role for display: its label when known, the raw value otherwise, '—' when there is none. */
export function roleLabel(role: string | null): string {
  if (role === null) return '—';
  return isRole(role) ? ROLE_LABELS[role] : role;
}
