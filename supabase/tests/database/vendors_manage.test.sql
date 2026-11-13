-- DC-84: vendor management. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(54);

-- Setup (as postgres): login A is a billing operator, B a financial approver, C a system
-- admin, D has no profile. One property, payment method and bill, so vendor 84001 has a
-- bill and vendor 84002 does not (ids 84001+, users 84101+, to stay clear of seeded rows).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000084a1', 'dc84-a@example.test'),
  ('00000000-0000-4000-8000-0000000084a2', 'dc84-b@example.test'),
  ('00000000-0000-4000-8000-0000000084a3', 'dc84-c@example.test'),
  ('00000000-0000-4000-8000-0000000084a4', 'dc84-d@example.test');
insert into public.properties (property_id, name) values (84001, 'DC84 Test Property');
insert into public.payment_methods (payment_id, payment_type, name, billing_zip)
  values (84001, 'card', 'DC84 Test Card', '75001');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (84101, 'Operator A', 'dc84-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000084a1'),
  (84102, 'Approver B', 'dc84-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000084a2'),
  (84103, 'Admin C', 'dc84-c@example.test', 'system_admin', '00000000-0000-4000-8000-0000000084a3');
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods) values
  (84001, 'DC84 Vendor With Bill', 'bill@example.test', '1 Test Way', '555-0101', 'https://vendor.example.test', 'card'),
  (84002, 'DC84 Vendor No Bill', 'nobill@example.test', '2 Test Way', '555-0102', null, null);
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_id, invoice_number, amount, date_due)
  values (84001, 'draft', 84001, 84001, 84101, 84001, 'DC84-01', 10.00, current_date + 30);

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
select has_column('public', 'vendors', 'email', 'vendors.email exists');
select has_column('public', 'vendors', 'logo_path', 'vendors.logo_path exists');
select col_is_null('public', 'vendors', 'email', 'email is nullable (legacy rows have none)');
select col_is_null('public', 'vendors', 'logo_path', 'logo_path is nullable');
select col_is_null('public', 'vendors', 'payment_portal_url', 'payment_portal_url is nullable now');
select col_is_null('public', 'vendors', 'supported_payment_methods', 'supported_payment_methods is nullable now');
select is(
  (select convalidated from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_name_present'),
  false, 'vendors_name_present exists and is NOT VALID, so legacy rows stay');
select is(
  (select convalidated from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_email_present'),
  false, 'vendors_email_present exists and is NOT VALID');
select is(
  (select convalidated from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_address_present'),
  false, 'vendors_address_present exists and is NOT VALID');
select is(
  (select convalidated from pg_constraint where conrelid = 'public.vendors'::regclass and conname = 'vendors_phone_present'),
  false, 'vendors_phone_present exists and is NOT VALID');
select is(
  (select indisunique from pg_index where indexrelid = to_regclass('public.vendors_name_lower_key')),
  true, 'vendors_name_lower_key is a unique index');

-- Function and privileges
select has_function('public', 'is_vendor_manager', ARRAY[]::text[], 'is_vendor_manager() exists');
select function_returns('public', 'is_vendor_manager', ARRAY[]::text[], 'boolean', 'it returns boolean');
select is_definer('public', 'is_vendor_manager', ARRAY[]::text[], 'it is security definer, so it can read users');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.is_vendor_manager()')),
  ARRAY['search_path=""'],
  'it pins search_path to empty'
);
select function_privs_are('public', 'is_vendor_manager', ARRAY[]::text[], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE is_vendor_manager()');
select function_privs_are('public', 'is_vendor_manager', ARRAY[]::text[], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on is_vendor_manager()');
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.is_vendor_manager()')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0,
  'public has no EXECUTE on is_vendor_manager()'
);
select policies_are('public', 'vendors',
  ARRAY['signed-in users can view vendors', 'vendor managers can add vendors', 'vendor managers can change vendors', 'vendor managers can delete vendors'],
  'vendors has the read policy and the three manager-only write policies');

-- Constraints (as postgres, which skips RLS but not CHECKs or unique indexes)
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Blank Email', '  ', 'x', 'x')$$, '23514', null, 'a blank email is refused');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Null Email', null, 'x', 'x')$$, '23514', null, 'a NULL email is refused');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('  ', 'x@example.test', 'x', 'x')$$, '23514', null, 'a blank name is refused');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Null Address', 'x@example.test', null, 'x')$$, '23514', null, 'a NULL address is refused');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Null Phone', 'x@example.test', 'x', null)$$, '23514', null, 'a NULL phone is refused');
select lives_ok($$insert into public.vendors (name, email, address, phone) values ('ACME Test', 'acme@example.test', '3 Test Way', '555-0103')$$, 'a complete vendor is accepted');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('acme test', 'acme2@example.test', '4 Test Way', '555-0104')$$, '23505', null, 'a name that differs only by case is refused');
select ok(
  exists (select 1 from public.vendors where email is null and vendor_id < 84000),
  'seeded vendors without an email are still there and readable');
