-- DC-100: audit_logs actor and entity columns, append-only, readable by approvers and admins.
-- DC-101: the audit trigger on the domain tables.
-- Run with `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(42);

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

-- DC-101: every insert, update and delete on the domain tables writes one audit row.
-- Writes run as postgres with approver B's claims, so auth.uid() is B, except the vendor
-- edits, which B makes as a signed-in user through RLS.
reset role;
create temp table dc101_mark on commit drop as
  select coalesce(max(audit_log_id), 0) as id from public.audit_logs;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000001000a2","role":"authenticated"}';

insert into public.properties (property_id, name) values (100101, 'DC101 Property');
insert into public.vendors (vendor_id, name, email, address, phone, portal_password)
  values (100101, 'DC101 Vendor', 'dc101@example.test', '1 Audit Way', '555-0100', 'hunter2-dc101');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip) values (100101, 'card', 'DC101 Card', '12345');
insert into public.cards (payment_method_id, card_brand, exp_date, is_credit, card_number, cvc)
  values (100101, 'visa', current_date + 365, true, '4111999988887777', '987');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip) values (100102, 'bank', 'DC101 Bank', '12345');
insert into public.bank_accounts (payment_method_id, bank_name, account_number, routing_number)
  values (100102, 'DC101 Bank', '000123456789', '110000000');
insert into public.policies (policy_id, vendor_id, name, description) overriding system value
  values (100101, 100101, 'DC101 Policy', 'x');
insert into public.bills (bill_id, status, user_id, vendor_id, property_id, payment_method_id, amount, invoice_number)
  values (100101, 'draft', 100101, 100101, 100101, 100101, 10.00, 'DC101-1');
update public.bills set status = 'pending_approval' where bill_id = 100101;
insert into public.approvals (approval_id, bill_id, submitted_by, status) values (100101, 100101, 100101, 'pending');
update public.approvals set status = 'approved', approved_by = 100102 where approval_id = 100101;
update public.bills set status = 'pending_payment' where bill_id = 100101;
-- DC-89: payments is written only through the payment functions; its guard trigger refuses
-- direct writes and every delete. This file tests the audit trigger, not the payment flow,
-- so it turns the guard off around its direct payments writes (the transaction rolls back).
alter table public.payments disable trigger payments_guard;
insert into public.payments (payment_id, bill_id, status) values (100101, 100101, 'pending');
update public.payments set status = 'success' where payment_id = 100101;
alter table public.payments enable trigger payments_guard;

set local role authenticated;
update public.vendors set phone = '555-0101', updated_at = now() + interval '1 second' where vendor_id = 100101;
update public.vendors set portal_password = 'hunter3-dc101', portal_username = 'dc101-login' where vendor_id = 100101;
reset role;

update public.properties set name = 'DC101 Property 2' where property_id = 100101;
update public.policies set is_active = false where policy_id = 100101;
update public.payment_methods set name = 'DC101 Card 2' where payment_method_id = 100101;
update public.cards set cvc = '654' where payment_method_id = 100101;
update public.bank_accounts set account_number = '000999888777' where payment_method_id = 100102;
alter table public.payments disable trigger payments_guard;
delete from public.payments where payment_id = 100101;
alter table public.payments enable trigger payments_guard;
delete from public.approvals where approval_id = 100101;
delete from public.bills where bill_id = 100101;
delete from public.policies where policy_id = 100101;
delete from public.cards where payment_method_id = 100101;
delete from public.bank_accounts where payment_method_id = 100102;
delete from public.payment_methods where payment_method_id = 100101;
delete from public.payment_methods where payment_method_id = 100102;
delete from public.vendors where vendor_id = 100101;
delete from public.properties where property_id = 100101;

select results_eq(
  $$select name, actor_type, actor_user_id, agent, entity_type, entity_id
      from public.audit_logs where audit_log_id > (select id from dc101_mark) order by audit_log_id$$,
  $$values ('property_created', 'user', 100102, null::text, 'property', 100101),
           ('vendor_created', 'user', 100102, null, 'vendor', 100101),
           ('payment_method_created', 'user', 100102, null, 'payment_method', 100101),
           ('card_created', 'user', 100102, null, 'card', 100101),
           ('payment_method_created', 'user', 100102, null, 'payment_method', 100102),
           ('bank_account_created', 'user', 100102, null, 'bank_account', 100102),
           ('policy_created', 'user', 100102, null, 'policy', 100101),
           ('bill_created', 'user', 100102, null, 'bill', 100101),
           ('bill_submitted', 'user', 100102, null, 'bill', 100101),
           ('approval_created', 'user', 100102, null, 'approval', 100101),
           ('approval_updated', 'user', 100102, null, 'approval', 100101),
           ('bill_approved', 'user', 100102, null, 'bill', 100101),
           ('payment_created', 'user', 100102, null, 'payment', 100101),
           ('payment_succeeded', 'user', 100102, null, 'payment', 100101),
           ('vendor_updated', 'user', 100102, null, 'vendor', 100101),
           ('vendor_updated', 'user', 100102, null, 'vendor', 100101),
           ('property_updated', 'user', 100102, null, 'property', 100101),
           ('policy_updated', 'user', 100102, null, 'policy', 100101),
           ('payment_method_updated', 'user', 100102, null, 'payment_method', 100101),
           ('card_updated', 'user', 100102, null, 'card', 100101),
           ('bank_account_updated', 'user', 100102, null, 'bank_account', 100102),
           ('payment_deleted', 'user', 100102, null, 'payment', 100101),
           ('approval_deleted', 'user', 100102, null, 'approval', 100101),
           ('bill_deleted', 'user', 100102, null, 'bill', 100101),
           ('policy_deleted', 'user', 100102, null, 'policy', 100101),
           ('card_deleted', 'user', 100102, null, 'card', 100101),
           ('bank_account_deleted', 'user', 100102, null, 'bank_account', 100102),
           ('payment_method_deleted', 'user', 100102, null, 'payment_method', 100101),
           ('payment_method_deleted', 'user', 100102, null, 'payment_method', 100102),
           ('vendor_deleted', 'user', 100102, null, 'vendor', 100101),
           ('property_deleted', 'user', 100102, null, 'property', 100101)$$,
  'each write on the nine tables logs one row with the actor, entity and action name, including B''s edits through RLS'
);
select is(
  (select details from public.audit_logs
     where audit_log_id > (select id from dc101_mark) and name = 'vendor_updated' order by audit_log_id limit 1),
  '{"old": {"phone": "555-0100"}, "new": {"phone": "555-0101"}}'::jsonb,
  'an update records only the changed columns, old and new, leaving out updated_at'
);
select ok(
  (select details->'new'->>'invoice_number' = 'DC101-1' and not details ? 'old' from public.audit_logs
     where audit_log_id > (select id from dc101_mark) and name = 'bill_created'),
  'an insert records the new row'
);
select ok(
  (select details->'old'->>'name' = 'DC101 Property 2' and not details ? 'new' from public.audit_logs
     where audit_log_id > (select id from dc101_mark) and name = 'property_deleted'),
  'a delete records the old row'
);
select ok(
  not exists (select 1 from public.audit_logs
                where details::text ~ '(hunter2-dc101|hunter3-dc101|dc101-login|4111999988887777|000123456789|000999888777|110000000)'),
  'portal passwords, card numbers, account and routing numbers never reach details'
);
select is(
  (select array_agg(distinct e.key || '=' || e.value order by e.key || '=' || e.value) from public.audit_logs a,
     jsonb_each_text(coalesce(a.details->'old', '{}') || coalesce(a.details->'new', '{}')) e
     where a.audit_log_id > (select id from dc101_mark) and e.value is not null
       and e.key in ('portal_username', 'portal_password', 'billing_zip', 'card_number', 'cvc', 'exp_date', 'account_number', 'routing_number')),
  array['account_number=[redacted]', 'billing_zip=[redacted]', 'card_number=[redacted]', 'cvc=[redacted]',
        'exp_date=[redacted]', 'portal_password=[redacted]', 'portal_username=[redacted]', 'routing_number=[redacted]'],
  'secret columns show as [redacted] when written or changed'
);
select ok(
  (select details->'new' ? 'portal_username' and details->'new'->'portal_username' = 'null'::jsonb from public.audit_logs
     where audit_log_id > (select id from dc101_mark) and name = 'vendor_created'),
  'an empty secret column stays null, not [redacted]'
);

-- Who acted: the extraction agent for B, an unknown agent header (ignored), and no user.
set local request.headers = '{"x-audit-actor": "agent/extraction"}';
insert into public.properties (property_id, name) values (100102, 'DC101 Agent Property');
set local request.headers = '{"x-audit-actor": "agent/janitor"}';
select lives_ok(
  $$update public.properties set name = 'DC101 Agent Property 2' where property_id = 100102$$,
  'an unknown agent header doesn''t block the write'
);
set local request.headers = '{}';
set local request.jwt.claims = '';
delete from public.properties where property_id = 100102;
select results_eq(
  $$select name, actor_type, agent, actor_user_id from public.audit_logs
      where entity_type = 'property' and entity_id = 100102 order by audit_log_id$$,
  $$values ('property_created', 'agent', 'extraction', 100102),
           ('property_updated', 'user', null::text, 100102),
           ('property_deleted', 'system', null, null::integer)$$,
  'agent header marks the extraction agent acting for B; unknown header is a user action; no user is system'
);

select * from finish();
rollback;
