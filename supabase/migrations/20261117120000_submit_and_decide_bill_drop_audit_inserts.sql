-- DC-102: submit_bill and decide_bill stop writing their own audit_logs rows. The DC-101
-- trigger already logs the bill change (bill_submitted, bill_approved, bill_needs_revision,
-- bill_denied, from audit_actions) and the approvals row, with the caller as actor, so the
-- hand-written rows recorded every call twice. Bodies are otherwise copied unchanged from
-- 20261115195631 (submit_bill) and 20261109200000 (decide_bill); create or replace keeps
-- their grants.

CREATE OR REPLACE FUNCTION public.submit_bill(p_bill_id integer)
RETURNS public.bills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id integer;
  v_user_role text;
  v_bill public.bills;
  v_missing text[];
  v_next_status text;
BEGIN
  SELECT user_id, role INTO v_user_id, v_user_role
    FROM public.users
    WHERE auth_user_id = (SELECT auth.uid());
  IF v_user_role IS DISTINCT FROM 'billing_operator' THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'forbidden';
  END IF;

  SELECT * INTO v_bill FROM public.bills WHERE bill_id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'not_found';
  END IF;

  IF v_bill.status <> 'draft' THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'not_draft', DETAIL = v_bill.status;
  END IF;

  v_missing := array_remove(array[
    CASE WHEN v_bill.vendor_id IS NULL THEN 'vendor_id' END,
    CASE WHEN v_bill.property_id IS NULL THEN 'property_id' END,
    CASE WHEN v_bill.payment_method_id IS NULL THEN 'payment_method_id' END,
    CASE WHEN v_bill.invoice_number IS NULL THEN 'invoice_number' END,
    CASE WHEN v_bill.amount IS NULL OR v_bill.amount <= 0 THEN 'amount' END,
    CASE WHEN v_bill.date_due IS NULL THEN 'date_due' END
  ], NULL);
  IF cardinality(v_missing) > 0 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'incomplete_bill', DETAIL = to_json(v_missing)::text;
  END IF;

  -- A bill sent back for revision goes back to the approver (from 20261110180000).
  IF (SELECT a.status FROM public.approvals a
        WHERE a.bill_id = p_bill_id
        ORDER BY a.created_at DESC, a.approval_id DESC
        LIMIT 1) = 'needs_revision' THEN
    v_next_status := 'pending_approval';
    INSERT INTO public.approvals (bill_id, submitted_by, status)
      VALUES (p_bill_id, v_user_id, 'pending');
  ELSE
    v_next_status := 'pending_payment';
  END IF;

  UPDATE public.bills
    SET status = v_next_status, updated_at = now()
    WHERE bill_id = p_bill_id
    RETURNING * INTO v_bill;

  RETURN v_bill;
END
$$;

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
