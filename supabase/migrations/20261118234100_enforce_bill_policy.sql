-- DC-92: apply the vendor's active policy (evaluate_bill_policy, 20261118234000) where a bill
-- moves on: at submit, when a payment is prepared, and when the worker claims an authorized
-- attempt. Adds send_bill_for_approval, which sends a queued bill back to the approver when
-- its policy now needs an approval. Refusals are PT409 with the evaluator's JSON in details
-- (policy_blocked, approval_required, policy_changed). submit_bill, prepare_payment and
-- start_payment_submission are copies of their latest definitions (20261118150000,
-- 20261117200000) with only these additions; signatures and grants are unchanged and
-- re-stated. No hand-written audit rows are added: the DC-101 row triggers log the changes.

-- submit_bill(): copied from 20261118150000. After the completeness check, a block rule keeps
-- the bill a draft (PT409 policy_blocked, details = the evaluator's JSON) and a
-- require_approval rule sends it to the approver even when p_needs_approval is false. allow
-- and none change nothing, so an approval the operator asked for stays.
CREATE OR REPLACE FUNCTION public.submit_bill(p_bill_id integer, p_needs_approval boolean DEFAULT false)
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
  v_policy jsonb;
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

  -- The vendor's active policy (DC-92). A blocked bill stays a draft.
  v_policy := public.evaluate_bill_policy(p_bill_id);
  IF v_policy ->> 'decision' = 'block' THEN
    RAISE SQLSTATE 'PT409' USING MESSAGE = 'policy_blocked', DETAIL = v_policy::text;
  END IF;

  -- Asked for approval, required by the vendor's policy, or sent back for revision (from
  -- 20261110180000): to the approver.
  IF coalesce(p_needs_approval, false)
     OR v_policy ->> 'decision' = 'require_approval'
     OR (SELECT a.status FROM public.approvals a
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

REVOKE EXECUTE ON FUNCTION public.submit_bill(integer, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_bill(integer, boolean) TO authenticated;

-- prepare_payment(): copied from 20261117200000. Only the trusted service (service_role) calls
-- it. It creates the pending attempt a person later authorizes, with the summary fixed at this
-- moment. Preparing again supersedes any earlier pending or authorized attempt for the bill.
-- DC-92: after the not_payable check, and before anything is superseded (so a refusal changes
-- nothing), the vendor's active policy is applied; policy_refs is computed here, and
-- p_policy_refs is still checked to be an array but no longer stored.
--
-- Error contract (PostgREST answers PTxyz with HTTP xyz; error.code, .message, .details).
-- Checked in this order:
--   code   HTTP  message              details
--   PT403  403   forbidden            null (p_prepared_by is NULL, unknown, or a viewer)
--   PT400  400   invalid_payment      JSON array of the bad fields, in this order: fees_cents (NULL,
--                                     negative or over 999999999999), payment_date (NULL or not within one day of
--                                     today), account_reference (over 100 characters once
--                                     trimmed), policy_refs (NULL or not a JSON array)
--   PT404  404   not_found            null (no such bill, or NULL)
--   PT409  409   payment_in_progress  payment_id of the processing or unknown attempt
--   PT409  409   already_paid         payment_id of the successful attempt
--   PT409  409   not_payable          the bill's status, unless pending_payment or payment_failed
--   PT409  409   policy_blocked       the evaluator's JSON (the vendor's active policy blocks the bill)
--   PT409  409   approval_required    the evaluator's JSON (require_approval, and the bill has no
--                                     qualifying approval: bill_has_qualifying_approval)
-- policy_refs is [{ policy_id, version_id, version, decision }] for the vendor's active
-- version, or [] when there is none (no policy, policy off, no confirmed version).
-- The account reference is trimmed and blank becomes NULL. Audit text never holds amounts or
-- the account reference.
create or replace function public.prepare_payment(
  p_bill_id integer,
  p_prepared_by integer,
  p_fees_cents bigint,
  p_payment_date date,
  p_account_reference text default null,
  p_policy_refs jsonb default '[]'::jsonb
) returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting('app.payments_write', true);
  v_role text;
  v_account text;
  v_bad text[];
  v_bill public.bills;
  v_payment_id integer;
  v_old record;
  v_row public.payments;
  v_policy jsonb;
