-- DC-81: deciding a bill waiting for approval. decide_bill() is the only way a bill
-- leaves pending_approval: in one transaction it checks the caller, the inputs and the
-- bill, moves the bill, records the decision on the approvals row and writes one
-- audit_logs row. Signed-in users can no longer insert or update approvals directly, so
-- a decision can't be forged or edited afterwards.
--
-- decision        bill status        approvals status   audit_logs.name
-- approved        pending_payment    approved           bill_approved
-- needs_revision  draft              needs_revision     bill_needs_revision
-- denied          approval_denied    rejected           bill_denied
--
-- Error contract. PostgREST answers a PTxyz SQLSTATE with HTTP status xyz, and
-- supabase-js .rpc('decide_bill', { p_bill_id, p_decision, p_note }) puts the fields in
-- error.code, error.message and error.details. Checked in this order:
--   code   HTTP  message               details
--   PT403  403   forbidden             null (no profile for this login, or role isn't financial_approver)
--   PT400  400   invalid_decision      JSON array of the bad fields, in order: ["decision"], ["note"] or ["decision","note"]
--   PT404  404   not_found             null
--   PT409  409   not_pending_approval  the bill's current status, e.g. pending_payment
-- The note is optional: it is trimmed, blank becomes NULL, and it can be at most 500
-- characters. On success it returns the updated bill.

-- needs_revision is the approvals status for "sent back to draft".
alter table public.approvals drop constraint status_values;
alter table public.approvals add constraint status_values
  check (status in ('pending', 'approved', 'rejected', 'expired', 'canceled', 'needs_revision'));

-- Replaces the open insert and update policies from
-- 20261102174727_create_approvals_and_payments.sql. decide_bill() runs as the table
-- owner, so these don't apply to it. The SELECT policy and the table grants are unchanged.
drop policy "authenticated users can insert approvals" on public.approvals;
drop policy "authenticated users can update approvals" on public.approvals;

create function public.decide_bill(p_bill_id integer, p_decision text, p_note text default null)
returns public.bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id integer;
  v_user_role text;
  v_bad text[];
  v_note text;
  v_bill_status text;
  v_approval_status text;
  v_audit_name text;
  v_bill public.bills;
  v_approval_id integer;
begin
  -- Signed-in users can't change their own role (DC-22 column grants).
  select user_id, role into v_user_id, v_user_role
    from public.users
    where auth_user_id = (select auth.uid());
  if v_user_role is distinct from 'financial_approver' then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  v_note := nullif(btrim(p_note), '');
  v_bad := array_remove(array[
    case when p_decision is null or p_decision not in ('approved', 'needs_revision', 'denied') then 'decision' end,
    case when char_length(v_note) > 500 then 'note' end
  ], null);
  if cardinality(v_bad) > 0 then
    raise sqlstate 'PT400' using message = 'invalid_decision', detail = to_json(v_bad)::text;
  end if;

  -- The row lock makes a concurrent decision on the same bill wait, then see its new status.
  select * into v_bill from public.bills where bill_id = p_bill_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  if v_bill.status <> 'pending_approval' then
    raise sqlstate 'PT409' using message = 'not_pending_approval', detail = v_bill.status;
  end if;

  select case p_decision
      when 'approved' then 'pending_payment'
      when 'needs_revision' then 'draft'
      else 'approval_denied'
    end,
    case p_decision
      when 'approved' then 'approved'
      when 'needs_revision' then 'needs_revision'
      else 'rejected'
    end,
    case p_decision
      when 'approved' then 'bill_approved'
      when 'needs_revision' then 'bill_needs_revision'
      else 'bill_denied'
    end
  into v_bill_status, v_approval_status, v_audit_name;

  -- Decide the newest pending request. A bill can be pending_approval without one
  -- (seed data, older flows), so then record the decision on a new row.
  select approval_id into v_approval_id
    from public.approvals
    where bill_id = p_bill_id and status = 'pending'
    order by created_at desc, approval_id desc
    limit 1;
  if found then
    update public.approvals
      set status = v_approval_status, approved_by = v_user_id, time_approved = now(), notes = v_note
      where approval_id = v_approval_id;
  else
    insert into public.approvals (bill_id, submitted_by, approved_by, status, time_approved, notes)
      values (p_bill_id, v_bill.user_id, v_user_id, v_approval_status, now(), v_note);
  end if;

  update public.bills
    set status = v_bill_status, updated_at = now()
    where bill_id = p_bill_id
    returning * into v_bill;

  -- audit_logs has no bill or user column (dropped in DC-53), so the description names both.
  insert into public.audit_logs (name, description)
    values (v_audit_name, format('bill %s: pending_approval → %s, by user %s', p_bill_id, v_bill_status, v_user_id));

  return v_bill;
end
$$;

-- New functions in public are executable by PUBLIC and anon by default.
revoke execute on function public.decide_bill(integer, text, text) from public, anon;
grant execute on function public.decide_bill(integer, text, text) to authenticated;
