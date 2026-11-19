-- DC-91: policy versions and the rule validator. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(119);

-- Setup (as postgres): login A is a billing operator, B a financial approver, C a system
-- admin, D has no profile. Vendors 91001 and 91002 are fixtures: 91001 has a policy and a
-- version, 91002 only ever gets the manager's insert, and 91003 is deleted to prove the cascade.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000091a1', 'dc91-a@example.test'),
  ('00000000-0000-4000-8000-0000000091a2', 'dc91-b@example.test'),
  ('00000000-0000-4000-8000-0000000091a3', 'dc91-c@example.test'),
  ('00000000-0000-4000-8000-0000000091a4', 'dc91-d@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (91101, 'Operator A', 'dc91-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000091a1'),
  (91102, 'Approver B', 'dc91-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000091a2'),
  (91103, 'Admin C', 'dc91-c@example.test', 'system_admin', '00000000-0000-4000-8000-0000000091a3');
insert into public.vendors (vendor_id, name, email, address, phone) values
  (91001, 'DC91 Version Vendor', 'v1@example.test', '1 Test Way', '555-0191'),
  (91002, 'DC91 Insert Vendor', 'v2@example.test', '2 Test Way', '555-0192'),
  (91003, 'DC91 Cascade Vendor', 'v3@example.test', '3 Test Way', '555-0193'),
  (91004, 'DC91 Active Vendor', 'v4@example.test', '4 Test Way', '555-0194');
insert into public.policies (policy_id, vendor_id, name, description, is_active) overriding system value values
  (91001, 91001, 'DC91 policy', 'Fixture policy.', true),
  (91003, 91003, 'DC91 cascade policy', 'Fixture policy.', true),
  (91004, 91004, 'DC91 active policy', 'Fixture policy.', true);
insert into public.policy_versions (version_id, policy_id, vendor_id, version, rule, original_sentence, sentence, revised_sentence, interpretation, answers, draft_revision, confirmed_by) overriding system value values
  (91001, 91001, 91001, 1, '{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{}}]}', 'o', 's', 'r', 'i', '[]', 1, 91102),
  (91003, 91003, 91003, 1, '{"schema_version":1,"vendor_id":91003,"rules":[{"effect":"block","when":{}}]}', 'o', 's', 'r', 'i', '[]', 1, 91102),
  (91004, 91004, 91004, 1, '{"schema_version":1,"vendor_id":91004,"rules":[{"effect":"block","when":{}}]}', 'o', 's', 'r', 'i', '[]', 1, 91102);
update public.policies set active_version_id = 91004 where policy_id = 91004;

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

-- Schema
select has_table('public', 'policy_versions', 'policy_versions exists');
select col_type_is('public', 'policy_versions', 'version_id', 'integer', 'version_id is integer');
select col_not_null('public', 'policy_versions', 'version_id', 'version_id is NOT NULL');
select col_type_is('public', 'policy_versions', 'policy_id', 'integer', 'policy_id is integer');
select col_not_null('public', 'policy_versions', 'policy_id', 'policy_id is NOT NULL');
select col_type_is('public', 'policy_versions', 'vendor_id', 'integer', 'vendor_id is integer');
select col_not_null('public', 'policy_versions', 'vendor_id', 'vendor_id is NOT NULL');
select col_type_is('public', 'policy_versions', 'version', 'integer', 'version is integer');
select col_not_null('public', 'policy_versions', 'version', 'version is NOT NULL');
select col_type_is('public', 'policy_versions', 'rule', 'jsonb', 'rule is jsonb');
select col_not_null('public', 'policy_versions', 'rule', 'rule is NOT NULL');
select col_type_is('public', 'policy_versions', 'original_sentence', 'text', 'original_sentence is text');
select col_not_null('public', 'policy_versions', 'original_sentence', 'original_sentence is NOT NULL');
select col_type_is('public', 'policy_versions', 'sentence', 'text', 'sentence is text');
select col_not_null('public', 'policy_versions', 'sentence', 'sentence is NOT NULL');
select col_type_is('public', 'policy_versions', 'revised_sentence', 'text', 'revised_sentence is text');
select col_not_null('public', 'policy_versions', 'revised_sentence', 'revised_sentence is NOT NULL');
select col_type_is('public', 'policy_versions', 'interpretation', 'text', 'interpretation is text');
select col_not_null('public', 'policy_versions', 'interpretation', 'interpretation is NOT NULL');
select col_type_is('public', 'policy_versions', 'not_covered', 'text', 'not_covered is text');
select col_is_null('public', 'policy_versions', 'not_covered', 'not_covered is nullable');
select col_type_is('public', 'policy_versions', 'answers', 'jsonb', 'answers is jsonb');
select col_not_null('public', 'policy_versions', 'answers', 'answers is NOT NULL');
select col_type_is('public', 'policy_versions', 'draft_revision', 'integer', 'draft_revision is integer');
select col_not_null('public', 'policy_versions', 'draft_revision', 'draft_revision is NOT NULL');
select col_type_is('public', 'policy_versions', 'confirmed_by', 'integer', 'confirmed_by is integer');
select col_not_null('public', 'policy_versions', 'confirmed_by', 'confirmed_by is NOT NULL');
select col_type_is('public', 'policy_versions', 'confirmed_at', 'timestamp with time zone', 'confirmed_at is timestamp with time zone');
select col_not_null('public', 'policy_versions', 'confirmed_at', 'confirmed_at is NOT NULL');
select col_is_pk('public', 'policy_versions', 'version_id', 'version_id is the primary key');
select col_is_unique('public', 'policy_versions', ARRAY['policy_id', 'version'], 'policy_id and version are unique together');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'public.policy_versions'::regclass and contype = 'f' and confrelid = 'public.policies'::regclass),
  'c', 'the policy FK cascades on delete');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'public.policy_versions'::regclass and contype = 'f' and confrelid = 'public.vendors'::regclass),
  'c', 'the vendor FK cascades on delete');