begin
  select role into v_role from public.users where user_id = p_prepared_by;
  if v_role is null or v_role not in ('billing_operator', 'financial_approver', 'system_admin') then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  v_account := nullif(btrim(p_account_reference), '');
  v_bad := array_remove(array[
    case when p_fees_cents is null or p_fees_cents < 0 or p_fees_cents > 999999999999 then 'fees_cents' end,
    case when p_payment_date is null
      or p_payment_date not between current_date - 1 and current_date + 1 then 'payment_date' end,
    case when char_length(v_account) > 100 then 'account_reference' end,
    case when jsonb_typeof(p_policy_refs) is distinct from 'array' then 'policy_refs' end
  ], null);
  if cardinality(v_bad) > 0 then
    raise sqlstate 'PT400' using message = 'invalid_payment', detail = to_json(v_bad)::text;
  end if;

  -- Supabase (supautils) refuses a function-level `set app.payments_write`, so the write marker
  -- is switched on here, for this transaction, and put back before returning. Any error rolls
  -- it back with the rest of the call.
  perform set_config('app.payments_write', 'on', true);

  -- The row lock makes a concurrent preparation or payment on the same bill wait, then see it.
  select * into v_bill from public.bills where bill_id = p_bill_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  select payment_id into v_payment_id from public.payments
    where bill_id = p_bill_id and status in ('processing', 'unknown');
  if found then
    raise sqlstate 'PT409' using message = 'payment_in_progress', detail = v_payment_id::text;
  end if;

  select payment_id into v_payment_id from public.payments
    where bill_id = p_bill_id and status = 'success';
  if found then
    raise sqlstate 'PT409' using message = 'already_paid', detail = v_payment_id::text;
  end if;

  if v_bill.status not in ('pending_payment', 'payment_failed') then
    raise sqlstate 'PT409' using message = 'not_payable', detail = v_bill.status;
  end if;

  -- The vendor's active policy (DC-92), before anything is superseded.
  v_policy := public.evaluate_bill_policy(p_bill_id);
  if v_policy ->> 'decision' = 'block' then
    raise sqlstate 'PT409' using message = 'policy_blocked', detail = v_policy::text;
  end if;
  if v_policy ->> 'decision' = 'require_approval'
     and not public.bill_has_qualifying_approval(p_bill_id) then
    raise sqlstate 'PT409' using message = 'approval_required', detail = v_policy::text;
  end if;

  -- Supersede earlier pending or authorized attempts, one audit row per transition.
  for v_old in
    select payment_id, status from public.payments
      where bill_id = p_bill_id and status in ('pending', 'authorized')
      order by payment_id for update
  loop
    update public.payments
      set status = 'expired', outcome_code = 'superseded', outcome_at = now()
      where payment_id = v_old.payment_id;
    insert into public.audit_logs (name, description)
      values ('payment_superseded', format('payment %s (bill %s): %s → expired, by user %s, outcome superseded',
        v_old.payment_id, p_bill_id, v_old.status, p_prepared_by));
  end loop;

  -- The summary is fixed here; its hash comes from the exact values inserted.
  v_row.bill_id := p_bill_id;
  v_row.status := 'pending';
  v_row.vendor_id := v_bill.vendor_id;
  v_row.payment_method_id := v_bill.payment_method_id;
  v_row.invoice_number := v_bill.invoice_number;
  v_row.account_reference := v_account;
  v_row.amount_cents := (v_bill.amount * 100)::bigint;
  v_row.fees_cents := p_fees_cents;
  v_row.total_cents := v_row.amount_cents + p_fees_cents;
  v_row.currency := 'USD';
  v_row.payment_date := p_payment_date;
  -- The policy version this attempt is prepared against, or none (DC-92).
  v_row.policy_refs := case when v_policy ->> 'version_id' is null then '[]'::jsonb
    else jsonb_build_array(jsonb_build_object(
      'policy_id', v_policy -> 'policy_id',
      'version_id', v_policy -> 'version_id',
      'version', v_policy -> 'version',
      'decision', v_policy -> 'decision'))
  end;
  v_row.prepared_by := p_prepared_by;
  v_row.summary_hash := public.payment_summary_hash(v_row);

  insert into public.payments (bill_id, status, vendor_id, payment_method_id, invoice_number,
    account_reference, amount_cents, fees_cents, total_cents, currency, payment_date,
    summary_hash, policy_refs, prepared_by)
  values (v_row.bill_id, v_row.status, v_row.vendor_id, v_row.payment_method_id, v_row.invoice_number,
    v_row.account_reference, v_row.amount_cents, v_row.fees_cents, v_row.total_cents, v_row.currency,
    v_row.payment_date, v_row.summary_hash, v_row.policy_refs, v_row.prepared_by)
  returning * into v_row;

  insert into public.audit_logs (name, description)
    values ('payment_prepared', format('payment %s (bill %s): new → pending, by user %s, policies %s',
      v_row.payment_id, p_bill_id, p_prepared_by, v_row.policy_refs));

  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_row;
