-- DC-90: policy drafts. Run with `supabase test db`.
-- Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(90);

-- Setup (as postgres): login A is a billing operator, B a financial approver, C a system
-- admin, D has no profile. Vendor 90001 is a fixture (for the cascade check) and 90002 only
-- ever sees refused inserts. RLS checks use seeded vendors: Summit Trail Equipment Rental
-- (which gets a policy here if it has none), Alder Creek Landscaping, Brightwater Water & Sewer.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000090a1', 'dc90-a@example.test'),
  ('00000000-0000-4000-8000-0000000090a2', 'dc90-b@example.test'),
  ('00000000-0000-4000-8000-0000000090a3', 'dc90-c@example.test'),
  ('00000000-0000-4000-8000-0000000090a4', 'dc90-d@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (90101, 'Operator A', 'dc90-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000090a1'),
  (90102, 'Approver B', 'dc90-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000090a2'),
  (90103, 'Admin C', 'dc90-c@example.test', 'system_admin', '00000000-0000-4000-8000-0000000090a3');
insert into public.vendors (vendor_id, name, email, address, phone) values
  (90001, 'DC90 Cascade Vendor', 'cascade@example.test', '1 Test Way', '555-0190'),
  (90002, 'DC90 Check Vendor', 'check@example.test', '2 Test Way', '555-0191');
insert into public.policies (vendor_id, name, description, is_active)
select vendor_id, 'DC90 fixture policy', 'Fixture policy for the isolation check.', true
from public.vendors where name = 'Summit Trail Equipment Rental'
on conflict (vendor_id) do nothing;

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
select has_table('public', 'policy_drafts', 'policy_drafts exists');
select col_type_is('public', 'policy_drafts', 'vendor_id', 'integer', 'vendor_id is integer');
select col_not_null('public', 'policy_drafts', 'vendor_id', 'vendor_id is NOT NULL');
select col_type_is('public', 'policy_drafts', 'revision', 'integer', 'revision is integer');
select col_not_null('public', 'policy_drafts', 'revision', 'revision is NOT NULL');
select col_type_is('public', 'policy_drafts', 'status', 'text', 'status is text');
select col_not_null('public', 'policy_drafts', 'status', 'status is NOT NULL');
select col_type_is('public', 'policy_drafts', 'original_sentence', 'text', 'original_sentence is text');
select col_not_null('public', 'policy_drafts', 'original_sentence', 'original_sentence is NOT NULL');
select col_type_is('public', 'policy_drafts', 'sentence', 'text', 'sentence is text');
select col_not_null('public', 'policy_drafts', 'sentence', 'sentence is NOT NULL');
select col_type_is('public', 'policy_drafts', 'revised_sentence', 'text', 'revised_sentence is text');
select col_not_null('public', 'policy_drafts', 'revised_sentence', 'revised_sentence is NOT NULL');
select col_type_is('public', 'policy_drafts', 'interpretation', 'text', 'interpretation is text');
select col_not_null('public', 'policy_drafts', 'interpretation', 'interpretation is NOT NULL');
select col_type_is('public', 'policy_drafts', 'not_covered', 'text', 'not_covered is text');
select col_is_null('public', 'policy_drafts', 'not_covered', 'not_covered is nullable');
select col_type_is('public', 'policy_drafts', 'rule', 'jsonb', 'rule is jsonb');
select col_is_null('public', 'policy_drafts', 'rule', 'rule is nullable');
select col_type_is('public', 'policy_drafts', 'questions', 'jsonb', 'questions is jsonb');
select col_not_null('public', 'policy_drafts', 'questions', 'questions is NOT NULL');
select col_type_is('public', 'policy_drafts', 'unsupported', 'jsonb', 'unsupported is jsonb');
select col_not_null('public', 'policy_drafts', 'unsupported', 'unsupported is NOT NULL');
select col_type_is('public', 'policy_drafts', 'conflicts', 'jsonb', 'conflicts is jsonb');
select col_not_null('public', 'policy_drafts', 'conflicts', 'conflicts is NOT NULL');
select col_type_is('public', 'policy_drafts', 'answers', 'jsonb', 'answers is jsonb');
select col_not_null('public', 'policy_drafts', 'answers', 'answers is NOT NULL');
select col_type_is('public', 'policy_drafts', 'policy_updated_at', 'timestamp with time zone', 'policy_updated_at is timestamp with time zone');
select col_is_null('public', 'policy_drafts', 'policy_updated_at', 'policy_updated_at is nullable');
select col_type_is('public', 'policy_drafts', 'updated_by', 'integer', 'updated_by is integer');
select col_is_null('public', 'policy_drafts', 'updated_by', 'updated_by is nullable');
select col_type_is('public', 'policy_drafts', 'created_at', 'timestamp with time zone', 'created_at is timestamp with time zone');
select col_not_null('public', 'policy_drafts', 'created_at', 'created_at is NOT NULL');
select col_type_is('public', 'policy_drafts', 'updated_at', 'timestamp with time zone', 'updated_at is timestamp with time zone');
select col_not_null('public', 'policy_drafts', 'updated_at', 'updated_at is NOT NULL');
select col_is_pk('public', 'policy_drafts', 'vendor_id', 'vendor_id is the primary key');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'public.policy_drafts'::regclass and contype = 'f' and confrelid = 'public.vendors'::regclass),
  'c', 'the vendor FK cascades on delete');
