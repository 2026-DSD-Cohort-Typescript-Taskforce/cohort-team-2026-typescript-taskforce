-- DC-81: decide_bill() and the approver-only approvals writes. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

-- Setup (as postgres): login A is a billing operator, B a financial approver, C has no
-- profile. One vendor, property and payment method, and one bill per case (ids 81001+,
-- users 81101+, to stay clear of seeded rows).
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000081a1', 'dc81-a@example.test'),
  ('00000000-0000-4000-8000-0000000081a2', 'dc81-b@example.test'),
  ('00000000-0000-4000-8000-0000000081a3', 'dc81-c@example.test');
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (81001, 'DC81 Test Vendor', 'vendor-81001@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (81001, 'DC81 Test Property');
insert into public.payment_methods (payment_id, payment_type, name, billing_zip)
  values (81001, 'card', 'DC81 Test Card', '75001');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (81101, 'Operator A', 'dc81-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000081a1'),
  (81102, 'Approver B', 'dc81-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000081a2');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_id, invoice_number, amount, date_due) values
  (81001, 'pending_approval', 81001, 81001, 81101, 81001, 'DC81-01', 120.00, current_date + 7),  -- approve, one pending row
  (81002, 'pending_approval', 81001, 81001, 81101, 81001, 'DC81-02', 120.00, current_date + 7),  -- needs revision, no approvals row
  (81003, 'pending_approval', 81001, 81001, 81101, 81001, 'DC81-03', 120.00, current_date + 7),  -- denied
  (81004, 'pending_approval', 81001, 81001, 81101, 81001, 'DC81-04', 120.00, current_date + 7),  -- two pending rows
  (81005, 'draft',            81001, 81001, 81101, 81001, 'DC81-05', 120.00, current_date + 7),  -- not pending approval
  (81006, 'pending_approval', 81001, 81001, 81101, 81001, 'DC81-06', 120.00, current_date + 7);  -- refused calls
insert into public.approvals (approval_id, bill_id, submitted_by, status, created_at, notes) values
  (81001, 81001, 81101, 'pending', now() - interval '1 day', 'Submitted for approval'),
  (81004, 81004, 81101, 'pending', now() - interval '2 days', 'older'),
  (81005, 81004, 81101, 'pending', now() - interval '1 day', 'newer');

-- decide_bill's error as {sqlstate, message, detail}, or null if it succeeds.
create function pg_temp.decide_error(p_bill_id integer, p_decision text, p_note text) returns text[]
language plpgsql as $$
declare
  v_state text;
  v_message text;
  v_detail text;
