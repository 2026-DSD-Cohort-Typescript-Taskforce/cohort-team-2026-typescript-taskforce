export interface PaymentMethod {
  payment_id: number;
  payment_type: 'card' | 'bank';
  name: string;
}
