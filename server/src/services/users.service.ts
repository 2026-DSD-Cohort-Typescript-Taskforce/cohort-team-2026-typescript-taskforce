import type { UserClient } from "../config/supabase";

export type Profile = {
  id: number;
  user_name: string | null;
  user_email: string | null;
  user_role: string | null;
  property_id: number | null;
};

/** The public.users row linked to a Supabase Auth user, read as that user (RLS applies). */
export async function getProfileByAuthUserId(supabase: UserClient, authUserId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("id, user_name, user_email, user_role, property_id")
    .eq("auth_user_id", authUserId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** True when a profile other than this login's already has the email (user_email is unique). */
export async function isEmailUsedByAnotherProfile(
  supabase: UserClient,
  email: string,
  authUserId: string,
): Promise<boolean> {
  const { data, error } = await supabase.from("users").select("auth_user_id").eq("user_email", email);
  if (error) throw error;
  return data.some((profile) => profile.auth_user_id !== authUserId);
}
