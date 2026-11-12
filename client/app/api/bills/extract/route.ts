// POST /api/bills/extract: runs extraction on a pending upload by calling the
// extract-invoices edge function with the user's access token, so the function's writes
// follow the same access rules as the user. A model call can take minutes, hence
// maxDuration. The browser always gets { outcome, message, bill? } back, except a 401.

import type { NextRequest } from 'next/server';
import { SIGNED_OUT } from '@/lib/submit-errors';
import { accessToken, readJsonObject, reply } from '@/lib/supabase';

const EXTRACT_FAILED = "Couldn't extract the bill. Try again.";

// The model can take up to 120 s, plus the download and the database writes.
export const maxDuration = 150;

/**
 * Runs extract-invoices as the signed-in user on a pending upload. Every answer except a
 * 401 is 200 with { outcome, message, bill? }, so the card handles one shape.
 */
export async function POST(request: NextRequest) {
  const token = accessToken(request);
  if (!token) return reply(SIGNED_OUT);

  const body = await readJsonObject(request);
  const path = typeof body?.path === 'string' ? body.path : null;
  if (!path) return reply({ body: { outcome: 'failed', message: 'Upload the PDF first.' } });

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY. See client/.env.example.');
  }

  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/functions/v1/extract-invoices`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ path, replaceBillId: body?.replaceBillId }),
      signal: AbortSignal.timeout(140_000),
    });
    if (res.status === 401) return reply(SIGNED_OUT);
    const result = await res.json().catch(() => null);
    return reply({
      body: result?.outcome ? result : { outcome: 'failed', message: EXTRACT_FAILED },
    });
  } catch (error) {
    console.error('extract-invoices failed:', error);
    return reply({ body: { outcome: 'failed', message: EXTRACT_FAILED } });
  }
}
