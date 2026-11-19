-- DC-91: confirmed policy rules are stored as versions that are never edited. Adds the
-- rule validator (a SQL copy of policyRuleV1Schema in client/lib/policy-rule.ts), the
-- policy_versions table, and policies.active_version_id. Only confirm_policy_draft (a later
-- migration) writes versions and sets active_version_id; managers keep the DC-85 columns.

-- Validator. Returns false, never raises, for anything that isn't a valid PolicyRuleV1 for
-- this vendor: the table check and the evaluator both rely on that. Conflicts between
-- rules are not checked here; precedence (block > require_approval > allow) settles them.
create function public.policy_rule_is_valid(p_rule jsonb, p_vendor_id integer)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_max constant numeric := 9007199254740991; -- Number.MAX_SAFE_INTEGER, what zod's int() allows
  v_rule jsonb;
  v_when jsonb;
  v_amount jsonb;
  v_ids jsonb;
  v_types jsonb;
  v_bound record;
begin
  if p_rule is null or p_vendor_id is null or jsonb_typeof(p_rule) <> 'object' then
    return false;
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_rule) k where k not in ('schema_version', 'vendor_id', 'rules')
  ) then
    return false;
  end if;
  if not (p_rule ? 'schema_version' and p_rule ? 'vendor_id' and p_rule ? 'rules') then
    return false;
  end if;
  if jsonb_typeof(p_rule -> 'schema_version') <> 'number' or (p_rule ->> 'schema_version')::numeric <> 1 then
    return false;
  end if;
  if jsonb_typeof(p_rule -> 'vendor_id') <> 'number' or (p_rule ->> 'vendor_id')::numeric <> p_vendor_id then
    return false;
  end if;
  if jsonb_typeof(p_rule -> 'rules') <> 'array' or jsonb_array_length(p_rule -> 'rules') not between 1 and 10 then
    return false;
  end if;

  for v_rule in select value from jsonb_array_elements(p_rule -> 'rules') loop
    if jsonb_typeof(v_rule) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_rule) k where k not in ('effect', 'when'))
       or not (v_rule ? 'effect' and v_rule ? 'when') then
      return false;
    end if;
    if jsonb_typeof(v_rule -> 'effect') <> 'string'
       or (v_rule ->> 'effect') not in ('allow', 'require_approval', 'block') then
      return false;
    end if;

    v_when := v_rule -> 'when';
    if jsonb_typeof(v_when) <> 'object' then
      return false;
    end if;
    if exists (
      select 1 from jsonb_object_keys(v_when) k
      where k not in ('amount_cents', 'property_ids', 'except_property_ids', 'payment_types')
    ) then
      return false;
    end if;
    if v_when ? 'property_ids' and v_when ? 'except_property_ids' then
      return false;
    end if;

    if v_when ? 'amount_cents' then
      v_amount := v_when -> 'amount_cents';
      if jsonb_typeof(v_amount) <> 'object'
         or not exists (select 1 from jsonb_object_keys(v_amount)) then
        return false;
      end if;
      for v_bound in select key, value from jsonb_each(v_amount) loop
        if v_bound.key not in ('gt', 'gte', 'lt', 'lte')
           or jsonb_typeof(v_bound.value) <> 'number'
           or (v_bound.value #>> '{}')::numeric <> trunc((v_bound.value #>> '{}')::numeric)
           or (v_bound.value #>> '{}')::numeric not between 0 and v_max then
          return false;
        end if;
      end loop;
      if v_amount ? 'gt' and v_amount ? 'gte' then
        return false;
      end if;
      if v_amount ? 'lt' and v_amount ? 'lte' then
        return false;
      end if;
    end if;

    foreach v_ids in array array[v_when -> 'property_ids', v_when -> 'except_property_ids'] loop
      if v_ids is not null then
        if jsonb_typeof(v_ids) <> 'array' or jsonb_array_length(v_ids) not between 1 and 50 then
          return false;
        end if;
        if exists (
          select 1 from jsonb_array_elements(v_ids) e
          where jsonb_typeof(e) <> 'number'
             or (e #>> '{}')::numeric <> trunc((e #>> '{}')::numeric)
             or (e #>> '{}')::numeric not between 0 and v_max
        ) then
          return false;
        end if;
        if (select count(distinct e) from jsonb_array_elements(v_ids) e) <> jsonb_array_length(v_ids) then
          return false;
        end if;
      end if;
    end loop;

    v_types := v_when -> 'payment_types';
    if v_types is not null then
      if jsonb_typeof(v_types) <> 'array' or jsonb_array_length(v_types) not between 1 and 2 then
        return false;
      end if;
      if exists (
        select 1 from jsonb_array_elements(v_types) e
        where jsonb_typeof(e) <> 'string' or (e #>> '{}') not in ('card', 'bank')
      ) then
        return false;
      end if;
      if (select count(distinct e) from jsonb_array_elements(v_types) e) <> jsonb_array_length(v_types) then
        return false;
      end if;
    end if;
  end loop;

  return true;
exception when others then
  -- A wrong type somewhere inside is a bad rule, not an error.
  return false;
end
$$;

revoke execute on function public.policy_rule_is_valid(jsonb, integer) from public, anon;
grant execute on function public.policy_rule_is_valid(jsonb, integer) to authenticated, service_role;

-- Versions. One row per confirmation; a later confirmation adds the next version.
create table public.policy_versions (
  version_id int4 generated always as identity primary key,
  policy_id int4 not null,
  vendor_id int4 not null,
  version int4 not null,
  rule jsonb not null,
  original_sentence text not null,
  sentence text not null,
  revised_sentence text not null,
  interpretation text not null,
  not_covered text,
  answers jsonb not null,
  draft_revision int4 not null,
  confirmed_by int4 not null,
  -- Also the time the version takes effect.
  confirmed_at timestamptz not null default now(),
  constraint policy_versions_policy_id_version_key unique (policy_id, version),
  constraint policy_versions_policy_id_fkey foreign key (policy_id)
    references public.policies (policy_id) on delete cascade,
  constraint policy_versions_vendor_id_fkey foreign key (vendor_id)
    references public.vendors (vendor_id) on delete cascade,
  constraint policy_versions_confirmed_by_fkey foreign key (confirmed_by)
    references public.users (user_id),
  constraint policy_versions_rule_valid
    check (public.policy_rule_is_valid(rule, vendor_id))
);

-- Versions are never edited. Deletes are refused too, except the cascade from deleting a
-- policy or vendor: that runs this trigger one level down (depth 2), a direct delete at 1.
create function public.policy_versions_refuse_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise sqlstate 'PT409' using message = 'policy_version_immutable';
end
$$;

revoke execute on function public.policy_versions_refuse_change() from public, anon, authenticated, service_role;

create trigger policy_versions_no_update before update on public.policy_versions
  for each row execute function public.policy_versions_refuse_change();
create trigger policy_versions_no_delete before delete on public.policy_versions
  for each row execute function public.policy_versions_refuse_change();

-- DC-101 audit trail.
create trigger audit_row_change after insert or update or delete on public.policy_versions
  for each row execute function public.audit_row_change('policy_version', 'version_id');

-- Row level security: signed-in users read; nobody writes directly (confirm_policy_draft is
-- security definer).
alter table public.policy_versions enable row level security;

create policy "signed-in users can view policy versions"
  on public.policy_versions for select
  to authenticated
  using (true);

-- service_role gets write grants by default; only the security definer function may write.
revoke all on public.policy_versions from anon, authenticated, service_role;
grant select on public.policy_versions to authenticated, service_role;

-- The version a policy currently enforces. Set only by confirm_policy_draft.
alter table public.policies
  add column active_version_id int4,
  add constraint policies_active_version_id_fkey foreign key (active_version_id)
    references public.policy_versions (version_id) on delete set null;

-- Managers can no longer write active_version_id: narrow to the columns the DC-85 routes write.
revoke insert, update on public.policies from authenticated;
grant insert (vendor_id, name, description), update (name, description, is_active, updated_at)
  on public.policies to authenticated;
