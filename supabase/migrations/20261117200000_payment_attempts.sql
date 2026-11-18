-- DC-89: payment attempts and explicit payment authorization. A payments row is one
-- attempt to pay one bill. It records the exact summary a person authorized (vendor,
-- invoice, account reference, method, amount, fees, total, currency, date) plus its hash,
-- and moves through a fixed set of statuses. Nobody writes to payments directly: signed-in
-- users and service_role can only read it, and every write goes through the security
-- definer functions below (added section by section), which set app.payments_write = 'on'.
-- The payments_guard trigger is the backstop: it refuses any write without that marker,
-- any DELETE and any TRUNCATE (a second trigger), any illegal status change, any change to the authorized summary, and any
-- row missing the columns its status needs. DC-112's set_payment_receipt is recreated with the
-- marker in Section 5.
--
-- Statuses and transitions:
--   pending    -> authorized | canceled | expired
--   authorized -> processing | canceled | expired
--   processing -> success | failure | unknown
--   unknown    -> success | failure
--
-- Section 1: schema, value checks, one open attempt per bill, summary functions, guard
-- trigger and privileges.

-- New columns. Legacy rows get their summary backfilled from the bill below.
alter table public.payments
  add column vendor_id integer references public.vendors (vendor_id),
  add column payment_method_id integer references public.payment_methods (payment_method_id),
  add column invoice_number text,
  add column account_reference text,
  add column amount_cents bigint,
  add column fees_cents bigint not null default 0,
  add column total_cents bigint,
  add column currency char(3),
  add column payment_date date,
  add column summary_hash text,
  add column policy_refs jsonb not null default '[]'::jsonb,
  add column prepared_by integer references public.users (user_id),
  add column authorized_by integer references public.users (user_id),
  add column canceled_by integer references public.users (user_id),
  add column authorized_at timestamptz,
  add column authorization_expires_at timestamptz,
  add column submitted_at timestamptz,
  add column outcome_at timestamptz,
  add column outcome_code text,
  add column outcome_message text,
  add column transaction_reference text,
  add column updated_at timestamptz not null default now();

-- idempotency_key came with #59 (text, unique index payments_idempotency_key_key). It stays
-- text, because #59's rows hold keys like 'portal-12'. From now on every attempt has one.
update public.payments set idempotency_key = gen_random_uuid()::text where idempotency_key is null;
alter table public.payments
  alter column idempotency_key set default gen_random_uuid()::text,
  alter column idempotency_key set not null;

-- The authorized summary and its hash. Read-only functions of a row the caller can already
-- read; the writer functions call them as owner. The jsonb is the exact thing a client
-- echoes back to authorize, so keep its keys and formats stable.
create function public.payment_summary(p public.payments) returns jsonb
language sql stable
set search_path = ''
as $$
  select jsonb_build_object(
    'bill_id', p.bill_id,
    'vendor_id', p.vendor_id,
    'invoice_number', p.invoice_number,
    'account_reference', p.account_reference,
    'payment_method_id', p.payment_method_id,
    'amount_cents', p.amount_cents,
    'fees_cents', p.fees_cents,
    'total_cents', p.total_cents,
    'currency', p.currency::text,
    'payment_date', to_char(p.payment_date::timestamp, 'YYYY-MM-DD')
  )
$$;

create function public.payment_summary_hash(p public.payments) returns text
language sql stable
set search_path = ''
as $$
  select encode(sha256(convert_to(public.payment_summary(p)::text, 'UTF8')), 'hex')
$$;

revoke execute on function public.payment_summary(public.payments) from public, anon;
revoke execute on function public.payment_summary_hash(public.payments) from public, anon;
grant execute on function public.payment_summary(public.payments) to authenticated, service_role;
grant execute on function public.payment_summary_hash(public.payments) to authenticated, service_role;

