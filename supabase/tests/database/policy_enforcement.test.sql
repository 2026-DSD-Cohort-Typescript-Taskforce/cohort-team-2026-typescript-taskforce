-- DC-92: the vendor's active policy applied by submit_bill, prepare_payment,
-- start_payment_submission and send_bill_for_approval. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(114);

-- Setup (as postgres): one user per role (96101+) and a second financial approver (96105),
-- vendors 96001..96015, each with its own policy (policy_id = vendor_id, on, no version yet)
-- except 96009, which has none. Bills per section: submit 963xx, prepare 964xx, start 965xx,
-- send-back 966xx, review focus 967xx/968xx, the bill's own submitter approving 969xx.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000096a1', 'dc92e-a@example.test'),
  ('00000000-0000-4000-8000-0000000096a2', 'dc92e-b@example.test'),
  ('00000000-0000-4000-8000-0000000096a3', 'dc92e-c@example.test'),
  ('00000000-0000-4000-8000-0000000096a4', 'dc92e-d@example.test'),
  ('00000000-0000-4000-8000-0000000096a5', 'dc92e-e@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (96101, 'Operator A', 'dc92e-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000096a1'),
  (96102, 'Approver B', 'dc92e-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000096a2'),
  (96103, 'Admin C', 'dc92e-c@example.test', 'system_admin', '00000000-0000-4000-8000-0000000096a3'),
  (96104, 'Viewer D', 'dc92e-d@example.test', 'viewer', '00000000-0000-4000-8000-0000000096a4'),
  (96105, 'Approver O', 'dc92e-e@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000096a5');
insert into public.vendors (vendor_id, name, email, address, phone)
select g, 'DC92E Vendor ' || g, 'v' || g || '@example.test', g || ' Test Way', '555-0196'
  from generate_series(96001, 96015) g;
insert into public.properties (property_id, name) values (96001, 'DC92E P1'), (96002, 'DC92E P2');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip)
  values (96001, 'card', 'DC92E Card', '75001');
insert into public.policies (policy_id, vendor_id, name, description, is_active) overriding system value
select g, g, 'DC92E policy ' || g, 'Fixture.', true from generate_series(96001, 96015) g where g <> 96009;

insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
select b, s, v, 96001, 96101, 96001, 'DC92E-' || b, 120.00, current_date + 7
  from (values
    -- submit_bill
    (96301, 'draft', 96001), (96302, 'draft', 96001), (96303, 'draft', 96001), (96304, 'draft', 96001),
    (96305, 'draft', 96001), (96306, 'draft', 96009), (96307, 'draft', 96009), (96308, 'draft', 96001),
    -- prepare_payment
    (96401, 'pending_payment', 96002), (96402, 'payment_failed', 96002), (96403, 'pending_payment', 96002),
    (96404, 'pending_payment', 96002), (96405, 'pending_payment', 96002), (96406, 'pending_payment', 96009),
    (96407, 'pending_payment', 96002), (96408, 'pending_payment', 96002), (96409, 'pending_payment', 96002),
    -- start_payment_submission
    (96501, 'pending_payment', 96003), (96502, 'pending_payment', 96004), (96503, 'pending_payment', 96005),
    (96504, 'pending_payment', 96006), (96505, 'pending_payment', 96007), (96506, 'pending_payment', 96008),
    -- send_bill_for_approval
    (96601, 'pending_payment', 96010), (96602, 'pending_payment', 96010), (96603, 'draft', 96010),
    (96604, 'pending_payment', 96010), (96605, 'pending_payment', 96011), (96606, 'pending_payment', 96010),
    (96607, 'payment_failed', 96010), (96608, 'pending_payment', 96009),
    -- review focus 1 and 2
    (96701, 'pending_payment', 96012), (96801, 'pending_payment', 96013), (96802, 'pending_payment', 96013)
  ) t(b, s, v);
update public.bills set invoice_number = null where bill_id = 96302;
-- Created by approver O (bills.user_id = 96105).
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due)
values (96901, 'draft', 96014, 96001, 96105, 96001, 'DC92E-96901', 120.00, current_date + 7),
       (96902, 'draft', 96015, 96001, 96105, 96001, 'DC92E-96902', 120.00, current_date + 7);

