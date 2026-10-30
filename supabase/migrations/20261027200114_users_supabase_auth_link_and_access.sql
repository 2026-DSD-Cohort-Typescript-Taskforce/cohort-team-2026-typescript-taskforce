-- DC-22: Supabase Auth owns logins and credentials; public.users is the app profile,
-- linked by auth_user_id. users.id stays bigint, so bills.user_id and
-- audit_logs.user_id are unchanged. Safe to rerun.

-- Credentials live in auth.users. No profile has a password to migrate. The column's
-- unique index is dropped with it.
alter table public.users drop column if exists user_password;

-- One profile per login. Nullable because existing profiles have no login until an
-- admin links one. Deleting a login unlinks its profile instead of deleting it, so
-- the bills and audit logs that reference the profile keep their history.
alter table public.users
  add column if not exists auth_user_id uuid unique
    references auth.users (id) on delete set null;

-- updated_at is set on every update, whatever value the writer sends.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- Signed-in users can read every profile and edit their own name and phone. They
-- cannot change their role, email, property or login link, or insert or delete
-- profiles; an admin or the local seed does that with the secret key. anon gets
-- nothing.
drop policy if exists "Enable read access for all users" on public.users;

drop policy if exists "Authenticated users can read all users" on public.users;
create policy "Authenticated users can read all users"
  on public.users for select
  to authenticated
  using (true);

drop policy if exists "Users can update their own profile" on public.users;
create policy "Users can update their own profile"
  on public.users for update
  to authenticated
  using (auth_user_id = (select auth.uid()))
  with check (auth_user_id = (select auth.uid()));

-- Replaces the grants from 20261024150824_remote_schema.sql. Column-level UPDATE
-- only works once the table-level UPDATE is gone.
revoke all on table public.users from anon, authenticated;
grant select on table public.users to authenticated;
grant update (user_name, user_phone) on table public.users to authenticated;

revoke all on sequence public.users_id_seq from anon;
