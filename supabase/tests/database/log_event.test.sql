-- DC-103: log_event() records audit events that aren't row changes.
-- Run with `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

-- Setup (as postgres): one billing operator. Ids 103101+ stay clear of seeded rows.
insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000001030a1', 'dc103-a@example.test');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (103101, 'Operator A', 'dc103-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000001030a1');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000001030a1","role":"authenticated"}';

-- As the extraction agent, acting for operator A.
set local request.headers = '{"x-audit-actor":"agent/extraction"}';
select lives_ok(
  $$select public.log_event('extraction_started', 'Reading the PDF', null, null, '{"pdf_sha256":"dc103"}')$$,
  'a signed-in user can log an extraction event'
);
select lives_ok(
  $$select public.log_event('extraction_succeeded', 'Read the PDF', 'bill', 103201,
      '{"pdf_sha256":"dc103","model":"m","portal_username":"login","portal_password":"hunter2","fields":["vendor_name","portal_password"]}')$$,
  'details with portal logins are accepted'
);

-- Without the header, the same call is the user's own.
set local request.headers = '{}';
select lives_ok(
  $$select public.log_event('duplicate_detected', 'Same PDF', 'bill', 103201, null)$$,
  'without the agent header the event is logged as the user'
);

select throws_ok(
  $$select public.log_event('bill_approved', 'forged', 'bill', 103201, null)$$,
  '22023', null,
  'names outside the extraction events are refused'
);

reset role;
select results_eq(
  $$select name, actor_user_id, actor_type, agent, entity_type, entity_id from public.audit_logs
      where actor_user_id = 103101 order by audit_log_id$$,
  $$values ('extraction_started', 103101, 'agent', 'extraction', null::text, null::integer),
           ('extraction_succeeded', 103101, 'agent', 'extraction', 'bill', 103201),
           ('duplicate_detected', 103101, 'user', null, 'bill', 103201)$$,
  'each call writes one row with the actor, agent and entity'
);
select is(
  (select details from public.audit_logs where name = 'extraction_succeeded' and actor_user_id = 103101),
  '{"pdf_sha256":"dc103","model":"m","fields":["vendor_name","portal_password"]}'::jsonb,
  'portal login values are dropped from details; field names stay'
);
select ok(
  not has_function_privilege('anon', 'public.log_event(text, text, text, integer, jsonb)', 'execute'),
  'anon cannot call log_event'
);
select ok(
  not has_table_privilege('authenticated', 'public.audit_logs', 'insert'),
  'signed-in users still cannot insert into audit_logs directly'
);

select * from finish();
rollback;