-- Confirm a new version of a vendor's policy and turn the policy on (as postgres, as
-- confirm_policy_draft would). Returns the new version_id.
create function pg_temp.activate(p_vendor integer, p_rules text) returns integer
language plpgsql as $f$
declare
  v_ver integer;
  v_id integer;
begin
  select coalesce(max(version), 0) + 1 into v_ver from public.policy_versions where policy_id = p_vendor;
  insert into public.policy_versions (policy_id, vendor_id, version, rule, original_sentence, sentence,
    revised_sentence, interpretation, answers, draft_revision, confirmed_by)
  values (p_vendor, p_vendor, v_ver,
    ('{"schema_version":1,"vendor_id":' || p_vendor || ',"rules":' || p_rules || '}')::jsonb,
    'o', 's', 'r', 'Fixture reading ' || v_ver || '.', '[]', 1, 96102)
  returning version_id into v_id;
  update public.policies set active_version_id = v_id, is_active = true where policy_id = p_vendor;
  return v_id;
end
$f$;

-- A statement's error as {sqlstate, message, detail}, or null if it succeeds. Runs as the
-- current role.
create function pg_temp.err(p_sql text) returns text[]
language plpgsql as $f$
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
$f$;

-- The newest attempt of a bill.
create function pg_temp.pid(p_bill integer) returns integer
language sql as $f$ select max(payment_id) from public.payments where bill_id = p_bill $f$;

-- The policy_refs entry prepare_payment should store for a bill's vendor right now.
create function pg_temp.refs(p_vendor integer, p_decision text) returns jsonb
language sql as $f$
  select jsonb_build_array(jsonb_build_object('policy_id', p.policy_id, 'version_id', v.version_id,
    'version', v.version, 'decision', p_decision))
    from public.policies p join public.policy_versions v on v.version_id = p.active_version_id
   where p.policy_id = p_vendor
$f$;

grant execute on function pg_temp.err(text), pg_temp.pid(integer) to authenticated, service_role;

-- submit_bill ----------------------------------------------------------------------------

select pg_temp.activate(96001, '[{"effect":"block","when":{}}]');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a1","role":"authenticated"}';
select throws_ok($$select public.submit_bill(96301)$$, 'PT409', 'policy_blocked', 'submit under a block rule: policy_blocked');
select is((pg_temp.err($$select public.submit_bill(96301)$$))[3]::jsonb ->> 'policy_name', 'DC92E policy 96001',
  'policy_blocked details name the policy');
select is((pg_temp.err($$select public.submit_bill(96301)$$))[3]::jsonb ->> 'interpretation', 'Fixture reading 1.',
  'policy_blocked details carry the interpretation');
select is((pg_temp.err($$select public.submit_bill(96301)$$))[3]::jsonb ->> 'decision', 'block',
  'policy_blocked details are the evaluator answer');
select throws_ok($$select public.submit_bill(96301, true)$$, 'PT409', 'policy_blocked', 'a block rule wins over asking for approval');
select throws_ok($$select public.submit_bill(96302)$$, 'PT400', 'incomplete_bill', 'the completeness check comes before the policy');
reset role;
select is((select status from public.bills where bill_id = 96301), 'draft', 'a blocked bill stays a draft');
select is((select count(*)::int from public.approvals where bill_id = 96301), 0, 'a blocked submit opens no approval');

select pg_temp.activate(96001, '[{"effect":"require_approval","when":{}}]');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a1","role":"authenticated"}';
select is((select status from public.submit_bill(96303)), 'pending_approval',
  'require_approval with p_needs_approval false: pending_approval');
reset role;
select results_eq($$select status::text, submitted_by::int, approved_by::int from public.approvals where bill_id = 96303$$,
  $$values ('pending', 96101, null::int)$$, 'require_approval at submit: one pending approval, submitted by the caller');

