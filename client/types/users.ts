export interface User {
  user_id: number;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  property_id: number;
  auth_user_id: string | null;
  created_at: string;
  updated_at: string | null;
}

export type UpdateUserInput = Partial<Pick<User, 'name' | 'phone'>>;
