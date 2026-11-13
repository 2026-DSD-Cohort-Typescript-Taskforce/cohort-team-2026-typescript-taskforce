// User types, table rows, the Add a User checks and their messages (DC-55).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { isRole, roleLabel } from './roles.ts';

// Embeds the property through users.property_id. After DC-86 a user can have several
// properties: change this to user_properties(properties(name)) and nothing else.
export const USER_SELECT = 'user_id, name, email, phone, role, auth_user_id, properties(name)';

type PropertyName = { name: string | null };

/** A users row as USER_SELECT returns it. */
export type UserRecord = {
  user_id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  role: string | null;
  /** null until the user accepts the invite and has a login. */
  auth_user_id: string | null;
  /** One property today (or none); a list once the embed goes through user_properties. */
  properties: PropertyName | PropertyName[] | null;
};

export type UserRow = {
  user_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: string | null;
  roleLabel: string;
  properties: string;
  pending: boolean;
};

export function toUserRow(record: UserRecord): UserRow {
  const list = Array.isArray(record.properties)
    ? record.properties
    : record.properties
      ? [record.properties]
      : [];
  const names = list.map((property) => property.name?.trim()).filter(Boolean);
  return {
    user_id: record.user_id,
    name: record.name ?? '',
    email: record.email,
    phone: record.phone,
    role: record.role,
    roleLabel: roleLabel(record.role),
    properties: names.length > 0 ? names.join(', ') : '—',
    pending: record.auth_user_id === null,
  };
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
export const USERS_FORBIDDEN = "You don't have access to manage users.";

export const inviteSent = (email: string) => `Invite sent to ${email}.`;

// local@domain, where the domain has at least two non-empty dot-separated labels
// (as in vendor-validation.ts).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** One message per field that failed; empty when the details can be sent. */
export function validateNewUser(input: NewUserInput): NewUserErrors {
  const errors: NewUserErrors = {};
  if (!input.name.trim()) errors.name = NAME_REQUIRED;
  const email = input.email.trim();
  if (!email) errors.email = EMAIL_REQUIRED;
  else if (!EMAIL_PATTERN.test(email)) errors.email = EMAIL_INVALID;
  if (!isRole(input.role)) errors.role = ROLE_REQUIRED;
  return errors;
}
