-- Browserbase workers can run in multiple short-lived server instances. Keep the
-- pre-click idempotency journal in Postgres so restarts and concurrency cannot submit twice.
create table public.stagehand_executions (
  key_hash text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  bill_id integer not null references public.bills(bill_id),
  state text not null check (state in ('claimed', 'submitting', 'confirmed', 'retryable')),
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (state = 'confirmed' and result ->> 'confirmed' = 'true')
    or (state <> 'confirmed' and result is null)
  )
);
alter table public.stagehand_executions enable row level security;
revoke all on table public.stagehand_executions from public, anon, authenticated;
grant select, insert, update on table public.stagehand_executions to service_role;

create function public.claim_stagehand_execution(
  p_key_hash text,
  p_fingerprint text,
  p_bill_id integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_execution public.stagehand_executions;
begin
  if p_key_hash !~ '^[0-9a-f]{64}$' or p_fingerprint !~ '^[0-9a-f]{64}$' then
    raise sqlstate 'PT400' using message = 'invalid_execution_identity';
  end if;

  insert into public.stagehand_executions(key_hash, fingerprint, bill_id, state)
  values (p_key_hash, p_fingerprint, p_bill_id, 'claimed')
  on conflict (key_hash) do nothing
  returning * into v_execution;
  if found then
    return jsonb_build_object('status', 'claimed');
  end if;

  select * into v_execution
  from public.stagehand_executions
  where key_hash = p_key_hash
  for update;

  if v_execution.fingerprint is distinct from p_fingerprint
    or v_execution.bill_id is distinct from p_bill_id then
    return jsonb_build_object('status', 'conflict');
  end if;
  if v_execution.state = 'confirmed' and v_execution.result ->> 'confirmed' = 'true' then
    return jsonb_build_object('status', 'replay', 'result', v_execution.result);
  end if;
  if v_execution.state = 'retryable' then
    update public.stagehand_executions
      set state = 'claimed', updated_at = now()
      where key_hash = p_key_hash;
    return jsonb_build_object('status', 'claimed');
  end if;
  return jsonb_build_object('status', 'outcome_unknown');
end;
$$;
revoke all on function public.claim_stagehand_execution(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_stagehand_execution(text, text, integer) to service_role;

create function public.transition_stagehand_execution(
  p_key_hash text,
  p_fingerprint text,
  p_expected_states text[],
  p_to_state text,
  p_result jsonb default null
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changed integer;
begin
  if p_to_state not in ('submitting', 'confirmed', 'retryable')
    or p_expected_states is null
    or cardinality(p_expected_states) = 0
    or exists (
      select 1 from unnest(p_expected_states) s
      where s not in ('claimed', 'submitting', 'confirmed', 'retryable')
    )
    or (p_to_state = 'confirmed') is distinct from
      (p_result is not null and p_result ->> 'confirmed' = 'true')
    or (p_to_state = 'submitting' and p_expected_states <> array['claimed'])
    or (p_to_state = 'retryable' and p_expected_states <> array['claimed'])
    or (p_to_state = 'confirmed' and not p_expected_states <@ array['submitting','confirmed']) then
    raise sqlstate 'PT400' using message = 'invalid_execution_transition';
  end if;

  update public.stagehand_executions
    set state = p_to_state, result = p_result, updated_at = now()
    where key_hash = p_key_hash
      and fingerprint = p_fingerprint
      and state = any(p_expected_states);
  get diagnostics v_changed = row_count;
  return v_changed = 1;
end;
$$;
revoke all on function public.transition_stagehand_execution(text, text, text[], text, jsonb)
  from public, anon, authenticated;
grant execute on function public.transition_stagehand_execution(text, text, text[], text, jsonb)
  to service_role;

create function public.get_stagehand_execution_receipt(p_bill_id integer, p_key_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_receipt jsonb;
begin
  select result -> 'receipt' into v_receipt
  from public.stagehand_executions
  where key_hash = p_key_hash
    and bill_id = p_bill_id
    and state = 'confirmed'
    and result ->> 'confirmed' = 'true';
  if v_receipt is null then
    raise sqlstate 'PT404' using message = 'execution_receipt_not_found';
  end if;
  return v_receipt;
end;
$$;
revoke all on function public.get_stagehand_execution_receipt(integer, text)
  from public, anon, authenticated;
grant execute on function public.get_stagehand_execution_receipt(integer, text) to service_role;
