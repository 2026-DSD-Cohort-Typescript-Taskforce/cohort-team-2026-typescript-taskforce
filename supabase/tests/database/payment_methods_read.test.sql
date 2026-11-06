-- DC-71: signed-in users can read payment_methods' id, type and name, and nothing else.
-- Run with `supabase test db`. Synthetic data only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Setup (as postgres): one payment method of our own (id 70001+ to stay clear of seeded
-- rows), next to the ones the migrations seed.
insert into public.payment_methods (payment_id, payment_type, name, billing_zip)
  values (70001, 'card', 'DC70 Test Card', '00000');
create temp table payment_methods_before as select * from public.payment_methods;
grant select on payment_methods_before to authenticated;

-- How many rows a statement changed (RLS can make an UPDATE or DELETE match none).
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

-- Policy
select policies_are('public', 'payment_methods',
  ARRAY['authenticated users can read payment methods'],
  'payment_methods has only the read policy');
select policy_cmd_is('public', 'payment_methods', 'authenticated users can read payment methods', 'select', 'the read policy covers SELECT');
select policy_roles_are('public', 'payment_methods', 'authenticated users can read payment methods', ARRAY['authenticated'], 'the read policy is for authenticated only');

-- Signed in
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000070a1","role":"authenticated"}';
select results_eq(
  $$select payment_id, payment_type, name from public.payment_methods order by payment_id$$,
  $$select payment_id, payment_type, name from payment_methods_before order by payment_id$$,
  'a signed-in user reads every payment method''s id, type and name'
);
select throws_ok($$select billing_zip from public.payment_methods$$, '42501', null, 'billing_zip is not readable');
select throws_ok($$select * from public.payment_methods$$, '42501', null, 'select * is refused, since it includes billing_zip');
select throws_ok(
  $$insert into public.payment_methods (payment_type, name) values ('card', 'DC70 Inserted')$$,
  '42501', null,
  'inserting a payment method is refused'
);
select is(pg_temp.rows_changed($$update public.payment_methods set name = 'DC70 Renamed' where payment_id = 70001$$), 0, 'updating a payment method changes nothing (0 rows)');
select is(pg_temp.rows_changed($$delete from public.payment_methods where payment_id = 70001$$), 0, 'deleting a payment method changes nothing (0 rows)');
select is((select count(*)::int from public.cards), 0, 'cards stay locked');
select is((select count(*)::int from public.bank_accounts), 0, 'bank_accounts stay locked');
reset role;

-- Signed out
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select is((select count(*)::int from public.payment_methods), 0, 'anon reads no payment methods');
reset role;

select results_eq(
  $$select * from public.payment_methods order by payment_id$$,
  $$select * from payment_methods_before order by payment_id$$,
  'the refused writes changed no payment method'
);

select * from finish();
rollback;
