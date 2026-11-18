-- Author:          Jared Crow
-- Date Created:    11/18/26
-- Last Updated:    11/18/26
-- Ticket:          DC-114 Fix System Admin Permissions
-- Description:     This file fixes the system admin permissions so they can approve bills and submit them for payment.
--                  Why? Because only billing operators could submit bills before.

-- Need to correct two previous functions to allows the right roles the right permissions:
--      Why? Because the last time the submit_bill() and decide_bill() functions were updated, 
--      Only billing_operator could submit, and only financial_approver could approve.

--Extra notes:
--  Run this test in the client folder to test all the changes made in this branch (DC-114):
--      node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --test lib/roles.test.ts


-- submit_bill(): billing_operator, financial_approver and system_admin can all submit.
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
  IF v_user_role IS NULL
     OR v_user_role NOT IN ('billing_operator', 'financial_approver', 'system_admin') THEN
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

-- decide_bill(): financial_approver and system_admin can approve / deny / send back.
CREATE OR REPLACE FUNCTION public.decide_bill(p_bill_id integer, p_decision text, p_note text DEFAULT NULL)
RETURNS public.bills
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id integer;
  v_user_role text;
  v_bad text[];
  v_note text;
  v_bill_status text;
  v_approval_status text;
  v_bill public.bills;
  v_approval_id integer;
BEGIN
  SELECT user_id, role INTO v_user_id, v_user_role
    FROM public.users
    WHERE auth_user_id = (SELECT auth.uid());
  IF v_user_role IS NULL
     OR v_user_role NOT IN ('financial_approver', 'system_admin') THEN
    RAISE SQLSTATE 'PT403' USING MESSAGE = 'forbidden';
  END IF;

  v_note := nullif(btrim(p_note), '');
  v_bad := array_remove(array[
    CASE WHEN p_decision IS NULL OR p_decision NOT IN ('approved', 'needs_revision', 'denied') THEN 'decision' END,
    CASE WHEN char_length(v_note) > 500 THEN 'note' END
  ], NULL);
  IF cardinality(v_bad) > 0 THEN
    RAISE SQLSTATE 'PT400' USING MESSAGE = 'invalid_decision', DETAIL = to_json(v_bad)::text;
  END IF;

  SELECT * INTO v_bill FROM public.bills WHERE bill_id = p_bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE SQLSTATE 'PT404' USING MESSAGE = 'not_found';
  END IF;

  IF v_bill.status <> 'pending_approval' THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'not_pending_approval', DETAIL = v_bill.status;
  END IF;

  SELECT CASE p_decision
      WHEN 'approved' THEN 'pending_payment'
      WHEN 'needs_revision' THEN 'draft'
      ELSE 'approval_denied'
    END,
    CASE p_decision
      WHEN 'approved' THEN 'approved'
      WHEN 'needs_revision' THEN 'needs_revision'
      ELSE 'rejected'
    END
  INTO v_bill_status, v_approval_status;

  SELECT approval_id INTO v_approval_id
    FROM public.approvals
    WHERE bill_id = p_bill_id AND status = 'pending'
    ORDER BY created_at DESC, approval_id DESC
    LIMIT 1;
  IF FOUND THEN
    UPDATE public.approvals
      SET status = v_approval_status, approved_by = v_user_id, time_approved = now(), notes = v_note
      WHERE approval_id = v_approval_id;
  ELSE
    INSERT INTO public.approvals (bill_id, submitted_by, approved_by, status, time_approved, notes)
      VALUES (p_bill_id, v_bill.user_id, v_user_id, v_approval_status, now(), v_note);
  END IF;

  UPDATE public.bills
    SET status = v_bill_status, updated_at = now()
    WHERE bill_id = p_bill_id
    RETURNING * INTO v_bill;

  RETURN v_bill;
END
$$;




