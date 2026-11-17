-- DC-101: log every insert, update and delete on the domain tables into audit_logs.
--
-- One AFTER ROW trigger, so only completed writes are logged and BEFORE triggers
-- (updated_at, invoice number cleanup) have already run. Every write path (Next routes,
-- extract-invoices, security-definer RPCs) acts as the signed-in user, so auth.uid() is
-- the actor; the x-audit-actor header (DC-99) marks writes made by an AI agent.
-- submit_bill and decide_bill still add their own hand-written rows until DC-102.

-- Action names for status changes. from_status null matches any earlier status, including
-- none (an insert). Anything not listed is <entity>_created, _updated or _deleted.
create table public.audit_actions (
  entity_type text not null,
  from_status text,
  to_status text not null,
  action text not null,
  unique nulls not distinct (entity_type, from_status, to_status)
);
alter table public.audit_actions enable row level security;
revoke all on table public.audit_actions from anon, authenticated;

insert into public.audit_actions (entity_type, from_status, to_status, action) values
  ('bill', 'draft', 'pending_approval', 'bill_submitted'),
  ('bill', 'draft', 'pending_payment', 'bill_submitted'),
  ('bill', 'pending_approval', 'pending_payment', 'bill_approved'),
  ('bill', 'pending_approval', 'draft', 'bill_needs_revision'),
  ('bill', 'pending_approval', 'approval_denied', 'bill_denied'),
  ('bill', null, 'payment_success', 'bill_paid'),
  ('bill', null, 'payment_failed', 'bill_payment_failed'),
  ('payment', null, 'success', 'payment_succeeded'),
  ('payment', null, 'failure', 'payment_failed');

-- Trigger arguments: the entity type and the table's integer key column.
create function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity text := tg_argv[0];
  v_old jsonb := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  v_new jsonb := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  v_id integer := (coalesce(v_new, v_old) ->> tg_argv[1])::integer;
  v_from text := v_old ->> 'status';
  v_to text := v_new ->> 'status';
  v_done text := case tg_op when 'INSERT' then 'created' when 'UPDATE' then 'updated' else 'deleted' end;
  -- Vendor portal logins and payment details. Signed-in users can't read most of these
  -- (billing_zip has no column grant; cards and bank_accounts have no select policy), and
  -- audit readers shouldn't get them through the log either.
  v_secrets text[] := array['portal_username', 'portal_password', 'billing_zip', 'card_number', 'cvc', 'exp_date', 'account_number', 'routing_number'];
  v_header text := nullif(current_setting('request.headers', true), '')::json ->> 'x-audit-actor';
  v_agent text;
  v_action text;
  v_details jsonb;
begin
  -- Any caller can send this header, so agent is a label, not proof: actor_user_id is still
  -- the signed-in user. Unknown values are ignored rather than failing the agent check.
  if v_header in ('agent/extraction', 'agent/payment') then
    v_agent := substr(v_header, 7);
  end if;

  if v_to is distinct from v_from and v_to is not null then
    select a.action into v_action
      from public.audit_actions a
      where a.entity_type = v_entity
        and a.to_status = v_to
        and (a.from_status is null or a.from_status = v_from)
      order by a.from_status nulls last
      limit 1;
  end if;

  -- An update keeps only the columns that changed; updated_at always does, so it's left out.
  if tg_op = 'UPDATE' then
    select jsonb_object_agg(o.key, o.value), jsonb_object_agg(o.key, v_new -> o.key)
      into v_old, v_new
      from jsonb_each(v_old) o
      where o.value is distinct from v_new -> o.key and o.key <> 'updated_at';
  end if;
  -- An update that changes nothing still logs a row, with empty old and new.
  v_old := v_old || coalesce((select jsonb_object_agg(k, '[redacted]'::text) from unnest(v_secrets) k where v_old ->> k is not null), '{}');
  v_new := v_new || coalesce((select jsonb_object_agg(k, '[redacted]'::text) from unnest(v_secrets) k where v_new ->> k is not null), '{}');
  v_details := case tg_op
    when 'INSERT' then jsonb_build_object('new', v_new)
    when 'DELETE' then jsonb_build_object('old', v_old)
    else jsonb_build_object('old', coalesce(v_old, '{}'), 'new', coalesce(v_new, '{}'))
  end;

  insert into public.audit_logs (name, description, actor_user_id, actor_type, agent, entity_type, entity_id, details)
  values (
    coalesce(v_action, v_entity || '_' || v_done),
    case when v_action is not null
      then format('%s %s status: %s → %s', v_entity, v_id, coalesce(v_from, 'none'), v_to)
      else format('%s %s %s', v_entity, v_id, v_done)
    end,
    (select u.user_id from public.users u where u.auth_user_id = auth.uid()),
    case when v_agent is not null then 'agent' when auth.uid() is not null then 'user' else 'system' end,
    v_agent,
    v_entity,
    v_id,
    v_details
  );
  return null;
end;
$$;
revoke execute on function public.audit_row_change() from public, anon, authenticated;

create trigger audit_row_change after insert or update or delete on public.bills
  for each row execute function public.audit_row_change('bill', 'bill_id');
create trigger audit_row_change after insert or update or delete on public.vendors
  for each row execute function public.audit_row_change('vendor', 'vendor_id');
create trigger audit_row_change after insert or update or delete on public.properties
  for each row execute function public.audit_row_change('property', 'property_id');
create trigger audit_row_change after insert or update or delete on public.policies
  for each row execute function public.audit_row_change('policy', 'policy_id');
create trigger audit_row_change after insert or update or delete on public.approvals
  for each row execute function public.audit_row_change('approval', 'approval_id');
create trigger audit_row_change after insert or update or delete on public.payments
  for each row execute function public.audit_row_change('payment', 'payment_id');
create trigger audit_row_change after insert or update or delete on public.payment_methods
  for each row execute function public.audit_row_change('payment_method', 'payment_method_id');
create trigger audit_row_change after insert or update or delete on public.cards
  for each row execute function public.audit_row_change('card', 'payment_method_id');
create trigger audit_row_change after insert or update or delete on public.bank_accounts
  for each row execute function public.audit_row_change('bank_account', 'payment_method_id');
