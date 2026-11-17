-- DC-90: policy drafts. Adds public.policy_drafts (at most one draft per vendor: the
-- manager's policy sentence turned into a proposed rule, with the model's questions and
-- the answers so far) and limits writes to financial approvers and system admins; every
-- signed-in user can read, anon has no access. A draft is stored only: it never turns a
-- policy on or changes policies.description. This changes no existing rows.

-- Table
create table public.policy_drafts (
  vendor_id int4 primary key,
  -- Set by the trigger below: 1 on insert, old + 1 on every update.
  revision int4 not null,
  status text not null,
  original_sentence text not null,
  sentence text not null,
  revised_sentence text not null,
  interpretation text not null,
  not_covered text,
  rule jsonb,
  questions jsonb not null default '[]',
  unsupported jsonb not null default '[]',
  conflicts jsonb not null default '[]',
  answers jsonb not null default '[]',
  policy_updated_at timestamptz,
  updated_by int4,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint policy_drafts_vendor_id_fkey foreign key (vendor_id)
    references public.vendors (vendor_id) on delete cascade,
  constraint policy_drafts_updated_by_fkey foreign key (updated_by)
    references public.users (user_id) on delete set null,
  constraint policy_drafts_status_valid
    check (status in ('complete', 'needs_clarification', 'unsupported', 'conflicting')),
  -- A blank value counts as missing. The full shape of the jsonb columns is checked in the app.
  constraint policy_drafts_original_sentence_valid
    check (btrim(original_sentence) <> '' and char_length(original_sentence) <= 1000),
  constraint policy_drafts_sentence_valid
    check (btrim(sentence) <> '' and char_length(sentence) <= 1000),
  constraint policy_drafts_revised_sentence_valid
    check (btrim(revised_sentence) <> '' and char_length(revised_sentence) <= 2000),
  constraint policy_drafts_interpretation_valid
    check (btrim(interpretation) <> '' and char_length(interpretation) <= 2000),
  constraint policy_drafts_not_covered_valid
    check (not_covered is null or char_length(not_covered) <= 1000),
  constraint policy_drafts_rule_is_object
    check (rule is null or jsonb_typeof(rule) = 'object'),
  constraint policy_drafts_questions_is_array check (jsonb_typeof(questions) = 'array'),
  constraint policy_drafts_unsupported_is_array check (jsonb_typeof(unsupported) = 'array'),
  constraint policy_drafts_conflicts_is_array check (jsonb_typeof(conflicts) = 'array'),
  constraint policy_drafts_answers_is_array check (jsonb_typeof(answers) = 'array')
);

-- Stamps every write, whatever the caller sent: the revision (1, then old + 1), updated_at,
-- created_at (kept) and updated_by (the caller's users.user_id, null with no login or
-- profile). Security definer, so the users lookup works whatever RLS policies and grants
-- users has; search_path is pinned to '' so a caller's search_path can't change which
-- users table it reads.
create function public.policy_drafts_stamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.revision := 1;
  else
    new.revision := old.revision + 1;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := (
    select user_id from public.users
    where auth_user_id = (select auth.uid())
  );
  return new;
end;
$$;

-- New functions in public are executable by PUBLIC and anon by default; only the trigger
-- needs to run it.
revoke execute on function public.policy_drafts_stamp() from public, anon, authenticated;

create trigger policy_drafts_stamp
  before insert or update on public.policy_drafts
  for each row execute function public.policy_drafts_stamp();

-- Row level security. There is no DELETE policy (or grant): a draft goes only when its
-- vendor is deleted, through the foreign key's cascade.
alter table public.policy_drafts enable row level security;

create policy "signed-in users can view policy drafts"
  on public.policy_drafts for select
  to authenticated
  using (true);

create policy "policy managers can add policy drafts"
  on public.policy_drafts for insert
  to authenticated
  with check ((select public.is_policy_manager()));

create policy "policy managers can change policy drafts"
  on public.policy_drafts for update
  to authenticated
  using ((select public.is_policy_manager()))
  with check ((select public.is_policy_manager()));

revoke all on public.policy_drafts from anon, authenticated;
grant select, insert, update on public.policy_drafts to authenticated;