select pg_temp.activate(96001, '[{"effect":"allow","when":{}}]');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a1","role":"authenticated"}';
select is((select status from public.submit_bill(96304, true)), 'pending_approval', 'allow keeps an approval the operator asked for');
select is((select status from public.submit_bill(96305)), 'pending_payment', 'allow without asking: pending_payment');
select is((select status from public.submit_bill(96306)), 'pending_payment', 'no policy: pending_payment');
select is((select status from public.submit_bill(96307, true)), 'pending_approval', 'no policy, asked for approval: pending_approval');
reset role;
select is((select count(*)::int from public.approvals where bill_id = 96304), 1, 'allow + asked: one approval row');
select is((select count(*)::int from public.approvals where bill_id in (96305, 96306)), 0, 'straight to payment: no approval row');

select pg_temp.activate(96001, '[{"effect":"block","when":{"amount_cents":{"gt":99999999}}}]');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a1","role":"authenticated"}';
select is((select status from public.submit_bill(96308)), 'pending_payment', 'a version with no matching rule: pending_payment');
reset role;

-- prepare_payment -----------------------------------------------------------------------

-- 96408 is prepared while vendor 96002's policy is on with no version (decision none).
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.prepare_payment(96408, 96101, 0, current_date)$$, 'policy on without a version: prepared');
reset role;
select is((select policy_refs from public.payments where bill_id = 96408), '[]'::jsonb, 'no version: policy_refs is empty');

select pg_temp.activate(96002, '[{"effect":"block","when":{}}]');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.prepare_payment(96401, 96101, 0, current_date)$$, 'PT409', 'policy_blocked',
  'pending_payment bill under a block rule: policy_blocked');
select throws_ok($$select public.prepare_payment(96402, 96101, 0, current_date)$$, 'PT409', 'policy_blocked',
  'payment_failed bill retried under a block rule: policy_blocked');
select is((pg_temp.err($$select public.prepare_payment(96401, 96101, 0, current_date)$$))[3]::jsonb ->> 'policy_name',
  'DC92E policy 96002', 'policy_blocked details name the policy');
select throws_ok($$select public.prepare_payment(96408, 96101, 0, current_date)$$, 'PT409', 'policy_blocked',
  'preparing again under a block rule: policy_blocked');
select throws_ok($$select public.prepare_payment(96402, 96104, 0, current_date)$$, 'PT403', 'forbidden',
  'the preparer check still comes first');
reset role;
select is((select count(*)::int from public.payments where bill_id in (96401, 96402)), 0, 'blocked: no payments row');
select results_eq($$select status::text from public.payments where bill_id = 96408$$, $$values ('pending')$$,
  'a refused preparation leaves the earlier attempt pending');
select is((select status from public.bills where bill_id = 96402), 'payment_failed', 'a refused retry leaves the bill payment_failed');

select pg_temp.activate(96002, '[{"effect":"require_approval","when":{}}]');
insert into public.approvals (bill_id, submitted_by, approved_by, status) values
  (96404, 96101, 96102, 'approved'),
  (96405, 96101, 96101, 'approved');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.prepare_payment(96403, 96101, 0, current_date)$$, 'PT409', 'approval_required',
  'require_approval without an approval: approval_required');
select is((pg_temp.err($$select public.prepare_payment(96403, 96101, 0, current_date)$$))[3]::jsonb ->> 'decision',
  'require_approval', 'approval_required details are the evaluator answer');
select throws_ok($$select public.prepare_payment(96405, 96101, 0, current_date)$$, 'PT409', 'approval_required',
  'a self-approval does not count');
select lives_ok($$select public.prepare_payment(96404, 96101, 0, current_date)$$, 'require_approval with a qualifying approval: prepared');
reset role;
select is((select count(*)::int from public.payments where bill_id in (96403, 96405)), 0, 'approval_required: no payments row');
select is((select policy_refs from public.payments where bill_id = 96404), pg_temp.refs(96002, 'require_approval'),
  'policy_refs records the policy, version and decision');
