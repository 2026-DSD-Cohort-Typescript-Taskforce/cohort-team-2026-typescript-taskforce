-- record_payment: the money write behind bill-mcp. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000091a1', 'pay-91-a@example.test'),
  ('00000000-0000-4000-8000-0000000091a2', 'pay-91-b@example.test');
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (91001, 'Pay Test Vendor', 'vendor-91001@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (91001, 'Pay Test Property');
insert into public.payment_methods (payment_id, payment_type, name, billing_zip)
  values (91001, 'card', 'Pay Test Card', '75001');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (91101, 'Operator A', 'pay-91-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000091a1'),
  (91102, 'Approver B', 'pay-91-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000091a2');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_id, invoice_number, amount, date_due) values
  (91001, 'pending_approval', 91001, 91001, 91101, 91001, 'PAY-01', 40.50, current_date + 7),
  (91002, 'pending_payment', 91001, 91001, 91101, 91001, 'PAY-02', 40.50, current_date + 7),
  (91003, 'pending_payment', 91001, 91001, 91101, 91001, 'PAY-03', 40.50, current_date + 7),
  (91004, 'draft',            91001, 91001, 91101, 91001, 'PAY-04', 40.50, current_date + 7);
insert into public.approvals (approval_id, bill_id, submitted_by, status, created_at) values
  (91001, 91001, 91101, 'pending', now() - interval '1 day'),
  (91002, 91002, 91101, 'approved', now() - interval '2 days'),
  (91003, 91002, 91101, 'rejected', now() - interval '1 day'),
  (91004, 91003, 91101, 'approved', now());

create function pg_temp.pay_error(
  p_bill_id integer,
  p_amount numeric,
  p_vendor_id integer,
  p_invoice_number text,
  p_idempotency_key text
) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.record_payment(p_bill_id, p_amount, p_vendor_id, p_invoice_number, p_idempotency_key);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;

select has_function('public', 'record_payment', array['integer', 'numeric', 'integer', 'text', 'text'], 'record_payment exists');
select is_definer('public', 'record_payment', array['integer', 'numeric', 'integer', 'text', 'text'], 'record_payment is security definer');
select function_privs_are('public', 'record_payment', array['integer', 'numeric', 'integer', 'text', 'text'], 'anon', array[]::text[], 'anon cannot execute record_payment');
select function_privs_are('public', 'record_payment', array['integer', 'numeric', 'integer', 'text', 'text'], 'authenticated', array[]::text[], 'authenticated cannot execute record_payment');
select function_privs_are('public', 'record_payment', array['integer', 'numeric', 'integer', 'text', 'text'], 'service_role', array['EXECUTE'], 'service_role can execute record_payment');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000091a2","role":"authenticated"}';
select throws_ok(
  $$select public.record_payment(91003, 40.50, 91001, 'PAY-03', 'skip-worker')$$,
  '42501', null,
  'a signed-in user cannot call record_payment directly'
);
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000091a2","role":"authenticated"}';
select is((select status from public.decide_bill(91001, 'approved', null)), 'pending_payment', 'decide_bill moves the bill to pending_payment');
reset role;

select is(
  (select status from public.record_payment(91001, 40.50, 91001, 'PAY-01', 'pay-91001')),
  'success',
  'an approved pending bill records one successful payment'
);
select is((select status from public.bills where bill_id = 91001), 'payment_success', 'the bill becomes payment_success');
select is(
  (select payment_id from public.record_payment(91001, 40.50, 91001, 'PAY-01', 'pay-91001')),
  (select payment_id from public.payments where idempotency_key = 'pay-91001'),
  'the same idempotency key returns the existing payment'
);
select is((select count(*)::int from public.payments where bill_id = 91001), 1, 'the retry does not insert a second payment');

select is(
  pg_temp.pay_error(91002, 40.50, 91001, 'PAY-02', 'pay-91002'),
  array['PT409', 'not_approved', null],
  'the newest approval must be approved'
);
select is((select count(*)::int from public.payments where bill_id = 91002), 0, 'a refused approval writes no payment');

select is(
  pg_temp.pay_error(91003, 1, 91001, 'PAY-03', 'pay-91003'),
  array['PT409', 'snapshot_mismatch', null],
  'a different amount is refused'
);
select is(
  pg_temp.pay_error(91004, 40.50, 91001, 'PAY-04', 'pay-91004'),
  array['PT409', 'not_pending_payment', 'draft'],
  'a draft is not payable'
);
select is((select count(*)::int from public.payments where bill_id in (91003, 91004)), 0, 'refused bills write no payment');

select * from finish();
rollback;
