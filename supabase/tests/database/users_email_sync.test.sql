-- DC-22: a login email change in Supabase Auth is copied to the linked profile.
-- Run with `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);

-- Setup (as postgres): logins A and B have profiles, C has none. Profile U has no login.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000000e1', 'sync-a@example.test'),
  ('00000000-0000-4000-8000-0000000000e2', 'sync-b@example.test'),
  ('00000000-0000-4000-8000-0000000000e3', 'sync-c@example.test');
insert into public.users (user_name, user_email, user_role, user_phone, auth_user_id) values
  ('Profile A', 'sync-a@example.test', 'billing_operator', '555-0001', '00000000-0000-4000-8000-0000000000e1'),
  ('Profile B', 'sync-b@example.test', 'billing_operator', '555-0002', '00000000-0000-4000-8000-0000000000e2'),
  ('Profile U', 'sync-u@example.test', 'billing_operator', '555-0003', null);

-- Every profile except A, to show that only the linked profile changes.
create temp table others as
  select id, user_name, user_email, user_role, user_phone, property_id, auth_user_id
  from public.users where user_email <> 'sync-a@example.test';
create temp view others_now as
  select id, user_name, user_email, user_role, user_phone, property_id, auth_user_id
  from public.users where id in (select id from others);

-- Schema
select has_function('public', 'sync_user_email_from_auth', ARRAY[]::name[], 'sync_user_email_from_auth() exists');
select function_returns('public', 'sync_user_email_from_auth', ARRAY[]::name[], 'trigger', 'it is a trigger function');
select is_definer('public', 'sync_user_email_from_auth', ARRAY[]::name[], 'it is security definer, so it can update public.users when Supabase Auth changes a login');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.sync_user_email_from_auth()')),
  ARRAY['search_path=""'],
  'it pins search_path to empty'
);
select has_trigger('auth', 'users', 'on_auth_user_email_change', 'auth.users has the email sync trigger');
select alike(
  (select pg_get_triggerdef(oid) from pg_trigger
    where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_email_change'),
  'CREATE TRIGGER on_auth_user_email_change AFTER UPDATE OF email ON auth.users FOR EACH ROW WHEN (((old.email)::text IS DISTINCT FROM (new.email)::text)) EXECUTE FUNCTION %sync_user_email_from_auth()',
  'the trigger runs after an update of email, only when the email changes'
);

-- Nobody but the trigger runs the function.
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.sync_user_email_from_auth()')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0,
  'public has no EXECUTE on sync_user_email_from_auth()'
);
select function_privs_are('public', 'sync_user_email_from_auth', ARRAY[]::name[], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on sync_user_email_from_auth()');
select function_privs_are('public', 'sync_user_email_from_auth', ARRAY[]::name[], 'authenticated', ARRAY[]::text[], 'authenticated has no EXECUTE on sync_user_email_from_auth()');
set local role anon;
select throws_ok($$select public.sync_user_email_from_auth()$$, '42501', null, 'anon cannot call sync_user_email_from_auth()');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
select throws_ok($$select public.sync_user_email_from_auth()$$, '42501', null, 'authenticated cannot call sync_user_email_from_auth()');
reset role;

-- authenticated still cannot write the profile copy directly.
select column_privs_are('public', 'users', 'user_email', 'authenticated', ARRAY['SELECT'], 'authenticated has no UPDATE on user_email');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000000e1","role":"authenticated"}';
select throws_ok(
  $$update public.users set user_email = 'sync-a-direct@example.test' where auth_user_id = auth.uid()$$,
  '42501', null, 'A cannot update own user_email directly'
);
reset role;

-- A changes the login email: A's profile follows, nothing else changes.
select lives_ok(
  $$update auth.users set email = 'sync-a-new@example.test' where id = '00000000-0000-4000-8000-0000000000e1'$$,
  'A''s login email changes'
);
select is((select user_email::text from public.users where user_name = 'Profile A'), 'sync-a-new@example.test', 'A''s profile has the new email');
select results_eq(
  $$select user_name::text, user_role::text, user_phone::text, auth_user_id from public.users where user_name = 'Profile A'$$,
  $$values ('Profile A', 'billing_operator', '555-0001', '00000000-0000-4000-8000-0000000000e1'::uuid)$$,
  'A''s other profile columns are unchanged'
);
select set_eq('select * from others_now', 'select * from others', 'other profiles, linked or not, are unchanged');

-- C has no profile: its email change goes through and touches no profile.
select lives_ok(
  $$update auth.users set email = 'sync-c-new@example.test' where id = '00000000-0000-4000-8000-0000000000e3'$$,
  'C''s login email changes'
);
select set_eq('select * from others_now', 'select * from others', 'a login with no profile changes no profile');

-- The trigger fires only when the email changes. Make A's copy differ, then update A's
-- login without changing its email: the copy is left alone.
update public.users set user_email = 'sync-a-copy@example.test' where user_name = 'Profile A';
update auth.users set email = email where id = '00000000-0000-4000-8000-0000000000e1';
update auth.users set raw_user_meta_data = '{"dc22": true}' where id = '00000000-0000-4000-8000-0000000000e1';
select is((select user_email::text from public.users where user_name = 'Profile A'), 'sync-a-copy@example.test', 'an update that keeps the email does not touch the profile');
update public.users set user_email = 'sync-a-new@example.test' where user_name = 'Profile A';

-- Conflict: A's new login email already belongs to profile U (no login). Copying it would
-- break users.user_email's unique constraint, so the whole login update is refused and
-- nothing changes. Supabase Auth reports an error and A keeps the old login email.
select throws_ok(
  $$update auth.users set email = 'sync-u@example.test' where id = '00000000-0000-4000-8000-0000000000e1'$$,
  '23505', null, 'A cannot take an email that profile U already has'
);
select is((select email::text from auth.users where id = '00000000-0000-4000-8000-0000000000e1'), 'sync-a-new@example.test', 'A''s login email is unchanged after the refused update');
select is((select user_email::text from public.users where user_name = 'Profile A'), 'sync-a-new@example.test', 'A''s profile is unchanged after the refused update');
select set_eq('select * from others_now', 'select * from others', 'U and the other profiles are unchanged after the refused update');

-- C has no profile to update, so the same email is not a conflict for C.
select lives_ok(
  $$update auth.users set email = 'sync-u@example.test' where id = '00000000-0000-4000-8000-0000000000e3'$$,
  'C can take profile U''s email: C has no profile to copy it to'
);
update auth.users set email = 'sync-c-new@example.test' where id = '00000000-0000-4000-8000-0000000000e3';

-- B's login email is held by Supabase Auth's own unique index, before the trigger runs.
select throws_ok(
  $$update auth.users set email = 'sync-b@example.test' where id = '00000000-0000-4000-8000-0000000000e1'$$,
  '23505', null, 'A cannot take B''s login email'
);
select is((select user_email::text from public.users where user_name = 'Profile B'), 'sync-b@example.test', 'B''s profile is unchanged');

-- A changes again: the copy keeps following the login.
select lives_ok(
  $$update auth.users set email = 'sync-a-again@example.test' where id = '00000000-0000-4000-8000-0000000000e1'$$,
  'A''s login email changes again'
);
select is((select user_email::text from public.users where user_name = 'Profile A'), 'sync-a-again@example.test', 'A''s profile follows the second change');

select * from finish();
rollback;
