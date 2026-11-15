// Properties as the /api/properties routes return them, the rules their details must meet,
// and the routes' error replies (DC-83). The property form runs validateProperty() before
// saving; POST and PATCH run it again on the request body. Only imports with a .ts
// extension, so `npm test` (node --test) can load it.

import type { ErrorResponse } from './submit-errors.ts';

export const PROPERTY_SELECT = 'property_id, name, address, phone, email';

export type Property = {
  property_id: number;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
};

export const PROPERTY_FIELDS = ['name', 'address', 'phone', 'email'] as const;

export type PropertyField = (typeof PROPERTY_FIELDS)[number];

/** A property's details as the API takes them. */
export type PropertyInput = Omit<Property, 'property_id'>;

/** One readable message per field that failed. */
export type PropertyErrors = Partial<Record<PropertyField, string>>;

export type PropertyValidation<T> =
  { input: T; errors?: undefined } | { input?: undefined; errors: PropertyErrors };

// The columns are unbounded VARCHARs; this keeps a pasted essay out of a card.
const MAX_LENGTH = 255;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Checks every field and returns the details to send, or an error per failing field.
 * Text is trimmed and a blank optional field becomes null. With `partial` (an edit),
 * fields that aren't in `values` are left out instead.
 */
export function validateProperty(
  values: Record<string, unknown>,
  options?: { partial?: false },
): PropertyValidation<PropertyInput>;
export function validateProperty(
  values: Record<string, unknown>,
  options: { partial: true },
): PropertyValidation<Partial<PropertyInput>>;
export function validateProperty(
  values: Record<string, unknown>,
  { partial = false }: { partial?: boolean } = {},
): PropertyValidation<Partial<PropertyInput>> {
  const input: Partial<Record<PropertyField, string | null>> = {};
  const errors: PropertyErrors = {};

  for (const field of PROPERTY_FIELDS) {
    if (partial && !(field in values)) continue;
    const result = check(field, values[field]);
    if (typeof result === 'object' && result !== null) errors[field] = result.error;
    else input[field] = result;
  }

  return Object.keys(errors).length > 0 ? { errors } : { input: input as Partial<PropertyInput> };
}

function check(field: PropertyField, value: unknown): string | null | { error: string } {
  if (value != null && typeof value !== 'string') return { error: 'Enter this as text.' };
  const text = value?.trim() ?? '';
  if (!text) return field === 'name' ? { error: "Enter the property's name." } : null;
  if (text.length > MAX_LENGTH) return { error: `Use ${MAX_LENGTH} characters or fewer.` };
  if (field === 'email' && !EMAIL_PATTERN.test(text))
    return { error: 'Enter an email like name@example.com.' };
  return text;
}

// properties.property_id is a Postgres integer.
const MAX_ID = 2147483647;

/** The property id in a URL, or null when it can't be one, so the route answers 404. */
export function parsePropertyId(id: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(id)) return null;
  const propertyId = Number(id);
  return propertyId <= MAX_ID ? propertyId : null;
}

export const PROPERTY_NOT_FOUND: ErrorResponse = {
  status: 404,
  body: { error: 'This property no longer exists.', code: 'not_found' },
};

/** bills.property_id and users.property_id reference properties with no cascade. */
export const PROPERTY_IN_USE: ErrorResponse = {
  status: 409,
  body: {
    error: "This property has bills or users assigned, so it can't be deleted.",
    code: 'property_in_use',
  },
};

export function invalidProperty(fields: string[] = []): ErrorResponse {
  return {
    status: 400,
    body: {
      error: "Some of the property's details aren't valid.",
      code: 'invalid_property',
      fields,
    },
  };
}
