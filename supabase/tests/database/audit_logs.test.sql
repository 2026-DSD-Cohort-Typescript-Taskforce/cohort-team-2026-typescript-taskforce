-- DC-100: audit_logs actor and entity columns, append-only, readable by approvers and admins.
-- Run with `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(33);

-- Setup (as postgres): login A is a billing operator, B a financial approver, C a system
-- admin, D has no profile. Ids 100101+ stay clear of seeded rows.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000001000a1', 'dc100-a@example.test'),
  ('00000000-0000-4000-8000-0000001000a2', 'dc100-b@example.test'),
  ('00000000-0000-4000-8000-0000001000a3', 'dc100-c@example.test'),
  ('00000000-0000-4000-8000-0000001000a4', 'dc100-d@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (100101, 'Operator A', 'dc100-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000001000a1'),
  (100102, 'Approver B', 'dc100-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000001000a2'),
  (100103, 'Admin C', 'dc100-c@example.test', 'system_admin', '00000000-0000-4000-8000-0000001000a3');
insert into public.audit_logs (name, description) values ('dc100_probe', 'written by postgres');

-- Columns
select has_column('public', 'audit_logs', 'actor_user_id', 'audit_logs has actor_user_id');
select col_type_is('public', 'audit_logs', 'actor_user_id', 'integer', 'actor_user_id is an integer, like users.user_id');
select fk_ok('public', 'audit_logs', 'actor_user_id', 'public', 'users', 'user_id', 'actor_user_id references users');
select is(
  (select confdeltype from pg_constraint
     where conrelid = 'public.audit_logs'::regclass and contype = 'f'
       and conkey = array[(select attnum from pg_attribute
                             where attrelid = 'public.audit_logs'::regclass and attname = 'actor_user_id')]),
  'n'::"char",
  'deleting a user keeps their audit rows and clears actor_user_id'
);
select has_column('public', 'audit_logs', 'actor_type', 'audit_logs has actor_type');
select col_type_is('public', 'audit_logs', 'actor_type', 'text', 'actor_type is text');
select has_column('public', 'audit_logs', 'agent', 'audit_logs has agent');
select col_type_is('public', 'audit_logs', 'agent', 'text', 'agent is text');
select has_column('public', 'audit_logs', 'entity_type', 'audit_logs has entity_type');
select col_type_is('public', 'audit_logs', 'entity_type', 'text', 'entity_type is text');
select has_column('public', 'audit_logs', 'entity_id', 'audit_logs has entity_id');
select col_type_is('public', 'audit_logs', 'entity_id', 'integer', 'entity_id is an integer, like every audited table''s key');
select has_column('public', 'audit_logs', 'details', 'audit_logs has details');
select col_type_is('public', 'audit_logs', 'details', 'jsonb', 'details is jsonb');

-- Allowed values
select throws_ok(
  $$insert into public.audit_logs (name, description, actor_type) values ('x', 'x', 'robot')$$,
  '23514', null, 'actor_type is one of user, agent, system'
);
select throws_ok(
  $$insert into public.audit_logs (name, description, actor_type, agent) values ('x', 'x', 'agent', 'janitor')$$,
  '23514', null, 'agent is one of extraction, payment'
);
select throws_ok(
  $$insert into public.audit_logs (name, description, actor_type) values ('x', 'x', 'agent')$$,
  '23514', null, 'an agent row names the agent'
);
select throws_ok(
  $$insert into public.audit_logs (name, description, actor_type, agent) values ('x', 'x', 'user', 'extraction')$$,
  '23514', null, 'only agent rows name an agent'
);
select lives_ok(
  $$insert into public.audit_logs (name, description, actor_user_id, actor_type, agent, entity_type, entity_id, details)
      values ('dc100_agent_probe', 'x', 100102, 'agent', 'extraction', 'bill', 1, '{"fields": 3}')$$,
  'an agent row with actor and entity is accepted'
);

-- Index for newest-first paging (DC-104)
select ok(
  exists (select 1 from pg_indexes
            where schemaname = 'public' and tablename = 'audit_logs'
              and indexdef like '%(created_at DESC, audit_log_id DESC)'),
  'an index on (created_at desc, audit_log_id desc) serves newest-first paging'
);

-- Existing rows
-- The seed dates rows relative to when it ran (30, 10, 18 and 12 days back), so the times
-- are checked as gaps from row 1.
select results_eq(
  $$select audit_log_id, name, description,
           created_at - min(created_at) over () as since_first,
           actor_user_id, actor_type, agent, entity_type, entity_id
      from public.audit_logs where audit_log_id <= 4 order by audit_log_id$$,
  $$values (1, 'bill_created', 'Created the Alder Creek bill.', interval '0', null::integer, null::text, null::text, null::text, null::integer),
           (2, 'bill_created', 'Created the Brightwater bill.', interval '20 days', null, null, null, null, null),
           (3, 'bill_paid', 'Recorded payment for the Northline bill.', interval '12 days', null, null, null, null, null),
           (4, 'bill_created', 'Created the Sunmeadow bill.', interval '18 days', null, null, null, null, null)$$,
  'seeded rows keep their name, description and time, with no actor or entity'
);

-- Who can read
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000001000a2","role":"authenticated"}';
select ok((select count(*) from public.audit_logs where name = 'dc100_probe') = 1, 'a financial approver can read the log');
select is(
  (select actor_type || '/' || agent from public.audit_logs where name = 'dc100_agent_probe'),
  'agent/extraction',
  'readers see the actor columns'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000001000a3","role":"authenticated"}';
select ok((select count(*) from public.audit_logs where name = 'dc100_probe') = 1, 'a system admin can read the log');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000001000a1","role":"authenticated"}';
select is((select count(*)::int from public.audit_logs), 0, 'a billing operator sees no audit rows');

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000001000a4","role":"authenticated"}';
select is((select count(*)::int from public.audit_logs), 0, 'a login with no profile sees no audit rows');

reset role;
set local role anon;
select throws_ok($$select count(*) from public.audit_logs$$, '42501', null, 'signed-out callers can''t read the log');
select throws_ok(
  $$insert into public.audit_logs (name, description) values ('forged', 'x')$$,
  '42501', null, 'signed-out callers can''t write the log'
);

-- No signed-in user writes directly, not even an approver who can read it
reset role;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000001000a2","role":"authenticated"}';
select throws_ok(
  $$insert into public.audit_logs (name, description) values ('forged', 'x')$$,
  '42501', null, 'an approver can''t insert audit rows'
);
select throws_ok(
  $$update public.audit_logs set description = 'edited' where name = 'dc100_probe'$$,
  '42501', null, 'an approver can''t edit audit rows'
);
select throws_ok(
  $$delete from public.audit_logs where name = 'dc100_probe'$$,
  '42501', null, 'an approver can''t delete audit rows'
);
select throws_ok($$truncate public.audit_logs$$, '42501', null, 'an approver can''t truncate the log');
select throws_ok(
  $$select nextval('public.audit_logs_audit_log_id_seq')$$,
  '42501', null, 'an approver can''t draw audit log ids'
);

select * from finish();
rollback;
