-- DC-91: confirm_policy_draft turns a complete policy draft into the vendor's active policy
-- version. In one transaction it creates or updates the policy (name, description, on),
-- stores the draft's rule as the next version, points the policy at it and deletes the
-- draft. Returns { policy, version } as json.
--
-- Errors (PostgREST code, message, details):
--   PT403  forbidden            null (caller is not a policy manager)
--   PT400  invalid_policy       ["name"] (name blank or over 100 characters)
--   PT404  vendor_not_found     null
--   PT404  draft_not_found      null
--   PT409  stale_draft          null (the draft's revision is not p_revision)
--   PT409  draft_not_complete   the draft's status
--   PT409  policy_changed       null (the policy changed since the draft was made)
--   PT400  invalid_rule         null (the rule is not a valid rule for this vendor)
--
-- Security definer: policy_versions has no write grants and users cannot set
-- active_version_id or delete drafts. The manager check is the first thing it does.
create function public.confirm_policy_draft(p_vendor_id integer, p_revision integer, p_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
  v_user_id integer;
  v_policy public.policies%rowtype;
  v_draft public.policy_drafts%rowtype;
  v_description text;
  v_version public.policy_versions%rowtype;
begin
  if not (select public.is_policy_manager()) then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  if v_name is null or v_name = '' or char_length(v_name) > 100 then
    raise sqlstate 'PT400' using message = 'invalid_policy', detail = '["name"]';
  end if;

  if not exists (select 1 from public.vendors where vendor_id = p_vendor_id) then
    raise sqlstate 'PT404' using message = 'vendor_not_found';
  end if;

  -- Lock order: the policy row, then the draft row.
  select * into v_policy from public.policies where vendor_id = p_vendor_id for update;
  select * into v_draft from public.policy_drafts where vendor_id = p_vendor_id for update;

  if not found then
    raise sqlstate 'PT404' using message = 'draft_not_found';
  end if;
  if v_draft.revision is distinct from p_revision then
    raise sqlstate 'PT409' using message = 'stale_draft';
  end if;
  if v_draft.status <> 'complete' then
    raise sqlstate 'PT409' using message = 'draft_not_complete', detail = v_draft.status;
  end if;
  -- Both null when the draft saw no policy. A name edit also bumps updated_at, so it counts.
  if v_draft.policy_updated_at is distinct from v_policy.updated_at then
    raise sqlstate 'PT409' using message = 'policy_changed';
  end if;
  if not public.policy_rule_is_valid(v_draft.rule, p_vendor_id) then
    raise sqlstate 'PT400' using message = 'invalid_rule';
  end if;

  select user_id into v_user_id from public.users where auth_user_id = (select auth.uid());

  -- policies.description holds at most 1000 characters.
  v_description := case
    when btrim(v_draft.revised_sentence) = '' or char_length(v_draft.revised_sentence) > 1000
      then v_draft.sentence
    else v_draft.revised_sentence
  end;

  if v_policy.policy_id is null then
    insert into public.policies (vendor_id, name, description, is_active)
    values (p_vendor_id, v_name, v_description, true)
    returning * into v_policy;
  else
    update public.policies
    set name = v_name, description = v_description, is_active = true, updated_at = now()
    where policy_id = v_policy.policy_id;
  end if;

  insert into public.policy_versions (
    policy_id, vendor_id, version, rule, original_sentence, sentence, revised_sentence,
    interpretation, not_covered, answers, draft_revision, confirmed_by
  )
  select
    v_policy.policy_id, p_vendor_id, coalesce(max(version), 0) + 1, v_draft.rule,
    v_draft.original_sentence, v_draft.sentence, v_draft.revised_sentence,
    v_draft.interpretation, v_draft.not_covered, v_draft.answers, v_draft.revision, v_user_id
  from public.policy_versions
  where policy_id = v_policy.policy_id
  returning * into v_version;

  update public.policies
  set active_version_id = v_version.version_id
  where policy_id = v_policy.policy_id
  returning * into v_policy;

  delete from public.policy_drafts where vendor_id = p_vendor_id;

  return jsonb_build_object('policy', to_jsonb(v_policy), 'version', to_jsonb(v_version));
end
$$;

revoke execute on function public.confirm_policy_draft(integer, integer, text) from public, anon, service_role;
grant execute on function public.confirm_policy_draft(integer, integer, text) to authenticated;
