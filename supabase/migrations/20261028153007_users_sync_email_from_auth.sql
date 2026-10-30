-- DC-22: users change their own email through Supabase Auth, which confirms the change
-- from both the old and the new address (double_confirm_changes in config.toml). When
-- the login email changes, this copies it to the linked profile. authenticated still
-- has no UPDATE on users.user_email, so the profile copy can't drift from the login.
-- Safe to rerun.

-- Supabase Auth updates auth.users as its own role, which has no access to
-- public.users, so the function runs as its owner.
--
-- If another profile already has the new email (for example one with no login yet),
-- the update breaks users.user_email's unique constraint and the error refuses the
-- whole login change: the login keeps its old email and no profile changes. Skipping
-- the copy instead would let the login and its profile disagree, and changing the
-- other profile would edit someone else's row.
create or replace function public.sync_user_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
     set user_email = new.email
   where auth_user_id = new.id;
  return null;
end
$$;

-- Only the trigger runs it. Supabase's default privileges grant EXECUTE on new public
-- functions to anon and authenticated, so revoking from public alone isn't enough.
revoke execute on function public.sync_user_email_from_auth() from public, anon, authenticated;

drop trigger if exists on_auth_user_email_change on auth.users;
create trigger on_auth_user_email_change
  after update of email on auth.users
  for each row
  when (old.email is distinct from new.email)
  execute function public.sync_user_email_from_auth();
