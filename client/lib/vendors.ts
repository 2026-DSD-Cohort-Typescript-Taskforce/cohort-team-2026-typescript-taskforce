// Vendor types, role check, search, sort and the replies for /api/vendors (DC-84).
// Only imports with a .ts extension, so `npm test` (node --test) can load it.

import { toErrorResponse, type ErrorResponse, type SupabaseError } from "./submit-errors.ts";
import { INVALID_LOGO } from "./vendor-validation.ts";

export type Vendor = {
  vendor_id: number;
  name: string;
  email: string | null;
  address: string | null;
  phone: string | null;
  logo_url: string | null;
};

const MANAGER_ROLES = ["financial_approver", "system_admin"];
const MAX_ID = 2147483647;

export function canManageVendors(role: string | null | undefined): boolean {
  return !!role && MANAGER_ROLES.includes(role);
}

/** A route's [id] segment as a vendor id, or null when it can't be one. */
export function parseVendorId(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return id >= 1 && id <= MAX_ID ? id : null;
}

const PHONE_QUERY = /^[\d +().-]+$/;
const digitsOf = (value: string) => value.replace(/\D/g, "");

/**
 * Searches name, address, email and phone. A query made only of phone characters (with a
 * digit) compares digits only, so "(555) 010" finds 555-010-1234; any other query is a
 * case-insensitive substring match.
 */
export function matchesVendor(v: Vendor, query: string): boolean {
  const q = query.trim();
  if (!q) return true;
  if (PHONE_QUERY.test(q) && /\d/.test(q)) {
    const wanted = digitsOf(q);
    if (digitsOf(v.phone ?? "").includes(wanted)) return true;
  }
  const needle = q.toLowerCase();
  return [v.name, v.address, v.email, v.phone].some((field) => field?.toLowerCase().includes(needle));
}

export function filterVendors(list: Vendor[], query: string): Vendor[] {
  return list.filter((v) => matchesVendor(v, query));
}

export function sortVendorsByName(list: Vendor[]): Vendor[] {
  return [...list].sort(
    (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.vendor_id - b.vendor_id,
  );
}

export function upsertVendor(list: Vendor[], v: Vendor): Vendor[] {
  const exists = list.some((item) => item.vendor_id === v.vendor_id);
  return sortVendorsByName(exists ? list.map((item) => (item.vendor_id === v.vendor_id ? v : item)) : [...list, v]);
}

export function removeVendor(list: Vendor[], id: number): Vendor[] {
  return list.filter((v) => v.vendor_id !== id);
}

export function vendorBanner(action: "saved" | "added" | "deleted", name: string): string {
  const verb = { saved: "Saved", added: "Added", deleted: "Deleted" }[action];
  return `${verb} ${name}.`;
}

/** A detail for display: an em dash when it is empty. */
export function displayValue(value: string | null): string {
  return value?.trim() ? value : "—";
}

export const LOAD_VENDORS_FAILED = "Couldn't load vendors. Try again.";
export const SAVE_VENDOR_FAILED = "Couldn't save the vendor. Try again.";
export const DELETE_VENDOR_FAILED = "Couldn't delete the vendor. Try again.";
export const LOGO_FAILED = "Vendor saved, but the logo didn't upload. Try again.";

export const VENDOR_FORBIDDEN: ErrorResponse = {
  status: 403,
  body: { error: "Only financial approvers and system admins can change vendors.", code: "forbidden" },
};

export const VENDOR_NOT_FOUND: ErrorResponse = {
  status: 404,
  body: { error: "This vendor no longer exists.", code: "vendor_not_found" },
};

export const VENDOR_HAS_BILLS: ErrorResponse = {
  status: 409,
  body: { error: "This vendor has bills, so it can't be deleted.", code: "vendor_has_bills" },
};

export const DUPLICATE_VENDOR_NAME: ErrorResponse = {
  status: 409,
  body: { error: "A vendor with this name already exists.", code: "duplicate_vendor_name", fields: ["name"] },
};

export const INVALID_LOGO_REPLY: ErrorResponse = {
  status: 400,
  body: { error: INVALID_LOGO, code: "invalid_logo" },
};

/** A 400 naming the fields that failed; the form shows its own message for each. */
export function invalidVendor(fields: string[]): ErrorResponse {
  return { status: 400, body: { error: "Some of the vendor's details aren't valid.", code: "invalid_vendor", fields } };
}

export function toVendorErrorResponse(error: SupabaseError, fallback = SAVE_VENDOR_FAILED): ErrorResponse {
  switch (error.code) {
    case "23505":
      return DUPLICATE_VENDOR_NAME;
    case "23503":
      return VENDOR_HAS_BILLS;
    case "42501":
      return VENDOR_FORBIDDEN;
    case "23514":
    case "22001":
      return invalidVendor([]);
  }
  return toErrorResponse(error, fallback);
}