select throws_ok($$update public.vendors set contact_name = 'x' where name = 'Maple Junction Storage'$$, '23514', null, 'a legacy vendor with no email, address or phone can''t be updated until they are filled in');

-- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.vendors$$, '42501', null, 'anon cannot read vendors');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Anon', 'a@example.test', 'x', 'x')$$, '42501', null, 'anon cannot insert vendors');
reset role;

-- Billing operator A: can read, cannot write
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000084a1","role":"authenticated"}';
select ok((select count(*) from public.vendors) > 0, 'operator can read vendors');
select is(public.is_vendor_manager(), false, 'operator is not a vendor manager');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Operator', 'o@example.test', 'x', 'x')$$, '42501', null, 'operator cannot insert vendors');
select is(pg_temp.rows_changed($$update public.vendors set phone = '555-0199' where vendor_id = 84002$$), 0, 'operator update changes 0 rows');
select is(pg_temp.rows_changed($$delete from public.vendors where vendor_id = 84002$$), 0, 'operator delete removes 0 rows');
reset role;

-- Login D: no profile
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000084a4","role":"authenticated"}';
select is(public.is_vendor_manager(), false, 'a login with no profile is not a vendor manager');
select throws_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 No Profile', 'n@example.test', 'x', 'x')$$, '42501', null, 'a login with no profile cannot insert vendors');
reset role;

-- Financial approver B
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000084a2","role":"authenticated"}';
select is(public.is_vendor_manager(), true, 'approver is a vendor manager');
select lives_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Approver Added', 'ap@example.test', '5 Test Way', '555-0105')$$, 'approver can insert a vendor (uses the id sequence)');
select is(pg_temp.rows_changed($$update public.vendors set phone = '555-0198' where vendor_id = 84002$$), 1, 'approver update changes 1 row');
select is(pg_temp.rows_changed($$delete from public.vendors where name = 'DC84 Approver Added'$$), 1, 'approver can delete a vendor with no bills');
select throws_ok($$delete from public.vendors where vendor_id = 84001$$, '23503', null, 'approver cannot delete a vendor that has a bill');
reset role;

-- System admin C
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000084a3","role":"authenticated"}';
select is(public.is_vendor_manager(), true, 'admin is a vendor manager');
select lives_ok($$insert into public.vendors (name, email, address, phone) values ('DC84 Admin Added', 'ad@example.test', '6 Test Way', '555-0106')$$, 'admin can insert a vendor (uses the id sequence)');
select is(pg_temp.rows_changed($$update public.vendors set phone = '555-0197' where vendor_id = 84002$$), 1, 'admin update changes 1 row');
select is(pg_temp.rows_changed($$delete from public.vendors where name = 'DC84 Admin Added'$$), 1, 'admin can delete a vendor with no bills');
select throws_ok($$delete from public.vendors where vendor_id = 84001$$, '23503', null, 'admin cannot delete a vendor that has a bill');
reset role;

-- Logo bucket and storage policies
select results_eq(
  $$select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'vendor-logos'$$,
  $$values (true, 1048576::bigint, array['image/png','image/jpeg','image/webp']::text[])$$,
  'vendor-logos is a public bucket, 1 MiB, png/jpeg/webp only'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and policyname in ('signed-in users can view vendor logos', 'vendor managers can upload vendor logos', 'vendor managers can delete vendor logos')),
  3,
  'the three vendor logo policies exist on storage.objects'
);

-- Storage: approver uploads, operator and anon can't. Storage blocks direct DELETEs on
-- storage.objects unless allow_delete_query is set; it is set here (this transaction only,
-- local database) so the delete policy can be tested without the Storage API.
set local storage.allow_delete_query = 'true';
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000084a2","role":"authenticated"}';
select lives_ok($$insert into storage.objects (bucket_id, name) values ('vendor-logos', '84001/a.png')$$, 'approver can upload a vendor logo');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000084a1","role":"authenticated"}';
select throws_ok($$insert into storage.objects (bucket_id, name) values ('vendor-logos', '84001/b.png')$$, '42501', null, 'operator cannot upload a vendor logo');
select is(pg_temp.rows_changed($$delete from storage.objects where bucket_id = 'vendor-logos' and name = '84001/a.png'$$), 0, 'operator delete removes 0 logos');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000084a2","role":"authenticated"}';
select is(pg_temp.rows_changed($$delete from storage.objects where bucket_id = 'vendor-logos' and name = '84001/a.png'$$), 1, 'approver can delete a vendor logo');
reset role;
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$insert into storage.objects (bucket_id, name) values ('vendor-logos', '84001/c.png')$$, '42501', null, 'anon cannot upload a vendor logo');
reset role;

select * from finish();
rollback;
