-- DC-89: start_payment_submission() and record_payment(), the two service-only functions the
-- payment worker calls: the atomic claim before any charge, and the outcome afterwards. Run with
-- `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(110);

-- Setup (as postgres, marker on): vendor, property, two payment methods, operator and a second
-- authorizer, and one bill per case.
set local app.payments_write = 'on';
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (89001, 'DC89 Test Vendor', 'vendor-89001@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (89001, 'DC89 Test Property');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip) values
  (89001, 'card', 'DC89 Test Card', '75001'),
  (89002, 'card', 'DC89 Other Card', '75002');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000089c1', 'dc89-c1@example.test'),
  ('00000000-0000-4000-8000-0000000089c2', 'dc89-c2@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (89121, 'Operator', 'dc89-c1@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000089c1'),
  (89122, 'Approver', 'dc89-c2@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000089c2');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
select g, 'pending_payment', 89001, 89001, 89121, 89001, 'DC89-' || g, 120.00, current_date + 7
from generate_series(89001, 89017) g where g <> 89016;
-- An incomplete legacy processing row (bill 89016, processing): prepared_by and the whole summary NULL.
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
  values (89016, 'processing', 89001, 89001, 89121, 89001, 'DC89-89016', 120.00, current_date + 7);
insert into public.payments (bill_id, status, submitted_at) values (89016, 'processing', now());
reset app.payments_write;

-- Prepare every attempt as the trusted service (bill 89016 is the legacy row). Bill 89003 is
-- prepared twice, so its first attempt is superseded (expired). Bill 89002 keeps its pending
-- attempt.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.prepare_payment(g, 89121, 0, current_date, case when g = 89011 then 'ACC-SECRET' end)
  from generate_series(89001, 89017) g where g <> 89016;
reset role;

create temp table pay as
select bill_id, payment_id from public.payments where bill_id between 89001 and 89017 and bill_id <> 89016;
grant select on pay to authenticated, anon, service_role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.prepare_payment(89003, 89121, 0, current_date);
reset role;

-- Authorize as the operator (89006 as the approver, who is made a viewer later).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089c1","role":"authenticated"}';
select public.authorize_payment(payment_id, public.payment_summary(p))
  from public.payments p
  where bill_id in (89001, 89004, 89005, 89007, 89008, 89009, 89010, 89011, 89012, 89013, 89014, 89015, 89017)
    and status = 'pending';
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089c2","role":"authenticated"}';
select public.authorize_payment(payment_id, public.payment_summary(p))
  from public.payments p where bill_id = 89006 and status = 'pending';
reset role;

-- Deliberate bypass of the guard (as postgres, marker on) to build edge states, then reset.
set local app.payments_write = 'on';
update public.payments set authorization_expires_at = now() where bill_id = 89004;
update public.payments set authorization_expires_at = now() + interval '1 minute' where bill_id = 89005;
-- Bill 89017 expires 200 ms from now on the wall clock, after this transaction began.
update public.payments set authorization_expires_at = clock_timestamp() + interval '200 milliseconds' where bill_id = 89017;
reset app.payments_write;
update public.users set role = 'viewer' where user_id = 89122;
update public.bills set amount = 121.00 where bill_id = 89007;
update public.bills set payment_method_id = 89002, invoice_number = 'DC89-CHANGED' where bill_id = 89008;
update public.bills set status = 'approval_denied' where bill_id = 89009;

create function pg_temp.pid(p_bill integer) returns integer
language sql as $$ select payment_id from pg_temp.pay where bill_id = p_bill $$;
-- The newest attempt of a bill.
create function pg_temp.cur(p_bill integer) returns integer
language sql as $$ select max(payment_id) from public.payments where bill_id = p_bill $$;
grant execute on function pg_temp.cur(integer) to authenticated, service_role;

create function pg_temp.prepare_error(p_bill integer) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.prepare_payment(p_bill, 89121, 0, current_date);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;
create function pg_temp.start_error(p_id integer) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.start_payment_submission(p_id);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;
create function pg_temp.record_error(p_id integer, p_outcome text, p_code text, p_ref text default null, p_msg text default null) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.record_payment(p_id, p_outcome, p_code, p_ref, p_msg);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;

-- Schema and privileges
select has_function('public', 'start_payment_submission', ARRAY['integer'], 'start_payment_submission exists');
select has_function('public', 'record_payment', ARRAY['integer', 'text', 'text', 'text', 'text'], 'record_payment exists');
select hasnt_function('public', 'record_payment', ARRAY['integer', 'numeric', 'integer', 'text', 'text'], 'the #59 record_payment is dropped');
select function_returns('public', 'start_payment_submission', ARRAY['integer'], 'payments', 'start_payment_submission returns the payments row');
select function_returns('public', 'record_payment', ARRAY['integer', 'text', 'text', 'text', 'text'], 'payments', 'record_payment returns the payments row');
select is_definer('public', 'start_payment_submission', ARRAY['integer'], 'start_payment_submission is security definer');
select is_definer('public', 'record_payment', ARRAY['integer', 'text', 'text', 'text', 'text'], 'record_payment is security definer');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.start_payment_submission(integer)')),
  ARRAY['search_path=""'], 'start_payment_submission pins search_path to empty');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.record_payment(integer, text, text, text, text)')),
  ARRAY['search_path=""'], 'record_payment pins search_path to empty');
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in (to_regprocedure('public.start_payment_submission(integer)'), to_regprocedure('public.record_payment(integer, text, text, text, text)'))
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0, 'public has no EXECUTE on either');
select function_privs_are('public', 'start_payment_submission', ARRAY['integer'], 'service_role', ARRAY['EXECUTE'], 'service_role can EXECUTE start_payment_submission');
select function_privs_are('public', 'record_payment', ARRAY['integer', 'text', 'text', 'text', 'text'], 'service_role', ARRAY['EXECUTE'], 'service_role can EXECUTE record_payment');
select function_privs_are('public', 'start_payment_submission', ARRAY['integer'], 'authenticated', ARRAY[]::text[], 'authenticated has no EXECUTE on start_payment_submission');
select function_privs_are('public', 'record_payment', ARRAY['integer', 'text', 'text', 'text', 'text'], 'authenticated', ARRAY[]::text[], 'authenticated has no EXECUTE on record_payment');
select function_privs_are('public', 'start_payment_submission', ARRAY['integer'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on start_payment_submission');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089c1","role":"authenticated"}';
select is(pg_temp.start_error(pg_temp.pid(89001)), ARRAY['42501', 'permission denied for function start_payment_submission', null], 'a signed-in user cannot start a submission');
select is(pg_temp.record_error(pg_temp.pid(89001), 'success', 'confirmed', 'TX-1'), ARRAY['42501', 'permission denied for function record_payment', null], 'a signed-in user cannot record a payment');
reset role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';

-- start_payment_submission: refusals
select is(pg_temp.start_error(null), ARRAY['PT404', 'not_found', null], 'NULL id: not_found');
select is(pg_temp.start_error(-1), ARRAY['PT404', 'not_found', null], 'unknown id: not_found');
select is(pg_temp.start_error(pg_temp.pid(89002)), ARRAY['PT409', 'not_authorized', 'pending'], 'a pending attempt is not authorized');
select is(pg_temp.start_error(pg_temp.pid(89003)), ARRAY['PT409', 'not_authorized', 'expired'], 'a superseded attempt is not authorized');
select is(pg_temp.start_error(pg_temp.pid(89004)), ARRAY['PT409', 'authorization_expired', null], 'authorization expiring now is expired');
select is(pg_temp.start_error(pg_temp.pid(89006)), ARRAY['PT403', 'forbidden', null], 'an authorizer who is now a viewer: forbidden');
select is(pg_temp.start_error(pg_temp.pid(89007)), ARRAY['PT409', 'summary_stale', '["amount_cents"]'], 'bill amount changed: summary_stale');
select is(pg_temp.start_error(pg_temp.pid(89008)), ARRAY['PT409', 'summary_stale', '["payment_method_id","invoice_number"]'], 'bill method and invoice changed: summary_stale in order');
select is(pg_temp.start_error(pg_temp.pid(89009)), ARRAY['PT409', 'not_payable', 'approval_denied'], 'bill no longer payable: not_payable');
-- now() stays at the transaction's start. A claim that began before the expiry but reaches the
-- check after it (e.g. after waiting for the bill lock) must still be refused. Bill 89017.
select pg_sleep(0.3);
select ok(now() < (select authorization_expires_at from public.payments where bill_id = 89017), 'bill 89017: the transaction began before the authorization expired');
select is(pg_temp.start_error(pg_temp.pid(89017)), ARRAY['PT409', 'authorization_expired', null], 'authorization that ran out after the transaction began is expired');
select is((select status from public.payments where bill_id = 89004), 'authorized', 'a refused claim leaves the attempt authorized');
select is((select status from public.bills where bill_id = 89007), 'pending_payment', 'a refused claim leaves the bill alone');

-- start_payment_submission: success
select is(pg_temp.start_error(pg_temp.pid(89005)), null, 'authorization expiring in a minute still starts');
select is(pg_temp.start_error(pg_temp.pid(89001)), null, 'an authorized attempt starts');
select is((select status from public.payments where bill_id = 89001), 'processing', 'attempt is processing');
select isnt((select submitted_at from public.payments where bill_id = 89001), null, 'submitted_at is set');
select ok((select submitted_at from public.payments where bill_id = 89001) > now(), 'submitted_at is the claim time, not the transaction start');
select is((select status from public.bills where bill_id = 89001), 'processing', 'bill is processing');
select is((select updated_at from public.bills where bill_id = 89001), now(), 'bill updated_at moved');
select is(
  (select description from public.audit_logs where name = 'payment_submitted'
     and description like format('payment %s (bill 89001):%%', pg_temp.pid(89001))),
  format('payment %s (bill 89001): authorized → processing, by service', pg_temp.pid(89001)),
  'payment_submitted audit row');
select is(pg_temp.start_error(pg_temp.pid(89001)), ARRAY['PT409', 'not_authorized', 'processing'], 'a second claim sees processing');
select ok(coalesce(current_setting('app.payments_write', true), '') <> 'on', 'start_payment_submission leaves the write marker off');

-- record_payment: validation, in order
select is(pg_temp.record_error(null, 'maybe', 'confirmed'), ARRAY['PT400', 'invalid_outcome', '["outcome"]'], 'bad outcome (checked before the id)');
select is(pg_temp.record_error(pg_temp.pid(89001), null, 'confirmed'), ARRAY['PT400', 'invalid_outcome', '["outcome"]'], 'NULL outcome');
select is(pg_temp.record_error(pg_temp.pid(89001), 'success', 'portal_error', 'TX-1'), ARRAY['PT400', 'invalid_outcome', '["outcome_code"]'], 'success with a failure code');
select is(pg_temp.record_error(pg_temp.pid(89001), 'failure', null), ARRAY['PT400', 'invalid_outcome', '["outcome_code"]'], 'NULL code');
select is(pg_temp.record_error(pg_temp.pid(89001), 'unknown', 'confirmed'), ARRAY['PT400', 'invalid_outcome', '["outcome_code"]'], 'unknown with a success code');
select is(pg_temp.record_error(pg_temp.pid(89001), 'success', 'confirmed'), ARRAY['PT400', 'invalid_outcome', '["transaction_reference"]'], 'success without a reference');
select is(pg_temp.record_error(pg_temp.pid(89001), 'success', 'confirmed', '  '), ARRAY['PT400', 'invalid_outcome', '["transaction_reference"]'], 'success with a blank reference');
select is(pg_temp.record_error(pg_temp.pid(89001), 'success', 'confirmed', repeat('x', 256)), ARRAY['PT400', 'invalid_outcome', '["transaction_reference"]'], 'a 256-character reference');
select is(pg_temp.record_error(pg_temp.pid(89001), 'failure', 'portal_error', null, repeat('m', 501)), ARRAY['PT400', 'invalid_outcome', '["message"]'], 'a 501-character message');
select is(pg_temp.record_error(pg_temp.pid(89001), 'maybe', 'nope', null, repeat('m', 501)), ARRAY['PT400', 'invalid_outcome', '["outcome","message"]'], 'outcome and message together');
select is(pg_temp.record_error(null, 'failure', 'portal_error'), ARRAY['PT404', 'not_found', null], 'NULL id: not_found');
select is(pg_temp.record_error(-1, 'failure', 'portal_error'), ARRAY['PT404', 'not_found', null], 'unknown id: not_found');
select is(pg_temp.record_error(pg_temp.pid(89010), 'failure', 'portal_error'), ARRAY['PT409', 'not_processing', 'authorized'], 'an authorized attempt is not processing');
select is(pg_temp.record_error(pg_temp.pid(89002), 'failure', 'not_submitted'), ARRAY['PT409', 'not_processing', 'pending'], 'a pending attempt is not processing');

-- success (bill 89011): reference trimmed, never in the audit text
select is(pg_temp.start_error(pg_temp.pid(89011)), null, 'bill 89011 claimed');
select is(pg_temp.record_error(pg_temp.pid(89011), 'success', 'confirmed', '  TX-SECRET-1  ', '  paid in full  '), null, 'success is recorded');
select is((select status from public.payments where bill_id = 89011), 'success', 'attempt is success');
select is((select transaction_reference from public.payments where bill_id = 89011), 'TX-SECRET-1', 'reference is trimmed');
select is((select outcome_code from public.payments where bill_id = 89011), 'confirmed', 'outcome_code stored');
select is((select outcome_message from public.payments where bill_id = 89011), 'paid in full', 'message is trimmed');
select isnt((select time_paid from public.payments where bill_id = 89011), null, 'time_paid is set');
select isnt((select outcome_at from public.payments where bill_id = 89011), null, 'outcome_at is set');
select is((select status from public.bills where bill_id = 89011), 'payment_success', 'bill is payment_success');
select isnt((select date_paid from public.bills where bill_id = 89011), null, 'bill date_paid is set');
select is(
  (select description from public.audit_logs where name = 'payment_succeeded'
     and description like format('payment %s (bill 89011):%%', pg_temp.pid(89011))),
  format('payment %s (bill 89011): processing → success, by service, outcome confirmed', pg_temp.pid(89011)),
  'payment_succeeded audit row');
select is(pg_temp.record_error(pg_temp.pid(89011), 'success', 'confirmed', 'TX-SECRET-1'), ARRAY['PT409', 'not_processing', 'success'], 'a recorded payment cannot be recorded again');
select ok(coalesce(current_setting('app.payments_write', true), '') <> 'on', 'record_payment leaves the write marker off');

-- failure, then retry to success (bill 89012)
select is(pg_temp.start_error(pg_temp.pid(89012)), null, 'bill 89012 claimed');
select is(pg_temp.record_error(pg_temp.pid(89012), 'failure', 'portal_rejected', '  TX-REJ-1  ', 'card declined'), null, 'failure is recorded');
select is((select status from public.payments where bill_id = 89012), 'failure', 'attempt is failure');
select is((select outcome_message from public.payments where bill_id = 89012), 'card declined', 'failure message stored');
select is((select transaction_reference from public.payments where bill_id = 89012), 'TX-REJ-1', 'a failure stores its trimmed reference');
select is((select status from public.bills where bill_id = 89012), 'payment_failed', 'bill is payment_failed');
select is((select date_paid from public.bills where bill_id = 89012), null, 'no date_paid on a failure');
select is(
  (select description from public.audit_logs where name = 'payment_failed'
     and description like format('payment %s (bill 89012):%%', pg_temp.pid(89012))),
  format('payment %s (bill 89012): processing → failure, by service, outcome portal_rejected', pg_temp.pid(89012)),
  'payment_failed audit row');
select is(pg_temp.record_error(pg_temp.pid(89012), 'success', 'confirmed', 'TX-2'), ARRAY['PT409', 'not_processing', 'failure'], 'a failed attempt cannot become a success');
select lives_ok($$select public.prepare_payment(89012, 89121, 0, current_date)$$, 'a failed bill can be prepared again');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089c1","role":"authenticated"}';
select lives_ok($$select public.authorize_payment(pg_temp.cur(89012), (select public.payment_summary(p) from public.payments p where payment_id = pg_temp.cur(89012)))$$, 'the retry is authorized');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(pg_temp.start_error(pg_temp.cur(89012)), null, 'the retry is claimed');
select is(pg_temp.record_error(pg_temp.cur(89012), 'success', 'confirmed', 'TX-RETRY'), null, 'the retry succeeds');
select is((select status from public.bills where bill_id = 89012), 'payment_success', 'bill ends payment_success after a retry');
select is((select count(*)::int from public.payments where bill_id = 89012), 2, 'two attempts on the bill');

-- unknown, then reconciled (bills 89013 and 89014)
select is(pg_temp.start_error(pg_temp.pid(89013)), null, 'bill 89013 claimed');
select is(pg_temp.record_error(pg_temp.pid(89013), 'unknown', 'outcome_unknown', null, 'portal timed out'), null, 'unknown is recorded');
select is((select status from public.payments where bill_id = 89013), 'unknown', 'attempt is unknown');
select is((select status from public.bills where bill_id = 89013), 'processing', 'bill stays processing');
select is((select date_paid from public.bills where bill_id = 89013), null, 'no date_paid while unknown');
select is(
  (select description from public.audit_logs where name = 'payment_outcome_unknown'
     and description like format('payment %s (bill 89013):%%', pg_temp.pid(89013))),
  format('payment %s (bill 89013): processing → unknown, by service, outcome outcome_unknown', pg_temp.pid(89013)),
  'payment_outcome_unknown audit row');
select is(pg_temp.start_error(pg_temp.pid(89013)), ARRAY['PT409', 'not_authorized', 'unknown'], 'an unknown attempt cannot be claimed again');
select is(pg_temp.record_error(pg_temp.pid(89013), 'unknown', 'outcome_unknown'), ARRAY['PT409', 'not_processing', 'unknown'], 'unknown cannot be recorded as unknown again');
select is(pg_temp.record_error(pg_temp.pid(89013), 'success', 'confirmed', 'TX-RECON-1'), null, 'an unknown attempt reconciles to success');
select is((select status from public.payments where bill_id = 89013), 'success', 'reconciled attempt is success');
select is((select outcome_message from public.payments where bill_id = 89013), 'portal timed out', 'reconciling without a message keeps the earlier one');
select is((select status from public.bills where bill_id = 89013), 'payment_success', 'bill is payment_success after reconciling');
select isnt((select date_paid from public.bills where bill_id = 89013), null, 'date_paid set on reconciling');

select is(pg_temp.start_error(pg_temp.pid(89014)), null, 'bill 89014 claimed');
select is(pg_temp.record_error(pg_temp.pid(89014), 'unknown', 'outcome_unknown', 'TX-UNK-14', 'first note'), null, 'bill 89014 unknown, with a reference and a note');
select is(pg_temp.record_error(pg_temp.pid(89014), 'failure', 'not_submitted', null, 'second note'), null, 'an unknown attempt reconciles to failure');
select is((select outcome_message from public.payments where bill_id = 89014), 'second note', 'reconciling with a new message replaces the old one');
select is((select transaction_reference from public.payments where bill_id = 89014), 'TX-UNK-14', 'reconciling without a reference keeps the earlier one');
select is((select status from public.payments where bill_id = 89014), 'failure', 'reconciled attempt is failure');
select is((select status from public.bills where bill_id = 89014), 'payment_failed', 'bill is payment_failed after reconciling');

-- an incomplete legacy processing row can be recorded (bill 89016)
select is(pg_temp.record_error((select payment_id from public.payments where bill_id = 89016), 'success', 'confirmed', 'TX-LEGACY'), null, 'an incomplete legacy processing row can be recorded');
select is((select status || '/' || transaction_reference from public.payments where bill_id = 89016), 'success/TX-LEGACY', 'the legacy row is success with its reference');

-- unknown blocks a new preparation (bill 89015)
select is(pg_temp.start_error(pg_temp.pid(89015)), null, 'bill 89015 claimed');
select is(pg_temp.record_error(pg_temp.pid(89015), 'unknown', 'outcome_unknown'), null, 'bill 89015 unknown');
select is(pg_temp.prepare_error(89015), ARRAY['PT409', 'payment_in_progress', pg_temp.pid(89015)::text], 'an unknown attempt blocks a new preparation');
select is(pg_temp.prepare_error(89011), ARRAY['PT409', 'already_paid', pg_temp.pid(89011)::text], 'a paid bill cannot be prepared again');

reset role;

-- Audit text: only ids, statuses, by-service, the outcome code and policies. Never amounts, the
-- account reference or a transaction reference. The shape check covers the rows the payment
-- functions write (no entity_type); DC-101's row trigger adds its own entity_type = 'payment'
-- rows in its own format.
select is(
  (select count(*)::int from public.audit_logs
    where name like 'payment\_%'
      and entity_type is null
      and description !~ '^payment [0-9]+ \(bill [0-9]+\): [a-z]+ → [a-z]+, by (user [0-9]+|service)(, outcome [a-z_]+)?(, policies \[.*\])?$'),
  0, 'every payment audit row has the documented shape');
select is(
  (select count(*)::int from public.audit_logs
    where name like 'payment\_%'
      and (description like '%ACC-SECRET%' or description like '%TX-%' or description like '%paid in full%' or description like '%declined%')),
  0, 'no audit row holds the account reference, a transaction reference or a message');

select * from finish();
rollback;
