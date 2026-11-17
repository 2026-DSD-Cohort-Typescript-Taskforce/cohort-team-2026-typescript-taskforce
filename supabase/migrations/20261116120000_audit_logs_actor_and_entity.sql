-- DC-100: who did what, to which record, in audit_logs. Append-only for signed-in users,
-- readable by financial approvers and system admins.
--
-- The columns are nullable: rows written before this migration have no actor or entity,
-- and submit_bill/decide_bill still insert only name and description until DC-101/DC-102.

alter table public.audit_logs
  add column actor_user_id integer references public.users (user_id) on delete set null,
  add column actor_type text check (actor_type in ('user', 'agent', 'system')),
  add column agent text check (agent in ('extraction', 'payment')),
  add column entity_type text,
  add column entity_id integer,
  add column details jsonb,
  -- An agent row names its agent, and only agent rows do.
  add constraint audit_logs_agent_matches_actor_type
    check (case when actor_type = 'agent' then agent is not null else agent is null end);

-- Newest first, paged by (created_at, audit_log_id) in GET /api/audit-logs (DC-104).
create index audit_logs_created_at_id_idx on public.audit_logs (created_at desc, audit_log_id desc);

-- Replaces Supabase's default grants, which let anon and signed-in users insert, update,
-- delete and truncate (RLS doesn't cover truncate). Signed-in users may only read, and RLS
-- narrows that to approvers and admins. Security-definer functions write as the owner.
revoke all on table public.audit_logs from anon, authenticated;
revoke all on sequence public.audit_logs_audit_log_id_seq from anon, authenticated;
grant select on table public.audit_logs to authenticated;

-- is_vendor_manager() is the financial_approver/system_admin check (20261111170000).
create policy "approvers and admins can view audit logs" on public.audit_logs
  for select to authenticated
  using ((select public.is_vendor_manager()));
