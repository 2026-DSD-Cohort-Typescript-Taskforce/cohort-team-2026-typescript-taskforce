-- Lets an extracted bill reach pending_payment. A partly read bill is saved as a draft
-- instead of being lost, the same PDF can belong to one bill only, vendors get the
-- portal login the payment side needs, submit_bill() also requires a payment method,
-- and users may move their pending upload into bills/.

-- Drafts may be missing details while someone finishes them. A bill that left draft
-- must have them all; submit_bill() checks the same fields first with a clearer error.
ALTER TABLE public.bills
  ALTER COLUMN vendor_id   DROP NOT NULL,
  ALTER COLUMN property_id DROP NOT NULL,
  ALTER COLUMN payment_id  DROP NOT NULL,
  ALTER COLUMN amount      DROP NOT NULL,
  ADD CONSTRAINT bills_complete_unless_draft CHECK (
    status = 'draft'
    OR (vendor_id IS NOT NULL AND property_id IS NOT NULL
        AND payment_id IS NOT NULL AND amount IS NOT NULL)
  );

-- The same PDF can belong to one bill only.
DROP INDEX public.bills_pdf_sha256_idx;
CREATE UNIQUE INDEX bills_pdf_sha256_key ON public.bills (pdf_sha256);

-- The vendor's payment portal login, for the payment side.
ALTER TABLE public.vendors
  ADD COLUMN portal_username TEXT,
  ADD COLUMN portal_password TEXT;

-- vendors stays public, except the login: signed-out visitors can read every other column.
REVOKE SELECT ON public.vendors FROM anon;
GRANT SELECT (vendor_id, name, address, contact_name, phone, payment_portal_url,
              supported_payment_methods, created_at, updated_at)
  ON public.vendors TO anon;

-- Same contract as before; payment_id and an empty amount are now reported as missing too.
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

  v_missing := array_remove(array[
    CASE WHEN v_bill.vendor_id IS NULL THEN 'vendor_id' END,
    CASE WHEN v_bill.property_id IS NULL THEN 'property_id' END,
    CASE WHEN v_bill.payment_id IS NULL THEN 'payment_id' END,
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

-- Lets a user file their own pending upload under bills/ (Storage move is an UPDATE).
CREATE POLICY "bill documents: file own pending under bills"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'bill-documents'
    AND (storage.foldername(name))[1] = 'pending'
    AND (storage.foldername(name))[2] = (
      SELECT user_id::text FROM public.users WHERE auth_user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'bill-documents'
    AND (storage.foldername(name))[1] = 'bills'
  );
