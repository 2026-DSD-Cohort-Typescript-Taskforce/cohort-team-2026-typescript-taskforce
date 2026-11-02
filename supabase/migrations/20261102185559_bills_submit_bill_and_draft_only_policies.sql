-- DC-12: submitting a bill for payment. submit_bill() is the only way a bill leaves
-- draft: in one transaction it checks the caller, the bill and its required fields,
-- moves the bill to pending_payment and writes one audit_logs row. Signed-in users can
-- insert and edit draft bills only, so a submitted bill can't be changed directly.
--
-- Error contract. PostgREST answers a PTxyz SQLSTATE with HTTP status xyz, and
-- supabase-js .rpc('submit_bill', { p_bill_id }) puts the fields in error.code,
-- error.message and error.details. Checked in this order:
--   code   HTTP  message          details
--   PT403  403   forbidden        null (no profile for this login, or user_role isn't billing_operator)
--   PT404  404   not_found        null
--   PT409  409   not_draft        the bill's current status, e.g. pending_payment
--   PT400  400   incomplete_bill  JSON array of every missing field, e.g. ["invoice_number","date_due"]
-- On success it returns the updated bill.

create function public.submit_bill(p_bill_id integer)
returns public.bills
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id bigint;
  v_user_role text;
  v_bill public.bills;
  v_missing text[];
begin
  -- Signed-in users can't change their own user_role (DC-22 column grants).
  select id, user_role into v_user_id, v_user_role
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

  -- modified_at is stored in UTC, like date_received.
  update public.bills
    set status = 'pending_payment', modified_at = now() at time zone 'UTC'
    where bill_id = p_bill_id
    returning * into v_bill;

  insert into public.audit_logs (user_id, bill_id, action, description)
    values (v_user_id, p_bill_id, 'bill_submitted', 'draft → pending_payment');

  return v_bill;
end
$$;

-- New functions in public are executable by PUBLIC and anon by default.
revoke execute on function public.submit_bill(integer) from public, anon;
grant execute on function public.submit_bill(integer) to authenticated;

-- Replaces the open insert and update policies from
-- 20261026232200_create_seed_bills_table.sql. submit_bill() runs as the table owner, so
-- these don't apply to it. The SELECT policy, grants and constraints are unchanged.
drop policy "authenticated users can insert bills" on public.bills;
drop policy "authenticated users can update bills" on public.bills;

create policy "authenticated users can insert draft bills"
  on public.bills for insert
  to authenticated
  with check (status = 'draft');

create policy "authenticated users can update draft bills"
  on public.bills for update
  to authenticated
  using (status = 'draft')
  with check (status = 'draft');
