-- DC-55: system admins invite users. invite_user() is the only way to add a profile through
-- the API: in one transaction it checks the caller, adds the users row and its
-- user_properties rows. Express then emails the invitee a sign-in link
-- (server/src/controllers/admin.controller.ts). Opening it confirms the login's email, and
-- the trigger below links the profile to that login, which takes it from Pending to Active.
-- Signed-in users still have no INSERT grant on users or user_properties, so the open
-- insert policies on user_properties (DC-86) stay unreachable.
--
-- Error contract (as decide_bill): PostgREST answers a PTxyz SQLSTATE with HTTP status xyz.
--   code   HTTP  message       when
--   PT403  403   forbidden     the caller's profile isn't system_admin (or has none)
--   PT409  409   email_in_use  a profile already has the email, in any case
--   PT409  409   login_exists  a confirmed login (a self sign-up) has the email: linking it
--                              would skip proving the inbox after the invite and keep a
--                              password someone else may have set. Delete that login first.
--   23514  400   (CHECK)       the role isn't one of users.role's values
--   23503  409   (FK)          a property id doesn't exist (Express answers 400 unknown_property)
-- The email is trimmed and lower-cased (Supabase Auth stores it lower-cased), a blank phone
-- becomes NULL and repeated property ids count once. Returns the new profile.

create function public.invite_user(
  p_name text,
  p_email text,
  p_phone text,
  p_role text,
  p_property_ids integer[] default '{}'
)
returns public.users
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_user public.users;
begin
  if not exists (
    select 1 from public.users
    where auth_user_id = (select auth.uid()) and role = 'system_admin'
  ) then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;

  -- users.email is unique only as stored, so check other cases too.
  if exists (select 1 from public.users where lower(email) = v_email) then
    raise exception 'email_in_use' using errcode = 'PT409';
  end if;

  if exists (
    select 1 from auth.users where lower(email) = v_email and email_confirmed_at is not null
  ) then
    raise exception 'login_exists' using errcode = 'PT409';
  end if;

  insert into public.users (name, email, phone, role)
  values (btrim(p_name), v_email, nullif(btrim(p_phone), ''), p_role)
  returning * into v_user;

  insert into public.user_properties (user_id, property_id)
  select distinct v_user.user_id, property_id
  from unnest(coalesce(p_property_ids, '{}')) as property_id;

  return v_user;
end
$$;

-- New functions in public are executable by PUBLIC and anon by default.
revoke execute on function public.invite_user(text, text, text, text, integer[]) from public, anon;
grant execute on function public.invite_user(text, text, text, text, integer[]) to authenticated;

-- Links a pending profile to the login that just confirmed the same email. A profile that
-- already has a login keeps it. Sign-up is open, so anyone can create an unconfirmed login
-- for an email before it is invited, with a password of their choosing; confirming proves
-- the inbox, not who set that password. So a login that gets a profile here loses any
-- password, and only /set-password (reached from the inbox) gives it one.
create function public.link_user_on_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.users
     set auth_user_id = new.id
   where auth_user_id is null
     and lower(email) = lower(new.email);
  if found then
    new.encrypted_password := '';
  end if;
  return new;
end
$$;

revoke execute on function public.link_user_on_email_confirmed() from public, anon, authenticated;

-- BEFORE, so it can clear the password in the same write.
create trigger on_auth_user_email_confirmed
  before update of email_confirmed_at on auth.users
  for each row
  when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
  execute function public.link_user_on_email_confirmed();
