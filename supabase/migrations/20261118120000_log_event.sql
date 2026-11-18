-- DC-103: audit events that aren't row changes, such as the extraction agent's steps.
--
-- The actor follows audit_row_change() (DC-101): the signed-in user, plus agent from the
-- x-audit-actor header. Only the names below are accepted, so a signed-in user can't
-- write rows that look like approvals or payments.
create function public.log_event(
  p_name text,
  p_description text,
  p_entity_type text default null,
  p_entity_id integer default null,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_header text := nullif(current_setting('request.headers', true), '')::json ->> 'x-audit-actor';
  v_agent text := case when v_header in ('agent/extraction', 'agent/payment') then substr(v_header, 7) end;
begin
  -- ponytail: extraction events only; add the payment agent's names when it's built.
  if p_name is null or p_name not in ('extraction_started', 'extraction_succeeded', 'extraction_failed', 'duplicate_detected') then
    raise exception 'unknown audit event: %', p_name using errcode = '22023';
  end if;

  insert into public.audit_logs (name, description, actor_user_id, actor_type, agent, entity_type, entity_id, details)
  values (
    p_name,
    p_description,
    (select u.user_id from public.users u where u.auth_user_id = auth.uid()),
    case when v_agent is not null then 'agent' when auth.uid() is not null then 'user' else 'system' end,
    v_agent,
    p_entity_type,
    p_entity_id,
    -- The same secrets the trigger redacts; top-level keys only.
    p_details - array['portal_username', 'portal_password', 'billing_zip', 'card_number', 'cvc', 'exp_date', 'account_number', 'routing_number']
  );
end;
$$;
revoke execute on function public.log_event(text, text, text, integer, jsonb) from public, anon;
grant execute on function public.log_event(text, text, text, integer, jsonb) to authenticated;
