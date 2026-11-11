import 'server-only';

import { getSessionAccessToken } from './accessToken';
import type { User, UpdateUserInput } from '@/types/users';

export type { UpdateUserInput } from '@/types/users';

export class UserRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'UserRequestError';
  }
}

async function requestUsers(query: string, init?: RequestInit): Promise<Response> {
  const accessToken = await getSessionAccessToken();
  if (!accessToken) throw new UserRequestError(401, 'You are not signed in.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the Next server.');
  }
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
  headers.set('Authorization', `Bearer ${accessToken}`);

  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/users${query ? `?${query}` : ''}`,
    {
      ...init,
      cache: 'no-store',
      headers,
    },
  );
  if (!response.ok) {
    throw new UserRequestError(response.status, `User request failed: ${response.status}`);
  }
  return response;
}

export async function fetchUsers(): Promise<User[]> {
  const response = await requestUsers('');
  return response.json();
}

export async function fetchUserById(id: string): Promise<User | null> {
  const response = await requestUsers(`user_id=eq.${encodeURIComponent(id)}&limit=1`);
  const users: User[] = await response.json();
  return users[0] ?? null;
}

export async function updateUser(id: string, data: UpdateUserInput): Promise<User | null> {
  const changes = Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== undefined),
  );
  const keys = Object.keys(changes);
  if (keys.length === 0 || keys.some((key) => key !== 'name' && key !== 'phone')) {
    throw new UserRequestError(400, 'Only name and phone may be updated.');
  }
  const name = changes.name;
  const phone = changes.phone;
  if (
    ('name' in changes &&
      (typeof name !== 'string' || name.trim().length === 0 || [...name].length > 255)) ||
    ('phone' in changes && phone !== null && (typeof phone !== 'string' || [...phone].length > 255))
  ) {
    throw new UserRequestError(400, 'Enter a valid name and phone (at most 255 characters each).');
  }
  const response = await requestUsers(`user_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(changes),
  });
  const users: User[] = await response.json();
  return users[0] ?? null;
}