select is(
  (select confdeltype::text from pg_constraint where conrelid = 'public.policy_drafts'::regclass and contype = 'f' and confrelid = 'public.users'::regclass),
  'n', 'the updated_by FK sets null on delete');
select is(
  (select relrowsecurity from pg_class where oid = 'public.policy_drafts'::regclass),
  true, 'row level security is enabled');
select is(
  (select column_default from information_schema.columns where table_schema = 'public' and table_name = 'policy_drafts' and column_name = 'questions'),
  '''[]''::jsonb', 'questions defaults to []');
select policies_are('public', 'policy_drafts',
  ARRAY['signed-in users can view policy drafts', 'policy managers can add policy drafts', 'policy managers can change policy drafts'],
  'the read policy and the two manager-only write policies exist');
select table_privs_are('public', 'policy_drafts', 'anon', ARRAY[]::text[], 'anon has no privileges');
select table_privs_are('public', 'policy_drafts', 'authenticated', ARRAY['SELECT', 'INSERT', 'UPDATE'], 'authenticated has select, insert and update only');
select is(
  (select count(*)::int from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    where p.oid = to_regprocedure('public.policy_drafts_stamp()')
      and acl.privilege_type = 'EXECUTE' and (acl.grantee = 0 or acl.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated')))),
  0, 'public, anon and authenticated cannot execute the trigger function');

-- Constraints (as postgres, which skips RLS but not CHECKs)
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values (90002, 'draft', 'o', 's', 'r', 'i')$$, '23514', null, 'a status outside the 4 values is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values (90002, 'complete', 'o', '  ', 'r', 'i')$$, '23514', null, 'a blank sentence is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values (90002, 'complete', 'o', repeat('s', 1001), 'r', 'i')$$, '23514', null, 'a 1001-character sentence is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values (90002, 'complete', '  ', 's', 'r', 'i')$$, '23514', null, 'a blank original_sentence is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values (90002, 'complete', repeat('o', 1001), 's', 'r', 'i')$$, '23514', null, 'a 1001-character original_sentence is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values (90002, 'complete', 'o', 's', 'r', repeat('i', 2001))$$, '23514', null, 'a 2001-character interpretation is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values (90002, 'complete', 'o', 's', repeat('r', 2001), 'i')$$, '23514', null, 'a 2001-character revised_sentence is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, not_covered) values (90002, 'complete', 'o', 's', 'r', 'i', repeat('n', 1001))$$, '23514', null, 'a 1001-character not_covered is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, questions) values (90002, 'complete', 'o', 's', 'r', 'i', '{}'::jsonb)$$, '23514', null, 'questions that is not an array is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, unsupported) values (90002, 'complete', 'o', 's', 'r', 'i', '{}'::jsonb)$$, '23514', null, 'unsupported that is not an array is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, conflicts) values (90002, 'complete', 'o', 's', 'r', 'i', '{}'::jsonb)$$, '23514', null, 'conflicts that is not an array is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, answers) values (90002, 'complete', 'o', 's', 'r', 'i', '{}'::jsonb)$$, '23514', null, 'answers that is not an array is refused');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, rule) values (90002, 'complete', 'o', 's', 'r', 'i', '[]'::jsonb)$$, '23514', null, 'a rule that is not an object is refused');
select lives_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, not_covered) values (90002, 'needs_clarification', repeat('o', 1000), repeat('s', 1000), repeat('r', 2000), repeat('i', 2000), repeat('n', 1000))$$, 'values at the length limits are accepted');
delete from public.policy_drafts where vendor_id = 90002;

-- Trigger (as postgres, no JWT)
insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation, revision, created_at, updated_at) values (90001, 'complete', 'o', 's', 'r', 'i', 99, '2000-01-01', '2000-01-01');
select is((select revision from public.policy_drafts where vendor_id = 90001), 1, 'an insert that sends revision 99 stores 1');
select is((select updated_at from public.policy_drafts where vendor_id = 90001), now(), 'an insert stamps updated_at with now(), not the value sent');
select is((select updated_by from public.policy_drafts where vendor_id = 90001), null, 'a write with no JWT leaves updated_by null');
update public.policy_drafts set sentence = 'changed' where vendor_id = 90001;
select is((select revision from public.policy_drafts where vendor_id = 90001), 2, 'an update stores old revision + 1');
update public.policy_drafts set revision = 500, sentence = 'changed again', created_at = '1999-01-01', updated_at = '2000-01-01' where vendor_id = 90001;
select is((select revision from public.policy_drafts where vendor_id = 90001), 3, 'an update that sets revision = 500 still stores old + 1');
select is((select updated_at from public.policy_drafts where vendor_id = 90001), now(), 'an update moves updated_at forward to now()');
select is((select created_at from public.policy_drafts where vendor_id = 90001), '2000-01-01'::timestamptz, 'an update that sends a different created_at leaves it unchanged');
select is((select updated_by from public.policy_drafts where vendor_id = 90001), null, 'an update with no JWT leaves updated_by null');

-- anon
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select * from public.policy_drafts$$, '42501', null, 'anon cannot read drafts');
reset role;

-- Billing operator A: can read, cannot write
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000090a1","role":"authenticated"}';
select is((select count(*)::int from public.policy_drafts where vendor_id = 90001), 1, 'operator can read drafts');
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values ((select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental'), 'complete', 'o', 's', 'r', 'i')$$, '42501', null, 'operator cannot insert drafts');
select is(pg_temp.rows_changed($$update public.policy_drafts set sentence = 'operator edit' where vendor_id = 90001$$), 0, 'operator update changes 0 rows');
reset role;

-- Login D: no profile
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000090a4","role":"authenticated"}';
select throws_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values ((select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental'), 'complete', 'o', 's', 'r', 'i')$$, '42501', null, 'a login with no profile cannot insert drafts');
select is((select count(*)::int from public.policy_drafts where vendor_id = 90001), 1, 'a login with no profile can read drafts');
reset role;

-- Financial approver B (Summit Trail, which has a policy)
create temp table before_policy as
  select is_active, description, updated_at from public.policies where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental');
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000090a2","role":"authenticated"}';
select lives_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values ((select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental'), 'complete', 'o', 's', 'r', 'i')$$, 'approver can insert a draft');
select is((select updated_by from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), 90102, 'updated_by is the approver''s user id on insert');
select is((select revision from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), 1, 'the draft starts at revision 1');
select is(pg_temp.rows_changed($$update public.policy_drafts set sentence = 'approver edit' where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')$$), 1, 'approver update changes 1 row');
select is((select revision from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), 2, 'the approver update bumps revision to 2');
select is((select updated_by from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), 90102, 'updated_by is the approver''s user id on update');
select throws_ok($$delete from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')$$, '42501', null, 'approver cannot delete drafts');
-- A restart is an upsert: it must bump the revision, keep created_at and stamp the approver
select set_config('dc90.created_at', (select created_at::text from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), false);
select lives_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values ((select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental'), 'complete', 'o2', 's2', 'r2', 'i2') on conflict (vendor_id) do update set status = excluded.status, original_sentence = excluded.original_sentence, sentence = excluded.sentence, revised_sentence = excluded.revised_sentence, interpretation = excluded.interpretation$$, 'approver can restart a draft with insert on conflict do update');
select is((select revision from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), 3, 'the restart bumps revision from 2 to 3');
select is((select created_at::text from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), current_setting('dc90.created_at'), 'the restart keeps created_at');
select is((select updated_by from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), 90102, 'updated_by is the approver after the restart');
select is((select sentence from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')), 's2', 'the restart replaced the sentence');
reset role;

-- System admin C
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000090a3","role":"authenticated"}';
select lives_ok($$insert into public.policy_drafts (vendor_id, status, original_sentence, sentence, revised_sentence, interpretation) values ((select vendor_id from public.vendors where name = 'Alder Creek Landscaping'), 'complete', 'o', 's', 'r', 'i')$$, 'admin can insert a draft');
select is(pg_temp.rows_changed($$update public.policy_drafts set sentence = 'admin edit' where vendor_id = (select vendor_id from public.vendors where name = 'Alder Creek Landscaping')$$), 1, 'admin update changes 1 row');
select is((select updated_by from public.policy_drafts where vendor_id = (select vendor_id from public.vendors where name = 'Alder Creek Landscaping')), 90103, 'updated_by is the admin''s user id');
reset role;

-- Isolation: draft writes left the vendor's policy untouched
select is(
  (select row(is_active, description, updated_at)::text from public.policies where vendor_id = (select vendor_id from public.vendors where name = 'Summit Trail Equipment Rental')),
  (select row(is_active, description, updated_at)::text from before_policy),
  'writing a draft leaves the vendor''s policy row unchanged (is_active, description, updated_at)');

-- Cascade
select is((select count(*)::int from public.policy_drafts where vendor_id = 90001), 1, 'the fixture vendor has a draft');
delete from public.vendors where vendor_id = 90001;
select is((select count(*)::int from public.policy_drafts where vendor_id = 90001), 0, 'deleting the vendor removes its draft');

select * from finish();
rollback;
