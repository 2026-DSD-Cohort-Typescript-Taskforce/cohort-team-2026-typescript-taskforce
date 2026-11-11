-- DC-85: vendor policies. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(57);

-- Setup (as postgres): login A is a billing operator, B a financial approver, C a system
-- admin, D has no profile. Test vendors are seeded ones (fixtures insert no vendors):
-- Alder Creek Landscaping and Brightwater Water & Sewer, neither with a seeded policy.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000085a1', 'dc85-a@example.test'),
  ('00000000-0000-4000-8000-0000000085a2', 'dc85-b@example.test'),
  ('00000000-0000-4000-8000-0000000085a3', 'dc85-c@example.test'),
  ('00000000-0000-4000-8000-0000000085a4', 'dc85-d@example.test');
insert into public.properties (property_id, name) values (85001, 'DC85 Test Property');
insert into public.users (user_id, name, email, role, property_id, auth_user_id) values
  (85101, 'Operator A', 'dc85-a@example.test', 'billing_operator', 85001, '00000000-0000-4000-8000-0000000085a1'),
  (85102, 'Approver B', 'dc85-b@example.test', 'financial_approver', 85001, '00000000-0000-4000-8000-0000000085a2'),
  (85103, 'Admin C', 'dc85-c@example.test', 'system_admin', 85001, '00000000-0000-4000-8000-0000000085a3');

-- How many rows a statement changed (RLS can make an UPDATE or DELETE match none).
create function pg_temp.rows_changed(p_sql text) returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Schema
select has_table('public', 'policies', 'policies exists');
select col_type_is('public', 'policies', 'policy_id', 'integer', 'policy_id is int4');
select col_type_is('public', 'policies', 'vendor_id', 'integer', 'vendor_id is int4');
select col_type_is('public', 'policies', 'name', 'text', 'name is text');
select col_type_is('public', 'policies', 'description', 'text', 'description is text');
select col_type_is('public', 'policies', 'is_active', 'boolean', 'is_active is boolean');
select col_type_is('public', 'policies', 'created_at', 'timestamp with time zone', 'created_at is timestamptz');
select col_type_is('public', 'policies', 'updated_at', 'timestamp with time zone', 'updated_at is timestamptz');
select col_not_null('public', 'policies', 'policy_id', 'policy_id is NOT NULL');
select col_not_null('public', 'policies', 'vendor_id', 'vendor_id is NOT NULL');
select col_not_null('public', 'policies', 'name', 'name is NOT NULL');
select col_not_null('public', 'policies', 'description', 'description is NOT NULL');
select col_not_null('public', 'policies', 'is_active', 'is_active is NOT NULL');
select col_not_null('public', 'policies', 'created_at', 'created_at is NOT NULL');
select col_not_null('public', 'policies', 'updated_at', 'updated_at is NOT NULL');
select col_is_pk('public', 'policies', 'policy_id', 'policy_id is the primary key');
select is(
  (select attidentity::text from pg_attribute where attrelid = 'public.policies'::regclass and attname = 'policy_id'),
  'a', 'policy_id is generated always as identity');
select col_default_is('public', 'policies', 'is_active', 'false', 'is_active defaults to false');
select is(
  (select contype::text from pg_constraint where conrelid = 'public.policies'::regclass and conname = 'policies_name_valid'),
  'c', 'policies_name_valid CHECK exists');
select is(
  (select contype::text from pg_constraint where conrelid = 'public.policies'::regclass and conname = 'policies_description_valid'),
  'c', 'policies_description_valid CHECK exists');
select is(
  (select contype::text from pg_constraint where conrelid = 'public.policies'::regclass and conname = 'policies_vendor_id_key'),
  'u', 'policies_vendor_id_key unique constraint exists');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'public.policies'::regclass and conname = 'policies_vendor_id_fkey'),
  'c', 'the vendor FK cascades on delete');