begin
  perform public.decide_bill(p_bill_id, p_decision, p_note);
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
select has_function('public', 'decide_bill', ARRAY['integer', 'text', 'text'], 'decide_bill(integer, text, text) exists');
select function_returns('public', 'decide_bill', ARRAY['integer', 'text', 'text'], 'bills', 'it returns the bill row');
select is_definer('public', 'decide_bill', ARRAY['integer', 'text', 'text'], 'it is security definer, so it can move a bill and write approvals and audit_logs');
select is(
  (select proconfig from pg_proc where oid = to_regprocedure('public.decide_bill(integer, text, text)')),
  ARRAY['search_path=""'],
  'it pins search_path to empty'
);
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.decide_bill(integer, text, text)')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0,
  'public has no EXECUTE on decide_bill()'
);
select function_privs_are('public', 'decide_bill', ARRAY['integer', 'text', 'text'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on decide_bill()');
select function_privs_are('public', 'decide_bill', ARRAY['integer', 'text', 'text'], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE decide_bill()');
select policies_are('public', 'approvals', ARRAY['authenticated users can view approvals'],
  'approvals keeps only the read policy: no policy lets a signed-in user write');
select lives_ok(
  $$insert into public.approvals (bill_id, submitted_by, status) values (81005, 81101, 'needs_revision')$$,
  'the approvals status check allows needs_revision'
);
select throws_ok(
  $$insert into public.approvals (bill_id, submitted_by, status) values (81005, 81101, 'maybe')$$,
  '23514', null,
  'the approvals status check still refuses other values'
);

-- Refused calls must leave these untouched. 81005 gets the needs_revision row above, so
-- the snapshot is taken after it.
create temp table bills_before as select * from public.bills where bill_id between 81001 and 81006;
create temp table approvals_before as select * from public.approvals where bill_id between 81001 and 81006;

-- anon can't call it
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select public.decide_bill(81006, 'approved')$$, '42501', null, 'anon cannot call decide_bill()');
reset role;

-- Not a financial approver
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a1","role":"authenticated"}';
select is(pg_temp.decide_error(81006, 'approved', null), ARRAY['PT403', 'forbidden', null], 'a billing operator gets forbidden');
select is(pg_temp.decide_error(81006, 'maybe', null), ARRAY['PT403', 'forbidden', null], 'forbidden is checked before the inputs');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a3","role":"authenticated"}';
select is(pg_temp.decide_error(81006, 'approved', null), ARRAY['PT403', 'forbidden', null], 'a login with no profile gets forbidden');

-- As approver B: refused cases
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a2","role":"authenticated"}';
select throws_ok($$select public.decide_bill(81999, 'approved')$$, 'PT404', 'not_found', 'refusals are raised as errors with the PostgREST status SQLSTATE');
select is(pg_temp.decide_error(81999, 'approved', null), ARRAY['PT404', 'not_found', null], 'an unknown bill gets not_found');
select is(pg_temp.decide_error(81005, 'approved', null), ARRAY['PT409', 'not_pending_approval', 'draft'], 'a bill that is not pending approval gets its current status');
select is(pg_temp.decide_error(81006, 'maybe', null), ARRAY['PT400', 'invalid_decision', '["decision"]'], 'an unknown decision is invalid_decision');
select is(pg_temp.decide_error(81006, null, null), ARRAY['PT400', 'invalid_decision', '["decision"]'], 'a NULL decision is invalid_decision');
select is(pg_temp.decide_error(81006, 'approved', repeat('x', 501)), ARRAY['PT400', 'invalid_decision', '["note"]'], 'a 501-character note is invalid_decision');
select is(pg_temp.decide_error(81006, 'maybe', repeat('x', 501)), ARRAY['PT400', 'invalid_decision', '["decision","note"]'], 'both bad: details list decision then note');
select is(pg_temp.decide_error(81999, 'maybe', null), ARRAY['PT400', 'invalid_decision', '["decision"]'], 'invalid input is checked before the bill is looked up');
reset role;

select results_eq(
  $$select * from public.bills where bill_id between 81001 and 81006 order by bill_id$$,
  $$select * from bills_before order by bill_id$$,
  'refused calls change no bill'
);
select results_eq(
  $$select * from public.approvals where bill_id between 81001 and 81006 order by approval_id$$,
  $$select * from approvals_before order by approval_id$$,
  'refused calls change no approvals row'
);
-- Rows written in this transaction have created_at = now(); seeded rows don't.
select is((select count(*)::int from public.audit_logs where created_at = now()), 0, 'refused calls write no audit row');

-- As approver B: approve a bill with one pending row. Times are cast to timestamptz so
-- these pass whether the columns are timestamp or timestamptz.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a2","role":"authenticated"}';
select results_eq(
  $$select bill_id, status::text, updated_at::timestamptz from public.decide_bill(81001, 'approved', '  ok  ')$$,
  $$values (81001, 'pending_payment', now())$$,
  'approve returns the bill as pending_payment with updated_at = now'
);
select is(pg_temp.decide_error(81001, 'approved', null), ARRAY['PT409', 'not_pending_approval', 'pending_payment'], 'deciding it again gets not_pending_approval');
reset role;

select results_eq(
  $$select approval_id, status::text, approved_by, time_approved::timestamptz, notes from public.approvals where bill_id = 81001$$,
  $$values (81001, 'approved', 81102, now(), 'ok')$$,
  'the pending row became approved by B, at now, with the trimmed note'
);
select results_eq(
  $$select name, description, created_at::timestamptz from public.audit_logs where created_at = now()$$,
  $$values ('bill_approved', 'bill 81001: pending_approval → pending_payment, by user 81102', now())$$,
  'exactly one audit row: bill_approved, naming this bill and B''s profile'
);

-- Needs revision on a bill with no approvals row, blank note
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a2","role":"authenticated"}';
select results_eq(
  $$select status::text, updated_at::timestamptz from public.decide_bill(81002, 'needs_revision', '   ')$$,
  $$values ('draft', now())$$,
  'needs_revision sends the bill back to draft'
);
reset role;

select results_eq(
  $$select submitted_by, approved_by, status::text, time_approved::timestamptz, notes from public.approvals where bill_id = 81002$$,
  $$values (81101, 81102, 'needs_revision', now(), null::text)$$,
  'with no approvals row, one is inserted: submitted by the bill''s user, decided by B, blank note stored as NULL'
);
select is(
  (select count(*)::int from public.audit_logs where name = 'bill_needs_revision' and created_at = now()
     and description = 'bill 81002: pending_approval → draft, by user 81102'),
  1,
  'one bill_needs_revision audit row'
);

-- Denied with a 500-emoji note (500 characters, more than 500 bytes)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a2","role":"authenticated"}';
select is(
  (select status::text from public.decide_bill(81003, 'denied', repeat('😀', 500))),
  'approval_denied',
  'denied moves the bill to approval_denied; a 500-character emoji note is accepted'
);
reset role;

select results_eq(
  $$select status::text, char_length(notes) from public.approvals where bill_id = 81003$$,
  $$values ('rejected', 500)$$,
  'the approvals row is rejected and keeps all 500 characters'
);
select is(
  (select count(*)::int from public.audit_logs where name = 'bill_denied' and created_at = now()
     and description = 'bill 81003: pending_approval → approval_denied, by user 81102'),
  1,
  'one bill_denied audit row'
);

-- Two pending rows: only the newer one is decided
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a2","role":"authenticated"}';
select is((select status::text from public.decide_bill(81004, 'approved', null)), 'pending_payment', 'approve a bill with two pending rows');
reset role;

select results_eq(
  $$select approval_id, status::text from public.approvals where bill_id = 81004 order by approval_id$$,
  $$values (81004, 'pending'), (81005, 'approved')$$,
  'only the newer pending row became approved'
);
select is((select count(*)::int from public.audit_logs where created_at = now()), 4, 'four decisions wrote exactly four audit rows');

-- Direct approvals writes are closed to signed-in users
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a1","role":"authenticated"}';
select throws_ok(
  $$insert into public.approvals (bill_id, submitted_by, status) values (81006, 81101, 'approved')$$,
  '42501', null,
  'an operator can''t insert an approvals row directly'
);
select is(pg_temp.rows_changed($$update public.approvals set status = 'approved' where bill_id = 81004$$), 0, 'an operator can''t update approvals rows (0 rows)');
select cmp_ok(pg_temp.rows_changed($$select * from public.approvals$$), '>', 0, 'an operator can still read approvals');
reset role;

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081a2","role":"authenticated"}';
select throws_ok(
  $$insert into public.approvals (bill_id, submitted_by, status) values (81006, 81101, 'approved')$$,
  '42501', null,
  'an approver can''t insert an approvals row directly either'
);
reset role;

select is((select status::text from public.approvals where approval_id = 81004), 'pending', 'direct update attempts left the older row pending');
select is((select status::text from public.bills where bill_id = 81006), 'pending_approval', 'the untouched bill is still pending_approval');

select * from finish();
rollback;
