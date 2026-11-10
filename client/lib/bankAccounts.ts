import 'server-only';

import { requestPaymentTable } from './paymentRequest';
import type { BankAccount, CreateBankAccountInput, UpdateBankAccountInput } from '@/types/bankAccounts';

export type { UpdateBankAccountInput } from '@/types/bankAccounts';

export async function fetchBankAccounts(): Promise<BankAccount[]> {
  const response = await requestPaymentTable('bank_accounts');
  return response.json();
}

export async function fetchBankAccountById(id: string): Promise<BankAccount | null> {
  const response = await requestPaymentTable('bank_accounts', `payment_id=eq.${encodeURIComponent(id)}&limit=1`);
  const rows: BankAccount[] = await response.json();
  return rows[0] ?? null;
}

export async function createBankAccount(data: CreateBankAccountInput): Promise<BankAccount> {
  const response = await requestPaymentTable('bank_accounts', '', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const rows: BankAccount[] = await response.json();
  if (!rows[0]) throw new Error('No created bank_accounts row was returned.');
  return rows[0];
}

export async function updateBankAccount(id: string, data: UpdateBankAccountInput): Promise<BankAccount | null> {
  const response = await requestPaymentTable('bank_accounts', `payment_id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(data),
  });
  const rows: BankAccount[] = await response.json();
  return rows[0] ?? null;
}

export async function deleteBankAccount(id: string): Promise<number> {
  const response = await requestPaymentTable('bank_accounts', `payment_id=eq.${encodeURIComponent(id)}`, { method: 'DELETE' });
  return response.status;
}