-- Function and privileges
select has_function('public', 'is_policy_manager', ARRAY[]::text[], 'is_policy_manager() exists');
select function_returns('public', 'is_policy_manager', ARRAY[]::text[], 'boolean', 'it returns boolean');
select is_definer('public', 'is_policy_manager', ARRAY[]::text[], 'it is security definer, so it can read users');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.is_policy_manager()')),
  ARRAY['search_path=""'],
  'it pins search_path to empty'
);
select function_privs_are('public', 'is_policy_manager', ARRAY[]::text[], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE is_policy_manager()');
select function_privs_are('public', 'is_policy_manager', ARRAY[]::text[], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on is_policy_manager()');
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.is_policy_manager()')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0,
  'public has no EXECUTE on is_policy_manager()'
);
select policies_are('public', 'policies',
  ARRAY['signed-in users can view policies', 'policy managers can add policies', 'policy managers can change policies'],
  'policies has the read policy and the two manager-only write policies');
select table_privs_are('public', 'policies', 'anon', ARRAY[]::text[], 'anon has no privileges on policies');
select table_privs_are('public', 'policies', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE'], 'authenticated has select, insert and update only (no delete)');

-- Constraints (as postgres, which skips RLS but not CHECKs or unique keys)
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), '  ', 'x')$$, '23514', null, 'a blank name is refused');
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), repeat('n', 101), 'x')$$, '23514', null, 'a 101-character name is refused');
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'x', '')$$, '23514', null, 'an empty description is refused');
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'x', repeat('d', 1001))$$, '23514', null, 'a 1001-character description is refused');
select lives_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), repeat('n', 100), repeat('d', 1000))$$, 'a 100-character name and 1000-character description are accepted');
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'Second', 'Second')$$, '23505', null, 'a second policy for the same vendor is refused');
delete from public.policies where vendor_id = (select vendor_id from public.vendors where name = 'Alder Creek Landscaping');

-- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.policies$$, '42501', null, 'anon cannot read policies');
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'x', 'x')$$, '42501', null, 'anon cannot insert policies');
reset role;

-- Billing operator A: can read, cannot write
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000085a1","role":"authenticated"}';
select is(
  (select name from public.policies where vendor_id = (select vendor_id from public.vendors where name = 'Sunmeadow Cleaning')),
  'Automatic approval for payments', 'operator can read the seeded Sunmeadow policy');
select is(public.is_policy_manager(), false, 'operator is not a policy manager');
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'x', 'x')$$, '42501', null, 'operator cannot insert policies');
select is(pg_temp.rows_changed($$update public.policies set is_active = false where vendor_id = (select vendor_id from public.vendors where name = 'Sunmeadow Cleaning')$$), 0, 'operator update changes 0 rows');
select throws_ok($$delete from public.policies where vendor_id = (select vendor_id from public.vendors where name = 'Sunmeadow Cleaning')$$, '42501', null, 'operator cannot delete policies');
reset role;

-- Login D: no profile
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000085a4","role":"authenticated"}';
select is(public.is_policy_manager(), false, 'a login with no profile is not a policy manager');
select throws_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'x', 'x')$$, '42501', null, 'a login with no profile cannot insert policies');
reset role;

-- Financial approver B (Alder Creek)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000085a2","role":"authenticated"}';
select is(public.is_policy_manager(), true, 'approver is a policy manager');
select lives_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'Approver policy', 'Added by an approver.')$$, 'approver can insert a policy (uses the id sequence)');
select is(
  (select is_active from public.policies where name = 'Approver policy'),
  false, 'a new policy starts inactive');
select is(pg_temp.rows_changed($$update public.policies set is_active = true, updated_at = now() where name = 'Approver policy'$$), 1, 'approver update changes 1 row');
select throws_ok($$delete from public.policies where name = 'Approver policy'$$, '42501', null, 'approver cannot delete policies');
reset role;

-- System admin C (Brightwater)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000085a3","role":"authenticated"}';
select is(public.is_policy_manager(), true, 'admin is a policy manager');
select lives_ok($$insert into public.policies (vendor_id, name, description) values ((select vendor_id from public.vendors where name = 'Brightwater Water & Sewer'), 'Admin policy', 'Added by an admin.')$$, 'admin can insert a policy (uses the id sequence)');
select is(
  (select is_active from public.policies where name = 'Admin policy'),
  false, 'a new policy starts inactive (admin)');
select is(pg_temp.rows_changed($$update public.policies set is_active = true, updated_at = now() where name = 'Admin policy'$$), 1, 'admin update changes 1 row');
select throws_ok($$delete from public.policies where name = 'Admin policy'$$, '42501', null, 'admin cannot delete policies');
reset role;

select * from finish();
rollback;
