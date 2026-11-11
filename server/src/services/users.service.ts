import type { UserClient } from '../config/supabase';

//Added this to help with the user_properties junction table:   - Jared
type UserProperty = {
  property_id: number;
};

export type Profile = {
  user_id: number;
  name: string | null;
  email: string | null;
  role: string | null;
  user_properties: UserProperty[];  //Updated this to work with user_properties - Jared
  //property_id: number | null;    
};

/** The public.users row linked to a Supabase Auth user, read as that user (RLS applies). */
export async function getProfileByAuthUserId(
  supabase: UserClient,
  authUserId: string,
): Promise<Profile | null> {
  const { data, error } = await supabase    //Changed the select statement too to better work with user_properties:
                                            //Now, it asks Supabase to perform a nested query that includes the related rows from user_properties.
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
