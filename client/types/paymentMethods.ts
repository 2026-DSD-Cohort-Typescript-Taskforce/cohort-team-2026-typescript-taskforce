export interface PaymentMethod {
  payment_method_id: number;
  payment_type: 'card' | 'bank';
  name: string;
}
