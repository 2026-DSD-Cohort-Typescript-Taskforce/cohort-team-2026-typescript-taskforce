import 'server-only';

import { getSessionAccessToken } from './accessToken';
import type { User, CreateUserInput, UpdateUserInput } from '@/types/users';

export type { UpdateUserInput } from '@/types/users';

export class UserRequestError extends Error {
  constructor(readonly status: number, message: string) {
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

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/users${query ? `?${query}` : ''}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  if (!response.ok) {
    const message = response.status === 403
      ? 'This user operation is not permitted. Signed-in users can read profiles and update only their own name and phone.'
      : `User request failed: ${response.status}`;
    throw new UserRequestError(response.status, message);
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

export async function createUser(data: CreateUserInput): Promise<User> {
  const response = await requestUsers('', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const users: User[] = await response.json();
  if (!users[0]) throw new Error('No created user was returned.');
  return users[0];
}

export async function updateUser(id: string, data: UpdateUserInput): Promise<User | null> {
  const keys = Object.keys(data);
  if (keys.length === 0 || keys.some((key) => key !== 'name' && key !== 'phone')) {
    throw new UserRequestError(400, 'Only name and phone may be updated.');
  }
  if (('name' in data && (typeof data.name !== 'string' || data.name.length > 255)) ||
      ('phone' in data && data.phone !== null && (typeof data.phone !== 'string' || data.phone.length > 255))) {
    throw new UserRequestError(400, 'Enter a valid name and phone (at most 255 characters each).');
  }
  const response = await requestUsers(`user_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const users: User[] = await response.json();
  return users[0] ?? null;
}

export async function deleteUser(id: string): Promise<number> {
  const response = await requestUsers(`user_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return response.status;
}
