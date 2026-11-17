-- DC-55: inviting users. invite_user() and the confirmation trigger. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

-- Setup (as postgres): an admin (S) and a billing operator (O) with logins, two properties,
-- and a confirmed login (L) with no profile, as a self sign-up would leave it.
insert into public.properties (property_id, name) values
  (955001, 'DC-55 property one'),
  (955002, 'DC-55 property two');
insert into auth.users (id, email, email_confirmed_at) values
  ('00000000-0000-4000-8000-0000000055a1', 'dc55-admin@example.test', now()),
  ('00000000-0000-4000-8000-0000000055a2', 'dc55-operator@example.test', now()),
  ('00000000-0000-4000-8000-0000000055a3', 'dc55-loose@example.test', now());
insert into public.users (user_id, name, email, role, auth_user_id) values
  (955001, 'DC-55 Admin', 'dc55-admin@example.test', 'system_admin', '00000000-0000-4000-8000-0000000055a1'),
  (955002, 'DC-55 Operator', 'dc55-operator@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000055a2'),
  (955003, 'DC-55 Mixed Case', 'DC55-Mixed@Example.test', 'viewer', null);

-- Schema
select has_function('public', 'invite_user', ARRAY['text', 'text', 'text', 'text', 'integer[]'], 'invite_user exists');
select is_definer('public', 'invite_user', ARRAY['text', 'text', 'text', 'text', 'integer[]'], 'invite_user is security definer');
select ok(
  not has_function_privilege('anon', 'public.invite_user(text, text, text, text, integer[])', 'execute'),
  'anon cannot execute invite_user'
);
select has_trigger('auth', 'users', 'on_auth_user_email_confirmed', 'auth.users links profiles on email confirmation');

-- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok(
  $$select public.invite_user('Nope', 'dc55-anon@example.test', null, 'viewer', '{}')$$,
  '42501', null, 'anon cannot invite'
);
reset role;

-- A billing operator is refused.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000055a2","role":"authenticated"}';
select throws_ok(
  $$select public.invite_user('Nope', 'dc55-nope@example.test', null, 'viewer', '{}')$$,
  'PT403', 'forbidden', 'a billing operator cannot invite'
);
reset role;
select is((select count(*)::int from public.users where email = 'dc55-nope@example.test'), 0, 'the refused invite added no profile');

-- The admin invites.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000055a1","role":"authenticated"}';
select lives_ok(
  $$select public.invite_user('  New Person ', ' DC55-New@Example.test ', '  ', 'financial_approver', '{955001,955002,955001}')$$,
  'the admin invites a new user with two properties'
);
select throws_ok(
  $$select public.invite_user('Again', 'dc55-new@example.test', null, 'viewer', '{}')$$,
  'PT409', 'email_in_use', 'the same email is refused'
);
select throws_ok(
  $$select public.invite_user('Again', 'dc55-mixed@example.test', null, 'viewer', '{}')$$,
  'PT409', 'email_in_use', 'an email held in another case is refused'
);
select throws_ok(
  $$select public.invite_user('Bad Role', 'dc55-badrole@example.test', null, 'superuser', '{}')$$,
  '23514', null, 'an unknown role is refused by the role CHECK'
);
select throws_ok(
  $$select public.invite_user('Bad Property', 'dc55-badprop@example.test', null, 'viewer', '{999999999}')$$,
  '23503', null, 'an unknown property is refused'
);
reset role;

select is((select count(*)::int from public.users where email in ('dc55-badrole@example.test', 'dc55-badprop@example.test')), 0, 'refused invites add no profile');
select is(
  (select row(name, email, phone, role, auth_user_id)::text from public.users where email = 'dc55-new@example.test'),
  row('New Person', 'dc55-new@example.test', null::text, 'financial_approver', null::uuid)::text,
  'the profile is trimmed, lower-cased, blank phone is null, and pending'
);
select set_eq(
  $$select property_id from public.user_properties up join public.users u using (user_id) where u.email = 'dc55-new@example.test'$$,
  ARRAY[955001, 955002],
  'the profile is linked to each chosen property once'
);

-- An email whose login is already confirmed (a self sign-up) is refused: linking it would
-- skip proving the inbox after the invite, and keep a password someone else may have set.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000055a1","role":"authenticated"}';
select throws_ok(
  $$select public.invite_user('Loose Login', 'DC55-Loose@example.test', null, 'viewer', '{}')$$,
  'PT409', 'login_exists', 'the email of a confirmed login with no profile is refused'
);
reset role;
select is((select count(*)::int from public.users where lower(email) = 'dc55-loose@example.test'), 0, 'and no profile is added');

-- The invite link creates an unconfirmed login; opening it confirms the email.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000055b1', 'dc55-new@example.test');
select is((select auth_user_id from public.users where email = 'dc55-new@example.test'), null, 'an unconfirmed login does not link the profile');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000055b1';
select is(
  (select auth_user_id from public.users where email = 'dc55-new@example.test'),
  '00000000-0000-4000-8000-0000000055b1'::uuid,
  'confirming the email links the pending profile'
);

-- A login someone signed up with before the invite keeps no password once it links: the
-- password was chosen before the email was proven.
insert into public.users (user_id, name, email, role) values (955004, 'DC-55 Preset', 'dc55-preset@example.test', 'viewer');
insert into auth.users (id, email, encrypted_password) values ('00000000-0000-4000-8000-0000000055b5', 'dc55-preset@example.test', 'preset-hash');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000055b5';
select is(
  (select row(u.auth_user_id, a.encrypted_password)::text from public.users u join auth.users a on a.id = u.auth_user_id where u.user_id = 955004),
  row('00000000-0000-4000-8000-0000000055b5'::uuid, '')::text,
  'linking a pre-registered login clears its password'
);

-- Matching ignores case.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000055b2', 'dc55-mixed@example.test');
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000055b2';
select is(
  (select auth_user_id from public.users where user_id = 955003),
  '00000000-0000-4000-8000-0000000055b2'::uuid,
  'a profile email in another case is linked'
);

-- A linked profile is never taken over by another login.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000055b3', 'dc55-other@example.test');
update public.users set email = 'dc55-other@example.test' where user_id = 955002;
update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000055b3';
select is(
  (select auth_user_id from public.users where user_id = 955002),
  '00000000-0000-4000-8000-0000000055a2'::uuid,
  'confirming a login does not relink a profile that already has one'
);

-- Confirmation of a login with no matching profile changes nothing.
select lives_ok(
  $$insert into auth.users (id, email, encrypted_password) values ('00000000-0000-4000-8000-0000000055b4', 'dc55-stranger@example.test', 'own-hash');
    update auth.users set email_confirmed_at = now() where id = '00000000-0000-4000-8000-0000000055b4'$$,
  'a login with no profile can still confirm'
);
select is((select count(*)::int from public.users where auth_user_id = '00000000-0000-4000-8000-0000000055b4'), 0, 'and no profile is linked to it');
select is((select encrypted_password from auth.users where id = '00000000-0000-4000-8000-0000000055b4'), 'own-hash', 'and it keeps its password');

-- Signed-in users still cannot insert profiles or property links directly.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000055a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.users (name, email, role) values ('Direct', 'dc55-direct@example.test', 'viewer')$$,
  '42501', null, 'even an admin cannot insert into users directly'
);
select throws_ok(
  $$insert into public.user_properties (user_id, property_id) values (955001, 955001)$$,
  '42501', null, 'even an admin cannot insert into user_properties directly'
);
reset role;

select * from finish();
rollback;
