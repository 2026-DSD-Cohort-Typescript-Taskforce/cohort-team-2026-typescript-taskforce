-- DC-21: the database side of manual bill entry: references, the DC-20 bill rules and who
-- can read or delete bills. Run with `supabase test db`. Synthetic data only; everything
-- rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(36);

-- date_received defaults to the UTC wall clock; in a UTC session (Supabase's default)
-- that is now().
set local timezone = 'UTC';

-- Setup (as postgres). Bills point at a seeded vendor, user and payment method, so this
-- file doesn't depend on those tables' other columns. Their ids are kept in settings
-- because the signed-in and signed-out roles below can't read every table.
-- Bills 21001+ and property 21001 stay clear of seeded rows.
do $$
declare
  v_vendor_a integer := (select min(vendor_id) from public.vendors);
begin
  perform set_config('dc21.vendor_a', v_vendor_a::text, true);
  perform set_config('dc21.vendor_a_name', (select name from public.vendors where vendor_id = v_vendor_a), true);
  perform set_config('dc21.vendor_b', (select min(vendor_id) from public.vendors where vendor_id > v_vendor_a)::text, true);
  perform set_config('dc21.user', (select min(user_id) from public.users)::text, true);
  perform set_config('dc21.payment', (select min(payment_id) from public.payment_methods)::text, true);
end
$$;

create function pg_temp.id(p_name text) returns integer
language sql stable as $$
  select current_setting('dc21.' || p_name)::integer
$$;

-- How many rows a statement changed (RLS can make a DELETE match none).
create function pg_temp.rows_changed(p_sql text) returns integer
language plpgsql as $$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

insert into public.properties (property_id, name) values (21001, 'DC21 Test Property');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_id, invoice_number, amount)
  values (21010, 'pending_payment', pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 'DC21-010', 80.00),
         -- A draft with approval history, as after a denied bill is revised.
         (21011, 'draft', pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 'DC21-011', 80.00);
insert into public.approvals (bill_id, submitted_by, status) values (21011, pg_temp.id('user'), 'rejected');

-- Policies and privileges
select policies_are('public', 'bills',
  ARRAY['authenticated users can view bills', 'authenticated users can insert draft bills',
        'authenticated users can update draft bills', 'authenticated users can delete draft bills'],
  'bills has the signed-in read policy and the three draft-only write policies');
select policy_cmd_is('public', 'bills', 'authenticated users can view bills', 'select', 'the read policy covers SELECT');
select policy_roles_are('public', 'bills', 'authenticated users can view bills', ARRAY['authenticated'], 'the read policy is for authenticated only');
select policy_cmd_is('public', 'bills', 'authenticated users can delete draft bills', 'delete', 'the draft delete policy covers DELETE');
select policy_roles_are('public', 'bills', 'authenticated users can delete draft bills', ARRAY['authenticated'], 'the draft delete policy is for authenticated only');
select table_privs_are('public', 'bills', 'anon', ARRAY[]::text[], 'anon has no privileges on bills');

-- A signed-in user saves a bill and reads it back
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000021a1","role":"authenticated"}';
select lives_ok(
  $$insert into public.bills (bill_id, vendor_id, property_id, user_id, payment_id, invoice_number, amount, date_due)
    values (21001, pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), '  DC21-001  ', 150.25, current_date + 30)$$,
  'a signed-in user saves a draft bill for an existing vendor and property'
);
select results_eq(
  $$select b.bill_id, b.vendor_id, v.name::text, b.property_id, p.name::text, b.user_id, b.payment_id,
           b.amount, b.status::text, b.invoice_number::text
    from public.bills b
    join public.vendors v on v.vendor_id = b.vendor_id
    join public.properties p on p.property_id = b.property_id
    where b.bill_id = 21001$$,
  $$values (21001, pg_temp.id('vendor_a'), current_setting('dc21.vendor_a_name'), 21001, 'DC21 Test Property',
            pg_temp.id('user'), pg_temp.id('payment'), 150.25::numeric, 'draft', 'DC21-001')$$,
  'it reads back with the same vendor, property, user and payment method, as a draft, with the invoice number trimmed'
);
select is((select date_received from public.bills where bill_id = 21001), now(), 'date_received defaults to now');

-- References that don't exist, or are missing
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount)
    values (-1, 21001, pg_temp.id('user'), pg_temp.id('payment'), 1.00)$$,
  '23503', 'insert or update on table "bills" violates foreign key constraint "bills_vendor_id_fkey"',
  'a vendor that does not exist is refused'
);
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount)
    values (pg_temp.id('vendor_a'), -1, pg_temp.id('user'), pg_temp.id('payment'), 1.00)$$,
  '23503', 'insert or update on table "bills" violates foreign key constraint "bills_property_id_fkey"',
  'a property that does not exist is refused'
);
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount)
    values (pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), -1, 1.00)$$,
  '23503', 'insert or update on table "bills" violates foreign key constraint "bills_payment_id_fkey"',
  'a payment method that does not exist is refused'
);
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount)
    values (pg_temp.id('vendor_a'), 21001, -1, pg_temp.id('payment'), 1.00)$$,
  '23503', 'insert or update on table "bills" violates foreign key constraint "bills_user_id_fkey"',
  'a user that does not exist is refused'
);
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount)
    values (null, 21001, pg_temp.id('user'), pg_temp.id('payment'), 1.00)$$,
  '23502', 'null value in column "vendor_id" of relation "bills" violates not-null constraint',
  'a bill without a vendor is refused'
);
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount)
    values (pg_temp.id('vendor_a'), null, pg_temp.id('user'), pg_temp.id('payment'), 1.00)$$,
  '23502', 'null value in column "property_id" of relation "bills" violates not-null constraint',
  'a bill without a property is refused'
);

