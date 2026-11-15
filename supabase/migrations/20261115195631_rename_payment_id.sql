-- Author:          Jared Crow
-- Date Created:    11/15/26
-- Date Finished:   11/15/26
-- Ticket:          DC-108 Extra Supabase Edits
-- Description:     This file renames the primary keys in payment_methods, cards, & bank_accounts from payment_id to payment_method_id.

--                  Why? Because the primary key in payments table is also named payment_id.
--                  Therefore, the relationship bills has with payments isn't confused with it's relationship with payment_methods.

--                  HOWEVER,
--                  Doing so also means renaming any and all references to payment_id in the codebase that aren't referring to the payments table.

ALTER TABLE bills               RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE payment_methods     RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE cards               RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE bank_accounts       RENAME COLUMN payment_id TO payment_method_id;

-- Claude said I need to add this to make sure the rename doesn't break anything:
ALTER SEQUENCE payment_methods_payment_id_seq RENAME TO payment_methods_payment_method_id_seq;

-- Also, this function from the migration 20261111062000_drafts_may_be_incomplete_and_vendor_logins.sql
-- has to be re-typed, but with ONE line changed:
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

  -- Renamed payment_id to payment_method_id here. That's the only change to this function:
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

  UPDATE public.bills
    SET status = 'pending_payment', updated_at = now()
    WHERE bill_id = p_bill_id
    RETURNING * INTO v_bill;

  INSERT INTO public.audit_logs (name, description)
    VALUES ('bill_submitted', format('bill %s: draft → pending_payment, by user %s', p_bill_id, v_user_id));

  RETURN v_bill;
END
$$;







