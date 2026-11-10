// The browser's calls to the app's vendor routes (DC-84), through the same `call` as the
// bill routes. Each returns the data, a failure with a readable message, or null while
// apiFetch sends the user to /login.

import { call, sendJson } from "./bill-api";
import {
  DELETE_VENDOR_FAILED,
  LOAD_VENDORS_FAILED,
  SAVE_VENDOR_FAILED,
  type Vendor,
} from "./vendors";
import type { VendorInput } from "./vendor-validation";

const readVendor = (body: { vendor: Vendor }) => body.vendor;

export function loadVendors() {
  return call("/api/vendors", undefined, (body: { vendors: Vendor[] }) => body.vendors, LOAD_VENDORS_FAILED);
}

export function createVendor(input: VendorInput) {
  return call("/api/vendors", sendJson("POST", input), readVendor, SAVE_VENDOR_FAILED);
}

export function updateVendor(id: number, input: VendorInput) {
  return call(`/api/vendors/${id}`, sendJson("PATCH", input), readVendor, SAVE_VENDOR_FAILED);
}

/** 204 with no body, so there is nothing to read. */
export function deleteVendor(id: number) {
  return call(`/api/vendors/${id}`, { method: "DELETE" }, () => null, DELETE_VENDOR_FAILED);
}

/** Multipart: the browser sets the Content-Type with its boundary. */
export function uploadVendorLogo(id: number, file: File) {
  const body = new FormData();
  body.append("logo", file);
  return call(`/api/vendors/${id}/logo`, { method: "PUT", body }, readVendor, SAVE_VENDOR_FAILED);
}

export function removeVendorLogo(id: number) {
  return call(`/api/vendors/${id}/logo`, { method: "DELETE" }, readVendor, SAVE_VENDOR_FAILED);
}
