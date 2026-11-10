export interface PaymentMethod {
  payment_id: number;
  payment_type: 'card' | 'bank';
  name: string;
}

export interface CreatePaymentMethodInput {
  payment_type: 'card' | 'bank';
  name: string;
  billing_zip: string;
}

export type UpdatePaymentMethodInput = Partial<CreatePaymentMethodInput>;