select fk_ok('public', 'policy_versions', 'confirmed_by', 'public', 'users', 'user_id', 'confirmed_by references users');
select col_type_is('public', 'policies', 'active_version_id', 'integer', 'policies.active_version_id is integer');
select col_is_null('public', 'policies', 'active_version_id', 'policies.active_version_id is nullable');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'public.policies'::regclass and contype = 'f' and confrelid = 'public.policy_versions'::regclass),
  'n', 'the active_version_id FK sets null on delete');
select is(
  (select relrowsecurity from pg_class where oid = 'public.policy_versions'::regclass),
  true, 'row level security is enabled');
select policies_are('public', 'policy_versions', ARRAY['signed-in users can view policy versions'], 'only the read policy exists');
select table_privs_are('public', 'policy_versions', 'anon', ARRAY[]::text[], 'anon has no privileges on policy_versions');
select table_privs_are('public', 'policy_versions', 'authenticated', ARRAY['SELECT'], 'authenticated can only select policy_versions');
select table_privs_are('public', 'policy_versions', 'service_role', ARRAY['SELECT'], 'service_role can only select policy_versions');
select has_trigger('public', 'policy_versions', 'audit_row_change', 'policy_versions has the audit_row_change trigger');
select function_privs_are('public', 'policy_rule_is_valid', ARRAY['jsonb', 'integer'], 'authenticated', ARRAY['EXECUTE'], 'authenticated can EXECUTE policy_rule_is_valid');
select function_privs_are('public', 'policy_rule_is_valid', ARRAY['jsonb', 'integer'], 'service_role', ARRAY['EXECUTE'], 'service_role can EXECUTE policy_rule_is_valid');
select function_privs_are('public', 'policy_rule_is_valid', ARRAY['jsonb', 'integer'], 'anon', ARRAY[]::text[], 'anon has no EXECUTE on policy_rule_is_valid');
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.policy_rule_is_valid(jsonb, integer)')
      and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'),
  0, 'public has no EXECUTE on policy_rule_is_valid');
select is((select provolatile::text from pg_proc where oid = to_regprocedure('public.policy_rule_is_valid(jsonb, integer)')), 'i', 'policy_rule_is_valid is immutable');
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.policy_versions_refuse_change()')
      and acl.privilege_type = 'EXECUTE' and (acl.grantee = 0 or acl.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated', 'service_role')))),
  0, 'public, anon, authenticated and service_role cannot execute the trigger function');

-- Validator: valid rules (vendor 91001)
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"require_approval","when":{"amount_cents":{"gt":50000},"except_property_ids":[3]}}]}'::jsonb, 91001), true, 'valid: ADR 0003 complete example (vendor 91001)');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"gte":10000,"lte":50000}}}]}'::jsonb, 91001), true, 'valid: gte and lte together');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"allow","when":{"payment_types":["bank"]}}]}'::jsonb, 91001), true, 'valid: payment_types bank');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{}}]}'::jsonb, 91001), true, 'valid: an empty when');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}}]}'::jsonb, 91001), true, 'valid: 10 rules');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"allow","when":{"property_ids":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49]}}]}'::jsonb, 91001), true, 'valid: 50 property ids');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"allow","when":{"payment_types":["card","bank"]}}]}'::jsonb, 91001), true, 'valid: both payment types');

