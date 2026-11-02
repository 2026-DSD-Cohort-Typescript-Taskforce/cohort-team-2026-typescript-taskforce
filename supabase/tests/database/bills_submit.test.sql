-- DC-12: submit_bill() and the draft-only bills policies. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(41);

-- Setup (as postgres): login A is a billing operator, B has another role, C has no
-- profile. One vendor and property, and one bill per case (ids 12001+ to stay clear of
-- seeded rows).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000012a1', 'dc12-a@example.test'),
  ('00000000-0000-4000-8000-0000000012a2', 'dc12-b@example.test'),
  ('00000000-0000-4000-8000-0000000012a3', 'dc12-c@example.test');
insert into public.users (user_name, user_email, user_role, auth_user_id) values
  ('Operator A', 'dc12-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000012a1'),
  ('Viewer B', 'dc12-b@example.test', 'viewer', '00000000-0000-4000-8000-0000000012a2');
insert into public.vendors (vendor_id, vendor_name) values (12001, 'DC12 Test Vendor');
insert into public.properties (property_id, property_name) values (12001, 'DC12 Test Property');
insert into public.bills (bill_id, status, vendor_id, property_id, invoice_number, amount, date_due) values
  (12001, 'draft', 12001, 12001, 'DC12-01', 120.00, current_date - 1),   -- complete, due yesterday
  (12002, 'draft', 12001, 12001, 'DC12-02', 120.00, current_date + 30),  -- complete
  (12003, 'draft', null, 12001, 'DC12-03', 120.00, current_date + 30),   -- no vendor
  (12004, 'draft', 12001, null, 'DC12-04', 120.00, current_date + 30),   -- no property
  (12005, 'draft', 12001, 12001, null, 120.00, current_date + 30),       -- no invoice number
  (12006, 'draft', 12001, 12001, 'DC12-06', 0.00, current_date + 30),    -- amount 0
  (12007, 'draft', 12001, 12001, 'DC12-07', -5.00, current_date + 30),   -- negative amount
  (12008, 'draft', 12001, 12001, 'DC12-08', 120.00, null),               -- no due date
  (12009, 'draft', null, null, null, 0.00, null),                        -- nothing filled in
  (12010, 'pending_payment', 12001, 12001, 'DC12-10', 120.00, current_date + 30),
  (12011, 'draft', 12001, 12001, 'DC12-11', 120.00, current_date + 30);  -- for direct edits

-- submit_bill's error as {sqlstate, message, detail}, or null if it succeeds.
create function pg_temp.submit_error(p_bill_id integer) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.submit_bill(p_bill_id);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;

-- How many rows a statement changed (RLS can make an UPDATE match none).
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

