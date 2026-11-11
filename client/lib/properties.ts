import 'server-only';

import { getSessionAccessToken } from './accessToken';
import type { Property, CreatePropertyInput } from '@/types/properties';

export type UpdatePropertyInput = Partial<CreatePropertyInput>;

export class PropertyRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PropertyRequestError';
  }
}

async function requestProperties(query: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getSessionAccessToken();
  if (!accessToken) throw new PropertyRequestError(401, 'You are not signed in.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the Next server.');
  }
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
  headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/properties${query ? `?${query}` : ''}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  if (!response.ok) {
    throw new PropertyRequestError(response.status, `Property request failed: ${response.status}`);
  }
  return response;
}

export async function fetchProperties(): Promise<Property[]> {
  const response = await requestProperties('');
  return response.json();
}

export async function fetchPropertyById(id: string): Promise<Property | null> {
  const response = await requestProperties(`property_id=eq.${encodeURIComponent(id)}&limit=1`);
  const properties: Property[] = await response.json();
  return properties[0] ?? null;
}

export async function createProperty(data: CreatePropertyInput): Promise<Property> {
  const response = await requestProperties('', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const properties: Property[] = await response.json();
  if (!properties[0]) throw new Error('No created property was returned.');
  return properties[0];
}

export async function updateProperty(id: string, data: UpdatePropertyInput): Promise<Property | null> {
  const response = await requestProperties(`property_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const properties: Property[] = await response.json();
  return properties[0] ?? null;
}

export async function deleteProperty(id: string): Promise<number> {
  const response = await requestProperties(`property_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return response.status;
}
