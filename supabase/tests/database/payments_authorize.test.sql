-- DC-89: authorize_payment() and cancel_payment(), the two functions a signed-in person calls
-- on a pending payment attempt. Run with `supabase test db`. Synthetic data only; everything
-- rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(93);

-- Setup (as postgres, marker on): vendor, property, payment method, five logins (operator,
-- approver, admin, viewer, and one with no profile) and one bill per case.
set local app.payments_write = 'on';
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (89001, 'DC89 Test Vendor', 'vendor-89001@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (89001, 'DC89 Test Property');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip)
  values (89001, 'card', 'DC89 Test Card', '75001');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000089b1', 'dc89-b1@example.test'),
  ('00000000-0000-4000-8000-0000000089b2', 'dc89-b2@example.test'),
  ('00000000-0000-4000-8000-0000000089b3', 'dc89-b3@example.test'),
  ('00000000-0000-4000-8000-0000000089b4', 'dc89-b4@example.test'),
  ('00000000-0000-4000-8000-0000000089b5', 'dc89-b5@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (89111, 'Operator', 'dc89-b1@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000089b1'),
  (89112, 'Approver', 'dc89-b2@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000089b2'),
  (89113, 'Admin', 'dc89-b3@example.test', 'system_admin', '00000000-0000-4000-8000-0000000089b3'),
  (89114, 'Viewer', 'dc89-b4@example.test', 'viewer', '00000000-0000-4000-8000-0000000089b4');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
select g, 'pending_payment', 89001, 89001, 89111, 89001, 'DC89-' || g, 120.00, current_date + 7
from generate_series(89001, 89020) g;

-- Builds a pending, prepared row with a complete summary and its correct hash for a bill, on a
-- given payment date (the marker is on while this runs).
create function pg_temp.insert_pending(p_bill integer, p_date date) returns void
language plpgsql as $$
declare
  r public.payments;
begin
  r.bill_id := p_bill; r.vendor_id := 89001; r.payment_method_id := 89001;
  r.invoice_number := 'DC89-' || p_bill; r.amount_cents := 12000; r.fees_cents := 0;
  r.total_cents := 12000; r.currency := 'USD'; r.payment_date := p_date;
  r.summary_hash := public.payment_summary_hash(r);
  insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number,
    amount_cents, fees_cents, total_cents, currency, payment_date, summary_hash, prepared_by)
  values (r.bill_id, 'pending', r.vendor_id, r.payment_method_id, r.invoice_number,
    r.amount_cents, r.fees_cents, r.total_cents, r.currency, r.payment_date, r.summary_hash, 89111);
end
$$;

-- Deliberate bypass of prepare_payment (as postgres, marker on): stale preparations whose payment
-- date is two days back (89017) and one day back (89018), and an incomplete legacy-style pending
-- row (89019: prepared_by and the whole summary NULL).
select pg_temp.insert_pending(89017, current_date - 2);
select pg_temp.insert_pending(89018, current_date - 1);
insert into public.payments (bill_id, status) values (89019, 'pending');

-- An attempt that is already processing (bill 89016), built directly with the marker.
insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number, amount_cents, fees_cents,
  total_cents, currency, payment_date, summary_hash, prepared_by, authorized_by, authorized_at, authorization_expires_at, submitted_at)
values (89016, 'processing', 89001, 89001, 'DC89-89016', 12000, 0, 12000, 'USD', current_date, 'h', 89111, 89112, now(), now() + interval '15 minutes', now());
reset app.payments_write;

-- Pending attempts, prepared by the trusted service. Bill 89004 has an account reference.
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.prepare_payment(g, 89111, 0, current_date, case when g = 89004 then 'ACC-1' end, '["POL-1"]'::jsonb)
  from generate_series(89001, 89015) g;
reset role;

-- Payment ids by bill (readable by the roles under test).
create temp table pay as
select bill_id, payment_id from public.payments where bill_id between 89001 and 89019;
grant select on pay to authenticated, anon, service_role;
-- A seeded legacy pending attempt, never prepared through the service.
create temp table legacy as
select payment_id from public.payments where prepared_by is null and status = 'pending' order by payment_id limit 1;
grant select on legacy to authenticated;

