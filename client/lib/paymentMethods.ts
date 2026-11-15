import 'server-only';

import { requestPaymentMethods } from './paymentRequest';
import type { PaymentMethod } from '@/types/paymentMethods';

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const response = await requestPaymentMethods();
  return response.json();
}

export async function fetchPaymentMethodById(id: string): Promise<PaymentMethod | null> {
  const response = await requestPaymentMethods(`payment_id=eq.${encodeURIComponent(id)}&limit=1`);
  const rows: PaymentMethod[] = await response.json();
  return rows[0] ?? null;
}
