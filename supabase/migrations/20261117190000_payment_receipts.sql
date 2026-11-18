-- DC-112: optional private receipt evidence, independent of payment success.
-- Existing blanket payment writes would let callers reassign another bill's receipt.
-- The service-only record/receipt RPCs remain the authoritative writers.
revoke all on table public.payments from anon, authenticated;
grant select on table public.payments to authenticated;
revoke all on sequence public.payments_payment_id_seq from anon, authenticated;
alter table public.payments
  add column receipt_path text,
  add column receipt_status text not null default 'unavailable' check (receipt_status in ('unavailable', 'failed', 'stored')),
  add column receipt_error text check (receipt_error in ('capture_failed', 'upload_failed', 'unavailable')),
  add constraint payment_receipt_consistent check (
    (receipt_status = 'stored' and receipt_path is not null and receipt_path = 'payments/' || payment_id::text || '/receipt.png' and receipt_error is null)
    or (receipt_status <> 'stored' and receipt_path is null)
  );

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('payment-receipts', 'payment-receipts', false, 2097152, array['image/png']);

-- One access rule shared by signed image access and upload-only retry lookup.
create function public.can_view_payment_receipt(p_payment_id integer)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.payments p join public.bills b on b.bill_id = p.bill_id
    join public.users u on u.auth_user_id = (select auth.uid())
    where p.payment_id = p_payment_id and p.status = 'success'
      and (b.user_id = u.user_id or u.role in ('financial_approver', 'system_admin'))
  );
$$;
revoke all on function public.can_view_payment_receipt(integer) from public, anon;
grant execute on function public.can_view_payment_receipt(integer) to authenticated;

create function public.can_view_payment_receipt_path(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.payments p
    where p.receipt_path = p_path and p.receipt_status = 'stored'
      and public.can_view_payment_receipt(p.payment_id));
$$;
revoke all on function public.can_view_payment_receipt_path(text) from public, anon;
grant execute on function public.can_view_payment_receipt_path(text) to authenticated;

create policy "payment receipts: authorized read" on storage.objects for select to authenticated
using (bucket_id = 'payment-receipts' and public.can_view_payment_receipt_path(name));

create function public.get_payment_receipt(p_bill_id integer, p_payment_id integer)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not public.can_view_payment_receipt(p_payment_id) then
    raise sqlstate 'PT404' using message = 'receipt_not_found';
  end if;
  select jsonb_build_object('payment_id', p.payment_id, 'billId', b.bill_id,
    'amount', b.amount, 'vendorId', b.vendor_id, 'invoiceNumber', b.invoice_number,
    'idempotencyKey', p.idempotency_key, 'receipt_path', p.receipt_path,
    'receipt_status', p.receipt_status, 'status', p.status)
  into v_result from public.payments p join public.bills b on b.bill_id = p.bill_id
  where p.payment_id = p_payment_id and b.bill_id = p_bill_id;
  if v_result is null then raise sqlstate 'PT404' using message = 'receipt_not_found'; end if;
  return v_result;
end;
$$;
revoke all on function public.get_payment_receipt(integer, integer) from public, anon;
grant execute on function public.get_payment_receipt(integer, integer) to authenticated;

-- Only trusted bill-mcp associates uploaded bytes with a recorded successful payment.
create function public.set_payment_receipt(
  p_payment_id integer, p_bill_id integer, p_idempotency_key text,
  p_path text, p_error text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare v_payment public.payments;
begin
  select * into v_payment from public.payments where payment_id = p_payment_id for update;
  if not found or v_payment.bill_id is distinct from p_bill_id
    or v_payment.idempotency_key is distinct from p_idempotency_key
    or v_payment.status is distinct from 'success' then
    raise sqlstate 'PT409' using message = 'receipt_payment_mismatch';
  end if;
  if p_path is not null and (p_path <> 'payments/' || p_payment_id::text || '/receipt.png' or p_error is not null) then
    raise sqlstate 'PT400' using message = 'invalid_receipt_path';
  end if;
  if p_path is null and (p_error is null or p_error not in ('capture_failed', 'upload_failed', 'unavailable')) then
    raise sqlstate 'PT400' using message = 'invalid_receipt_error';
  end if;
  if v_payment.receipt_status = 'stored' then return v_payment; end if;
  update public.payments set receipt_path = p_path,
    receipt_status = case when p_path is null then 'failed' else 'stored' end,
    receipt_error = p_error where payment_id = p_payment_id returning * into v_payment;
  return v_payment;
end;
$$;
revoke all on function public.set_payment_receipt(integer, integer, text, text, text) from public, anon, authenticated;
grant execute on function public.set_payment_receipt(integer, integer, text, text, text) to service_role;
