// Contract with client/lib/roles.ts and the users.role CHECK (DC-86). Change all three together.
import { z } from 'zod';

export const ROLES = ['billing_operator', 'financial_approver', 'system_admin'] as const;

export type Role = (typeof ROLES)[number];

export const roleSchema = z.enum(ROLES);

export const isRole = (value: unknown): value is Role => roleSchema.safeParse(value).success;
