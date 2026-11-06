-- DC-22: users identity, credentials and access. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(53);

-- Setup (as postgres): three synthetic logins. A and B have profiles; C has none.
-- Test rows use fixed ids far above the seed data. Every profile needs a property, and a
-- bill also needs a vendor and a payment method.
insert into public.properties (property_id, name) values (922001, 'DC-22 test property');
insert into public.vendors (vendor_id, name, payment_portal_url, supported_payment_methods)
  values (922001, 'DC-22 test vendor', 'https://vendor.example.test', 'card');
insert into public.payment_methods (payment_id, payment_type, name, billing_zip)
  values (922001, 'card', 'DC-22 test card', '00000');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'dc22-a@example.test'),
  ('00000000-0000-4000-8000-00000000000b', 'dc22-b@example.test'),
  ('00000000-0000-4000-8000-00000000000c', 'dc22-c@example.test');
insert into public.users (user_id, name, email, role, phone, property_id, created_at, updated_at) values
  (922001, 'Profile A', 'dc22-a@example.test', 'billing_operator', '555-0001', 922001, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z'),
  (922002, 'Profile B', 'dc22-b@example.test', 'billing_operator', '555-0002', 922001, '2000-01-01T00:00:00Z', '2000-01-01T00:00:00Z');
select lives_ok(
  $$update public.users set auth_user_id = '00000000-0000-4000-8000-00000000000a' where email = 'dc22-a@example.test';
    update public.users set auth_user_id = '00000000-0000-4000-8000-00000000000b' where email = 'dc22-b@example.test'$$,
  'setup: link profiles A and B to their logins'
);
do $$ begin perform set_config('dc22.user_count', (select count(*) from public.users)::text, true); end $$;

-- Schema
select hasnt_column('public', 'users', 'user_password', 'user_password is gone; Supabase Auth stores credentials');
select has_column('public', 'users', 'auth_user_id', 'users has auth_user_id');
select col_type_is('public', 'users', 'auth_user_id', 'uuid', 'auth_user_id is uuid');
select col_is_null('public', 'users', 'auth_user_id', 'auth_user_id is nullable (existing profiles have no login yet)');
select col_is_unique('public', 'users', ARRAY['auth_user_id'], 'auth_user_id is unique: one profile per login');
select fk_ok('public', 'users', 'auth_user_id', 'auth', 'users', 'id', 'auth_user_id references auth.users(id)');
select is(
  (select confdeltype::text from pg_constraint
    where conrelid = 'public.users'::regclass and confrelid = 'auth.users'::regclass and contype = 'f'),
  'n',
  'deleting a login sets auth_user_id to NULL and keeps the profile'
);
select col_type_is('public', 'users', 'user_id', 'integer', 'users.user_id is integer');
select col_is_pk('public', 'users', 'user_id', 'users.user_id is the primary key');
select fk_ok('public', 'bills', 'user_id', 'public', 'users', 'user_id', 'bills.user_id references users.user_id');
select fk_ok('public', 'approvals', 'submitted_by', 'public', 'users', 'user_id', 'approvals.submitted_by references users.user_id');
select col_type_is('public', 'users', 'role', 'character varying(255)', 'role stays free text');
select is(
  (select count(*)::int from pg_constraint where conrelid = 'public.users'::regclass and contype = 'c'),
  0,
  'users has no CHECK constraints (roles deferred)'
);

-- Policies and grants
select policies_are('public', 'users',
  ARRAY['Authenticated users can read all users', 'Users can update their own profile'],
  'users has only the two DC-22 policies');
select policy_roles_are('public', 'users', 'Authenticated users can read all users', ARRAY['authenticated'], 'read policy is for authenticated only');
select policy_cmd_is('public', 'users', 'Authenticated users can read all users', 'select', 'read policy covers SELECT');
select policy_roles_are('public', 'users', 'Users can update their own profile', ARRAY['authenticated'], 'update policy is for authenticated only');
select policy_cmd_is('public', 'users', 'Users can update their own profile', 'update', 'update policy covers UPDATE');
select table_privs_are('public', 'users', 'anon', ARRAY[]::text[], 'anon has no privileges on users');
select table_privs_are('public', 'users', 'authenticated', ARRAY['SELECT'], 'authenticated has table-level SELECT only');
select column_privs_are('public', 'users', 'name', 'authenticated', ARRAY['SELECT', 'UPDATE'], 'authenticated can update name');
select column_privs_are('public', 'users', 'phone', 'authenticated', ARRAY['SELECT', 'UPDATE'], 'authenticated can update phone');
select column_privs_are('public', 'users', 'role', 'authenticated', ARRAY['SELECT'], 'authenticated cannot update role');
select column_privs_are('public', 'users', 'email', 'authenticated', ARRAY['SELECT'], 'authenticated cannot update email (changed through Supabase Auth)');
select column_privs_are('public', 'users', 'property_id', 'authenticated', ARRAY['SELECT'], 'authenticated cannot update property_id (open item)');
select sequence_privs_are('public', 'users_id_seq', 'anon', ARRAY[]::text[], 'anon has no privileges on users_id_seq');

-- Timestamp trigger
select has_trigger('public', 'users', 'users_set_updated_at', 'users has the updated_at trigger');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.set_updated_at()')),
  ARRAY['search_path=""'],
  'set_updated_at() pins search_path to empty'
);