-- Backfill legacy rows from their bill (whole dollars-and-cents amounts as cents, no fees).
-- They were never prepared through the trusted service, so prepared_by stays NULL. Only rows
-- whose bill has a positive amount, a vendor, a payment method and an invoice number are
-- backfilled; any other legacy row keeps a NULL summary and NULL hash, so the migration can not
-- abort on data we have not seen (those rows can still be superseded, canceled or recorded).
update public.payments p
   set vendor_id = b.vendor_id,
       payment_method_id = b.payment_method_id,
       invoice_number = b.invoice_number,
       amount_cents = (b.amount * 100)::bigint,
       fees_cents = 0,
       total_cents = (b.amount * 100)::bigint,
       currency = 'USD',
       payment_date = p.created_at::date
  from public.bills b
 where b.bill_id = p.bill_id
   and p.amount_cents is null
   and b.amount > 0
   and b.vendor_id is not null
   and b.payment_method_id is not null
   and b.invoice_number is not null;

update public.payments p
   set summary_hash = public.payment_summary_hash(p)
 where p.amount_cents is not null
   and p.summary_hash is null;

-- Statuses.
alter table public.payments drop constraint status_values;
alter table public.payments add constraint payments_status_values
  check (status in ('pending', 'authorized', 'processing', 'success', 'failure', 'unknown', 'canceled', 'expired'));

-- Value checks. NULL passes each one; the summary-complete check below covers required values
-- of prepared rows.
alter table public.payments
  add constraint payments_total_matches check (total_cents = amount_cents + fees_cents),
  add constraint payments_currency_usd check (currency = 'USD'),
  add constraint payments_amount_positive check (amount_cents > 0),
  add constraint payments_fees_not_negative check (fees_cents >= 0),
  add constraint payments_policy_refs_array check (jsonb_typeof(policy_refs) = 'array'),
  add constraint payments_account_reference_length check (char_length(account_reference) <= 100),
  add constraint payments_outcome_message_length check (char_length(outcome_message) <= 500),
  add constraint payments_transaction_reference_length check (char_length(transaction_reference) <= 255),
  add constraint payments_outcome_code_values check (outcome_code in (
    'confirmed', 'payment_mismatch', 'portal_rejected', 'portal_error', 'not_submitted',
    'outcome_unknown', 'superseded'));

-- Every row prepared through the trusted service (prepared_by set) carries a complete summary.
-- Legacy rows (prepared_by NULL) are exempt: some may have no complete summary to backfill.
alter table public.payments add constraint payments_summary_complete
  check (prepared_by is null or (vendor_id is not null and payment_method_id is not null
    and invoice_number is not null and amount_cents is not null and total_cents is not null
    and currency is not null and payment_date is not null and summary_hash is not null));

-- One open-or-paid attempt per bill. Fail clearly if existing data already breaks that.
do $$
declare
  v_bills text;
begin
  select string_agg(bill_id::text, ', ' order by bill_id) into v_bills
    from (select bill_id from public.payments
           where status in ('pending', 'authorized', 'processing', 'unknown', 'success')
           group by bill_id having count(*) > 1) d;
  if v_bills is not null then
    raise exception 'payments_one_open_attempt_per_bill: bills with more than one open or paid payment: %', v_bills;
  end if;
end
$$;

create unique index payments_one_open_attempt_per_bill on public.payments (bill_id)
  where status in ('pending', 'authorized', 'processing', 'unknown', 'success');

