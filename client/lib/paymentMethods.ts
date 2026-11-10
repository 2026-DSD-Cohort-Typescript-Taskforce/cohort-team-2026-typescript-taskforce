import 'server-only';

import { requestPaymentTable } from './paymentRequest';
import type { PaymentMethod, CreatePaymentMethodInput, UpdatePaymentMethodInput } from '@/types/paymentMethods';

export type { UpdatePaymentMethodInput } from '@/types/paymentMethods';

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const response = await requestPaymentTable('payment_methods');
  return response.json();
}

export async function fetchPaymentMethodById(id: string): Promise<PaymentMethod | null> {
  const response = await requestPaymentTable('payment_methods', `payment_id=eq.${encodeURIComponent(id)}&limit=1`);
  const rows: PaymentMethod[] = await response.json();
  return rows[0] ?? null;
}

export async function createPaymentMethod(data: CreatePaymentMethodInput): Promise<PaymentMethod> {
  const response = await requestPaymentTable('payment_methods', '', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const rows: PaymentMethod[] = await response.json();
  if (!rows[0]) throw new Error('No created payment_methods row was returned.');
  return rows[0];
}

export async function updatePaymentMethod(id: string, data: UpdatePaymentMethodInput): Promise<PaymentMethod | null> {
  const response = await requestPaymentTable('payment_methods', `payment_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const rows: PaymentMethod[] = await response.json();
  return rows[0] ?? null;
}

export async function deletePaymentMethod(id: string): Promise<number> {
  const response = await requestPaymentTable('payment_methods', `payment_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return response.status;
}
