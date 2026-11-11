import 'server-only';

import { getSessionAccessToken } from './accessToken';
import type {
  Bill,
  CreateBillInput
} from '@/types/bill';

const LAST_SUBMITTED = 'order=created_at.desc&limit=1&status=neq.draft&select=*,vendors(name)';

export type UpdateBillInput = Partial<CreateBillInput>;

export class BillRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'BillRequestError';
  }
}

async function requestBills(query: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getSessionAccessToken();
  if (!accessToken) throw new BillRequestError(401, 'You are not signed in.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the Next server.');
  }
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/bills${query ? `?${query}` : ''}`, {
    ...init,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    throw new BillRequestError(response.status, `Bill request failed: ${response.status}`);
  }
  return response;
}

export async function createBill(data: CreateBillInput): Promise<Bill> {
  const response = await requestBills('', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const bills: Bill[] = await response.json();
  if (!bills[0]) throw new Error('No created bill was returned.');
  return bills[0];
}

export function fetchBills(): Promise<Bill[]> {
  return getBills<Bill>('');
}

export async function fetchBillById(id: string): Promise<Bill | null> {
  const bills: Bill[] = await getBills<Bill>(`bill_id=eq.${encodeURIComponent(id)}&limit=1`);
  return bills[0] ?? null;
}

type BillWithVendor = Bill & { vendors: { name: string } | null };

async function getBills<T>(query: string): Promise<T[]> {
  const response = await requestBills(query);
  return response.json();
}

// latest non-draft bill across every bill visible to the caller
export async function fetchLastSubmittedBill(): Promise<BillWithVendor | null> {
  const bills: BillWithVendor[] = await getBills<BillWithVendor>(LAST_SUBMITTED);
  return bills[0] ?? null;
}

// latest non-draft bill for one user
export async function fetchLastSubmittedBillByUserId(
  userId: string,
): Promise<BillWithVendor | null> {
  const bills: BillWithVendor[] = await getBills(
    `user_id=eq.${encodeURIComponent(userId)}&${LAST_SUBMITTED}`,
  );
  return bills[0] ?? null;
}

// last 10 paid bills visible to the caller
export async function fetchRecentPaidBills(): Promise<BillWithVendor[]> {
  return getBills(
    'status=eq.payment_success&date_paid=not.is.null&order=date_paid.desc&limit=10&select=*,vendors(name)',
  );
}

// oldest 10 bills awaiting approval visible to the caller
export async function fetchPendingApprovalBills(): Promise<BillWithVendor[]> {
  return getBills(
    'status=eq.pending_approval&order=date_received.asc&limit=10&select=*,vendors(name)',
  );
}

type StatusRow = { status: string };

// one { status } row per bill visible to the caller
export async function getBillStatusRows(): Promise<StatusRow[]> {
  return getBills<StatusRow>('select=status');
}

// one { status } row per bill for one user
export async function getBillStatusRowsByUserId(
  userId: string,
): Promise<StatusRow[]> {
  return getBills<StatusRow>(`user_id=eq.${encodeURIComponent(userId)}&select=status`);
}

export async function updateBill(id: string, data: UpdateBillInput): Promise<Bill | null> {
  const response = await requestBills(`bill_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const bills: Bill[] = await response.json();
  return bills[0] ?? null;
}

export async function deleteBill(id: string): Promise<number> {
  const response = await requestBills(`bill_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return response.status;
}
