export interface Card {
  payment_id: number;
  card_brand: string;
  exp_date: string;
  is_credit: boolean;
  created_at: string;
}

export interface CreateCardInput {
  payment_id: number;
  card_brand: string;
  card_number: string;
  cvc: string;
  exp_date: string;
  is_credit: boolean;
}

export type UpdateCardInput = Partial<Omit<CreateCardInput, 'payment_id'>>;
