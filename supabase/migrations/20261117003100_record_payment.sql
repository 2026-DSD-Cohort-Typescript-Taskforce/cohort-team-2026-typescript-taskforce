-- record_payment is the only new writer that marks a bill paid. bill-mcp calls it
-- with the service role after the Stagehand worker returns 2xx. It repeats the
-- gate: the bill is pending_payment, the newest approval is approved, and the
-- amount, vendor, and invoice match that row. The same idempotency key returns
-- the payment already written. anon and authenticated cannot execute it, so a
-- browser session cannot skip the worker by calling this function.

alter table public.payments add column idempotency_key text;
create unique index payments_idempotency_key_key on public.payments (idempotency_key);

create function public.record_payment(
  p_bill_id integer,
  p_amount numeric,
  p_vendor_id integer,
  p_invoice_number text,
  p_idempotency_key text
)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_bill public.bills;
  v_existing public.payments;
  v_approval text;
begin
  v_key := nullif(btrim(p_idempotency_key), '');
  if v_key is null then
    raise sqlstate 'PT400' using message = 'invalid_idempotency_key';
  end if;

  select * into v_bill from public.bills where bill_id = p_bill_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  select * into v_existing from public.payments where idempotency_key = v_key;
  if found then
    if v_existing.bill_id is distinct from p_bill_id then
      raise sqlstate 'PT409' using message = 'idempotency_conflict';
    end if;
    return v_existing;
  end if;

  if v_bill.status <> 'pending_payment' then
    raise sqlstate 'PT409' using message = 'not_pending_payment', detail = v_bill.status;
  end if;
  if v_bill.amount is distinct from p_amount
     or v_bill.vendor_id is distinct from p_vendor_id
     or v_bill.invoice_number is distinct from p_invoice_number then
    raise sqlstate 'PT409' using message = 'snapshot_mismatch';
  end if;

  select status into v_approval
    from public.approvals
    where bill_id = p_bill_id
    order by created_at desc, approval_id desc
    limit 1;
  if v_approval is distinct from 'approved' then
    raise sqlstate 'PT409' using message = 'not_approved';
  end if;

  insert into public.payments (bill_id, status, time_paid, idempotency_key)
    values (p_bill_id, 'success', now(), v_key)
    returning * into v_existing;

  update public.bills
    set status = 'payment_success', updated_at = now()
    where bill_id = p_bill_id;

  return v_existing;
end
$$;

revoke all on function public.record_payment(integer, numeric, integer, text, text) from public;
revoke execute on function public.record_payment(integer, numeric, integer, text, text) from anon, authenticated;
grant execute on function public.record_payment(integer, numeric, integer, text, text) to service_role;
