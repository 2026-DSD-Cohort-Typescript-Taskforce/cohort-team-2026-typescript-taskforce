-- DC-92: evaluate_bill_policy and bill_has_qualifying_approval. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(84);

insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000092a1', 'dc92-a@example.test'),
  ('00000000-0000-4000-8000-0000000092a2', 'dc92-b@example.test'),
  ('00000000-0000-4000-8000-0000000092a3', 'dc92-c@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (92101, 'Submitter', 'dc92-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000092a1'),
  (92102, 'Approver', 'dc92-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000092a2'),
  (92103, 'Admin', 'dc92-c@example.test', 'system_admin', '00000000-0000-4000-8000-0000000092a3');
insert into public.vendors (vendor_id, name, email, address, phone) values
  (92001, 'DC92 Vendor', 'v1@example.test', '1 Test Way', '555-0192'),
  (92002, 'DC92 Other Vendor', 'v2@example.test', '2 Test Way', '555-0193'),
  (92003, 'DC92 Bare Vendor', 'v3@example.test', '3 Test Way', '555-0194');
insert into public.properties (property_id, name) values (92011, 'DC92 P1'), (92012, 'DC92 P2');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip) values
  (92021, 'card', 'DC92 Card', '75001'), (92022, 'bank', 'DC92 Bank', '75001');

-- Bills (drafts, so nulls are allowed). 92301.. on vendor 92001, 92399 on vendor 92003 (no policy).
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, amount) values
  (92301, 'draft', 92001, 92011, 92101, 92021, 500.00),
  (92302, 'draft', 92001, 92011, 92101, 92021, 500.01),
  (92303, 'draft', 92001, 92012, 92101, 92021, 100.00),
  (92304, 'draft', 92001, 92011, 92101, 92022, 100.00),
  (92305, 'draft', 92001, 92011, 92101, 92021, null),
  (92306, 'draft', 92001, 92011, 92101, null, 100.00),
  (92307, 'draft', 92001, null, 92101, 92021, 100.00),
  (92399, 'draft', 92003, 92011, 92101, 92021, 100.00);

insert into public.policies (policy_id, vendor_id, name, description, is_active) overriding system value values
  (92001, 92001, 'DC92 policy', 'Fixture.', true),
  (92002, 92002, 'DC92 other policy', 'Fixture.', true);
create function pg_temp.activate(p_rules text) returns jsonb language plpgsql as $f$
declare v_ver integer;
begin
  select coalesce(max(version), 0) + 1 into v_ver from public.policy_versions where policy_id = 92001;
  insert into public.policy_versions (policy_id, vendor_id, version, rule, original_sentence, sentence, revised_sentence, interpretation, answers, draft_revision, confirmed_by)
    values (92001, 92001, v_ver, ('{"schema_version":1,"vendor_id":92001,"rules":' || p_rules || '}')::jsonb, 'o', 's', 'r', 'Fixture reading.', '[]', 1, 92102);
  update public.policies set active_version_id = (select version_id from public.policy_versions where policy_id = 92001 and version = v_ver), is_active = true where policy_id = 92001;
  return null;
end $f$;
-- other vendor's version, for the foreign-version case
insert into public.policy_versions (version_id, policy_id, vendor_id, version, rule, original_sentence, sentence, revised_sentence, interpretation, answers, draft_revision, confirmed_by) overriding system value values
  (92900, 92002, 92002, 1, '{"schema_version":1,"vendor_id":92002,"rules":[{"effect":"allow","when":{}}]}', 'o', 's', 'r', 'Other.', '[]', 1, 92102);