-- DC-20 invoice number and date rules
select lives_ok(
  $$insert into public.bills (bill_id, vendor_id, property_id, user_id, payment_id, invoice_number, amount)
    values (21002, pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), '   ', 1.00)$$,
  'a draft with a blank invoice number saves'
);
select lives_ok(
  $$insert into public.bills (bill_id, vendor_id, property_id, user_id, payment_id, invoice_number, amount)
    values (21003, pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), null, 1.00)$$,
  'a second draft at the same vendor with no invoice number saves'
);
select is(
  (select count(*)::int from public.bills where bill_id in (21002, 21003) and invoice_number is null),
  2,
  'a blank invoice number is stored as NULL, and many drafts at one vendor can have none'
);
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, invoice_number, amount)
    values (pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 'dc21-001', 1.00)$$,
  '23505', 'duplicate key value violates unique constraint "bills_vendor_id_invoice_number_key"',
  'the same invoice number at the same vendor, in another case, is refused'
);
select lives_ok(
  $$insert into public.bills (bill_id, vendor_id, property_id, user_id, payment_id, invoice_number, amount)
    values (21005, pg_temp.id('vendor_b'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 'DC21-001', 1.00)$$,
  'the same invoice number at another vendor saves'
);
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount, date_received)
    values (pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 1.00, now() + interval '1 day')$$,
  '23514', 'new row for relation "bills" violates check constraint "bills_date_received_not_future_check"',
  'a date_received in the future is refused'
);
reset role;

-- Status rules, as postgres: signed-in users can only insert drafts.
select throws_ok(
  $$insert into public.bills (status, vendor_id, property_id, user_id, payment_id, amount)
    values ('pending_approval', pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 1.00)$$,
  '23514', 'new row for relation "bills" violates check constraint "bills_invoice_number_required_check"',
  'a bill that is not a draft needs an invoice number'
);
select throws_ok(
  $$insert into public.bills (status, vendor_id, property_id, user_id, payment_id, invoice_number, amount)
    values ('paid', pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 'DC21-008', 1.00)$$,
  '23514', 'new row for relation "bills" violates check constraint "bills_status_check"',
  'a status outside the bill lifecycle is refused'
);

-- A vendor or property that bills use can't be deleted (no cascade).
select throws_ok(
  $$delete from public.properties where property_id = 21001$$,
  '23503', 'update or delete on table "properties" violates foreign key constraint "bills_property_id_fkey" on table "bills"',
  'deleting a property that bills use is refused'
);
-- Other tables may also reference the vendor, so only the error code is checked.
select throws_ok(
  $$delete from public.vendors where vendor_id = pg_temp.id('vendor_a')$$,
  '23503', null,
  'deleting a vendor that bills use is refused'
);
select results_eq(
  $$select vendor_id, property_id from public.bills where bill_id = 21001$$,
  $$values (pg_temp.id('vendor_a'), 21001)$$,
  'the bill keeps its vendor and property'
);

-- Signed out: no access at all
set local role anon;
set local request.jwt.claims = '{"role":"anon"}';
select throws_ok($$select count(*) from public.bills$$, '42501', 'permission denied for table bills', 'anon cannot read bills');
select throws_ok(
  $$insert into public.bills (vendor_id, property_id, user_id, payment_id, amount)
    values (pg_temp.id('vendor_a'), 21001, pg_temp.id('user'), pg_temp.id('payment'), 1.00)$$,
  '42501', 'permission denied for table bills',
  'anon cannot insert bills'
);
select throws_ok($$update public.bills set amount = 1.00 where bill_id = 21001$$, '42501', 'permission denied for table bills', 'anon cannot update bills');
select throws_ok($$delete from public.bills where bill_id = 21001$$, '42501', 'permission denied for table bills', 'anon cannot delete bills');
reset role;

-- Signed in: read every bill, delete only drafts
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000021a1","role":"authenticated"}';
select is(
  (select count(*)::int from public.bills where bill_id between 21001 and 21011),
  6,
  'a signed-in user can read the bills, including ones they did not enter'
);
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 21003$$), 1, 'a draft can be deleted');
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 21010$$), 0, 'a bill that is not a draft can''t be deleted (0 rows)');
select throws_ok(
  $$delete from public.bills where bill_id = 21011$$,
  '23503', 'update or delete on table "bills" violates foreign key constraint "approvals_bill_id_fkey" on table "approvals"',
  'a draft with approval history can''t be deleted'
);
reset role;

select results_eq(
  $$select bill_id from public.bills where bill_id between 21001 and 21011 order by bill_id$$,
  $$values (21001), (21002), (21005), (21010), (21011)$$,
  'only the draft without history was deleted'
);
select is((select amount from public.bills where bill_id = 21001), 150.25, 'the signed-out attempts changed nothing');

select * from finish();
rollback;
