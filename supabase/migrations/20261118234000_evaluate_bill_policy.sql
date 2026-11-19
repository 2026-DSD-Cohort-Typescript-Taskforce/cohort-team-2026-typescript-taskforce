-- DC-92: evaluate a bill against its vendor's active policy version, and say whether the
-- bill's newest approval counts for a policy (someone other than the submitter approved).
-- Both are read-only. Callers (submit_bill, prepare_payment, start_payment_submission and
-- the send-back function) decide what to do with the answer.

create function public.evaluate_bill_policy(p_bill_id integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_bill record;
  v_type text;
  v_policy record;
  v_version record;
  v_cents bigint;
  v_rules jsonb;
  v_rule jsonb;
  v_when jsonb;
  v_amount jsonb;
  v_idx integer;
  v_effect text;
  v_rank integer;
  v_best_rank integer := 0;
  v_best_idx integer;
  v_decision text := 'none';
  v_rule_index integer;
  v_matches boolean;
  v_missing boolean := false;
  v_result jsonb;
begin
  select b.bill_id, b.vendor_id, b.property_id, b.payment_method_id, b.amount
    into v_bill
    from public.bills b
   where b.bill_id = p_bill_id;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  select p.policy_id, p.name, p.is_active, p.active_version_id
    into v_policy
    from public.policies p
   where p.vendor_id = v_bill.vendor_id;
  if not found or not v_policy.is_active or v_policy.active_version_id is null then
    return jsonb_build_object(
      'decision', 'none', 'policy_id', null, 'version_id', null, 'version', null,
      'rule_index', null, 'policy_name', null, 'interpretation', null);
  end if;

  select v.version_id, v.policy_id, v.vendor_id, v.version, v.rule, v.interpretation
    into v_version
    from public.policy_versions v
   where v.version_id = v_policy.active_version_id;

  v_result := jsonb_build_object(
    'policy_id', v_policy.policy_id,
    'version_id', v_version.version_id,
    'version', v_version.version,
    'policy_name', v_policy.name,
    'interpretation', v_version.interpretation);

  -- A version that is missing, is another policy's, or no longer validates fails closed.
  if not found
     or v_version.policy_id is distinct from v_policy.policy_id
     or not public.policy_rule_is_valid(v_version.rule, v_bill.vendor_id) then
    return v_result || jsonb_build_object('decision', 'block', 'rule_index', null);
  end if;

  v_cents := round(v_bill.amount * 100)::bigint;
  if v_bill.payment_method_id is not null then
    select pm.payment_type into v_type
      from public.payment_methods pm
     where pm.payment_method_id = v_bill.payment_method_id;
  end if;

  v_rules := v_version.rule -> 'rules';
  for v_idx in 0 .. jsonb_array_length(v_rules) - 1 loop
    v_rule := v_rules -> v_idx;
    v_when := v_rule -> 'when';
    v_effect := v_rule ->> 'effect';

    -- A condition on a fact the bill lacks cannot be judged: block.
    if (v_when ? 'amount_cents' and v_cents is null)
       or ((v_when ? 'property_ids' or v_when ? 'except_property_ids') and v_bill.property_id is null)
       or (v_when ? 'payment_types' and v_type is null) then
      v_missing := true;
      exit;
    end if;

    v_matches := true;
    if v_when ? 'amount_cents' then
      v_amount := v_when -> 'amount_cents';
      if v_amount ? 'gt' and not (v_cents > (v_amount ->> 'gt')::numeric) then v_matches := false; end if;
      if v_amount ? 'gte' and not (v_cents >= (v_amount ->> 'gte')::numeric) then v_matches := false; end if;
      if v_amount ? 'lt' and not (v_cents < (v_amount ->> 'lt')::numeric) then v_matches := false; end if;
      if v_amount ? 'lte' and not (v_cents <= (v_amount ->> 'lte')::numeric) then v_matches := false; end if;
    end if;
    if v_when ? 'property_ids' and not exists (
      select 1 from jsonb_array_elements(v_when -> 'property_ids') e
       where (e #>> '{}')::numeric = v_bill.property_id) then
      v_matches := false;
    end if;
    if v_when ? 'except_property_ids' and exists (
      select 1 from jsonb_array_elements(v_when -> 'except_property_ids') e
       where (e #>> '{}')::numeric = v_bill.property_id) then
      v_matches := false;
    end if;
    if v_when ? 'payment_types' and not exists (
      select 1 from jsonb_array_elements_text(v_when -> 'payment_types') e
       where e = v_type) then
      v_matches := false;
    end if;

    if v_matches then
      v_rank := case v_effect when 'block' then 3 when 'require_approval' then 2 else 1 end;
      if v_rank > v_best_rank then
        v_best_rank := v_rank;
        v_best_idx := v_idx;
        v_decision := v_effect;
      end if;
    end if;
  end loop;

  if v_missing then
    return v_result || jsonb_build_object('decision', 'block', 'rule_index', null);
  end if;
  v_rule_index := case when v_best_rank > 0 then v_best_idx else null end;
  return v_result || jsonb_build_object('decision', v_decision, 'rule_index', v_rule_index);
end
$$;

-- True when the bill's newest approval (by created_at, then approval_id) is approved by a
-- known user who neither created the bill (bills.user_id) nor submitted any of its approval
-- rows. A send-back makes the requester the row's submitter, so the row alone can't show
-- who submitted the bill. A self-approval or an auto-approve row never counts.
create function public.bill_has_qualifying_approval(p_bill_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select a.status = 'approved'
       and a.approved_by is not null
       and a.approved_by is distinct from b.user_id
       and not exists (
         select 1 from public.approvals s
          where s.bill_id = a.bill_id and s.submitted_by = a.approved_by)
      from public.approvals a
      join public.bills b on b.bill_id = a.bill_id
     where a.bill_id = p_bill_id
     order by a.created_at desc, a.approval_id desc
     limit 1
  ), false)
$$;

revoke execute on function public.evaluate_bill_policy(integer) from public, anon;
revoke execute on function public.bill_has_qualifying_approval(integer) from public, anon;
grant execute on function public.evaluate_bill_policy(integer) to authenticated, service_role;
grant execute on function public.bill_has_qualifying_approval(integer) to authenticated, service_role;
