-- DC-85: vendor policies. Adds public.policies (at most one policy per vendor: a name, a
-- description and an on/off flag) and limits writes to financial approvers and system
-- admins; every signed-in user can read, anon has no access. Policies are stored only:
-- nothing reads them to change a bill. This changes no existing rows.

-- Table
create table public.policies (
  policy_id int4 generated always as identity primary key,
  vendor_id int4 not null,
  name text not null,
  description text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  -- The routes set this to now() on every write.
  updated_at timestamptz not null default now(),
  constraint policies_vendor_id_key unique (vendor_id),
  constraint policies_vendor_id_fkey foreign key (vendor_id)
    references public.vendors (vendor_id) on delete cascade,
  -- A blank value counts as missing.
  constraint policies_name_valid
    check (btrim(name) <> '' and char_length(name) <= 100),
  constraint policies_description_valid
    check (btrim(description) <> '' and char_length(description) <= 1000)
);

-- Who can write policies. Security definer, so the role check reads users as the owner and
-- keeps working whatever RLS policies and grants users has; search_path is pinned to ''
-- so a caller's search_path can't change which users table it reads.
create function public.is_policy_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where auth_user_id = (select auth.uid())
      and role in ('financial_approver', 'system_admin')
  );
$$;

-- New functions in public are executable by PUBLIC and anon by default.
revoke execute on function public.is_policy_manager() from public, anon;
grant execute on function public.is_policy_manager() to authenticated;

-- Row level security. There is no DELETE policy (or grant): a policy goes only when its
-- vendor is deleted, through the foreign key's cascade.
alter table public.policies enable row level security;

create policy "signed-in users can view policies"
  on public.policies for select
  to authenticated
  using (true);

create policy "policy managers can add policies"
  on public.policies for insert
  to authenticated
  with check ((select public.is_policy_manager()));

create policy "policy managers can change policies"
  on public.policies for update
  to authenticated
  using ((select public.is_policy_manager()))
  with check ((select public.is_policy_manager()));

revoke all on public.policies from anon, authenticated;
grant select, insert, update on public.policies to authenticated;
