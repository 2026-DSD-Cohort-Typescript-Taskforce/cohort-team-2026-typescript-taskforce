import type { UserClient } from '../config/supabase';

/** One row of the user_properties junction table, as nested in a profile. - Jared */
type UserProperty = {
  property_id: number;
};

export type Profile = {
  user_id: number;
  name: string | null;
  email: string | null;
  role: string | null;
  /** The properties this user is linked to (DC-86: replaced users.property_id). */
  user_properties: UserProperty[];
};

/**
 * The public.users row linked to a Supabase Auth user, read as that user (RLS applies).
 * The nested user_properties select has Supabase join in the user's rows from that table.
 */
export async function getProfileByAuthUserId(
  supabase: UserClient,
  authUserId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select(`
      user_id,
      name,
      email,
      role,
      user_properties (
        property_id
      )
    `)
    .eq('auth_user_id', authUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** True when a profile other than this login's already has the email (email is unique). */
export async function isEmailUsedByAnotherProfile(
  supabase: UserClient,
  email: string,
  authUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from('users').select('auth_user_id').eq('email', email);
  if (error) throw error;
  return data.some((profile) => profile.auth_user_id !== authUserId);
}