select throws_ok($$select public.evaluate_bill_policy(99999999)$$, 'PT404', 'not_found', 'no bill raises not_found');
select is(public.evaluate_bill_policy(92301), jsonb_build_object('decision','none','policy_id',null,'version_id',null,'version',null,'rule_index',null,'policy_name',null,'interpretation',null), 'no policy: none, other keys null');
select is(public.evaluate_bill_policy(92399) ->> 'decision', 'none', 'vendor without policy: none');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'none', 'policy on without a version: none');
select is(public.evaluate_bill_policy(92301) -> 'policy_id', 'null'::jsonb, 'policy on without a version: policy_id null');
select pg_temp.activate('[{"effect":"block","when":{}}]');
update public.policies set is_active = false where policy_id = 92001;
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'none', 'policy off: none');
select is(public.evaluate_bill_policy(92301) -> 'version_id', 'null'::jsonb, 'policy off: other keys null');
update public.policies set is_active = true where policy_id = 92001;
select pg_temp.activate('[{"effect":"block","when":{"amount_cents":{"gt":50000}}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'none', 'gt: 500.00 no match');
select is(public.evaluate_bill_policy(92301) ->> 'policy_name', 'DC92 policy', 'no match still names the policy');
select is(public.evaluate_bill_policy(92301) ->> 'interpretation', 'Fixture reading.', 'no match still carries interpretation');
select is((public.evaluate_bill_policy(92301) ->> 'version')::int, (select version from public.policy_versions where version_id = (public.evaluate_bill_policy(92301) ->> 'version_id')::int), 'no match fills version');
select is(public.evaluate_bill_policy(92301) -> 'rule_index', 'null'::jsonb, 'no match: rule_index null');
select is(public.evaluate_bill_policy(92302) ->> 'decision', 'block', 'gt: 500.01 matches');
select is((public.evaluate_bill_policy(92302) ->> 'rule_index')::int, 0, 'gt: 500.01 matches: rule_index');
select pg_temp.activate('[{"effect":"block","when":{"amount_cents":{"gte":50000}}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'block', 'gte: 500.00 matches');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 0, 'gte: 500.00 matches: rule_index');
select is(public.evaluate_bill_policy(92303) ->> 'decision', 'none', 'gte: 100.00 no match');
select pg_temp.activate('[{"effect":"block","when":{"amount_cents":{"lt":50000}}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'none', 'lt: 500.00 no match');
select is(public.evaluate_bill_policy(92303) ->> 'decision', 'block', 'lt: 100.00 matches');
select is((public.evaluate_bill_policy(92303) ->> 'rule_index')::int, 0, 'lt: 100.00 matches: rule_index');
select pg_temp.activate('[{"effect":"block","when":{"amount_cents":{"lte":50000}}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'block', 'lte: 500.00 matches');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 0, 'lte: 500.00 matches: rule_index');
select is(public.evaluate_bill_policy(92302) ->> 'decision', 'none', 'lte: 500.01 no match');
select pg_temp.activate('[{"effect":"block","when":{"amount_cents":{"gte":10000,"lte":50000}}}]');
select is(public.evaluate_bill_policy(92303) ->> 'decision', 'block', 'range: 100.00 matches');
select is((public.evaluate_bill_policy(92303) ->> 'rule_index')::int, 0, 'range: 100.00 matches: rule_index');
select is(public.evaluate_bill_policy(92302) ->> 'decision', 'none', 'range: 500.01 no match');
select pg_temp.activate('[{"effect":"require_approval","when":{"property_ids":[92011]}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'require_approval', 'property_ids: 92011 matches');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 0, 'property_ids: 92011 matches: rule_index');
select is(public.evaluate_bill_policy(92303) ->> 'decision', 'none', 'property_ids: 92012 no match');
select pg_temp.activate('[{"effect":"require_approval","when":{"except_property_ids":[92011]}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'none', 'except_property_ids: 92011 none');
select is(public.evaluate_bill_policy(92303) ->> 'decision', 'require_approval', 'except_property_ids: 92012 matches');
select is((public.evaluate_bill_policy(92303) ->> 'rule_index')::int, 0, 'except_property_ids: 92012 matches: rule_index');
select pg_temp.activate('[{"effect":"block","when":{"payment_types":["bank"]}}]');
select is(public.evaluate_bill_policy(92304) ->> 'decision', 'block', 'payment_types bank: bank bill matches');
select is((public.evaluate_bill_policy(92304) ->> 'rule_index')::int, 0, 'payment_types bank: bank bill matches: rule_index');
select is(public.evaluate_bill_policy(92303) ->> 'decision', 'none', 'payment_types bank: card bill none');
select pg_temp.activate('[{"effect":"allow","when":{}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'allow', 'empty when matches');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 0, 'empty when matches: rule_index');
select pg_temp.activate('[{"effect":"allow","when":{}},{"effect":"block","when":{}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'block', 'allow + block: block');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 1, 'allow + block: block: rule_index');
select pg_temp.activate('[{"effect":"block","when":{}},{"effect":"allow","when":{}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'block', 'block first + allow: block at index 0');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 0, 'block first + allow: block at index 0: rule_index');
select pg_temp.activate('[{"effect":"allow","when":{}},{"effect":"require_approval","when":{}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'require_approval', 'allow + require_approval: require_approval');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 1, 'allow + require_approval: require_approval: rule_index');
select pg_temp.activate('[{"effect":"allow","when":{}},{"effect":"require_approval","when":{}},{"effect":"require_approval","when":{}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'require_approval', 'two require_approval: first index');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 1, 'two require_approval: first index: rule_index');
select pg_temp.activate('[{"effect":"allow","when":{"amount_cents":{"gt":99999999}}},{"effect":"block","when":{"amount_cents":{"gt":99999999}}},{"effect":"require_approval","when":{}}]');
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'require_approval', 'non-matching block ignored');
select is((public.evaluate_bill_policy(92301) ->> 'rule_index')::int, 2, 'non-matching block ignored: rule_index');
select pg_temp.activate('[{"effect":"allow","when":{"amount_cents":{"gt":50000}}}]');
select is(public.evaluate_bill_policy(92305) ->> 'decision', 'block', 'amount condition, amount null: block');
select is(public.evaluate_bill_policy(92305) -> 'rule_index', 'null'::jsonb, 'missing fact: rule_index null');
select pg_temp.activate('[{"effect":"allow","when":{"payment_types":["bank"]}}]');
select is(public.evaluate_bill_policy(92306) ->> 'decision', 'block', 'payment type condition, method null: block');
select pg_temp.activate('[{"effect":"allow","when":{"property_ids":[92011]}}]');
select is(public.evaluate_bill_policy(92307) ->> 'decision', 'block', 'property condition, property null: block');
select pg_temp.activate('[{"effect":"allow","when":{"property_ids":[92012]}},{"effect":"block","when":{"amount_cents":{"gt":50000}}}]');
select is(public.evaluate_bill_policy(92307) ->> 'decision', 'block', 'missing fact in a non-matching rule still blocks (property null)');
select pg_temp.activate('[{"effect":"require_approval","when":{"payment_types":["bank"]}}]');
select is(public.evaluate_bill_policy(92305) ->> 'decision', 'none', 'condition key absent, fact null: not a block (amount null)');
select pg_temp.activate('[{"effect":"require_approval","when":{"amount_cents":{"gt":50000}}}]');
select is(public.evaluate_bill_policy(92306) ->> 'decision', 'none', 'condition key absent, fact null: not a block (method null)');
select is(public.evaluate_bill_policy(92307) ->> 'decision', 'none', 'condition key absent, fact null: not a block (property null)');
select pg_temp.activate('[{"effect":"allow","when":{}}]');
update public.policies set active_version_id = 92900 where policy_id = 92001;
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'block', 'another policy version: block');
select is(public.evaluate_bill_policy(92301) -> 'rule_index', 'null'::jsonb, 'foreign version: rule_index null');
select is(public.evaluate_bill_policy(92301) ->> 'policy_name', 'DC92 policy', 'foreign version: policy named');
select is((public.evaluate_bill_policy(92301) ->> 'version_id')::int, 92900, 'foreign version: version_id is the pointed-at one');
select is(public.bill_has_qualifying_approval(92301), false, 'no approvals: false');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92301, 92101, 92102, 'approved', '2026-11-01 10:00');
select is(public.bill_has_qualifying_approval(92301), true, 'newest approved by another user: true');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92302, 92101, 92101, 'approved', '2026-11-01 10:00');
select is(public.bill_has_qualifying_approval(92302), false, 'approved_by = submitted_by: false');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92303, 92101, 92102, 'approved', '2026-11-01 10:00'), (92303, 92101, null, 'pending', '2026-11-02 10:00');
select is(public.bill_has_qualifying_approval(92303), false, 'older approved + newer pending: false');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92304, 92101, null, 'approved', '2026-11-01 10:00');
select is(public.bill_has_qualifying_approval(92304), false, 'approved_by null: false');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92305, 92101, null, 'pending', '2026-11-01 10:00'), (92305, 92101, 92102, 'approved', '2026-11-02 10:00');
select is(public.bill_has_qualifying_approval(92305), true, 'older pending + newer approved: true');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92306, 92101, 92102, 'approved', '2026-11-01 10:00'), (92306, 92101, 92102, 'rejected', '2026-11-01 10:00');
select is(public.bill_has_qualifying_approval(92306), false, 'same created_at: higher approval_id (rejected) wins: false');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92307, 92102, 92101, 'approved', '2026-11-01 10:00');
select is(public.bill_has_qualifying_approval(92307), false, 'approved by the bill''s own user, another user submitted the row: false');
insert into public.approvals (bill_id, submitted_by, approved_by, status, created_at) values (92399, 92103, 92102, 'approved', '2026-11-01 10:00'), (92399, 92102, 92103, 'approved', '2026-11-02 10:00');
select is(public.bill_has_qualifying_approval(92399), false, 'approved by the submitter of an earlier approval row: false');
select is(public.bill_has_qualifying_approval(99999999), false, 'unknown bill: false');
select is(has_function_privilege('anon', 'public.evaluate_bill_policy(integer)', 'execute'), false, 'anon execute on evaluate_bill_policy(integer): false');
select is(has_function_privilege('authenticated', 'public.evaluate_bill_policy(integer)', 'execute'), true, 'authenticated execute on evaluate_bill_policy(integer): true');
select is(has_function_privilege('service_role', 'public.evaluate_bill_policy(integer)', 'execute'), true, 'service_role execute on evaluate_bill_policy(integer): true');
select is(has_function_privilege('public', 'public.evaluate_bill_policy(integer)', 'execute'), false, 'public cannot execute evaluate_bill_policy(integer)');
select is((select prosecdef from pg_proc where oid = 'public.evaluate_bill_policy(integer)'::regprocedure), true, 'evaluate_bill_policy(integer) is security definer');
select is((select provolatile from pg_proc where oid = 'public.evaluate_bill_policy(integer)'::regprocedure), 's', 'evaluate_bill_policy(integer) is stable');
select is(has_function_privilege('anon', 'public.bill_has_qualifying_approval(integer)', 'execute'), false, 'anon execute on bill_has_qualifying_approval(integer): false');
select is(has_function_privilege('authenticated', 'public.bill_has_qualifying_approval(integer)', 'execute'), true, 'authenticated execute on bill_has_qualifying_approval(integer): true');
select is(has_function_privilege('service_role', 'public.bill_has_qualifying_approval(integer)', 'execute'), true, 'service_role execute on bill_has_qualifying_approval(integer): true');
select is(has_function_privilege('public', 'public.bill_has_qualifying_approval(integer)', 'execute'), false, 'public cannot execute bill_has_qualifying_approval(integer)');
select is((select prosecdef from pg_proc where oid = 'public.bill_has_qualifying_approval(integer)'::regprocedure), true, 'bill_has_qualifying_approval(integer) is security definer');
select is((select provolatile from pg_proc where oid = 'public.bill_has_qualifying_approval(integer)'::regprocedure), 's', 'bill_has_qualifying_approval(integer) is stable');
set local role anon;
select throws_ok($$select public.evaluate_bill_policy(92301)$$, '42501', null, 'anon call to evaluate_bill_policy is refused');
select throws_ok($$select public.bill_has_qualifying_approval(92301)$$, '42501', null, 'anon call to bill_has_qualifying_approval is refused');
reset role;
set local role authenticated;
select is(public.evaluate_bill_policy(92301) ->> 'decision', 'block', 'authenticated can evaluate');
reset role;

select * from finish();
rollback;