end
$$;

-- Service-only: revoke what PUBLIC and Supabase's default privileges grant, then grant.
revoke execute on function public.prepare_payment(integer, integer, bigint, date, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_payment(integer, integer, bigint, date, text, jsonb) to service_role;

-- start_payment_submission(): copied from 20261117200000. Only the trusted service
-- (service_role) calls it. It is the atomic claim the worker makes before any charge: it moves
-- an authorized attempt to processing, or refuses.
--
-- start_payment_submission(p_payment_id) locks the bill, then the attempt, so two concurrent
-- claims serialize and the second sees processing. The order is the same as prepare_payment's,
-- so a claim racing a re-preparation of the same bill waits instead of deadlocking. Every
-- payment function that locks both rows locks the bill first (the attempt's bill_id never
-- changes; authorize_payment and cancel_payment lock only the attempt). Error contract, in
-- this order:
--   code   HTTP  message                details
--   PT404  404   not_found              null (no such payment, or NULL)
--   PT409  409   not_authorized         the status, unless authorized
--   PT409  409   authorization_expired  null (the 15 minutes are over, by the wall clock read
--                                       after both locks are held)
--   PT403  403   forbidden              null (the authorizer is no longer a billing_operator,
--                                       financial_approver or system_admin)
--   PT409  409   not_payable            the bill's status, unless pending_payment or payment_failed
--   PT409  409   summary_stale          JSON array of the bill fields that no longer match the
--                                       attempt, in this order: amount_cents, vendor_id,
--                                       payment_method_id, invoice_number
--   PT409  409   policy_blocked         the evaluator's JSON (DC-92: the vendor's active policy
--                                       blocks the bill)
--   PT409  409   policy_changed         the evaluator's JSON (the active version is not the one
--                                       in the attempt's policy_refs, including a version
--                                       appearing or disappearing; the admin triggers again)
--   PT409  409   approval_required      the evaluator's JSON (require_approval, and the bill has
--                                       no qualifying approval)
-- Success: the attempt is processing with submitted_at set to that same wall-clock time, and
-- the bill is processing. The check can't use now(): it is frozen at the start of the
-- transaction, so a claim that waited for a lock would still see an expired yes as valid.
create or replace function public.start_payment_submission(p_payment_id integer)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting('app.payments_write', true);
  v_payment public.payments;
  v_bill public.bills;
  v_bill_id integer;
  v_role text;
  v_bad text[];
  v_row public.payments;
  v_claimed_at timestamptz;
  v_policy jsonb;