select is((select jsonb_array_length(policy_refs) from public.payments where bill_id = 96404), 1, 'policy_refs has one entry');
select is((select policy_refs -> 0 ->> 'version' from public.payments where bill_id = 96404), '2', 'policy_refs records the version number');

select pg_temp.activate(96002, '[{"effect":"allow","when":{}}]');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.prepare_payment(96407, 96101, 0, current_date, null, '[7]')$$, 'allow: prepared');
select lives_ok($$select public.prepare_payment(96406, 96101, 0, current_date, p_policy_refs => '[7]')$$, 'no policy: prepared');
select throws_ok($$select public.prepare_payment(96409, 96101, 0, current_date, null, '{}')$$, 'PT400', 'invalid_payment',
  'p_policy_refs is still checked to be an array');
reset role;
select is((select policy_refs from public.payments where bill_id = 96407), pg_temp.refs(96002, 'allow'),
  'allow: policy_refs records the decision, not the passed refs');
select is((select policy_refs from public.payments where bill_id = 96406), '[]'::jsonb, 'no policy: policy_refs is empty, not the passed refs');

-- start_payment_submission --------------------------------------------------------------

-- Prepared and authorized under allow (96501..96504), no version (96505), and a version
-- whose require_approval rule does not match yet (96506).
select pg_temp.activate(v, '[{"effect":"allow","when":{}}]') from generate_series(96003, 96006) v;
select pg_temp.activate(96008, '[{"effect":"require_approval","when":{"property_ids":[96002]}}]');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.prepare_payment(b, 96101, 0, current_date) from generate_series(96501, 96506) b;
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a1","role":"authenticated"}';
select public.authorize_payment(payment_id, public.payment_summary(p))
  from public.payments p where bill_id between 96501 and 96506 and status = 'pending';
reset role;
select is((select count(*)::int from public.payments where bill_id between 96501 and 96506 and status = 'authorized'), 6,
  'six attempts authorized');
select is((select policy_refs -> 0 ->> 'decision' from public.payments where bill_id = 96506), 'none',
  'a version with no matching rule is still recorded');

-- What changes after authorization (as postgres).
select pg_temp.activate(96003, '[{"effect":"block","when":{}}]');
select pg_temp.activate(96004, '[{"effect":"allow","when":{}}]');
update public.policies set is_active = false where policy_id = 96005;
select pg_temp.activate(96007, '[{"effect":"allow","when":{}}]');
update public.bills set property_id = 96002 where bill_id = 96506;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok(format('select public.start_payment_submission(%s)', pg_temp.pid(96501)), 'PT409', 'policy_blocked',
  'a block version confirmed after authorization: policy_blocked');
select throws_ok(format('select public.start_payment_submission(%s)', pg_temp.pid(96502)), 'PT409', 'policy_changed',
  'a new allow version after authorization: policy_changed');
select is((pg_temp.err(format('select public.start_payment_submission(%s)', pg_temp.pid(96502))))[3]::jsonb ->> 'version',
  '2', 'policy_changed details are the evaluator answer for the new version');
select throws_ok(format('select public.start_payment_submission(%s)', pg_temp.pid(96503)), 'PT409', 'policy_changed',
  'policy switched off after authorization: policy_changed');
select throws_ok(format('select public.start_payment_submission(%s)', pg_temp.pid(96505)), 'PT409', 'policy_changed',
  'a policy version appearing after authorization: policy_changed');
select throws_ok(format('select public.start_payment_submission(%s)', pg_temp.pid(96506)), 'PT409', 'approval_required',
  'same version, now require_approval without a qualifying approval: approval_required');
select lives_ok(format('select public.start_payment_submission(%s)', pg_temp.pid(96504)), 'unchanged version: claimed');
reset role;
select results_eq(
  $$select bill_id, status::text from public.payments where bill_id between 96501 and 96506 order by bill_id$$,
  $$values (96501, 'authorized'), (96502, 'authorized'), (96503, 'authorized'), (96504, 'processing'),
    (96505, 'authorized'), (96506, 'authorized')$$,
  'refused claims leave the attempt authorized; the unchanged one is processing');
