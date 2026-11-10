// The rules a vendor's details and logo must meet (DC-84). The vendor form runs them
// before saving; POST and PATCH /api/vendors and PUT .../logo run them again on the
// request. Only imports with a .ts extension, so `npm test` (node --test) can load it.

export type VendorField = "name" | "email" | "address" | "phone";

export const VENDOR_FIELDS: VendorField[] = ["name", "email", "address", "phone"];

/** A vendor's details as the API takes them. */
export type VendorInput = Record<VendorField, string>;

/** One readable message per field that failed. */
export type VendorErrors = Partial<Record<VendorField, string>>;

// vendors.name is VARCHAR(255), email VARCHAR(254), address VARCHAR(500).
export const NAME_MAX = 255;
export const EMAIL_MAX = 254;
export const ADDRESS_MAX = 500;

const MIN_PHONE_DIGITS = 10;
const MAX_PHONE_DIGITS = 15;

const WORDS: Record<VendorField, string> = { name: "name", email: "email", address: "address", phone: "phone number" };

// local@domain, where the domain has at least two non-empty dot-separated labels.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const PHONE_PATTERN = /^\+?[\d\s().-]+$/;

const length = (value: string) => [...value].length;

/** Checks every field; returns the trimmed details to save, or an error per failing field. */
export function validateVendorInput(body: Record<string, unknown>): { input: VendorInput } | { errors: VendorErrors } {
  const input = {} as VendorInput;
  const errors: VendorErrors = {};

  for (const field of VENDOR_FIELDS) {
    const raw = body[field];
    const value = typeof raw === "string" ? raw.trim() : "";
    const error = value ? check(field, value) : `Enter the vendor's ${WORDS[field]}.`;
    if (error) errors[field] = error;
    else input[field] = value;
  }

  return Object.keys(errors).length > 0 ? { errors } : { input };
}

function check(field: VendorField, value: string): string | null {
  switch (field) {
    case "name":
      return length(value) > NAME_MAX ? `Keep the name to ${NAME_MAX} characters or fewer.` : null;
    case "address":
      return length(value) > ADDRESS_MAX ? `Keep the address to ${ADDRESS_MAX} characters or fewer.` : null;
    case "email":
      return length(value) <= EMAIL_MAX && EMAIL_PATTERN.test(value) ? null : "Enter a valid email address.";
    case "phone": {
      const digits = value.replace(/\D/g, "").length;
      const ok = PHONE_PATTERN.test(value) && digits >= MIN_PHONE_DIGITS && digits <= MAX_PHONE_DIGITS;
      return ok ? null : "Enter a valid phone number.";
    }
  }
}

export const LOGO_MAX_BYTES = 1_048_576;

export const INVALID_LOGO = "Choose a PNG, JPEG or WebP image up to 1 MB.";

const LOGO_TYPES: Record<string, "png" | "jpg" | "webp"> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The file extension for a logo of this type, or null when it isn't an allowed logo. */
export function logoExtension(file: { type: string; size: number }): "png" | "jpg" | "webp" | null {
  if (file.size <= 0 || file.size > LOGO_MAX_BYTES) return null;
  return LOGO_TYPES[file.type] ?? null;
}
