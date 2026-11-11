import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import { backend } from './backend';

async function verifyAccessToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;

  const response = await backend('/api/auth/me', {
    headers: { cookie: `sb-access-token=${encodeURIComponent(token)}` },
  });

  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new Error('Could not verify your session. Try again.');

  return token;
}

export const getSessionAccessToken = cache(async (): Promise<string | null> => {
  return verifyAccessToken((await cookies()).get('sb-access-token')?.value);
});
