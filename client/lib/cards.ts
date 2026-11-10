import 'server-only';

import { requestPaymentTable } from './paymentRequest';
import type { Card, CreateCardInput, UpdateCardInput } from '@/types/cards';

export type { UpdateCardInput } from '@/types/cards';

export async function fetchCards(): Promise<Card[]> {
  const response = await requestPaymentTable('cards');
  return response.json();
}

export async function fetchCardById(id: string): Promise<Card | null> {
  const response = await requestPaymentTable('cards', `payment_id=eq.${encodeURIComponent(id)}&limit=1`);
  const rows: Card[] = await response.json();
  return rows[0] ?? null;
}

export async function createCard(data: CreateCardInput): Promise<Card> {
  const response = await requestPaymentTable('cards', '', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const rows: Card[] = await response.json();
  if (!rows[0]) throw new Error('No created cards row was returned.');
  return rows[0];
}

export async function updateCard(id: string, data: UpdateCardInput): Promise<Card | null> {
  const response = await requestPaymentTable('cards', `payment_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const rows: Card[] = await response.json();
  return rows[0] ?? null;
}

export async function deleteCard(id: string): Promise<number> {
  const response = await requestPaymentTable('cards', `payment_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return response.status;
}
