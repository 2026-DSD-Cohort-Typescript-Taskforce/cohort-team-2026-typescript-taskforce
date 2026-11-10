export interface BankAccount {
  payment_id: number;
  bank_name: string;
  created_at: string;
}

export interface CreateBankAccountInput {
  payment_id: number;
  bank_name: string;
  account_number: string;
  routing_number: string;
}

export type UpdateBankAccountInput = Partial<Omit<CreateBankAccountInput, 'payment_id'>>;
