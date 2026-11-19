-- Scheduled payments use the latest real bill approval; no stored user JWT is involved.
begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

set local app.payments_write = 'on';
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
values (89401, 'Automated Pay Vendor', 'vendor-89401@example.test', '1 Test Way', '555-0194', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (89401, 'Automated Pay Property');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip)
values (89401, 'card', 'Automated Pay Card', '75001');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000094a1', 'dc94-operator@example.test'),
  ('00000000-0000-4000-8000-0000000094a2', 'dc94-approver@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (89411, 'Operator', 'dc94-operator@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000094a1'),
  (89412, 'Approver', 'dc94-approver@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000094a2');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
values
  (89401, 'pending_payment', 89401, 89401, 89411, 89401, 'AUTO-1', 25.00, current_date + 7),
  (89402, 'pending_payment', 89401, 89401, 89411, 89401, 'AUTO-2', 25.00, current_date + 7),
  (89403, 'pending_payment', 89401, 89401, 89411, 89401, 'AUTO-3', 25.00, current_date + 7);
insert into public.approvals (bill_id, submitted_by, approved_by, status, time_approved) values
  (89401, 89411, 89412, 'approved', now()),
  (89402, 89411, null, 'pending', null),
  (89403, 89411, 89412, 'approved', now());
insert into public.approvals (bill_id, submitted_by, approved_by, status, time_approved)
values (89403, 89411, null, 'needs_revision', null);
reset app.payments_write;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.prepare_payment(g, 89411, 0, current_date)
from generate_series(89401, 89403) g;
reset role;

create function pg_temp.auto_error(p_bill integer) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.authorize_approved_payment(
    (select payment_id from public.payments where bill_id = p_bill and status = 'pending')
  );
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;

select has_function('public', 'authorize_approved_payment', array['integer'], 'service authorization exists');
select is_definer('public', 'authorize_approved_payment', array['integer'], 'service authorization is security definer');
select function_privs_are('public', 'authorize_approved_payment', array['integer'], 'service_role', array['EXECUTE'], 'service role can authorize');
select function_privs_are('public', 'authorize_approved_payment', array['integer'], 'authenticated', array[]::text[], 'users cannot call the service function');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000094a1","role":"authenticated"}';
select is(pg_temp.auto_error(89401), array['42501', 'permission denied for function authorize_approved_payment', null], 'authenticated caller is refused');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.auto_error(89401), null, 'latest approved bill is authorized');
select is(pg_temp.auto_error(89402), array['PT409', 'not_approved', null], 'pending approval is refused');
select is(pg_temp.auto_error(89403), array['PT409', 'not_approved', null], 'newer non-approved decision is refused');
reset role;

select results_eq(
  $$select status::text, authorized_by from public.payments where bill_id = 89401$$,
  $$values ('authorized', 89412)$$,
  'the real approver owns the authorization'
);

select * from finish();
rollback;
