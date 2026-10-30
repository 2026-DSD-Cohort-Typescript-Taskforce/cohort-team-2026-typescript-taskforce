-- DC-20: bill lifecycle and invoice rules. The vendor_id, invoice_number, status and
-- date_received columns come from 20261024152919_create_seed_bills_table.sql; this
-- adds their rules.

-- Invoice numbers are stored trimmed, and a blank one is stored as NULL.
create function public.bills_normalize_invoice_number()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.invoice_number := nullif(btrim(new.invoice_number), '');
  return new;
end
$$;

create trigger bills_normalize_invoice_number
  before insert or update of invoice_number on public.bills
  for each row execute function public.bills_normalize_invoice_number();

update public.bills
  set invoice_number = nullif(btrim(invoice_number), '')
  where invoice_number is distinct from nullif(btrim(invoice_number), '');

-- An invoice number is unique per vendor, ignoring case. The same number can appear
-- at different vendors, and any number of bills can have none. The existing
-- bills_vendor_invoice_unique constraint is case-sensitive, so this index adds the
-- case-insensitive rule.
create unique index bills_vendor_id_invoice_number_key
  on public.bills (vendor_id, lower(invoice_number));

-- status is the bill's lifecycle; a saved but unsubmitted bill is a draft.
-- Seeded 'paid' and 'unpaid' bills map onto the lifecycle; bills with no status
-- start as drafts.
update public.bills set status = 'payment_success' where status = 'paid';
update public.bills set status = 'pending_payment' where status = 'unpaid';
update public.bills set status = 'draft' where status is null;
alter table public.bills
  alter column status set default 'draft',
  alter column status set not null,
  add constraint bills_status_check check (status in (
    'draft', 'pending_approval', 'approval_denied', 'pending_payment',
    'processing', 'payment_success', 'payment_failed')),
  -- A bill needs an invoice number once it leaves draft.
  add constraint bills_invoice_number_required_check
    check (status = 'draft' or invoice_number is not null);

-- date_received is stored in UTC like created_at. It defaults to the insert time, can be
-- edited or backdated later, and can't be in the future. Bills without one take created_at.
update public.bills set date_received = created_at where date_received is null;
alter table public.bills
  alter column date_received set default (now() at time zone 'UTC'),
  alter column date_received set not null,
  add constraint bills_date_received_not_future_check
    check (date_received <= (now() at time zone 'UTC'));
