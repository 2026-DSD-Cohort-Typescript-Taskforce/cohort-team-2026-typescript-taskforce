// The browser's calls to the app's bill routes (DC-71), through apiFetch: loading and
// saving bills, running extraction, attaching and viewing bill documents, and adding a
// vendor or property from the bill form. Each returns the data, a failure with a readable
// message, or null while apiFetch sends the user to /login (the caller then does nothing
// more).

import { apiFetch } from './api-fetch';
import { SAVE_FAILED } from './bill-errors';
import type { BillInput } from './bill-validation';
import type { Bill, FormOptions } from './bill-view';
import type { ExtractionResult } from './extraction';
import { SUBMIT_FAILED } from './submit-errors';

export const UNREACHABLE = 'Could not reach the server. Try again.';

/** A refused or failed call: the route's { error, code } reply, or status 0 when offline. */
export type ApiFailure = {
  status: number;
  error: string;
  code?: string;
  /** Fields the route named (incomplete_bill, invalid_bill, duplicate_invoice). */
  fields?: string[];
  /** The bill's status now, with not_draft. */
  billStatus?: string;
};

export type ApiResult<T> = { ok: true; data: T } | ({ ok: false } & ApiFailure);

async function call<T>(
  path: string,
  init: RequestInit | undefined,
  read: (body: never) => T,
  fallback: string,
): Promise<ApiResult<T> | null> {
  try {
    const res = await apiFetch(path, init);
    if (!res) return null;
    const body = await res.json().catch(() => null);
    if (res.ok) return { ok: true, data: read(body as never) };
    return {
      ok: false,
      status: res.status,
      error: body?.error ?? fallback,
      code: body?.code,
      fields: body?.fields,
      billStatus: body?.status,
    };
  } catch {
    return { ok: false, status: 0, error: UNREACHABLE };
  }
}

function sendJson(method: 'POST' | 'PATCH', body: unknown): RequestInit {
  return { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}

export function loadBills() {
  return call(
    '/api/bills',
    undefined,
    (body: { bills: Bill[] }) => body.bills,
    "Couldn't load the bills. Try again.",
  );
}

export function loadFormOptions() {
  return call(
    '/api/bills/form-options',
    undefined,
    (body: FormOptions) => body,
    "Couldn't load the bill form's choices. Try again.",
  );
}

/** The signed-in user's role (users.role), from Express's GET /api/auth/me. */
export function loadUserRole() {
  return call(
    '/api/auth/me',
    undefined,
    (body: { user: { role: string | null } }) => body.user.role,
    'Could not load your account.',
  );
}

export function createDraftBill(input: BillInput) {
  return call(
    '/api/bills',
    sendJson('POST', input),
    (body: { bill: Bill }) => body.bill,
    SAVE_FAILED,
  );
}

export function updateDraftBill(billId: number, input: Partial<BillInput>) {
  return call(
    `/api/bills/${billId}`,
    sendJson('PATCH', input),
    (body: { bill: Bill }) => body.bill,
    "Couldn't update the bill. Try again.",
  );
}

/** submit_bill() returns the bills row, without the embedded names. */
export function submitBill(billId: number) {
  return call(
    `/api/bills/${billId}/submit`,
    { method: 'POST' },
    (body: { bill: { status: string } }) => body.bill.status,
    SUBMIT_FAILED,
  );
}

/** Runs extract-invoices on a pending upload. The route always answers with an outcome. */
export function extractBill(path: string, replaceBillId?: number) {
  return call(
    '/api/bills/extract',
    sendJson('POST', { path, replaceBillId }),
    (body: ExtractionResult) => body,
    "Couldn't extract the bill. Try again.",
  );
}

/** Files a pending upload under bills/ and attaches it to the draft. */
export function attachDocument(billId: number, path: string) {
  return call(
    `/api/bills/${billId}/document`,
    sendJson('POST', { path }),
    (body: { bill: Bill }) => body.bill,
    "Couldn't attach the PDF. Try again.",
  );
}

/** A link to the bill's PDF that works for a few minutes. */
export function loadDocumentUrl(billId: number) {
  return call(
    `/api/bills/${billId}/document`,
    undefined,
    (body: { url: string }) => body.url,
    "Couldn't load the PDF.",
  );
}

export function addVendor(input: {
  name: string;
  payment_portal_url: string;
  supported_payment_methods: string;
}) {
  return call(
    '/api/vendors',
    sendJson('POST', input),
    (body: { vendor: { id: number } }) => body.vendor,
    "Couldn't add the vendor. Try again.",
  );
}

export function addProperty(name: string) {
  return call(
    '/api/properties',
    sendJson('POST', { name }),
    (body: { property: { id: number } }) => body.property,
    "Couldn't add the property. Try again.",
  );
}
