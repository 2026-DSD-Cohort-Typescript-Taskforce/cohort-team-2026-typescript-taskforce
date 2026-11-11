-- DC-81 review: a bill the approver sent back ("Needs revision" moves it to draft) skipped
-- approval when it was resubmitted, because submit_bill() moved every draft to
-- pending_payment. Now a draft whose newest approvals row is needs_revision goes back to
-- pending_approval, and a new pending approvals row is opened for decide_bill() to decide.
-- Every other draft still goes to pending_payment.
--
-- Same signature, checks and error contract as 20261106205929, so callers don't change.
-- CREATE OR REPLACE keeps the function's owner and EXECUTE grants.

create or replace function public.submit_bill(p_bill_id integer)
returns public.bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id integer;
  v_user_role text;
  v_bill public.bills;
  v_missing text[];
  v_next_status text;
begin
  -- Signed-in users can't change their own role (DC-22 column grants).
  select user_id, role into v_user_id, v_user_role
    from public.users
    where auth_user_id = (select auth.uid());
  if v_user_role is distinct from 'billing_operator' then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  -- The row lock makes a concurrent submit of the same bill wait, then see its new status.
  select * into v_bill from public.bills where bill_id = p_bill_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  if v_bill.status <> 'draft' then
    raise sqlstate 'PT409' using message = 'not_draft', detail = v_bill.status;
  end if;

  -- A past due date is allowed. A blank invoice number is already stored as NULL.
  v_missing := array_remove(array[
    case when v_bill.vendor_id is null then 'vendor_id' end,
    case when v_bill.property_id is null then 'property_id' end,
    case when v_bill.invoice_number is null then 'invoice_number' end,
    case when v_bill.amount <= 0 then 'amount' end,
    case when v_bill.date_due is null then 'date_due' end
  ], null);
  if cardinality(v_missing) > 0 then
    raise sqlstate 'PT400' using message = 'incomplete_bill', detail = to_json(v_missing)::text;
  end if;

  -- A bill sent back for revision goes back to the approver. Newest row first, in the same
  -- order decide_bill() uses to pick the row it decides.
  if (select a.status from public.approvals a
        where a.bill_id = p_bill_id
        order by a.created_at desc, a.approval_id desc
        limit 1) = 'needs_revision' then
    v_next_status := 'pending_approval';
    insert into public.approvals (bill_id, submitted_by, status)
      values (p_bill_id, v_user_id, 'pending');
  else
    v_next_status := 'pending_payment';
  end if;

  update public.bills
    set status = v_next_status, updated_at = now()
    where bill_id = p_bill_id
    returning * into v_bill;

  -- audit_logs has no bill or user column (dropped in DC-53), so the description names both.
  insert into public.audit_logs (name, description)
    values ('bill_submitted', format('bill %s: draft → %s, by user %s', p_bill_id, v_next_status, v_user_id));

  return v_bill;
end
$$;
