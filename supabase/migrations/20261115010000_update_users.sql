-- DC-55: system admins edit users. update_user() is the only way to change another user's
-- name, phone, role or properties through the API: in one transaction it checks the caller,
-- updates the users row and replaces its user_properties rows. The email is not editable
-- here: it is the login's email, which Supabase Auth changes (and the sync trigger copies).
--
-- Error contract (as invite_user):
--   code   HTTP  message    when
--   PT403  403   forbidden  the caller's profile isn't system_admin (or has none)
--   PT404  404   not_found  no profile has this user_id
--   PT409  409   own_role   the caller would remove their own system_admin role, which could
--                           leave no one able to manage users
--   23514  400   (CHECK)    the role isn't one of users.role's values
--   23503  409   (FK)       a property id doesn't exist (Express answers 400 unknown_property)
-- The name is trimmed, a blank phone becomes NULL and repeated property ids count once.
-- Returns the updated profile.

create function public.update_user(
  p_user_id integer,
  p_name text,
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
  v_caller integer;
  v_user public.users;
begin
  -- FOR SHARE: two admins demoting each other at once would otherwise both pass this check
  -- and leave no admin; one of them now waits, deadlocks and is rolled back instead.
  select user_id into v_caller from public.users
  where auth_user_id = (select auth.uid()) and role = 'system_admin'
  for share;
  if v_caller is null then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;

  if p_user_id = v_caller and p_role is distinct from 'system_admin' then
    raise exception 'own_role' using errcode = 'PT409';
  end if;

  update public.users
     set name = btrim(p_name), phone = nullif(btrim(p_phone), ''), role = p_role
   where user_id = p_user_id
  returning * into v_user;
  if not found then
    raise exception 'not_found' using errcode = 'PT404';
  end if;

  delete from public.user_properties where user_id = p_user_id;
  insert into public.user_properties (user_id, property_id)
  select distinct p_user_id, property_id
  from unnest(coalesce(p_property_ids, '{}')) as property_id;

  return v_user;
end
$$;

-- New functions in public are executable by PUBLIC and anon by default.
revoke execute on function public.update_user(integer, text, text, text, integer[]) from public, anon;
grant execute on function public.update_user(integer, text, text, text, integer[]) to authenticated;