-- The error of a call as {sqlstate, message, detail}, or null if it succeeds. Run as the
-- caller's current role.
create function pg_temp.auth_error(p_id integer, p_summary jsonb) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.authorize_payment(p_id, p_summary);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;
create function pg_temp.cancel_error(p_id integer, p_note text default null) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.cancel_payment(p_id, p_note);
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;
create function pg_temp.pid(p_bill integer) returns integer
language sql as $$ select payment_id from pg_temp.pay where bill_id = p_bill $$;

-- Schema and privileges
select has_function('public', 'authorize_payment', ARRAY['integer', 'jsonb'], 'authorize_payment exists');
select has_function('public', 'cancel_payment', ARRAY['integer', 'text'], 'cancel_payment exists');
select function_returns('public', 'authorize_payment', ARRAY['integer', 'jsonb'], 'payments', 'authorize_payment returns the payments row');
select function_returns('public', 'cancel_payment', ARRAY['integer', 'text'], 'payments', 'cancel_payment returns the payments row');
select is_definer('public', 'authorize_payment', ARRAY['integer', 'jsonb'], 'authorize_payment is security definer');
select is_definer('public', 'cancel_payment', ARRAY['integer', 'text'], 'cancel_payment is security definer');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.authorize_payment(integer, jsonb)')),
  ARRAY['search_path=""'], 'authorize_payment pins search_path to empty');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.cancel_payment(integer, text)')),
  ARRAY['search_path=""'], 'cancel_payment pins search_path to empty');
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid in (to_regprocedure('public.authorize_payment(integer, jsonb)'), to_regprocedure('public.cancel_payment(integer, text)'))
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0, 'public has no EXECUTE on either');
select function_privs_are('public', 'authorize_payment', ARRAY['integer', 'jsonb'], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE authorize_payment');
select function_privs_are('public', 'cancel_payment', ARRAY['integer', 'text'], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE cancel_payment');
select function_privs_are('public', 'authorize_payment', ARRAY['integer', 'jsonb'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on authorize_payment');
select function_privs_are('public', 'cancel_payment', ARRAY['integer', 'text'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on cancel_payment');

set local role anon;
select is(pg_temp.auth_error(pg_temp.pid(89001), '{}'::jsonb), ARRAY['42501', 'permission denied for function authorize_payment', null], 'anon cannot authorize');
select is(pg_temp.cancel_error(pg_temp.pid(89001)), ARRAY['42501', 'permission denied for function cancel_payment', null], 'anon cannot cancel');
reset role;

-- Snapshot before the refused calls.
create temp table before_snapshot as
select (select md5(string_agg(p::text, '|' order by payment_id)) from public.payments p) as pay,
       (select count(*) from public.audit_logs) as aud;
grant select on before_snapshot to authenticated;

-- Refused calls (nothing changes)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b4","role":"authenticated"}';
select is(pg_temp.auth_error(pg_temp.pid(89001), (select public.payment_summary(p) from public.payments p where bill_id = 89001)),
  ARRAY['PT403', 'forbidden', null], 'a viewer cannot authorize');
select is(pg_temp.cancel_error(pg_temp.pid(89001)), ARRAY['PT403', 'forbidden', null], 'a viewer cannot cancel');
select is(pg_temp.auth_error(null, null), ARRAY['PT403', 'forbidden', null], 'the caller check comes before the summary check');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b5","role":"authenticated"}';
select is(pg_temp.auth_error(pg_temp.pid(89001), (select public.payment_summary(p) from public.payments p where bill_id = 89001)),
  ARRAY['PT403', 'forbidden', null], 'a login with no profile cannot authorize');
select is(pg_temp.cancel_error(pg_temp.pid(89001)), ARRAY['PT403', 'forbidden', null], 'a login with no profile cannot cancel');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b1","role":"authenticated"}';
-- Summary shape (bill 89012)
select is(pg_temp.auth_error(pg_temp.pid(89012), null), ARRAY['PT400', 'invalid_summary', null], 'a NULL summary');
select is(pg_temp.auth_error(pg_temp.pid(89012), '[]'::jsonb), ARRAY['PT400', 'invalid_summary', null], 'a summary that is an array');
select is(pg_temp.auth_error(pg_temp.pid(89012), '"x"'::jsonb), ARRAY['PT400', 'invalid_summary', null], 'a summary that is a string');
select is(pg_temp.auth_error(pg_temp.pid(89012), (select public.payment_summary(p) - 'fees_cents' from public.payments p where bill_id = 89012)),
  ARRAY['PT400', 'invalid_summary', '["fees_cents"]'], 'a missing key');
select is(pg_temp.auth_error(pg_temp.pid(89012), (select public.payment_summary(p) || '{"tip": 1}' from public.payments p where bill_id = 89012)),
  ARRAY['PT400', 'invalid_summary', '["tip"]'], 'an extra key');
select is(pg_temp.auth_error(pg_temp.pid(89012), (select (public.payment_summary(p) - 'fees_cents') || '{"tip": 1}' from public.payments p where bill_id = 89012)),
  ARRAY['PT400', 'invalid_summary', '["fees_cents","tip"]'], 'a missing and an extra key, sorted');
select is(pg_temp.auth_error(pg_temp.pid(89012), '{}'::jsonb),
  ARRAY['PT400', 'invalid_summary', '["account_reference","amount_cents","bill_id","currency","fees_cents","invoice_number","payment_date","payment_method_id","total_cents","vendor_id"]'],
  'an empty object lists every key, sorted');
select is(pg_temp.auth_error(null, (select public.payment_summary(p) from public.payments p where bill_id = 89012)), ARRAY['PT404', 'not_found', null], 'a NULL id');
select is(pg_temp.auth_error(89999, (select public.payment_summary(p) from public.payments p where bill_id = 89012)), ARRAY['PT404', 'not_found', null], 'an unknown id');
select is(pg_temp.auth_error(89999, null), ARRAY['PT400', 'invalid_summary', null], 'the summary check comes before the lookup');

-- Status checks
select is(pg_temp.auth_error((select payment_id from pg_temp.legacy),
    (select public.payment_summary(p) from public.payments p where p.payment_id = (select payment_id from pg_temp.legacy))),
  ARRAY['PT409', 'not_prepared', null], 'a legacy pending row (never prepared by the service) cannot be authorized');
select is(pg_temp.auth_error(pg_temp.pid(89016), (select public.payment_summary(p) from public.payments p where bill_id = 89016)),
  ARRAY['PT409', 'not_pending', 'processing'], 'a processing attempt is not pending');
select is(pg_temp.auth_error(pg_temp.pid(89017), (select public.payment_summary(p) from public.payments p where bill_id = 89017)),
  ARRAY['PT409', 'summary_stale', '["payment_date"]'], 'a preparation two days old is stale');

-- Mismatch (bill 89004: account reference ACC-1). One key at a time.
select is(
  pg_temp.auth_error(pg_temp.pid(89004), jsonb_set((select public.payment_summary(p) from public.payments p where bill_id = 89004), array[t.k], t.v)),
  ARRAY['PT409', 'summary_mismatch', '["' || t.k || '"]'], 'a changed ' || t.k)
from (values
  ('bill_id', '89999'::jsonb), ('vendor_id', '1'), ('invoice_number', '"X-1"'), ('account_reference', '"ACC-2"'),
  ('payment_method_id', '1'), ('amount_cents', '12001'), ('fees_cents', '1'), ('total_cents', '12001'),
  ('currency', '"EUR"'), ('payment_date', '"2026-01-01"')
) as t(k, v);
select is(pg_temp.auth_error(pg_temp.pid(89004), jsonb_set((select public.payment_summary(p) from public.payments p where bill_id = 89004), '{amount_cents}', '"12000"')),
  ARRAY['PT409', 'summary_mismatch', '["amount_cents"]'], 'a number sent as a string is not coerced');
select is(pg_temp.auth_error(pg_temp.pid(89004), jsonb_set((select public.payment_summary(p) from public.payments p where bill_id = 89004), '{payment_date}', '"11/16/2026"')),
  ARRAY['PT409', 'summary_mismatch', '["payment_date"]'], 'a date in another format is not coerced');
select is(pg_temp.auth_error(pg_temp.pid(89004), jsonb_set(jsonb_set((select public.payment_summary(p) from public.payments p where bill_id = 89004), '{total_cents}', '1'), '{bill_id}', '2')),
  ARRAY['PT409', 'summary_mismatch', '["bill_id","total_cents"]'], 'two changed keys, in canonical order');
select is(pg_temp.auth_error(pg_temp.pid(89004), jsonb_set((select public.payment_summary(p) from public.payments p where bill_id = 89004), '{account_reference}', 'null')),
  ARRAY['PT409', 'summary_mismatch', '["account_reference"]'], 'a stored account reference cannot be replaced by null');
select is(pg_temp.auth_error(pg_temp.pid(89005), jsonb_set((select public.payment_summary(p) from public.payments p where bill_id = 89005), '{account_reference}', '""')),
  ARRAY['PT409', 'summary_mismatch', '["account_reference"]'], 'an empty string does not match a stored NULL');

-- Cancel refusals
select is(pg_temp.cancel_error(pg_temp.pid(89010), repeat('x', 501)), ARRAY['PT400', 'invalid_note', null], 'a 501-character note');
select is(pg_temp.cancel_error(pg_temp.pid(89010), repeat(' ', 5) || repeat('x', 501) || repeat(' ', 5)), ARRAY['PT400', 'invalid_note', null], 'a 501-character note with padding');
select is(pg_temp.cancel_error(null), ARRAY['PT404', 'not_found', null], 'cancel with a NULL id');
select is(pg_temp.cancel_error(89999), ARRAY['PT404', 'not_found', null], 'cancel with an unknown id');
select is(pg_temp.cancel_error(pg_temp.pid(89016)), ARRAY['PT409', 'not_cancelable', 'processing'], 'a processing attempt cannot be canceled');

-- The marker is off after a refused call.
select is(coalesce(current_setting('app.payments_write', true), ''), '', 'the write marker is off after refused calls');

reset role;
select is(
  (select md5(string_agg(p::text, '|' order by payment_id)) from public.payments p), (select pay from before_snapshot),
  'refused calls change no payments row');
select is((select count(*) from public.audit_logs), (select aud from before_snapshot), 'refused calls write no audit row');

-- Authorize: each non-viewer role, on its own attempt
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b1","role":"authenticated"}';
select is(pg_temp.auth_error(pg_temp.pid(89001), (select public.payment_summary(p) from public.payments p where bill_id = 89001)), null, 'an operator authorizes');
select is(coalesce(current_setting('app.payments_write', true), ''), '', 'the write marker is off after a successful call');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b2","role":"authenticated"}';
select is(pg_temp.auth_error(pg_temp.pid(89002), (select public.payment_summary(p) from public.payments p where bill_id = 89002)), null, 'an approver authorizes');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b3","role":"authenticated"}';
select is(pg_temp.auth_error(pg_temp.pid(89003), (select public.payment_summary(p) from public.payments p where bill_id = 89003)), null, 'an admin authorizes');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b1","role":"authenticated"}';
select is(pg_temp.auth_error(pg_temp.pid(89005), jsonb_set((select public.payment_summary(p) from public.payments p where bill_id = 89005), '{account_reference}', 'null')), null, 'null matches a stored NULL account reference');
select is(pg_temp.auth_error(pg_temp.pid(89018), (select public.payment_summary(p) from public.payments p where bill_id = 89018)),
  null, 'a preparation one day old can still be authorized');
select is(pg_temp.cancel_error(pg_temp.pid(89019), 'legacy row'), null, 'an incomplete legacy pending row can be canceled');
reset role;

select is((select status from public.payments where bill_id = 89018), 'authorized', 'one-day-old preparation: status authorized');
select results_eq($$select status::text, outcome_message from public.payments where bill_id = 89019$$,
  $$values ('canceled', 'legacy row')$$, 'the legacy row is canceled with its note');
select is((select status from public.payments where bill_id = 89001), 'authorized', 'operator: status authorized');
select is((select authorized_by from public.payments where bill_id = 89001), 89111, 'operator: authorized_by');
select is((select authorized_by from public.payments where bill_id = 89002), 89112, 'approver: authorized_by');
select is((select authorized_by from public.payments where bill_id = 89003), 89113, 'admin: authorized_by');
select is((select authorized_at from public.payments where bill_id = 89001), now(), 'authorized_at is now()');
select is((select authorization_expires_at - authorized_at from public.payments where bill_id = 89001), interval '15 minutes', 'authorization lasts 15 minutes');
select is((select authorization_expires_at - authorized_at from public.payments where bill_id = 89003), interval '15 minutes', 'authorization lasts 15 minutes (admin)');
select is((select status from public.payments where bill_id = 89005), 'authorized', 'null-account attempt authorized');
select is(
  (select description from public.audit_logs where name = 'payment_authorized'
     and description like format('payment %s (bill 89001):%%', (select payment_id from pg_temp.pay where bill_id = 89001))),
  format('payment %s (bill 89001): pending → authorized, by user 89111, policies ["POL-1"]', (select payment_id from pg_temp.pay where bill_id = 89001)),
  'one exact payment_authorized audit row, with policies and no amounts');
select is(
  (select count(*)::int from public.audit_logs where name = 'payment_authorized'
     and description like format('payment %s (bill 89001):%%', (select payment_id from pg_temp.pay where bill_id = 89001))),
  1, 'exactly one audit row for the authorization');

-- Already authorized
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000089b1","role":"authenticated"}';
select is(pg_temp.auth_error(pg_temp.pid(89001), (select public.payment_summary(p) from public.payments p where bill_id = 89001)),
  ARRAY['PT409', 'not_pending', 'authorized'], 'an authorized attempt is not pending');

-- Cancel
select is(pg_temp.cancel_error(pg_temp.pid(89008), '  wrong vendor  '), null, 'cancel a pending attempt with a note');
select is(coalesce(current_setting('app.payments_write', true), ''), '', 'the write marker is off after a successful cancel');
select is(pg_temp.cancel_error(pg_temp.pid(89009)), null, 'cancel a pending attempt with no note');
select is(pg_temp.cancel_error(pg_temp.pid(89002), '   '), null, 'cancel an authorized attempt with a blank note');
select is(pg_temp.cancel_error(pg_temp.pid(89003), repeat('x', 500)), null, 'a 500-character note is allowed');
select is(pg_temp.cancel_error(pg_temp.pid(89008)), ARRAY['PT409', 'not_cancelable', 'canceled'], 'a canceled attempt cannot be canceled again');
reset role;

select is((select status from public.payments where bill_id = 89008), 'canceled', 'pending canceled');
select is((select canceled_by from public.payments where bill_id = 89008), 89111, 'canceled_by is the caller');
select is((select outcome_at from public.payments where bill_id = 89008), now(), 'outcome_at is now()');
select is((select outcome_message from public.payments where bill_id = 89008), 'wrong vendor', 'the note is trimmed');
select is((select outcome_message from public.payments where bill_id = 89009), null, 'no note stores NULL');
select is((select status from public.payments where bill_id = 89002), 'canceled', 'authorized canceled');
select is((select outcome_message from public.payments where bill_id = 89002), null, 'a blank note stores NULL');
select is((select char_length(outcome_message) from public.payments where bill_id = 89003), 500, 'a 500-character note is stored');
select is(
  (select description from public.audit_logs where name = 'payment_canceled'
     and description like format('payment %s (bill 89008):%%', (select payment_id from pg_temp.pay where bill_id = 89008))),
  format('payment %s (bill 89008): pending → canceled, by user 89111', (select payment_id from pg_temp.pay where bill_id = 89008)),
  'payment_canceled audit row from pending, with no note text');
select is(
  (select description from public.audit_logs where name = 'payment_canceled'
     and description like format('payment %s (bill 89002):%%', (select payment_id from pg_temp.pay where bill_id = 89002))),
  format('payment %s (bill 89002): authorized → canceled, by user 89111', (select payment_id from pg_temp.pay where bill_id = 89002)),
  'payment_canceled audit row from authorized');
select is(
  (select count(*)::int from public.audit_logs where description like '%wrong vendor%'),
  0, 'the note is not written to the audit log');

select * from finish();
rollback;
