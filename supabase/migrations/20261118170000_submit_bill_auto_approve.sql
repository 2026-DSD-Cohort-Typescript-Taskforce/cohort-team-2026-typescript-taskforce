-- submit_bill() takes p_auto_approve: true, on the straight-through pending_payment path,
-- records one approved approvals row for the signed-in caller so autopay can accept the bill.
-- A bill sent to pending_approval ignores the flag. Adding a parameter makes a new function,
-- so the two-argument function is dropped and the grants are set again. Both new arguments
-- default to false, so existing submit_bill(p_bill_id) and submit_bill(p_bill_id, true) calls
-- keep working. Body is otherwise copied from 20261118150000.

DROP FUNCTION public.submit_bill(integer, boolean);

CREATE FUNCTION public.submit_bill(p_bill_id integer, p_needs_approval boolean DEFAULT false, p_auto_approve boolean DEFAULT false)
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
  IF v_user_role IS NULL OR v_user_role NOT IN ('billing_operator', 'financial_approver', 'system_admin') THEN
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

  -- Asked for approval, or sent back for revision (from 20261110180000): to the approver.
  -- p_auto_approve does not apply here.
  IF coalesce(p_needs_approval, false)
     OR (SELECT a.status FROM public.approvals a
           WHERE a.bill_id = p_bill_id
           ORDER BY a.created_at DESC, a.approval_id DESC
           LIMIT 1) = 'needs_revision' THEN
    v_next_status := 'pending_approval';
    INSERT INTO public.approvals (bill_id, submitted_by, status)
      VALUES (p_bill_id, v_user_id, 'pending');
  ELSE
    v_next_status := 'pending_payment';
    IF coalesce(p_auto_approve, false) THEN
      INSERT INTO public.approvals (bill_id, submitted_by, approved_by, status, time_approved, notes)
        VALUES (
          p_bill_id,
          v_user_id,
          v_user_id,
          'approved',
          now(),
          'Recorded by invoice extraction so the bill can be paid.'
        );
    END IF;
  END IF;

  UPDATE public.bills
    SET status = v_next_status, updated_at = now()
    WHERE bill_id = p_bill_id
    RETURNING * INTO v_bill;

  RETURN v_bill;
END
$$;

REVOKE EXECUTE ON FUNCTION public.submit_bill(integer, boolean, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_bill(integer, boolean, boolean) TO authenticated;
