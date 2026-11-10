import 'server-only';

import { getSessionAccessToken } from './accessToken';

import type {
    Vendor,
    CreateVendorInput
} from "@/types/vendors";

export type UpdateVendorInput = Partial<CreateVendorInput>;

export class VendorRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'VendorRequestError';
  }
}

async function requestVendors(query: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getSessionAccessToken();
  if (!accessToken) throw new VendorRequestError(401, 'You are not signed in.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the Next server.');
  }
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
  headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/vendors${query ? `?${query}` : ''}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  if (!response.ok) {
    throw new VendorRequestError(response.status, `Vendor request failed: ${response.status}`);
  }
  return response;
}

export async function createVendor(data: CreateVendorInput): Promise<Vendor> {
    const response = await requestVendors('', {
        method: 'POST',
        headers: { Prefer: 'return=representation'},
        body: JSON.stringify(data),
    });

    const vendors: Vendor[] = await response.json();

    if (!vendors[0]) {
        throw new Error('No created vendor was returned.');
    }

    return vendors[0];
}

export function fetchVendors(): Promise<Vendor[]> {
  return getVendors<Vendor>('');
}

export async function fetchVendorById(id: string): Promise<Vendor | null> {
  const vendors: Vendor[] = await getVendors(`vendor_id=eq.${encodeURIComponent(id)}&limit=1`);
  return vendors[0] ?? null;
}

async function getVendors<T>(query: string): Promise<T[]> {
  const response = await requestVendors(query);
  return response.json();
}

export async function updateVendor(
  id: string,
  data: UpdateVendorInput,
): Promise<Vendor | null> {
  const response = await requestVendors(`vendor_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });

  const vendors: Vendor[] = await response.json();
  return vendors[0] ?? null;
}

export async function deleteVendor(id: string): Promise<number> {
  const response = await requestVendors(`vendor_id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return response.status;
}