begin
  -- Lock the bill first, then the attempt, as prepare_payment does (no deadlock when they race).
  select bill_id into v_bill_id from public.payments where payment_id = p_payment_id;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;
  select * into v_bill from public.bills where bill_id = v_bill_id for update;
  select * into v_payment from public.payments where payment_id = p_payment_id for update;
  -- Read the clock only now that both locks are held (now() is the transaction's start).
  v_claimed_at := clock_timestamp();

  if v_payment.status <> 'authorized' then
    raise sqlstate 'PT409' using message = 'not_authorized', detail = v_payment.status;
  end if;
  if v_claimed_at >= v_payment.authorization_expires_at then
    raise sqlstate 'PT409' using message = 'authorization_expired';
  end if;

  select role into v_role from public.users where user_id = v_payment.authorized_by;
  if v_role is null or v_role not in ('billing_operator', 'financial_approver', 'system_admin') then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  if v_bill.status not in ('pending_payment', 'payment_failed') then
    raise sqlstate 'PT409' using message = 'not_payable', detail = v_bill.status;
  end if;

  v_bad := array_remove(array[
    case when (v_bill.amount * 100)::bigint is distinct from v_payment.amount_cents then 'amount_cents' end,
    case when v_bill.vendor_id is distinct from v_payment.vendor_id then 'vendor_id' end,
    case when v_bill.payment_method_id is distinct from v_payment.payment_method_id then 'payment_method_id' end,
    case when v_bill.invoice_number is distinct from v_payment.invoice_number then 'invoice_number' end
  ], null);
  if cardinality(v_bad) > 0 then
    raise sqlstate 'PT409' using message = 'summary_stale', detail = to_json(v_bad)::text;
  end if;

  -- The vendor's active policy (DC-92). A block refuses outright, since triggering again would
  -- not help. Otherwise the attempt must have been prepared against the version active now
  -- (policy_refs is [] for none, so both null means unchanged), and require_approval still
  -- needs a qualifying approval.
  v_policy := public.evaluate_bill_policy(v_bill.bill_id);
  if v_policy ->> 'decision' = 'block' then
    raise sqlstate 'PT409' using message = 'policy_blocked', detail = v_policy::text;
  end if;
  if (v_payment.policy_refs -> 0 ->> 'version_id')::integer
       is distinct from (v_policy ->> 'version_id')::integer then
    raise sqlstate 'PT409' using message = 'policy_changed', detail = v_policy::text;
  end if;
  if v_policy ->> 'decision' = 'require_approval'
     and not public.bill_has_qualifying_approval(v_bill.bill_id) then
    raise sqlstate 'PT409' using message = 'approval_required', detail = v_policy::text;
  end if;

  perform set_config('app.payments_write', 'on', true);

  update public.payments
    set status = 'processing', submitted_at = v_claimed_at
    where payment_id = v_payment.payment_id
    returning * into v_row;

  update public.bills set status = 'processing', updated_at = now() where bill_id = v_payment.bill_id;

  insert into public.audit_logs (name, description)
    values ('payment_submitted', format('payment %s (bill %s): authorized → processing, by service',
      v_row.payment_id, v_row.bill_id));

  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_row;
end
$$;

-- Service only: revoke what PUBLIC and Supabase's default privileges grant, then grant.
revoke execute on function public.start_payment_submission(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.start_payment_submission(integer) to service_role;

-- send_bill_for_approval(): spec decision 2. A bill already queued for payment
-- (pending_payment or payment_failed) whose vendor policy now says require_approval, and that
-- has no qualifying approval, goes back to pending_approval when someone triggers its payment:
-- a new pending approvals row submitted by that person, and its pending or authorized attempt
-- expired as superseded. Only the trusted service calls it. It locks the bill, then the
-- attempt, like the payment functions, and sets the payments write marker the same way. The
-- DC-101 row triggers log the bill, approval and payment changes; nothing is logged by hand.
-- Error contract, in this order:
--   code   HTTP  message                details
--   PT403  403   forbidden              null (p_requested_by is NULL, unknown, or a viewer)
--   PT404  404   not_found              null (no such bill, or NULL)
--   PT409  409   not_payable            the bill's status, unless pending_payment or payment_failed
--   PT409  409   payment_in_progress    payment_id of the processing or unknown attempt
--   PT409  409   approval_not_required  the evaluator's JSON (the decision is not
--                                       require_approval, or the bill has a qualifying approval)
-- Success returns the evaluator's JSON, read before the bill's status changes.
create function public.send_bill_for_approval(p_bill_id integer, p_requested_by integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting('app.payments_write', true);
  v_role text;
  v_bill public.bills;
  v_payment_id integer;
  v_policy jsonb;
begin
  select role into v_role from public.users where user_id = p_requested_by;
  if v_role is null or v_role not in ('billing_operator', 'financial_approver', 'system_admin') then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  -- The bill first, then its attempt (below), as the payment functions lock them.
  select * into v_bill from public.bills where bill_id = p_bill_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  if v_bill.status not in ('pending_payment', 'payment_failed') then
    raise sqlstate 'PT409' using message = 'not_payable', detail = v_bill.status;
  end if;

  select payment_id into v_payment_id from public.payments
    where bill_id = p_bill_id and status in ('processing', 'unknown');
  if found then
    raise sqlstate 'PT409' using message = 'payment_in_progress', detail = v_payment_id::text;
  end if;

  v_policy := public.evaluate_bill_policy(p_bill_id);
  if v_policy ->> 'decision' is distinct from 'require_approval'
     or public.bill_has_qualifying_approval(p_bill_id) then
    raise sqlstate 'PT409' using message = 'approval_not_required', detail = v_policy::text;
  end if;

  -- Supabase (supautils) refuses a function-level `set app.payments_write`, so the write marker
  -- is switched on here, for this transaction, and put back before returning. Any error rolls
  -- it back with the rest of the call.
  perform set_config('app.payments_write', 'on', true);

  -- At most one attempt is pending or authorized (payments_one_open_attempt_per_bill).
  update public.payments
    set status = 'expired', outcome_code = 'superseded', outcome_at = now()
    where bill_id = p_bill_id and status in ('pending', 'authorized');

  update public.bills set status = 'pending_approval', updated_at = now() where bill_id = p_bill_id;

  insert into public.approvals (bill_id, submitted_by, status)
    values (p_bill_id, p_requested_by, 'pending');

  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_policy;
end
$$;

-- Service only: revoke what PUBLIC and Supabase's default privileges grant, then grant.
revoke execute on function public.send_bill_for_approval(integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.send_bill_for_approval(integer, integer) to service_role;
