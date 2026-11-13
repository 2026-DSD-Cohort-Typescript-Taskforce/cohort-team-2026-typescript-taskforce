import type { NextRequest } from 'next/server';
import { createUserClient, reply, replyWithError } from '@/lib/supabase';
import { LOAD_USERS_FAILED, USER_SELECT } from '@/lib/user-directory';

/**
 * Every user profile, by name. No role check here: RLS lets any signed-in user read the
 * profiles, and the /users page itself is limited to system admins.
 */
export async function GET(request: NextRequest) {
  const supabase = createUserClient(request);
  if (supabase instanceof Response) return supabase;

  const { data, error } = await supabase
    .from('users')
    .select(USER_SELECT)
    .order('name')
    .order('user_id');
  if (error) return replyWithError(error, LOAD_USERS_FAILED);
  return reply({ body: { users: data } });
}
