begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

insert into public.bills(
  bill_id, user_id, vendor_id, property_id, payment_method_id,
  invoice_number, amount, date_due, status
) values (
  118001,
  (select min(user_id) from public.users),
  (select min(vendor_id) from public.vendors),
  (select min(property_id) from public.properties),
  (select min(payment_method_id) from public.payment_methods),
  'STAGEHAND-118001', 125, current_date, 'pending_payment'
);

set local role service_role;
select is(
  public.claim_stagehand_execution(repeat('a',64), repeat('b',64), 118001) ->> 'status',
  'claimed', 'first caller atomically claims the execution'
);
select is(
  public.claim_stagehand_execution(repeat('a',64), repeat('b',64), 118001) ->> 'status',
  'outcome_unknown', 'a concurrent or repeated active claim fails closed'
);
select is(
  public.claim_stagehand_execution(repeat('a',64), repeat('c',64), 118001) ->> 'status',
  'conflict', 'the same key cannot identify another request'
);
select ok(
  public.transition_stagehand_execution(repeat('a',64), repeat('b',64), array['claimed'], 'retryable'),
  'known pre-submission failure becomes retryable'
);
select is(
  public.claim_stagehand_execution(repeat('a',64), repeat('b',64), 118001) ->> 'status',
  'claimed', 'one retry can claim the retryable execution'
);
select is(
  public.claim_stagehand_execution(repeat('a',64), repeat('b',64), 118001) ->> 'status',
  'outcome_unknown', 'a second concurrent retry remains blocked'
);
select ok(
  public.transition_stagehand_execution(repeat('a',64), repeat('b',64), array['claimed'], 'submitting'),
  'submission intent is persisted before payment'
);
select is(
  public.claim_stagehand_execution(repeat('a',64), repeat('b',64), 118001) ->> 'status',
  'outcome_unknown', 'submission intent remains uncertain across another claim'
);
select ok(
  public.transition_stagehand_execution(repeat('a',64), repeat('b',64), array['submitting'], 'confirmed', '{"confirmed":true,"receipt":{"status":"captured"}}'),
  'confirmed result is persisted'
);
select is(
  public.claim_stagehand_execution(repeat('a',64), repeat('b',64), 118001) ->> 'status',
  'replay', 'confirmed execution replays'
);
select is(
  public.get_stagehand_execution_receipt(118001, repeat('a',64)) ->> 'status',
  'captured', 'receipt comes only from the confirmed execution'
);
select throws_ok(
  $$select public.get_stagehand_execution_receipt(999999, repeat('a',64))$$,
  'PT404', null, 'receipt lookup is bound to the bill'
);
select throws_ok(
  $$select public.claim_stagehand_execution('raw-key', repeat('b',64), 118001)$$,
  'PT400', null, 'raw idempotency keys are rejected'
);
select throws_ok(
  $$select public.transition_stagehand_execution(repeat('a',64), repeat('b',64), array['confirmed'], 'retryable')$$,
  'PT400', null, 'confirmed execution cannot become retryable'
);
reset role;

set local role authenticated;
select throws_ok(
  $$select public.claim_stagehand_execution(repeat('d',64), repeat('e',64), 118001)$$,
  '42501', null, 'signed-in users cannot claim executions'
);
select throws_ok(
  $$select public.transition_stagehand_execution(repeat('a',64), repeat('b',64), array['confirmed'], 'confirmed', '{"confirmed":true}')$$,
  '42501', null, 'signed-in users cannot alter executions'
);
select throws_ok(
  $$select public.get_stagehand_execution_receipt(118001, repeat('a',64))$$,
  '42501', null, 'signed-in users cannot read worker receipts directly'
);
select throws_ok(
  $$select * from public.stagehand_executions$$,
  '42501', null, 'signed-in users cannot read the journal table'
);

select * from finish();
rollback;