-- Validator: invalid rules
select is(public.policy_rule_is_valid('{"schema_version":2,"vendor_id":91001,"rules":[{"effect":"block","when":{}}]}'::jsonb, 91001), false, 'invalid: schema_version 2');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91002,"rules":[{"effect":"block","when":{}}]}'::jsonb, 91001), false, 'invalid: a vendor mismatch');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[]}'::jsonb, 91001), false, 'invalid: 0 rules');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}},{"effect":"allow","when":{}}]}'::jsonb, 91001), false, 'invalid: 11 rules');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"notify","when":{}}]}'::jsonb, 91001), false, 'invalid: effect notify');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"weekday":["mon"]}}]}'::jsonb, 91001), false, 'invalid: an unknown when key');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"extra":1,"rules":[{"effect":"block","when":{}}]}'::jsonb, 91001), false, 'invalid: an unknown top-level key');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{},"note":"x"}]}'::jsonb, 91001), false, 'invalid: an unknown rule key');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{}}}]}'::jsonb, 91001), false, 'invalid: empty amount_cents');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"gt":1,"gte":2}}}]}'::jsonb, 91001), false, 'invalid: gt and gte together');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"lt":5,"lte":4}}}]}'::jsonb, 91001), false, 'invalid: lt and lte together');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"gt":-1}}}]}'::jsonb, 91001), false, 'invalid: gt -1');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"gt":1.5}}}]}'::jsonb, 91001), false, 'invalid: gt 1.5');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"gt":"5"}}}]}'::jsonb, 91001), false, 'invalid: gt as a string');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"eq":5}}}]}'::jsonb, 91001), false, 'invalid: an unknown amount key');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"property_ids":[]}}]}'::jsonb, 91001), false, 'invalid: empty property_ids');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"property_ids":[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50]}}]}'::jsonb, 91001), false, 'invalid: 51 property ids');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"property_ids":[1,2,1]}}]}'::jsonb, 91001), false, 'invalid: a duplicate property id');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"property_ids":[1.5]}}]}'::jsonb, 91001), false, 'invalid: a non-integer property id');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"property_ids":["1"]}}]}'::jsonb, 91001), false, 'invalid: a string property id');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"property_ids":3}}]}'::jsonb, 91001), false, 'invalid: property_ids not an array');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"property_ids":[1],"except_property_ids":[2]}}]}'::jsonb, 91001), false, 'invalid: both property lists');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"payment_types":["cash"]}}]}'::jsonb, 91001), false, 'invalid: payment type cash');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"payment_types":["card","card"]}}]}'::jsonb, 91001), false, 'invalid: a duplicate payment type');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"payment_types":[]}}]}'::jsonb, 91001), false, 'invalid: empty payment_types');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"payment_types":[1]}}]}'::jsonb, 91001), false, 'invalid: a numeric payment type');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":[]}]}'::jsonb, 91001), false, 'invalid: when not an object');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":{}}'::jsonb, 91001), false, 'invalid: rules not an array');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[1]}'::jsonb, 91001), false, 'invalid: a rule that is not an object');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"when":{}}]}'::jsonb, 91001), false, 'invalid: a missing effect');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block"}]}'::jsonb, 91001), false, 'invalid: a missing when');
select is(public.policy_rule_is_valid('{"vendor_id":91001,"rules":[{"effect":"block","when":{}}]}'::jsonb, 91001), false, 'invalid: a missing schema_version');
select is(public.policy_rule_is_valid('{"schema_version":"1","vendor_id":91001,"rules":[{"effect":"block","when":{}}]}'::jsonb, 91001), false, 'invalid: a string schema_version');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":"91001","rules":[{"effect":"block","when":{}}]}'::jsonb, 91001), false, 'invalid: a string vendor_id');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{"amount_cents":{"gt":99999999999999999999}}}]}'::jsonb, 91001), false, 'invalid: an amount beyond a safe integer');
select is(public.policy_rule_is_valid('{}'::jsonb, 91001), false, 'invalid: an empty object');
select is(public.policy_rule_is_valid('[]'::jsonb, 91001), false, 'invalid: a rule that is an array');
select is(public.policy_rule_is_valid('"x"'::jsonb, 91001), false, 'invalid: a rule that is a string');
select is(public.policy_rule_is_valid('1'::jsonb, 91001), false, 'invalid: a rule that is a number');
select is(public.policy_rule_is_valid('null'::jsonb, 91001), false, 'invalid: a rule that is JSON null');
select is(public.policy_rule_is_valid(null, 91001), false, 'invalid: a SQL null rule');
select is(public.policy_rule_is_valid('{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{}}]}'::jsonb, null), false, 'invalid: a null vendor');

