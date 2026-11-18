-- DC-89: payments columns, value checks, one-open-attempt index, legacy backfill, lock-down
-- and guard trigger. Run with `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(88);

-- Setup (as postgres, marker on): one vendor, property, payment method, user and one bill per
-- case (ids 89001+, users 89101+, to stay clear of seeded rows).
set local app.payments_write = 'on';
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (89001, 'DC89 Test Vendor', 'vendor-89001@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (89001, 'DC89 Test Property');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip)
  values (89001, 'card', 'DC89 Test Card', '75001');
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000089a1', 'dc89-a@example.test'),
  ('00000000-0000-4000-8000-0000000089a2', 'dc89-b@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (89101, 'Operator A', 'dc89-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000089a1'),
  (89102, 'Approver B', 'dc89-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000089a2');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
select g, 'pending_payment', 89001, 89001, 89101, 89001, 'DC89-' || g, 120.00, current_date + 7
from generate_series(89001, 89010) g;

-- Error of a statement as {sqlstate, message, detail}, or null if it succeeds.
create function pg_temp.sql_error(p_sql text) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  execute p_sql;
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;

-- Inserts a valid summary-complete pending row for a bill, with column overrides as jsonb.
create function pg_temp.insert_error(p_bill integer, p_over jsonb default '{}') returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number, account_reference,
    amount_cents, fees_cents, total_cents, currency, payment_date, summary_hash, policy_refs,
    outcome_code, outcome_message, transaction_reference, submitted_at, outcome_at, canceled_by, prepared_by)
  select r.bill_id, r.status, r.vendor_id, r.payment_method_id, r.invoice_number, r.account_reference,
    r.amount_cents, coalesce(r.fees_cents, 0), r.total_cents, r.currency, r.payment_date, r.summary_hash,
    coalesce(r.policy_refs, '[]'::jsonb), r.outcome_code, r.outcome_message, r.transaction_reference,
    r.submitted_at, r.outcome_at, r.canceled_by, r.prepared_by
  from jsonb_populate_record(null::public.payments, jsonb_build_object(
    'bill_id', p_bill, 'status', 'pending', 'vendor_id', 89001, 'payment_method_id', 89001,
    'invoice_number', 'DC89', 'amount_cents', 12000, 'fees_cents', 0, 'total_cents', 12000,
    'currency', 'USD', 'payment_date', '2026-11-16', 'summary_hash', 'h') || p_over) r;
  return null;
exception when others then
  get stacked diagnostics v_state = returned_sqlstate, v_message = message_text, v_detail = pg_exception_detail;
  return array[v_state, v_message, nullif(v_detail, '')];
end
$$;

-- Columns and types.
select col_type_is('payments', 'idempotency_key', 'text');
select col_type_is('payments', 'vendor_id', 'integer');
select col_type_is('payments', 'payment_method_id', 'integer');
select col_type_is('payments', 'invoice_number', 'text');
select col_type_is('payments', 'account_reference', 'text');
select col_type_is('payments', 'amount_cents', 'bigint');
select col_type_is('payments', 'fees_cents', 'bigint');
select col_type_is('payments', 'total_cents', 'bigint');
select col_type_is('payments', 'currency', 'character(3)');
select col_type_is('payments', 'payment_date', 'date');
select col_type_is('payments', 'summary_hash', 'text');
select col_type_is('payments', 'policy_refs', 'jsonb');
select col_type_is('payments', 'prepared_by', 'integer');
select col_type_is('payments', 'authorized_by', 'integer');
select col_type_is('payments', 'canceled_by', 'integer');
select col_type_is('payments', 'authorized_at', 'timestamp with time zone');
select col_type_is('payments', 'authorization_expires_at', 'timestamp with time zone');
select col_type_is('payments', 'submitted_at', 'timestamp with time zone');
select col_type_is('payments', 'outcome_at', 'timestamp with time zone');
select col_type_is('payments', 'outcome_code', 'text');
select col_type_is('payments', 'outcome_message', 'text');
select col_type_is('payments', 'transaction_reference', 'text');
select col_type_is('payments', 'updated_at', 'timestamp with time zone');
select col_has_default('payments', 'idempotency_key');
select col_default_is('payments', 'fees_cents', 0::bigint);
select col_default_is('payments', 'policy_refs', '[]'::jsonb);
select col_not_null('payments', 'idempotency_key');
select col_not_null('payments', 'fees_cents');
select col_not_null('payments', 'policy_refs');
select col_not_null('payments', 'updated_at');
select index_is_unique('public', 'payments', 'payments_idempotency_key_key', 'idempotency_key is unique (the #59 index)');
select col_is_fk('payments', 'vendor_id');
select col_is_fk('payments', 'payment_method_id');
select col_is_fk('payments', 'prepared_by');
select col_is_fk('payments', 'authorized_by');
select col_is_fk('payments', 'canceled_by');

-- Status check.
select is((pg_temp.insert_error(89001, '{"status":"maybe"}'))[1], '23514', 'status check refuses maybe');
select ok((select bool_and(pg_get_constraintdef(c.oid) like '%''' || s || '''%')
             from pg_constraint c, unnest(array['pending','authorized','processing','success','failure','unknown','canceled','expired']) s
            where c.conrelid = 'public.payments'::regclass and c.conname = 'payments_status_values'),
  'status check lists the 8 statuses');

-- Value checks (all 23514).
select is((pg_temp.insert_error(89001, '{"total_cents":12001}'))[1], '23514', 'total must equal amount plus fees');
select is((pg_temp.insert_error(89001, '{"currency":"EUR"}'))[1], '23514', 'currency is USD only');
select is((pg_temp.insert_error(89001, '{"amount_cents":0,"total_cents":0}'))[1], '23514', 'amount must be positive');
select is((pg_temp.insert_error(89001, '{"fees_cents":-1,"total_cents":11999}'))[1], '23514', 'fees can not be negative');
select is((pg_temp.insert_error(89001, '{"policy_refs":{}}'))[1], '23514', 'policy_refs must be an array');
select is((pg_temp.insert_error(89001, jsonb_build_object('account_reference', repeat('a', 101))))[1], '23514', 'account_reference max 100');
select is((pg_temp.insert_error(89001, jsonb_build_object('outcome_message', repeat('a', 501))))[1], '23514', 'outcome_message max 500');
select is((pg_temp.insert_error(89001, jsonb_build_object('transaction_reference', repeat('a', 256))))[1], '23514', 'transaction_reference max 255');
select is((pg_temp.insert_error(89001, '{"outcome_code":"nope"}'))[1], '23514', 'outcome_code is one of the known codes');
select is((pg_temp.insert_error(89001, '{"amount_cents":null,"total_cents":null,"prepared_by":89101}'))[1], '23514', 'a prepared row must be summary-complete');
select is((pg_temp.insert_error(89001, '{"vendor_id":null,"prepared_by":89101}'))[1], '23514', 'a prepared row with a NULL vendor is refused');
select is(pg_temp.insert_error(89007, '{"vendor_id":null,"payment_method_id":null,"invoice_number":null,"amount_cents":null,"total_cents":null,"currency":null,"payment_date":null,"summary_hash":null}'),
  null, 'a legacy-style row (prepared_by NULL) may have an empty summary');

-- One open-or-paid row per bill.
select is(pg_temp.insert_error(89001, '{"status":"processing","submitted_at":"2026-11-16T10:00:00Z"}'), null, 'processing row inserts');
select is((pg_temp.insert_error(89001))[1], '23505', 'second open row for the same bill is refused');
select is(pg_temp.insert_error(89002, '{"status":"failure","outcome_code":"portal_rejected","outcome_at":"2026-11-16T10:00:00Z"}'), null, 'failure row inserts');
select is(pg_temp.insert_error(89002), null, 'new pending row after a failure is allowed');

-- Legacy backfill: the seeded success payment (bill 6).
select ok(exists (
  select 1 from public.payments p join public.bills b on b.bill_id = p.bill_id
   where b.bill_id = 6 and p.status = 'success'
     and p.amount_cents = (b.amount * 100)::bigint and p.fees_cents = 0 and p.total_cents = p.amount_cents
     and p.currency = 'USD' and p.payment_date = p.created_at::date
     and p.vendor_id = b.vendor_id and p.payment_method_id = b.payment_method_id and p.invoice_number = b.invoice_number
     and p.summary_hash = public.payment_summary_hash(p) and p.prepared_by is null
), 'seeded success payment is backfilled from its bill');

-- Summary hash.
select ok(public.payment_summary_hash(jsonb_populate_record(null::public.payments,
    '{"bill_id":1,"amount_cents":12000,"fees_cents":0,"total_cents":12000}')) ~ '^[0-9a-f]{64}$',
  'hash is 64 lowercase hex');
select isnt(
  public.payment_summary_hash(jsonb_populate_record(null::public.payments,
    '{"bill_id":1,"amount_cents":12000,"fees_cents":0,"total_cents":12000}')),
  public.payment_summary_hash(jsonb_populate_record(null::public.payments,
    '{"bill_id":1,"amount_cents":12000,"fees_cents":5,"total_cents":12005}')),
  'hash changes when fees change');
select is(public.payment_summary(jsonb_populate_record(null::public.payments,
    '{"bill_id":1,"vendor_id":2,"invoice_number":"x","payment_method_id":3,"amount_cents":12000,"fees_cents":0,"total_cents":12000,"currency":"USD","payment_date":"2026-11-16"}')),
  '{"bill_id": 1, "currency": "USD", "vendor_id": 2, "fees_cents": 0, "total_cents": 12000, "amount_cents": 12000, "invoice_number": "x", "payment_date": "2026-11-16", "account_reference": null, "payment_method_id": 3}'::jsonb,
  'summary shape');

-- Privileges and policies.
select policies_are('public', 'payments', array['authenticated users can view payments']);
select table_privs_are('public', 'payments', 'anon', array[]::text[]);
select table_privs_are('public', 'payments', 'authenticated', array['SELECT']);
select table_privs_are('public', 'payments', 'service_role', array['SELECT']);
select sequence_privs_are('public', 'payments_payment_id_seq', 'anon', array[]::text[]);
select sequence_privs_are('public', 'payments_payment_id_seq', 'authenticated', array[]::text[]);
select sequence_privs_are('public', 'payments_payment_id_seq', 'service_role', array[]::text[]);

set local role anon;
select is((pg_temp.sql_error('select 1 from public.payments'))[1], '42501', 'anon can not read payments');
reset role;

set local role authenticated;
select lives_ok('select 1 from public.payments limit 1', 'authenticated can read payments');
select is((pg_temp.sql_error('insert into public.payments (bill_id, status) values (89005, ''pending'')'))[1], '42501', 'authenticated can not insert');
select is((pg_temp.sql_error('update public.payments set notes = ''x'''))[1], '42501', 'authenticated can not update');
select is((pg_temp.sql_error('delete from public.payments'))[1], '42501', 'authenticated can not delete');
reset role;

set local role service_role;
select is((pg_temp.sql_error('insert into public.payments (bill_id, status) values (89005, ''pending'')'))[1], '42501', 'service_role can not insert');
select is((pg_temp.sql_error('update public.payments set notes = ''x'''))[1], '42501', 'service_role can not update');
select is((pg_temp.sql_error('delete from public.payments'))[1], '42501', 'service_role can not delete');
select is((pg_temp.sql_error('truncate public.payments'))[1], '42501', 'service_role can not truncate');
reset role;

-- Guard trigger. A pending row for bill 89003 with an old updated_at.
select is(pg_temp.insert_error(89003, '{}'), null, 'guard fixture row');
-- Deliberate bypass (as postgres, marker on): with the updated_at trigger off, give the row an old
-- updated_at, so the legal update below can be seen to advance it.
set local app.payments_write = 'on';
alter table public.payments disable trigger payments_set_updated_at;
update public.payments set updated_at = '2020-01-01T00:00:00Z' where bill_id = 89003;
alter table public.payments enable trigger payments_set_updated_at;

set local app.payments_write = 'off';
select is(pg_temp.insert_error(89004), array['42501', 'payments_write_forbidden', null], 'insert without marker refused');
select is(pg_temp.sql_error('update public.payments set notes = ''x'' where bill_id = 89003'), array['42501', 'payments_write_forbidden', null], 'update without marker refused');
select is(pg_temp.sql_error('delete from public.payments where bill_id = 89003'), array['42501', 'payments_write_forbidden', null], 'delete without marker refused');
set local app.payments_write = 'on';
select is(pg_temp.sql_error('delete from public.payments where bill_id = 89003'), array['42501', 'payments_write_forbidden', null], 'delete refused even with marker');
select is(pg_temp.sql_error('update public.payments set status = ''success'' where bill_id = 89003'),
  array['P0001', 'illegal_payment_transition', 'pending → success'], 'pending to success is illegal');
select is(pg_temp.sql_error('update public.payments set fees_cents = 5, total_cents = 12005 where bill_id = 89003'),
  array['P0001', 'payment_summary_immutable', 'fees_cents'], 'summary columns are immutable');
select is(pg_temp.sql_error('update public.payments set status = ''canceled'' where bill_id = 89003'),
  array['P0001', 'payment_incomplete', 'canceled_by'], 'canceled needs canceled_by');
select is(pg_temp.sql_error('update public.payments set status = ''canceled'', canceled_by = 89101 where bill_id = 89003'), null, 'pending to canceled with canceled_by');
select ok((select updated_at = now() and updated_at <> '2020-01-01T00:00:00Z' from public.payments where bill_id = 89003), 'updated_at advances to now()');

-- A #59-era success row (bill 89006): written before the guard, without the outcome columns a
-- success now needs. Updates that keep its status (e.g. storing a receipt) still work; clearing
-- a column the status needs does not.
alter table public.payments disable trigger payments_guard;
insert into public.payments (bill_id, status, time_paid, idempotency_key) values (89006, 'success', now(), 'portal-89006');
alter table public.payments enable trigger payments_guard;
select is(pg_temp.sql_error('update public.payments set notes = ''receipt'' where bill_id = 89006'), null, 'a legacy success row without outcome columns can still be updated');
select is(pg_temp.sql_error('update public.payments set time_paid = null where bill_id = 89006'),
  array['P0001', 'payment_incomplete', 'time_paid'], 'an update that keeps the status can not clear a column it needs');

-- TRUNCATE is refused for every role, even with the marker on (cascade included).
select is(pg_temp.sql_error('truncate public.payments'), array['42501', 'payments_write_forbidden', null], 'truncate payments refused even with marker');
select is(pg_temp.sql_error('truncate public.bills cascade'), array['42501', 'payments_write_forbidden', null], 'truncate bills cascade refused');

select * from finish();
rollback;