select results_eq(
  $$select bill_id, status::text from public.bills where bill_id in (96501, 96504) order by bill_id$$,
  $$values (96501, 'pending_payment'), (96504, 'processing')$$,
  'a refused claim leaves the bill pending_payment');

-- send_bill_for_approval ----------------------------------------------------------------

-- 96601 gets an authorized attempt before its vendor has a version; 96604 a processing one,
-- built directly (marker on).
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select public.prepare_payment(96601, 96101, 0, current_date);
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a1","role":"authenticated"}';
select public.authorize_payment(payment_id, public.payment_summary(p)) from public.payments p where bill_id = 96601;
reset role;
set local app.payments_write = 'on';
insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number, amount_cents, fees_cents,
  total_cents, currency, payment_date, summary_hash, prepared_by, authorized_by, authorized_at, authorization_expires_at, submitted_at)
values (96604, 'processing', 96010, 96001, 'DC92E-96604', 12000, 0, 12000, 'USD', current_date, 'h', 96101, 96101, now(),
  now() + interval '15 minutes', now());
reset app.payments_write;
select pg_temp.activate(96010, '[{"effect":"require_approval","when":{}}]');
select pg_temp.activate(96011, '[{"effect":"allow","when":{}}]');
insert into public.approvals (bill_id, submitted_by, approved_by, status) values (96606, 96101, 96102, 'approved');
create temp table expect_96601 as select public.evaluate_bill_policy(96601) as r;
grant select on expect_96601 to service_role;

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select is(public.send_bill_for_approval(96601, 96103), (select r from expect_96601),
  'send-back returns the evaluator answer');
select is(public.send_bill_for_approval(96607, 96101) ->> 'decision', 'require_approval', 'a payment_failed bill can be sent back');
reset role;
select is((select status from public.bills where bill_id = 96601), 'pending_approval', 'send-back: bill is pending_approval');
select results_eq($$select status::text, submitted_by::int, approved_by::int from public.approvals where bill_id = 96601$$,
  $$values ('pending', 96103, null::int)$$, 'send-back: one pending approval, submitted by the requester');
select results_eq($$select status::text, outcome_code from public.payments where bill_id = 96601$$,
  $$values ('expired', 'superseded')$$, 'send-back: the authorized attempt is expired as superseded');
select isnt((select outcome_at from public.payments where bill_id = 96601), null, 'send-back: the expiry has an outcome time');
select is((select status from public.bills where bill_id = 96607), 'pending_approval', 'payment_failed bill sent back: pending_approval');
select is((select count(*)::int from public.audit_logs where name = 'payment_superseded' and description like '%(bill 96601)%'), 0,
  'send-back writes no hand-written audit row');
select is((select count(*)::int from public.audit_logs where entity_type = 'payment' and entity_id = pg_temp.pid(96601)
    and name = 'payment_updated' and details -> 'new' ->> 'status' = 'expired'), 1,
  'the row trigger logs the expiry');

set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.send_bill_for_approval(96602, 96104)$$, 'PT403', 'forbidden', 'viewer requester: forbidden');
select throws_ok($$select public.send_bill_for_approval(96602, 99999999)$$, 'PT403', 'forbidden', 'unknown requester: forbidden');
select throws_ok($$select public.send_bill_for_approval(96602, null)$$, 'PT403', 'forbidden', 'NULL requester: forbidden');
select throws_ok($$select public.send_bill_for_approval(99999999, 96103)$$, 'PT404', 'not_found', 'no such bill: not_found');
select is(pg_temp.err($$select public.send_bill_for_approval(96603, 96103)$$), ARRAY['PT409', 'not_payable', 'draft'],
  'draft bill: not_payable with the status');
select is(pg_temp.err($$select public.send_bill_for_approval(96601, 96103)$$), ARRAY['PT409', 'not_payable', 'pending_approval'],
  'a bill already sent back: not_payable');
select is(pg_temp.err($$select public.send_bill_for_approval(96604, 96103)$$),
  ARRAY['PT409', 'payment_in_progress', pg_temp.pid(96604)::text], 'processing attempt: payment_in_progress with its id');