-- Guard trigger. Checked in this order: write marker (and no DELETE), status transition,
-- immutable columns, columns the new status needs. An INSERT may use any status; only
-- prepare_payment inserts, always as pending. A row entering a status must have all of that
-- status's columns. An update that keeps the status only may not clear one that is set, so a
-- legacy row that never had them (e.g. a #59 success) can still get its receipt.
create function public.payments_guard() returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_col text;
  v_new jsonb;
  v_old jsonb;
begin
  if tg_op = 'DELETE' or current_setting('app.payments_write', true) is distinct from 'on' then
    raise exception 'payments_write_forbidden' using errcode = '42501';
  end if;

  v_new := to_jsonb(new);

  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);

    if new.status <> old.status and not (
      (old.status = 'pending' and new.status in ('authorized', 'canceled', 'expired'))
      or (old.status = 'authorized' and new.status in ('processing', 'canceled', 'expired'))
      or (old.status = 'processing' and new.status in ('success', 'failure', 'unknown'))
      or (old.status = 'unknown' and new.status in ('success', 'failure'))
    ) then
      raise exception 'illegal_payment_transition' using errcode = 'P0001',
        detail = old.status || ' → ' || new.status;
    end if;

    foreach v_col in array array['bill_id', 'vendor_id', 'invoice_number', 'account_reference',
      'payment_method_id', 'amount_cents', 'fees_cents', 'total_cents', 'currency', 'payment_date',
      'summary_hash', 'idempotency_key', 'policy_refs', 'prepared_by', 'created_at'] loop
      if v_new -> v_col is distinct from v_old -> v_col then
        raise exception 'payment_summary_immutable' using errcode = 'P0001', detail = v_col;
      end if;
    end loop;
  end if;

  foreach v_col in array case new.status
    when 'authorized' then array['authorized_by', 'authorized_at', 'authorization_expires_at']
    when 'processing' then array['submitted_at']
    when 'success' then array['transaction_reference', 'time_paid', 'outcome_code', 'outcome_at']
    when 'failure' then array['outcome_code', 'outcome_at']
    when 'unknown' then array['outcome_code', 'outcome_at']
    when 'canceled' then array['canceled_by']
    when 'expired' then array['outcome_code']
    else array[]::text[]
  end loop
    if v_new ->> v_col is null
       and (tg_op = 'INSERT' or new.status <> old.status or v_old ->> v_col is not null) then
      raise exception 'payment_incomplete' using errcode = 'P0001', detail = v_col;
    end if;
  end loop;

  return new;
end
$$;

revoke execute on function public.payments_guard() from public, anon, authenticated, service_role;

-- TRUNCATE skips row triggers and the DELETE refusal, so it gets its own statement trigger. It
-- always refuses (cascades from bills included).
create function public.payments_refuse_truncate() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'payments_write_forbidden' using errcode = '42501';
end
$$;

revoke execute on function public.payments_refuse_truncate() from public, anon, authenticated, service_role;

create trigger payments_refuse_truncate
  before truncate on public.payments
  for each statement execute function public.payments_refuse_truncate();

create trigger payments_guard
  before insert or update or delete on public.payments
  for each row execute function public.payments_guard();

create trigger payments_set_updated_at
  before update on public.payments
  for each row execute function public.set_updated_at();

