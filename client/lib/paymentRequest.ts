import 'server-only';

import { getSessionAccessToken } from './accessToken';

const selections = {
  payment_methods: 'payment_id, payment_type,name',
  cards: 'payment_id, card_brand,exp_date, is_credit, created_at',
  bank_accounts: 'payment_id, bank_name, created_at',
} as const;

type PaymentTable = keyof typeof selections;

export class PaymentRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'PaymentRequestError';
  }
}

export async function requestPaymentTable(
  table: PaymentTable,
  query = '',
  init?: RequestInit,
): Promise<Response> {
  const token = await getSessionAccessToken();
  if (!token) throw new PaymentRequestError(401, 'You are not signed in.');

  const { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    throw new Error('Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY on the Next server.');
  }
  const params = new URLSearchParams(query);
  params.set('select', selections[table]);
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  headers.set('apikey', SUPABASE_PUBLISHABLE_KEY);
  headers.set('Authorization', `Bearer ${token}`);

  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}?${params}`, {
    ...init,
    cache: 'no-store',
    headers,
  });
  if (!response.ok) {
    throw new PaymentRequestError(response.status, `${table} request failed: ${response.status}`);
  }
  return response;
}