select throws_ok($$select public.send_bill_for_approval(96605, 96103)$$, 'PT409', 'approval_not_required', 'allow policy: approval_not_required');
select is((pg_temp.err($$select public.send_bill_for_approval(96605, 96103)$$))[3]::jsonb ->> 'decision', 'allow',
  'approval_not_required details are the evaluator answer');
select throws_ok($$select public.send_bill_for_approval(96606, 96103)$$, 'PT409', 'approval_not_required',
  'a qualifying approval is present: approval_not_required');
select throws_ok($$select public.send_bill_for_approval(96608, 96103)$$, 'PT409', 'approval_not_required', 'no policy: approval_not_required');
reset role;
select results_eq($$select bill_id, status::text from public.bills where bill_id in (96602, 96604, 96605, 96606, 96608) order by bill_id$$,
  $$values (96602, 'pending_payment'), (96604, 'pending_payment'), (96605, 'pending_payment'), (96606, 'pending_payment'),
    (96608, 'pending_payment')$$, 'refused send-backs leave the bill as it was');
select is((select count(*)::int from public.approvals where bill_id in (96602, 96604, 96605, 96608)), 0, 'refused send-backs open no approval');
select is((select status from public.payments where bill_id = 96604), 'processing', 'refused send-back leaves the processing attempt');

-- Review focus 1: the admin who sent the bill back approves it themselves ----------------

select pg_temp.activate(96012, '[{"effect":"require_approval","when":{}}]');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.send_bill_for_approval(96701, 96103)$$, 'admin C sends the bill back for approval');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a3","role":"authenticated"}';
select lives_ok($$select public.decide_bill(96701, 'approved')$$, 'admin C approves the bill they sent back');
reset role;
select is((select status from public.bills where bill_id = 96701), 'pending_payment', 'self-approved bill is pending_payment');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.prepare_payment(96701, 96103, 0, current_date)$$, 'PT409', 'approval_required',
  'payment is still refused after a self-approval');
select lives_ok($$select public.send_bill_for_approval(96701, 96103)$$, 'the self-approved bill is sent back again');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a2","role":"authenticated"}';
select lives_ok($$select public.decide_bill(96701, 'approved')$$, 'approver B approves');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.prepare_payment(96701, 96103, 0, current_date)$$, 'after B approves, payment is prepared');
reset role;
select is((select policy_refs from public.payments where bill_id = 96701), pg_temp.refs(96012, 'require_approval'),
  'the attempt records the require_approval version');

-- Review focus 2: the policy is switched off while the bill waits for approval ------------

select pg_temp.activate(96013, '[{"effect":"require_approval","when":{}}]');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.send_bill_for_approval(96801, 96103)$$, 'bill 96801 sent back');
select lives_ok($$select public.send_bill_for_approval(96802, 96103)$$, 'bill 96802 sent back');
reset role;
update public.policies set is_active = false where policy_id = 96013;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a2","role":"authenticated"}';
select lives_ok($$select public.decide_bill(96801, 'approved')$$, 'approver B approves 96801');
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a3","role":"authenticated"}';
select lives_ok($$select public.decide_bill(96802, 'approved')$$, 'admin C approves 96802 themselves');
reset role;
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.prepare_payment(96801, 96103, 0, current_date)$$, 'policy off: payment prepared');
select lives_ok($$select public.prepare_payment(96802, 96103, 0, current_date)$$, 'policy off: even a self-approved bill is prepared');
reset role;
select is((select policy_refs from public.payments where bill_id = 96801), '[]'::jsonb, 'policy off: policy_refs is empty');
select is((select policy_refs from public.payments where bill_id = 96802), '[]'::jsonb, 'policy off: policy_refs is empty (self-approved)');

-- Review focus 3: the bill's own submitter approves it --------------------------------------

