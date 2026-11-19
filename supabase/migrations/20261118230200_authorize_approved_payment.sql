-- Service-only authorization for scheduled payments. The latest real bill approval supplies
-- the authorizing user; cron never stores or impersonates an expiring user session.
create function public.authorize_approved_payment(p_payment_id integer)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_lifetime constant interval := interval '15 minutes';
  v_marker text := current_setting('app.payments_write', true);
  v_payment public.payments;
  v_approval public.approvals;
  v_row public.payments;
begin
  select * into v_payment
    from public.payments
    where payment_id = p_payment_id
    for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;
  if v_payment.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'not_pending', detail = v_payment.status;
  end if;
  if v_payment.prepared_by is null then
    raise sqlstate 'PT409' using message = 'not_prepared';
  end if;
  if v_payment.payment_date is null
     or v_payment.payment_date not between current_date - 1 and current_date + 1 then
    raise sqlstate 'PT409' using message = 'summary_stale', detail = '["payment_date"]';
  end if;

  select * into v_approval
    from public.approvals
    where bill_id = v_payment.bill_id
    order by created_at desc, approval_id desc
    limit 1;
  if not found or v_approval.status <> 'approved' or v_approval.approved_by is null then
    raise sqlstate 'PT409' using message = 'not_approved';
  end if;

  perform set_config('app.payments_write', 'on', true);
  update public.payments
    set status = 'authorized', authorized_by = v_approval.approved_by,
        authorized_at = now(), authorization_expires_at = now() + c_lifetime
    where payment_id = v_payment.payment_id
    returning * into v_row;
  insert into public.audit_logs (name, description)
    values ('payment_authorized', format(
      'payment %s (bill %s): pending → authorized, by approved user %s via service, policies %s',
      v_row.payment_id, v_row.bill_id, v_approval.approved_by, v_row.policy_refs));
  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_row;
end
$$;

revoke execute on function public.authorize_approved_payment(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.authorize_approved_payment(integer) to service_role;