-- Schema, privileges, policies
select has_function('public', 'submit_bill', ARRAY['integer'], 'submit_bill(integer) exists');
select function_returns('public', 'submit_bill', ARRAY['integer'], 'bills', 'it returns the bill row');
select is_definer('public', 'submit_bill', ARRAY['integer'], 'it is security definer, so it can move a bill out of draft and write audit_logs');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.submit_bill(integer)')),
  ARRAY['search_path=""'],
  'it pins search_path to empty'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.submit_bill(integer)')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0,
  'public has no EXECUTE on submit_bill()'
);
select function_privs_are('public', 'submit_bill', ARRAY['integer'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on submit_bill()');
select function_privs_are('public', 'submit_bill', ARRAY['integer'], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE submit_bill()');
select policies_are('public', 'bills',
  ARRAY['bills table is public', 'authenticated users can insert draft bills', 'authenticated users can update draft bills', 'authenticated users can delete bills'],
  'bills has the public read policy, the two draft-only write policies and the delete policy');
select policy_cmd_is('public', 'bills', 'authenticated users can insert draft bills', 'insert', 'draft insert policy covers INSERT');
select policy_roles_are('public', 'bills', 'authenticated users can insert draft bills', ARRAY['authenticated'], 'draft insert policy is for authenticated only');
select policy_cmd_is('public', 'bills', 'authenticated users can update draft bills', 'update', 'draft update policy covers UPDATE');
select policy_roles_are('public', 'bills', 'authenticated users can update draft bills', ARRAY['authenticated'], 'draft update policy is for authenticated only');

-- Everything except 12001 should come through the failure cases unchanged.
create temp table bills_before as select * from public.bills where bill_id between 12002 and 12011;

-- anon can't call it
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.submit_bill(12002)$$, '42501', null, 'anon cannot call submit_bill()');
reset role;

-- Not a billing operator
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a2","role":"authenticated"}';
select is(pg_temp.submit_error(12002), ARRAY['PT403', 'forbidden', null], 'a user whose role is not billing_operator gets forbidden');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a3","role":"authenticated"}';
select is(pg_temp.submit_error(12002), ARRAY['PT403', 'forbidden', null], 'a login with no profile gets forbidden');

-- As operator A: refused cases
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a1","role":"authenticated"}';
select throws_ok($$select public.submit_bill(12999)$$, 'PT404', 'not_found', 'refusals are raised as errors with the PostgREST status SQLSTATE');
select is(pg_temp.submit_error(12999), ARRAY['PT404', 'not_found', null], 'an unknown bill gets not_found');
select is(pg_temp.submit_error(12010), ARRAY['PT409', 'not_draft', 'pending_payment'], 'a bill that is not a draft gets not_draft with its current status');
select is(pg_temp.submit_error(12003), ARRAY['PT400', 'incomplete_bill', '["vendor_id"]'], 'no vendor: incomplete_bill lists vendor_id');
select is(pg_temp.submit_error(12004), ARRAY['PT400', 'incomplete_bill', '["property_id"]'], 'no property: incomplete_bill lists property_id');
select is(pg_temp.submit_error(12005), ARRAY['PT400', 'incomplete_bill', '["invoice_number"]'], 'no invoice number: incomplete_bill lists invoice_number');
select is(pg_temp.submit_error(12006), ARRAY['PT400', 'incomplete_bill', '["amount"]'], 'amount 0: incomplete_bill lists amount');
select is(pg_temp.submit_error(12007), ARRAY['PT400', 'incomplete_bill', '["amount"]'], 'negative amount: incomplete_bill lists amount');
select is(pg_temp.submit_error(12008), ARRAY['PT400', 'incomplete_bill', '["date_due"]'], 'no due date: incomplete_bill lists date_due');
select is(
  pg_temp.submit_error(12009),
  ARRAY['PT400', 'incomplete_bill', '["vendor_id","property_id","invoice_number","amount","date_due"]'],
  'nothing filled in: incomplete_bill lists every missing field at once'
);
reset role;

select results_eq(
  $$select * from public.bills where bill_id between 12002 and 12011 order by bill_id$$,
  $$select * from bills_before order by bill_id$$,
  'refused submits change no bill'
);
select is((select count(*)::int from public.audit_logs where bill_id between 12001 and 12011), 0, 'refused submits write no audit row');

-- As operator A: success
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a1","role":"authenticated"}';
select results_eq(
  $$select bill_id, status::text, modified_at from public.submit_bill(12001)$$,
  $$values (12001, 'pending_payment', now() at time zone 'UTC')$$,
  'operator submits a complete draft due yesterday; it returns the bill as pending_payment'
);
select is(pg_temp.submit_error(12001), ARRAY['PT409', 'not_draft', 'pending_payment'], 'submitting it again gets not_draft');
reset role;

select results_eq(
  $$select status::text, modified_at from public.bills where bill_id = 12001$$,
  $$values ('pending_payment', now() at time zone 'UTC')$$,
  'the bill is stored as pending_payment with modified_at = now (UTC)'
);
select results_eq(
  $$select user_id, bill_id, action::text, description, created_at from public.audit_logs where bill_id = 12001$$,
  $$select id, 12001, 'bill_submitted', 'draft → pending_payment', now() at time zone 'UTC'
    from public.users where user_email = 'dc12-a@example.test'$$,
  'exactly one audit row: bill_submitted by A''s profile, for this bill, at now'
);

-- Draft-only policies, as operator A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, invoice_number, amount, date_due, status)
    values (12001, 12001, 'DC12-20', 120.00, current_date + 30, 'pending_payment')$$,
  '42501', null,
  'inserting a bill that is not a draft is refused'
);
select lives_ok(
  $$insert into public.bills (vendor_id, property_id, invoice_number, amount) values (12001, 12001, 'DC12-21', 120.00)$$,
  'inserting a bill without a status runs (it defaults to draft)'
);
select throws_ok(
  $$update public.bills set status = 'pending_payment' where bill_id = 12011$$,
  '42501', null,
  'moving a draft to pending_payment directly is refused'
);
select is(pg_temp.rows_changed($$update public.bills set amount = 250.00 where bill_id = 12011$$), 1, 'a draft can still be edited');
select is(pg_temp.rows_changed($$update public.bills set amount = 1.00 where bill_id = 12001$$), 0, 'the bill submitted above can''t be edited (0 rows)');
select is(pg_temp.rows_changed($$update public.bills set status = 'draft' where bill_id = 12010$$), 0, 'a pending_payment bill can''t be moved back to draft (0 rows)');
reset role;

select is((select status::text from public.bills where bill_id = 12011), 'draft', 'the edited draft is still a draft');
select is((select amount from public.bills where bill_id = 12011), 250.00, 'the draft edit was saved');
select results_eq(
  $$select bill_id, status::text, amount from public.bills where bill_id in (12001, 12010) order by bill_id$$,
  $$values (12001, 'pending_payment', 120.00), (12010, 'pending_payment', 120.00)$$,
  'submitted bills are unchanged by the direct edits'
);
select is((select count(*)::int from public.bills where invoice_number = 'DC12-20'), 0, 'the refused non-draft insert left no row');

select * from finish();
rollback;
