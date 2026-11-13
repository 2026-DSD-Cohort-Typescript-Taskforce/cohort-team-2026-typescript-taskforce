import 'server-only';

import { getSessionAccessToken } from './accessToken';

const PAYMENT_METHOD_FIELDS = 'payment_id,payment_type,name';

export class PaymentRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentRequestError';
  }
}

export async function requestPaymentMethods(query = ''): Promise<Response> {
  const token = await getSessionAccessToken();
  if (!token) throw new PaymentRequestError(401, 'You are not signed in.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the Next server.');
  }
  const params = new URLSearchParams(query);
  params.set('select', PAYMENT_METHOD_FIELDS);
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(
    `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/payment_methods?${params}`,
    {
      cache: 'no-store',
      headers,
    },
  );
  if (!response.ok) {
    throw new PaymentRequestError(
      response.status,
      `payment_methods request failed: ${response.status}`,
    );
  }
  return response;
}