-- Replaces the open insert and update policies from
-- 20261102174727_create_approvals_and_payments.sql, and takes every write privilege away
-- (including from service_role and anon's read). The SELECT policy stays.
drop policy "authenticated users can insert payments" on public.payments;
drop policy "authenticated users can update payments" on public.payments;

revoke all on public.payments from anon, authenticated, service_role;
grant select on public.payments to authenticated, service_role;
-- The writer functions run as the owner, so nobody else needs the id sequence either.
revoke all on sequence public.payments_payment_id_seq from anon, authenticated, service_role;

-- Section 2: prepare_payment(). Only the trusted service (service_role) calls it. It creates
-- the pending attempt a person later authorizes, with the summary fixed at this moment.
-- Preparing again supersedes any earlier pending or authorized attempt for the bill.
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
-- The account reference is trimmed and blank becomes NULL. Audit text never holds amounts or
-- the account reference.
create function public.prepare_payment(
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
  v_row.policy_refs := p_policy_refs;
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

-- New functions in public are executable by PUBLIC, and Supabase's default privileges also
-- grant anon, authenticated and service_role explicitly. Service-only: revoke all, then grant.
revoke execute on function public.prepare_payment(integer, integer, bigint, date, text, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_payment(integer, integer, bigint, date, text, jsonb) to service_role;

-- Section 3: authorize_payment() and cancel_payment(), called by a signed-in billing_operator,
-- financial_approver or system_admin. authorize_payment is the exact yes: the caller echoes the
-- summary they saw, and it must equal the stored one, key for key and type for type (no
-- coercion). cancel_payment withdraws a pending or authorized attempt.
--
-- authorize_payment(p_payment_id, p_summary jsonb) error contract, checked in this order:
--   code   HTTP  message            details
--   PT403  403   forbidden          null (no profile for this login, or a viewer)
--   PT400  400   invalid_summary    null (NULL or not a JSON object), or a sorted JSON array of
--                                   the missing and extra keys
--   PT404  404   not_found          null (no such payment, or NULL)
--   PT409  409   not_pending        the payment's status
--   PT409  409   not_prepared       null (a legacy row never prepared through the trusted service)
--   PT409  409   summary_stale      ["payment_date"] (the stored payment date is no longer within
--                                   one day of today)
--   PT409  409   summary_mismatch   JSON array of the keys whose values differ, in summary order
-- On success the attempt is authorized for 15 minutes.
--
-- cancel_payment(p_payment_id, p_note text default null) error contract, in this order:
--   PT403 forbidden (null); PT400 invalid_note (null; note over 500 characters once trimmed);
--   PT404 not_found (null); PT409 not_cancelable (the status, unless pending or authorized).
-- The note is trimmed, blank becomes NULL, and is stored as outcome_message. Neither the note
-- nor any amount goes into the audit text.
create function public.authorize_payment(p_payment_id integer, p_summary jsonb)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- How long an authorization lasts before the attempt must be superseded or run.
  c_lifetime constant interval := interval '15 minutes';
  v_marker text := current_setting('app.payments_write', true);
  v_user_id integer;
  v_role text;
  v_keys text[] := array['bill_id', 'vendor_id', 'invoice_number', 'account_reference',
    'payment_method_id', 'amount_cents', 'fees_cents', 'total_cents', 'currency', 'payment_date'];
  v_bad text[];
  v_payment public.payments;
  v_expected jsonb;
  v_row public.payments;
begin
  select user_id, role into v_user_id, v_role
    from public.users
    where auth_user_id = (select auth.uid());
  if v_role is null or v_role not in ('billing_operator', 'financial_approver', 'system_admin') then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  if jsonb_typeof(p_summary) is distinct from 'object' then
    raise sqlstate 'PT400' using message = 'invalid_summary';
  end if;
  select array_agg(k order by k collate "C") into v_bad from (
    select k from unnest(v_keys) k where not p_summary ? k
    union all
    select k from jsonb_object_keys(p_summary) k where k <> all (v_keys)
  ) d;
  if cardinality(v_bad) > 0 then
    raise sqlstate 'PT400' using message = 'invalid_summary', detail = to_json(v_bad)::text;
  end if;

  select * into v_payment from public.payments where payment_id = p_payment_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  if v_payment.status <> 'pending' then
    raise sqlstate 'PT409' using message = 'not_pending', detail = v_payment.status;
  end if;
  if v_payment.prepared_by is null then
    raise sqlstate 'PT409' using message = 'not_prepared';
  end if;
  -- The same window prepare_payment accepts: an old preparation can not be authorized and charged today.
  if v_payment.payment_date is null
     or v_payment.payment_date not between current_date - 1 and current_date + 1 then
    raise sqlstate 'PT409' using message = 'summary_stale', detail = '["payment_date"]';
  end if;

  -- jsonb equality: "12000" does not equal 12000, and null only equals null.
  v_expected := public.payment_summary(v_payment);
  select array_agg(k order by o) into v_bad
    from unnest(v_keys) with ordinality as t(k, o)
    where p_summary -> k is distinct from v_expected -> k;
  if cardinality(v_bad) > 0 then
    raise sqlstate 'PT409' using message = 'summary_mismatch', detail = to_json(v_bad)::text;
  end if;

  -- Supabase (supautils) refuses a function-level `set app.payments_write`, so the write marker
  -- is switched on here, for this transaction, and put back before returning.
  perform set_config('app.payments_write', 'on', true);

  update public.payments
    set status = 'authorized', authorized_by = v_user_id, authorized_at = now(),
        authorization_expires_at = now() + c_lifetime
    where payment_id = v_payment.payment_id
    returning * into v_row;

  insert into public.audit_logs (name, description)
    values ('payment_authorized', format('payment %s (bill %s): pending → authorized, by user %s, policies %s',
      v_row.payment_id, v_row.bill_id, v_user_id, v_row.policy_refs));

  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_row;
end
$$;

create function public.cancel_payment(p_payment_id integer, p_note text default null)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting('app.payments_write', true);
  v_user_id integer;
  v_role text;
  v_note text;
  v_payment public.payments;
  v_row public.payments;
begin
  select user_id, role into v_user_id, v_role
    from public.users
    where auth_user_id = (select auth.uid());
  if v_role is null or v_role not in ('billing_operator', 'financial_approver', 'system_admin') then
    raise sqlstate 'PT403' using message = 'forbidden';
  end if;

  v_note := nullif(btrim(p_note), '');
  if char_length(v_note) > 500 then
    raise sqlstate 'PT400' using message = 'invalid_note';
  end if;

  select * into v_payment from public.payments where payment_id = p_payment_id for update;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;

  if v_payment.status not in ('pending', 'authorized') then
    raise sqlstate 'PT409' using message = 'not_cancelable', detail = v_payment.status;
  end if;

  perform set_config('app.payments_write', 'on', true);

  update public.payments
    set status = 'canceled', canceled_by = v_user_id, outcome_at = now(), outcome_message = v_note
    where payment_id = v_payment.payment_id
    returning * into v_row;

  insert into public.audit_logs (name, description)
    values ('payment_canceled', format('payment %s (bill %s): %s → canceled, by user %s',
      v_row.payment_id, v_row.bill_id, v_payment.status, v_user_id));

  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_row;
end
$$;

-- Signed-in users only: revoke what PUBLIC and Supabase's default privileges grant, then grant.
revoke execute on function public.authorize_payment(integer, jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.cancel_payment(integer, text) from public, anon, authenticated, service_role;
grant execute on function public.authorize_payment(integer, jsonb) to authenticated;
grant execute on function public.cancel_payment(integer, text) to authenticated;

-- Section 4: start_payment_submission() and record_payment(). Only the trusted service
-- (service_role) calls them. start_payment_submission is the atomic claim the worker makes
-- before any charge: it moves an authorized attempt to processing, or refuses. record_payment
-- records what happened afterwards (the "record_payment" of ADR 0002).
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
-- Success: the attempt is processing with submitted_at set to that same wall-clock time, and
-- the bill is processing. The check can't use now(): it is frozen at the start of the
-- transaction, so a claim that waited for a lock would still see an expired yes as valid.
--
-- record_payment(p_payment_id, p_outcome, p_outcome_code, p_transaction_reference, p_message)
-- error contract, in this order:
--   PT400  400   invalid_outcome  JSON array of the bad arguments, in this order: outcome (not
--                                 success, failure or unknown), outcome_code (not one of that
--                                 outcome's codes; skipped when the outcome is bad),
--                                 transaction_reference (blank for success, or over 255
--                                 characters once trimmed), message (over 500 once trimmed)
--   PT404  404   not_found        null
--   PT409  409   not_processing   the status, unless processing, or unknown with an outcome of
--                                 success or failure (reconciling)
-- A trimmed transaction reference and message are stored for every outcome when given. Reconciling
-- an unknown attempt keeps its earlier reference and message when the new ones are NULL or blank.
-- Outcome codes: success confirmed; failure payment_mismatch, portal_rejected, portal_error,
-- not_submitted; unknown outcome_unknown. A success sets the bill to payment_success and its
-- date_paid; a failure sets payment_failed; unknown leaves the bill processing, and a new
-- preparation stays blocked until it is reconciled. Audit text never holds the transaction
-- reference or the message.
create function public.start_payment_submission(p_payment_id integer)
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

-- #59's record_payment(bill, amount, vendor, invoice, key) inserted a success row after the
-- worker had already paid. The guard refuses that insert, so it would pay and then fail to
-- record. The attempt flow replaces it.
drop function public.record_payment(integer, numeric, integer, text, text);

create function public.record_payment(
  p_payment_id integer,
  p_outcome text,
  p_outcome_code text,
  p_transaction_reference text default null,
  p_message text default null
) returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_marker text := current_setting('app.payments_write', true);
  v_reference text := nullif(btrim(p_transaction_reference), '');
  v_message text := nullif(btrim(p_message), '');
  v_codes text[];
  v_bad text[];
  v_payment public.payments;
  v_bill_id integer;
  v_row public.payments;
begin
  v_codes := case p_outcome
    when 'success' then array['confirmed']
    when 'failure' then array['payment_mismatch', 'portal_rejected', 'portal_error', 'not_submitted']
    when 'unknown' then array['outcome_unknown']
  end;
  v_bad := array_remove(array[
    case when v_codes is null then 'outcome' end,
    case when v_codes is not null and not coalesce(p_outcome_code = any (v_codes), false) then 'outcome_code' end,
    case when (p_outcome = 'success' and v_reference is null) or char_length(v_reference) > 255
      then 'transaction_reference' end,
    case when char_length(v_message) > 500 then 'message' end
  ], null);
  if cardinality(v_bad) > 0 then
    raise sqlstate 'PT400' using message = 'invalid_outcome', detail = to_json(v_bad)::text;
  end if;

  -- Lock the bill first, then the attempt, as prepare_payment and start_payment_submission do.
  select bill_id into v_bill_id from public.payments where payment_id = p_payment_id;
  if not found then
    raise sqlstate 'PT404' using message = 'not_found';
  end if;
  perform 1 from public.bills where bill_id = v_bill_id for update;
  select * into v_payment from public.payments where payment_id = p_payment_id for update;

  if not (v_payment.status = 'processing'
          or (v_payment.status = 'unknown' and p_outcome <> 'unknown')) then
    raise sqlstate 'PT409' using message = 'not_processing', detail = v_payment.status;
  end if;

  perform set_config('app.payments_write', 'on', true);

  update public.payments
    set status = p_outcome, outcome_code = p_outcome_code,
        outcome_message = coalesce(v_message, v_payment.outcome_message),
        outcome_at = now(),
        transaction_reference = coalesce(v_reference, v_payment.transaction_reference),
        time_paid = case when p_outcome = 'success' then now() end
    where payment_id = v_payment.payment_id
    returning * into v_row;

  -- An unknown outcome leaves the bill processing.
  if p_outcome = 'success' then
    update public.bills set status = 'payment_success', date_paid = now(), updated_at = now()
      where bill_id = v_payment.bill_id;
  elsif p_outcome = 'failure' then
    update public.bills set status = 'payment_failed', updated_at = now()
      where bill_id = v_payment.bill_id;
  end if;

  insert into public.audit_logs (name, description)
    values (
      case p_outcome when 'success' then 'payment_succeeded' when 'failure' then 'payment_failed'
        else 'payment_outcome_unknown' end,
      format('payment %s (bill %s): %s → %s, by service, outcome %s',
        v_row.payment_id, v_row.bill_id, v_payment.status, p_outcome, p_outcome_code));

  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_row;
end
$$;

-- Service only: revoke what PUBLIC and Supabase's default privileges grant, then grant.
revoke execute on function public.start_payment_submission(integer)
  from public, anon, authenticated, service_role;
revoke execute on function public.record_payment(integer, text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.start_payment_submission(integer) to service_role;
grant execute on function public.record_payment(integer, text, text, text, text) to service_role;

-- Section 5: DC-112's set_payment_receipt() (#60), recreated so it can still store a receipt on
-- a success row under the guard. The checks and result are unchanged; only the write marker is
-- added around its update. Its grants (service_role only) carry over.
create or replace function public.set_payment_receipt(
  p_payment_id integer, p_bill_id integer, p_idempotency_key text,
  p_path text, p_error text default null
) returns public.payments language plpgsql security definer set search_path = '' as $$
declare
  v_marker text := current_setting('app.payments_write', true);
  v_payment public.payments;
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
  perform set_config('app.payments_write', 'on', true);
  update public.payments set receipt_path = p_path,
    receipt_status = case when p_path is null then 'failed' else 'stored' end,
    receipt_error = p_error where payment_id = p_payment_id returning * into v_payment;
  perform set_config('app.payments_write', coalesce(v_marker, ''), true);
  return v_payment;
end;
$$;