-- O submits 96901 straight to payment before its vendor's policy has a version. After C's
-- send-back the approval row's submitter is C, so only bills.user_id shows it is O's bill.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a5","role":"authenticated"}';
select is((select status from public.submit_bill(96901)), 'pending_payment', 'approver O submits their bill straight to payment');
reset role;
select pg_temp.activate(96014, '[{"effect":"require_approval","when":{}}]');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.send_bill_for_approval(96901, 96103)$$, 'admin C sends 96901 back for approval');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a5","role":"authenticated"}';
select lives_ok($$select public.decide_bill(96901, 'approved')$$, 'O approves the bill they submitted');
reset role;
select is(public.bill_has_qualifying_approval(96901), false, 'an approval by the bill''s own submitter does not count');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.prepare_payment(96901, 96103, 0, current_date)$$, 'PT409', 'approval_required',
  'payment is refused after the submitter approves their own bill');
select lives_ok($$select public.send_bill_for_approval(96901, 96103)$$, 'the bill O approved is sent back again');
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a2","role":"authenticated"}';
select lives_ok($$select public.decide_bill(96901, 'approved')$$, 'approver B approves 96901');
reset role;
select is(public.bill_has_qualifying_approval(96901), true, 'an approval by someone who never submitted the bill counts');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select lives_ok($$select public.prepare_payment(96901, 96103, 0, current_date)$$, 'after B approves, 96901 is prepared');
reset role;

-- O submits 96902 under require_approval and approves it themselves.
select pg_temp.activate(96015, '[{"effect":"require_approval","when":{}}]');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000096a5","role":"authenticated"}';
select is((select status from public.submit_bill(96902)), 'pending_approval', 'O submits 96902 under require_approval');
select lives_ok($$select public.decide_bill(96902, 'approved')$$, 'O approves their own submission');
reset role;
select is(public.bill_has_qualifying_approval(96902), false, 'approving your own submission does not count');
set local role service_role;
set local request.jwt.claims = '{"role":"service_role"}';
select throws_ok($$select public.prepare_payment(96902, 96105, 0, current_date)$$, 'PT409', 'approval_required',
  'payment is refused after O approves their own submission');
reset role;

-- Signature, security, grants ------------------------------------------------------------

select function_returns('public', 'send_bill_for_approval', ARRAY['integer', 'integer'], 'jsonb',
  'send_bill_for_approval(integer, integer) returns jsonb');
select is((select prosecdef from pg_proc where oid = to_regprocedure('public.send_bill_for_approval(integer, integer)')), true,
  'send_bill_for_approval is security definer');
select is((select proconfig from pg_proc where oid = to_regprocedure('public.send_bill_for_approval(integer, integer)')),
  ARRAY['search_path=""'], 'send_bill_for_approval has an empty search_path');
select ok(not has_function_privilege('authenticated', 'public.send_bill_for_approval(integer, integer)', 'execute'),
  'authenticated cannot execute send_bill_for_approval');
select ok(not has_function_privilege('anon', 'public.send_bill_for_approval(integer, integer)', 'execute'),
  'anon cannot execute send_bill_for_approval');
select ok(not has_function_privilege('public', 'public.send_bill_for_approval(integer, integer)', 'execute'),
  'PUBLIC cannot execute send_bill_for_approval');
select ok(has_function_privilege('service_role', 'public.send_bill_for_approval(integer, integer)', 'execute'),
  'service_role can execute send_bill_for_approval');
select ok(has_function_privilege('authenticated', 'public.submit_bill(integer, boolean)', 'execute'),
  'authenticated can still execute submit_bill');
select ok(not has_function_privilege('anon', 'public.submit_bill(integer, boolean)', 'execute'),
  'anon still cannot execute submit_bill');
select ok(has_function_privilege('service_role', 'public.prepare_payment(integer, integer, bigint, date, text, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.prepare_payment(integer, integer, bigint, date, text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.prepare_payment(integer, integer, bigint, date, text, jsonb)', 'execute'),
  'prepare_payment is still service_role only');
select ok(has_function_privilege('service_role', 'public.start_payment_submission(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.start_payment_submission(integer)', 'execute')
  and not has_function_privilege('anon', 'public.start_payment_submission(integer)', 'execute'),
  'start_payment_submission is still service_role only');

select * from finish();
rollback;
