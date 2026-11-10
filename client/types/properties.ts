export interface Property {
  property_id: number;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
  created_at: string;
}

export interface CreatePropertyInput {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}
