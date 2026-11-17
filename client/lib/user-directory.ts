// User types, table rows, the Add a User checks and their messages (DC-55).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { isRole, roleLabel } from './roles.ts';

// properties goes through user_properties (DC-86), so it is a list. The ids prefill the
// edit form.
export const USER_SELECT =
  'user_id, name, email, phone, role, auth_user_id, properties(property_id, name)';

type PropertyName = { property_id: number; name: string | null };

/** A users row as USER_SELECT returns it. */
export type UserRecord = {
  user_id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  /** null until the user accepts the invite and has a login. */
  auth_user_id: string | null;
  properties: PropertyName[];
};

export type UserRow = {
  user_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  roleLabel: string;
  /** The names joined, for sorting and the table's filters. */
  properties: string;
  /** The same names as a list, for the chips. */
  propertyNames: string[];
  pending: boolean;
};

export function toUserRow(record: UserRecord): UserRow {
  const names = record.properties
    .map((property) => property.name?.trim())
    .filter((name): name is string => !!name);
  return {
    user_id: record.user_id,
    name: record.name ?? '',
    email: record.email,
    phone: record.phone,
    role: record.role,
    roleLabel: roleLabel(record.role),
    properties: names.length > 0 ? names.join(', ') : '—',
    propertyNames: names,
    pending: record.auth_user_id === null,
  };
}

/** True when the name or email holds the query, ignoring case. A blank query matches all. */
export function matchesUser(row: UserRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  return [row.name, row.email].some((field) => field?.toLowerCase().includes(needle));
}

/** The property chips to show in a row: the first two, and how many more there are. */
export function chipsFor(names: string[]): { shown: string[]; more: number } {
  return { shown: names.slice(0, 2), more: Math.max(names.length - 2, 0) };
}

/** The Add a User form's details. */
export type NewUserInput = {
  name: string;
  email: string;
  phone?: string;
  role: string;
  propertyIds: number[];
};

export type NewUserField = 'name' | 'email' | 'role';

/** The fields checked in order, so the form can focus the first that failed. */
export const NEW_USER_FIELDS: NewUserField[] = ['name', 'email', 'role'];

export type NewUserErrors = Partial<Record<NewUserField, string>>;

export const NAME_REQUIRED = "Enter the user's full name.";
export const EMAIL_REQUIRED = "Enter the user's email address.";
export const EMAIL_INVALID = 'Enter a valid email address.';
export const ROLE_REQUIRED = 'Choose a role.';

export const LOAD_USERS_FAILED = "Couldn't load users. Try again.";
export const CREATE_USER_FAILED = "Couldn't add the user. Try again.";
export const UPDATE_USER_FAILED = "Couldn't save the user. Try again.";
export const USERS_FORBIDDEN = "You don't have access to manage users.";

export const RESEND_FAILED = "Couldn't send the invite. Try again.";

export const inviteSent = (email: string) => `Invite sent to ${email}.`;
export const userSaved = (name: string) => `Saved ${name}.`;
export const inviteNotSent = (email: string) =>
  `${email} was added, but the invite email couldn't be sent. Use Resend invite to try again.`;

// local@domain, where the domain has at least two non-empty dot-separated labels
// (as in vendor-validation.ts).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/**
 * One message per field that failed; empty when the details can be sent. Editing passes
 * checkEmail false: the email is read-only there.
 */
export function validateNewUser(input: NewUserInput, checkEmail = true): NewUserErrors {
  const errors: NewUserErrors = {};
  if (!input.name.trim()) errors.name = NAME_REQUIRED;
  if (checkEmail) {
    const email = input.email.trim();
    if (!email) errors.email = EMAIL_REQUIRED;
    else if (!EMAIL_PATTERN.test(email)) errors.email = EMAIL_INVALID;
  }
  if (!isRole(input.role)) errors.role = ROLE_REQUIRED;
  return errors;
}
