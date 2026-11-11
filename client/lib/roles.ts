// Contract with server/src/config/roles.ts. Change both together.

export const ROLES = ['billing_operator', 'financial_approver', 'system_administrator'] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  billing_operator: 'Billing Operator',
  financial_approver: 'Financial Approver',
  system_administrator: 'System Administrator',
};