-- anon: nothing
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.users$$, '42501', null, 'anon cannot select users');
select throws_ok($$insert into public.users (email) values ('dc22-anon@example.test')$$, '42501', null, 'anon cannot insert users');
select throws_ok($$update public.users set name = 'anon'$$, '42501', null, 'anon cannot update users');
select throws_ok($$delete from public.users$$, '42501', null, 'anon cannot delete users');
reset role;

-- authenticated as A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select results_eq($$select count(*)::text from public.users$$, ARRAY[current_setting('dc22.user_count')], 'A can read all users rows');
select lives_ok(
  $$update public.users set name = 'Profile A renamed', phone = '555-0100' where email = 'dc22-a@example.test'$$,
  'A''s update of own name and phone runs'
);
select lives_ok(
  $$update public.users set name = 'hijacked' where email = 'dc22-b@example.test'$$,
  'A''s update of B''s row runs (RLS matches no row)'
);
select throws_ok($$update public.users set role = 'admin' where email = 'dc22-a@example.test'$$, '42501', null, 'A cannot change own role');
select throws_ok($$update public.users set email = 'x@example.test' where email = 'dc22-a@example.test'$$, '42501', null, 'A cannot change own email (changed through Supabase Auth)');
select throws_ok($$update public.users set property_id = null where email = 'dc22-a@example.test'$$, '42501', null, 'A cannot change own property_id (open item)');
select throws_ok($$insert into public.users (email) values ('dc22-new@example.test')$$, '42501', null, 'A cannot insert users (admin/seed creates them)');
select throws_ok($$delete from public.users where email = 'dc22-a@example.test'$$, '42501', null, 'A cannot delete users');
reset role;

select is((select name::text from public.users where email = 'dc22-a@example.test'), 'Profile A renamed', 'A''s name changed');
select is((select phone::text from public.users where email = 'dc22-a@example.test'), '555-0100', 'A''s phone changed');
select is((select name::text from public.users where email = 'dc22-b@example.test'), 'Profile B', 'B''s row is unchanged');
select is((select updated_at from public.users where email = 'dc22-a@example.test'), now(), 'updated_at moves to now() on update');
select is((select created_at from public.users where email = 'dc22-a@example.test'), '2000-01-01T00:00:00Z'::timestamptz, 'created_at is unchanged on update');

-- updated_at is set by the trigger even when a writer supplies a value (postgres, bypassing RLS).
update public.users set updated_at = '1999-01-01T00:00:00Z' where email = 'dc22-b@example.test';
select is((select updated_at from public.users where email = 'dc22-b@example.test'), now(), 'trigger overrides a supplied updated_at');

-- bills and approvals reference users.user_id
select lives_ok(
  $$insert into public.bills (bill_id, amount, status, property_id, vendor_id, user_id, payment_id) values (922001, 1.00, 'draft', 922001, 922001, 922002, 922001);
    insert into public.approvals (bill_id, submitted_by, status) values (922001, 922002, 'pending')$$,
  'a bill and an approval can reference B''s profile'
);
select throws_ok($$delete from public.users where email = 'dc22-b@example.test'$$, '23503', null, 'a profile referenced by bills/approvals cannot be deleted');
select throws_ok(
  $$insert into public.bills (bill_id, amount, status, property_id, vendor_id, user_id, payment_id) values (922002, 1.00, 'draft', 922001, 922001, -1, 922001)$$,
  '23503', null, 'bills.user_id must exist in users'
);

-- /me lookup used by DC-13: the profile for the caller's login
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}';
select results_eq($$select email::text from public.users where auth_user_id = auth.uid()$$, ARRAY['dc22-a@example.test'], '/me finds A''s profile by auth_user_id = auth.uid()');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}';
select results_eq($$select count(*) from public.users where auth_user_id = auth.uid()$$, ARRAY[0::bigint], '/me finds no profile for C (login without profile)');
reset role;

-- Deleting B's login keeps B's profile and its bill/audit history
delete from auth.users where id = '00000000-0000-4000-8000-00000000000b';
select results_eq(
  $$select count(*) from public.users where email = 'dc22-b@example.test' and auth_user_id is null$$,
  ARRAY[1::bigint],
  'B''s profile remains, unlinked, after its login is deleted'
);

select * from finish();
rollback;
