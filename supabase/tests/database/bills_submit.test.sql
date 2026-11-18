-- DC-12: submit_bill() and the draft-only bills policies. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- Setup (as postgres): login A is a billing operator, B a viewer, C has no profile, D a
-- financial approver, E a system admin. One vendor, property and payment method, and one
-- bill per case (ids 12001+, users 12101+, to stay clear of seeded rows).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000012a1', 'dc12-a@example.test'),
  ('00000000-0000-4000-8000-0000000012a2', 'dc12-b@example.test'),
  ('00000000-0000-4000-8000-0000000012a3', 'dc12-c@example.test'),
  ('00000000-0000-4000-8000-0000000012a4', 'dc12-d@example.test'),
  ('00000000-0000-4000-8000-0000000012a5', 'dc12-e@example.test');
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (12001, 'DC12 Test Vendor', 'vendor@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (12001, 'DC12 Test Property');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip)
  values (12001, 'card', 'DC12 Test Card', '75001');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (12101, 'Operator A', 'dc12-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000012a1'),
  (12102, 'Viewer B', 'dc12-b@example.test', 'viewer', '00000000-0000-4000-8000-0000000012a2'),
  (12103, 'Approver D', 'dc12-d@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000012a4'),
  (12104, 'Admin E', 'dc12-e@example.test', 'system_admin', '00000000-0000-4000-8000-0000000012a5');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due) values
  (12001, 'draft', 12001, 12001, 12101, 12001, 'DC12-01', 120.00, current_date - 1),   -- complete, due yesterday
  (12002, 'draft', 12001, 12001, 12101, 12001, 'DC12-02', 120.00, current_date + 30),  -- complete
  (12005, 'draft', 12001, 12001, 12101, 12001, null, 120.00, current_date + 30),       -- no invoice number
  (12006, 'draft', 12001, 12001, 12101, 12001, 'DC12-06', 0.00, current_date + 30),    -- amount 0
  (12007, 'draft', 12001, 12001, 12101, 12001, 'DC12-07', -5.00, current_date + 30),   -- negative amount
  (12008, 'draft', 12001, 12001, 12101, 12001, 'DC12-08', 120.00, null),               -- no due date
  (12009, 'draft', 12001, 12001, 12101, 12001, null, 0.00, null),                      -- nothing else filled in
  (12010, 'pending_payment', 12001, 12001, 12101, 12001, 'DC12-10', 120.00, current_date + 30),
  (12011, 'draft', 12001, 12001, 12101, 12001, 'DC12-11', 120.00, current_date + 30),  -- for direct edits
  (12012, 'draft', 12001, 12001, 12101, 12001, 'DC12-12', 120.00, current_date + 30),  -- approver asks for approval
  (12013, 'draft', 12001, 12001, 12101, 12001, 'DC12-13', 120.00, current_date + 30);  -- admin submits for payment

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
select has_function('public', 'submit_bill', ARRAY['integer', 'boolean'], 'submit_bill(integer, boolean) exists');
select function_returns('public', 'submit_bill', ARRAY['integer', 'boolean'], 'bills', 'it returns the bill row');
select is_definer('public', 'submit_bill', ARRAY['integer', 'boolean'], 'it is security definer, so it can move a bill out of draft and write audit_logs');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.submit_bill(integer,boolean)')),
  ARRAY['search_path=""'],
  'it pins search_path to empty'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.submit_bill(integer,boolean)')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0,
  'public has no EXECUTE on submit_bill()'
);
select function_privs_are('public', 'submit_bill', ARRAY['integer', 'boolean'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on submit_bill()');
select function_privs_are('public', 'submit_bill', ARRAY['integer', 'boolean'], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE submit_bill()');
select policies_are('public', 'bills',
  ARRAY['authenticated users can view bills', 'authenticated users can insert draft bills', 'authenticated users can update draft bills', 'authenticated users can delete draft bills'],
  'bills has the signed-in read policy and the three draft-only write policies (DC-21)');
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
select is(pg_temp.submit_error(12002), ARRAY['PT403', 'forbidden', null], 'a viewer gets forbidden');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a3","role":"authenticated"}';
select is(pg_temp.submit_error(12002), ARRAY['PT403', 'forbidden', null], 'a login with no profile gets forbidden');

-- As operator A: refused cases
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a1","role":"authenticated"}';
select throws_ok($$select public.submit_bill(12999)$$, 'PT404', 'not_found', 'refusals are raised as errors with the PostgREST status SQLSTATE');
select is(pg_temp.submit_error(12999), ARRAY['PT404', 'not_found', null], 'an unknown bill gets not_found');
select is(pg_temp.submit_error(12010), ARRAY['PT409', 'not_draft', 'pending_payment'], 'a bill that is not a draft gets not_draft with its current status');
-- Drafts may be missing a vendor or property (20261111062000); submit_bill() and the
-- bills_complete_unless_draft check make sure a bill past draft has both.
select col_is_null('public', 'bills', 'vendor_id', 'bills.vendor_id may be NULL while the bill is a draft');
select col_is_null('public', 'bills', 'property_id', 'bills.property_id may be NULL while the bill is a draft');
select is(pg_temp.submit_error(12005), ARRAY['PT400', 'incomplete_bill', '["invoice_number"]'], 'no invoice number: incomplete_bill lists invoice_number');
select is(pg_temp.submit_error(12006), ARRAY['PT400', 'incomplete_bill', '["amount"]'], 'amount 0: incomplete_bill lists amount');
select is(pg_temp.submit_error(12007), ARRAY['PT400', 'incomplete_bill', '["amount"]'], 'negative amount: incomplete_bill lists amount');
select is(pg_temp.submit_error(12008), ARRAY['PT400', 'incomplete_bill', '["date_due"]'], 'no due date: incomplete_bill lists date_due');
select is(
  pg_temp.submit_error(12009),
  ARRAY['PT400', 'incomplete_bill', '["invoice_number","amount","date_due"]'],
  'nothing else filled in: incomplete_bill lists every missing field at once'
);
reset role;

select results_eq(
  $$select * from public.bills where bill_id between 12002 and 12011 order by bill_id$$,
  $$select * from bills_before order by bill_id$$,
  'refused submits change no bill'
);
-- Rows written in this transaction have created_at = now(); seeded rows don't.
-- The setup ran as postgres, so its trigger rows are 'system'; anything else came from a call.
select is((select count(*)::int from public.audit_logs where created_at = now() and actor_type is distinct from 'system'), 0, 'refused submits write no audit row');

-- As operator A: success. Times are cast to timestamptz so these pass whether the
-- columns are timestamp or timestamptz.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a1","role":"authenticated"}';
select results_eq(
  $$select bill_id, status::text, updated_at::timestamptz from public.submit_bill(12001)$$,
  $$values (12001, 'pending_payment', now())$$,
  'operator submits a complete draft due yesterday; it returns the bill as pending_payment'
);
select is(pg_temp.submit_error(12001), ARRAY['PT409', 'not_draft', 'pending_payment'], 'submitting it again gets not_draft');
reset role;

select results_eq(
  $$select status::text, updated_at::timestamptz from public.bills where bill_id = 12001$$,
  $$values ('pending_payment', now())$$,
  'the bill is stored as pending_payment with updated_at = now'
);
select results_eq(
  $$select name, actor_type, actor_user_id, entity_type, entity_id from public.audit_logs
      where created_at = now() and actor_type is distinct from 'system' order by audit_log_id$$,
  $$values ('bill_submitted', 'user', 12101, 'bill', 12001)$$,
  'exactly one audit row: bill_submitted, by A, for this bill; submit_bill adds none of its own'
);

-- Approvers and admins can submit too; p_needs_approval sends the bill to the approver.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a4","role":"authenticated"}';
select results_eq(
  $$select bill_id, status::text from public.submit_bill(12012, true)$$,
  $$values (12012, 'pending_approval')$$,
  'an approver submits with p_needs_approval; the bill is pending_approval'
);
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a5","role":"authenticated"}';
select results_eq(
  $$select bill_id, status::text from public.submit_bill(12013)$$,
  $$values (12013, 'pending_payment')$$,
  'an admin submits without it; the bill is pending_payment'
);
reset role;
select results_eq(
  $$select bill_id, submitted_by, status::text from public.approvals where bill_id in (12012, 12013)$$,
  $$values (12012, 12103, 'pending')$$,
  'the approval request is one pending approvals row, submitted by D; none for the admin''s bill'
);

-- Draft-only policies, as operator A
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000012a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due, status)
    values (12001, 12001, 12101, 12001, 'DC12-20', 120.00, current_date + 30, 'pending_payment')$$,
  '42501', null,
  'inserting a bill that is not a draft is refused'
);
select lives_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_method_id, invoice_number, amount)
    values (12001, 12001, 12101, 12001, 'DC12-21', 120.00)$$,
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
