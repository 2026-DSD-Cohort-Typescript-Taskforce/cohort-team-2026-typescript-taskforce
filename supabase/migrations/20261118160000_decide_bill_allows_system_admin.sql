-- System admins may do everything financial approvers can, including deciding bills.
-- Same as 20261117120000's decide_bill(), with only the role check widened.

create or replace function public.decide_bill(p_bill_id integer, p_decision text, p_note text default null)
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
  v_bill public.bills;
  v_approval_id integer;
begin
  -- Signed-in users can't change their own role (DC-22 column grants).
  select user_id, role into v_user_id, v_user_role
    from public.users
    where auth_user_id = (select auth.uid());
  if v_user_role is null or v_user_role not in ('financial_approver', 'system_admin') then
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
    end
  into v_bill_status, v_approval_status;

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

  return v_bill;
end
$$;