-- The table refuses an invalid rule
select throws_ok($$insert into public.policy_versions (policy_id, vendor_id, version, rule, original_sentence, sentence, revised_sentence, interpretation, answers, draft_revision, confirmed_by) values (91001, 91001, 2, '{"schema_version":2,"vendor_id":91001,"rules":[]}', 'o', 's', 'r', 'i', '[]', 1, 91102)$$, '23514', null, 'a version with an invalid rule is refused');
select throws_ok($$insert into public.policy_versions (policy_id, vendor_id, version, rule, original_sentence, sentence, revised_sentence, interpretation, answers, draft_revision, confirmed_by) values (91001, 91001, 1, '{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{}}]}', 'o', 's', 'r', 'i', '[]', 1, 91102)$$, '23505', null, 'a second version 1 for the same policy is refused');

-- Never edited (as postgres, which skips RLS and grants but not triggers)
select throws_ok($$update public.policy_versions set sentence = 'changed' where version_id = 91001$$, 'PT409', 'policy_version_immutable', 'an update is refused');
select throws_ok($$delete from public.policy_versions where version_id = 91001$$, 'PT409', 'policy_version_immutable', 'a direct delete is refused');
select is((select sentence from public.policy_versions where version_id = 91001), 's', 'the refused update changed nothing');

-- The cascade from a vendor delete is allowed and takes the policy and versions with it
select lives_ok($$delete from public.vendors where vendor_id = 91003$$, 'deleting a vendor with a policy and a version is allowed');
select is((select count(*)::int from public.policies where policy_id = 91003), 0, 'the vendor delete removed its policy');
select is((select count(*)::int from public.policy_versions where policy_id = 91003), 0, 'the vendor delete removed its versions');

-- Circular cascade: the policy's active_version_id points at a version that is deleted with it
select lives_ok($$delete from public.vendors where vendor_id = 91004$$, 'deleting a vendor whose policy has an active version is allowed');
select is((select count(*)::int from public.policies where policy_id = 91004), 0, 'the active-version vendor delete removed its policy');
select is((select count(*)::int from public.policy_versions where policy_id = 91004), 0, 'the active-version vendor delete removed its versions');

-- Billing operator A: can read versions, cannot write
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000091a1","role":"authenticated"}';
select is((select count(*)::int from public.policy_versions where version_id = 91001), 1, 'operator can read versions');
reset role;

-- Financial approver B (a policy manager)
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000091a2","role":"authenticated"}';
select is((select count(*)::int from public.policy_versions where version_id = 91001), 1, 'manager can read versions');
select throws_ok($$insert into public.policy_versions (policy_id, vendor_id, version, rule, original_sentence, sentence, revised_sentence, interpretation, answers, draft_revision, confirmed_by) values (91001, 91001, 2, '{"schema_version":1,"vendor_id":91001,"rules":[{"effect":"block","when":{}}]}', 'o', 's', 'r', 'i', '[]', 1, 91102)$$, '42501', null, 'manager cannot insert a version');
select throws_ok($$update public.policy_versions set sentence = 'changed' where version_id = 91001$$, '42501', null, 'manager cannot update a version');
select throws_ok($$delete from public.policy_versions where version_id = 91001$$, '42501', null, 'manager cannot delete a version');
select throws_ok($$update public.policies set active_version_id = 91001 where policy_id = 91001$$, '42501', null, 'manager cannot set active_version_id');
select throws_ok($$insert into public.policies (vendor_id, name, description, active_version_id) values (91002, 'n', 'd', 91001)$$, '42501', null, 'manager cannot insert with active_version_id');
select is(pg_temp.rows_changed($$update public.policies set name = 'DC91 renamed', description = 'New description.', is_active = false, updated_at = now() where policy_id = 91001$$), 1, 'manager can update name, description, is_active and updated_at');
select is(pg_temp.rows_changed($$insert into public.policies (vendor_id, name, description) values (91002, 'DC91 new policy', 'New policy.')$$), 1, 'manager can insert vendor_id, name and description');
reset role;

-- Anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.policy_versions$$, '42501', null, 'anon cannot read versions');
reset role;

select * from finish();
rollback;
