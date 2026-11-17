-- DC-89: prepare_payment(), the service-only function that creates a pending payment
-- attempt. Run with `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(69);

-- Setup (as postgres, marker on): one vendor, property and payment method, four users (one per
-- role) and one bill per case (ids 89001+, users 89101+, to stay clear of seeded rows).
set local app.payments_write = 'on';
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (89001, 'DC89 Test Vendor', 'vendor-89001@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (89001, 'DC89 Test Property');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip)
  values (89001, 'card', 'DC89 Test Card', '75001');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000089a1', 'dc89-a@example.test'),
  ('00000000-0000-4000-8000-0000000089a2', 'dc89-b@example.test'),
  ('00000000-0000-4000-8000-0000000089a3', 'dc89-c@example.test'),
  ('00000000-0000-4000-8000-0000000089a4', 'dc89-d@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (89101, 'Operator A', 'dc89-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000089a1'),
  (89102, 'Approver B', 'dc89-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000089a2'),
  (89103, 'Admin C', 'dc89-c@example.test', 'system_admin', '00000000-0000-4000-8000-0000000089a3'),
  (89104, 'Viewer D', 'dc89-d@example.test', 'viewer', '00000000-0000-4000-8000-0000000089a4');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
select g, 'pending_payment', 89001, 89001, 89101, 89001, 'DC89-' || g, 120.00, current_date + 7
from generate_series(89001, 89020) g;
update public.bills set status = 'payment_failed' where bill_id = 89002;
update public.bills set status = 'draft' where bill_id = 89003;
update public.bills set amount = 9999999999.99 where bill_id = 89004;
update public.bills set amount = 0.01 where bill_id = 89005;

-- Attempts built directly, with the marker (bills 89012 to 89015).
insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number, amount_cents, fees_cents,
  total_cents, currency, payment_date, summary_hash, prepared_by, authorized_by, authorized_at, authorization_expires_at)
values (89012, 'authorized', 89001, 89001, 'DC89-89012', 12000, 0, 12000, 'USD', current_date, 'h', 89101, 89102, now(), now() + interval '15 minutes');
insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number, amount_cents, fees_cents,
  total_cents, currency, payment_date, summary_hash, prepared_by, authorized_by, authorized_at, authorization_expires_at, submitted_at)
values (89013, 'processing', 89001, 89001, 'DC89-89013', 12000, 0, 12000, 'USD', current_date, 'h', 89101, 89102, now(), now() + interval '15 minutes', now());
insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number, amount_cents, fees_cents,
  total_cents, currency, payment_date, summary_hash, prepared_by, authorized_by, authorized_at, authorization_expires_at, submitted_at,
  outcome_code, outcome_at)
values (89014, 'unknown', 89001, 89001, 'DC89-89014', 12000, 0, 12000, 'USD', current_date, 'h', 89101, 89102, now(), now() + interval '15 minutes', now(),
  'outcome_unknown', now());
insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number, amount_cents, fees_cents,
  total_cents, currency, payment_date, summary_hash, prepared_by, authorized_by, authorized_at, authorization_expires_at, submitted_at,
  outcome_code, outcome_at, transaction_reference, time_paid)
values (89015, 'success', 89001, 89001, 'DC89-89015', 12000, 0, 12000, 'USD', current_date, 'h', 89101, 89102, now(), now() + interval '15 minutes', now(),
  'confirmed', now(), 'TX-89015', now());
-- An incomplete legacy pending row (bill 89018: prepared_by and the whole summary NULL).
insert into public.payments (bill_id, status) values (89018, 'pending');
reset app.payments_write;

-- prepare_payment's error as {sqlstate, message, detail}, or null if it succeeds. Run as the
-- caller's current role.
create function pg_temp.prep_error(p_bill integer, p_by integer, p_fees bigint, p_date date,
  p_account text default null, p_refs jsonb default '[]'::jsonb) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.prepare_payment(p_bill, p_by, p_fees, p_date, p_account, p_refs);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;

-- Schema and privileges
select has_function('public', 'prepare_payment', ARRAY['integer', 'integer', 'bigint', 'date', 'text', 'jsonb'], 'prepare_payment exists');
select function_returns('public', 'prepare_payment', ARRAY['integer', 'integer', 'bigint', 'date', 'text', 'jsonb'], 'payments', 'it returns the payments row');
select is_definer('public', 'prepare_payment', ARRAY['integer', 'integer', 'bigint', 'date', 'text', 'jsonb'], 'it is security definer');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.prepare_payment(integer, integer, bigint, date, text, jsonb)')),
  ARRAY['search_path=""'],
  'it pins search_path to empty (the write marker is set in the body: Supabase refuses a function-level custom setting)'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.prepare_payment(integer, integer, bigint, date, text, jsonb)')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0,
  'public has no EXECUTE'
);
select function_privs_are('public', 'prepare_payment', ARRAY['integer', 'integer', 'bigint', 'date', 'text', 'jsonb'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE');
select function_privs_are('public', 'prepare_payment', ARRAY['integer', 'integer', 'bigint', 'date', 'text', 'jsonb'], 'authenticated', ARRAY[]::text[], 'authenticated has no EXECUTE');
select function_privs_are('public', 'prepare_payment', ARRAY['integer', 'integer', 'bigint', 'date', 'text', 'jsonb'], 'service_role', ARRAY['EXECUTE'], 'service_role can EXECUTE');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089a1","role":"authenticated"}';
select is(pg_temp.prep_error(89016, 89101, 0, current_date), ARRAY['42501', 'permission denied for function prepare_payment', null], 'a signed-in user cannot call it');
reset role;

-- Refused calls change nothing: snapshot payments, bills and audit_logs, compare after.
create temp table before_snapshot as
select (select md5(string_agg(p::text, '|' order by payment_id)) from public.payments p) as pay,
       (select md5(string_agg(b::text, '|' order by bill_id)) from public.bills b) as bil,
       (select count(*) from public.audit_logs) as aud;
grant select on before_snapshot to service_role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- Errors, in check order
select is(pg_temp.prep_error(89016, 89104, 0, current_date), ARRAY['PT403', 'forbidden', null], 'a viewer cannot prepare');
select is(pg_temp.prep_error(89016, 89999, 0, current_date), ARRAY['PT403', 'forbidden', null], 'an unknown user cannot prepare');
select is(pg_temp.prep_error(89016, null, 0, current_date), ARRAY['PT403', 'forbidden', null], 'a NULL user cannot prepare');
select is(pg_temp.prep_error(89999, 89104, -1, null), ARRAY['PT403', 'forbidden', null], 'the user check comes before input checks');
select is(pg_temp.prep_error(89016, 89101, -1, current_date), ARRAY['PT400', 'invalid_payment', '["fees_cents"]'], 'negative fees');
select is(pg_temp.prep_error(89016, 89101, null, current_date), ARRAY['PT400', 'invalid_payment', '["fees_cents"]'], 'NULL fees');
select is(pg_temp.prep_error(89016, 89101, 0, current_date + 2), ARRAY['PT400', 'invalid_payment', '["payment_date"]'], 'date two days ahead');
select is(pg_temp.prep_error(89016, 89101, 0, current_date - 2), ARRAY['PT400', 'invalid_payment', '["payment_date"]'], 'date two days back');
select is(pg_temp.prep_error(89016, 89101, 0, null), ARRAY['PT400', 'invalid_payment', '["payment_date"]'], 'NULL date');
select is(pg_temp.prep_error(89016, 89101, 1000000000000, current_date), ARRAY['PT400', 'invalid_payment', '["fees_cents"]'], 'fees over 999999999999');
select is(pg_temp.prep_error(89016, 89101, 0, current_date, repeat('x', 101)), ARRAY['PT400', 'invalid_payment', '["account_reference"]'], '101-character account reference');
select is(pg_temp.prep_error(89016, 89101, 0, current_date, null, '{}'::jsonb), ARRAY['PT400', 'invalid_payment', '["policy_refs"]'], 'policy refs that are not an array');
select is(pg_temp.prep_error(89016, 89101, 0, current_date, null, null), ARRAY['PT400', 'invalid_payment', '["policy_refs"]'], 'NULL policy refs');
select is(pg_temp.prep_error(89016, 89101, -1, current_date + 2, repeat('x', 101), '{}'::jsonb),
  ARRAY['PT400', 'invalid_payment', '["fees_cents","payment_date","account_reference","policy_refs"]'], 'all four bad, in order');
select is(pg_temp.prep_error(null, 89101, 0, current_date), ARRAY['PT404', 'not_found', null], 'NULL bill');
select is(pg_temp.prep_error(89999, 89101, 0, current_date), ARRAY['PT404', 'not_found', null], 'unknown bill');
select is(pg_temp.prep_error(89003, 89101, 0, current_date), ARRAY['PT409', 'not_payable', 'draft'], 'a draft bill is not payable');
select is(pg_temp.prep_error(89013, 89101, 0, current_date),
  ARRAY['PT409', 'payment_in_progress', (select payment_id::text from public.payments where bill_id = 89013)], 'a processing attempt blocks a new one');
select is(pg_temp.prep_error(89014, 89101, 0, current_date),
  ARRAY['PT409', 'payment_in_progress', (select payment_id::text from public.payments where bill_id = 89014)], 'an unknown attempt blocks a new one');
select is(pg_temp.prep_error(89015, 89101, 0, current_date),
  ARRAY['PT409', 'already_paid', (select payment_id::text from public.payments where bill_id = 89015)], 'a paid bill is already paid');

reset role;
select is(
  (select md5(string_agg(p::text, '|' order by payment_id)) from public.payments p), (select pay from before_snapshot),
  'refused calls change no payments row');
select is(
  (select md5(string_agg(b::text, '|' order by bill_id)) from public.bills b), (select bil from before_snapshot),
  'refused calls change no bills row');
select is((select count(*) from public.audit_logs), (select aud from before_snapshot), 'refused calls write no audit row');

-- Happy path
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok(
  $$select public.prepare_payment(89001, 89101, 250, current_date, '••••4321', '[{"policy_id":1}]')$$,
  'an operator prepares a payment');
reset role;
select results_eq(
  $$select status::text, amount_cents, fees_cents, total_cents, currency::text, prepared_by, account_reference, policy_refs
      from public.payments where bill_id = 89001$$,
  $$values ('pending', 12000::bigint, 250::bigint, 12250::bigint, 'USD', 89101, '••••4321', '[{"policy_id": 1}]'::jsonb)$$,
  'the pending row has the amounts, fees, total, currency, preparer, account and policies');
select results_eq(
  $$select p.vendor_id, p.payment_method_id, p.invoice_number::text, p.payment_date
      from public.payments p where p.bill_id = 89001$$,
  $$select vendor_id, payment_method_id, invoice_number::text, current_date from public.bills where bill_id = 89001$$,
  'vendor, method and invoice come from the bill');
select is(
  (select summary_hash = public.payment_summary_hash(p) from public.payments p where bill_id = 89001),
  true, 'summary_hash is the hash of the stored summary');
select isnt((select idempotency_key from public.payments where bill_id = 89001), null, 'it has an idempotency key');
select is(
  (select count(*)::int from public.audit_logs where name = 'payment_prepared' and created_at = now()), 1,
  'one payment_prepared audit row');
select ok(
  (select description like '%bill 89001%' and description like '%by user 89101%' and description like '%new%'
          and description like '%pending%'
     from public.audit_logs where name = 'payment_prepared' and created_at = now()),
  'its description names the bill, the preparer and the transition');
select is(
  (select description from public.audit_logs where name = 'payment_prepared' and created_at = now()),
  format('payment %s (bill 89001): new → pending, by user 89101, policies [{"policy_id": 1}]',
    (select payment_id from public.payments where bill_id = 89001)),
  'the audit description has the exact text');

-- The write marker does not leak out of the call.
select isnt(current_setting('app.payments_write', true), 'on', 'the write marker is off again after a call');

-- Other roles, other bills, edge values
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.prep_error(89006, 89102, 0, current_date), null, 'a financial approver can prepare');
select is(pg_temp.prep_error(89007, 89103, 0, current_date), null, 'a system admin can prepare');
select is(pg_temp.prep_error(89002, 89101, 0, current_date), null, 'a payment_failed bill can be prepared');
select is(pg_temp.prep_error(89004, 89101, 0, current_date), null, 'the largest amount can be prepared');
select is(pg_temp.prep_error(89005, 89101, 0, current_date), null, 'the smallest amount can be prepared');
select is(pg_temp.prep_error(89008, 89101, 0, current_date, '   '), null, 'a blank account reference can be prepared');
select is(pg_temp.prep_error(89009, 89101, 0, current_date - 1), null, 'yesterday is allowed');
select is(pg_temp.prep_error(89010, 89101, 0, current_date + 1), null, 'tomorrow is allowed');
select is(pg_temp.prep_error(89017, 89101, 999999999999, current_date), null, 'the largest fee can be prepared');
reset role;
select is((select amount_cents from public.payments where bill_id = 89004), 999999999999::bigint, 'amount 9999999999.99 is 999999999999 cents');
select is((select amount_cents from public.payments where bill_id = 89005), 1::bigint, 'amount 0.01 is 1 cent');
select is((select total_cents from public.payments where bill_id = 89017), 1000000011999::bigint, 'amount plus the largest fee is the total');
select is((select account_reference from public.payments where bill_id = 89008), null, 'a blank account reference is stored as NULL');
select is((select prepared_by from public.payments where bill_id = 89006), 89102, 'prepared_by is the approver');
select is((select prepared_by from public.payments where bill_id = 89007), 89103, 'prepared_by is the admin');
select is(
  (select count(*)::int from public.payments where bill_id in (89002, 89004, 89005, 89006, 89007, 89008, 89009, 89010) and status = 'pending'),
  8, 'each of those bills has one pending attempt');

-- Supersede
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.prep_error(89011, 89101, 0, current_date), null, 'first preparation');
reset role;
create temp table first_attempt as select payment_id from public.payments where bill_id = 89011;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.prep_error(89011, 89101, 100, current_date), null, 'second preparation');
reset role;
select results_eq(
  $$select status::text, outcome_code, outcome_at is not null from public.payments where payment_id = (select payment_id from first_attempt)$$,
  $$values ('expired', 'superseded', true)$$,
  'the first attempt is expired and superseded');
select is(
  (select description from public.audit_logs where name = 'payment_superseded' and created_at = now()),
  format('payment %s (bill 89011): pending → expired, by user 89101, outcome superseded', (select payment_id from first_attempt)),
  'one payment_superseded audit row with the exact text');
select is((select count(*)::int from public.audit_logs where name = 'payment_superseded' and created_at = now()), 1,
  'exactly one payment_superseded audit row so far');
select results_eq(
  $$select status::text, fees_cents from public.payments where bill_id = 89011 and status = 'pending'$$,
  $$values ('pending', 100::bigint)$$, 'the second attempt is pending');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.prep_error(89012, 89101, 0, current_date), null, 'preparing over an authorized attempt');
reset role;
select results_eq(
  $$select status::text, outcome_code from public.payments where bill_id = 89012 and authorized_by is not null$$,
  $$values ('expired', 'superseded')$$, 'the authorized attempt is expired and superseded');
select is((select count(*)::int from public.payments where bill_id = 89012 and status = 'pending'), 1, 'a new pending attempt exists');

-- An incomplete legacy pending row is superseded like any other.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.prep_error(89018, 89101, 0, current_date), null, 'preparing over an incomplete legacy pending row');
reset role;
select results_eq(
  $$select status::text, outcome_code from public.payments where bill_id = 89018 and prepared_by is null$$,
  $$values ('expired', 'superseded')$$, 'the incomplete legacy row is expired and superseded');
select is((select count(*)::int from public.payments where bill_id = 89018 and status = 'pending'), 1, 'a complete pending attempt replaces it');

select * from finish();
rollback;
