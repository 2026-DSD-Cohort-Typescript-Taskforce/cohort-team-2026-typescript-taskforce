-- DC-22: 20261102150148_update_previous_tables.sql (DC-53) renamed users.user_email to
-- email. The email sync function from 20261028153007_users_sync_email_from_auth.sql still
-- wrote user_email, so every login email change on a linked profile failed and Supabase
-- Auth refused it. This is the same function with the new column name. Safe to rerun.
--
-- create or replace keeps the function's owner and EXECUTE privileges, and the
-- on_auth_user_email_change trigger keeps pointing at it, so neither is repeated here.
create or replace function public.sync_user_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
     set email = new.email
   where auth_user_id = new.id;
  return null;
end
$$;
