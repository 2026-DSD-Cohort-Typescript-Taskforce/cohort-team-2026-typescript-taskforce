-- Local sample data, loaded by `supabase db reset` after the migrations ([db.seed] in
-- config.toml). Synthetic; never run it against the shared project.

-- DC-12: three draft bills to submit, entered by Alex Morgan. The first two are complete;
-- the third has no invoice number or due date, so submit_bill() refuses it with
-- incomplete_bill.
insert into public.bills (status, vendor_id, property_id, user_id, payment_id, invoice_number, amount, date_due)
values
  (
    'draft',
    (select vendor_id from public.vendors where name = 'Alder Creek Landscaping'),
    (select property_id from public.properties where name = 'Alder Creek Workshop'),
    (select user_id from public.users where email = 'alex.morgan@example.com'),
    (select payment_id from public.payment_methods where name = 'Alder Creek Demo Card'),
    'BILL-2001',
    212.40,
    current_date + 14
  ),
  (
    'draft',
    (select vendor_id from public.vendors where name = 'Brightwater Water & Sewer'),
    (select property_id from public.properties where name = 'Brightwater Print Studio'),
    (select user_id from public.users where email = 'alex.morgan@example.com'),
    (select payment_id from public.payment_methods where name = 'Brightwater Demo Bank Account'),
    'BILL-2002',
    97.15,
    current_date + 21
  ),
  (
    'draft',
    (select vendor_id from public.vendors where name = 'Copper Ridge Waste Services'),
    (select property_id from public.properties where name = 'Copper Ridge Fabrication'),
    (select user_id from public.users where email = 'alex.morgan@example.com'),
    (select payment_id from public.payment_methods where name = 'Copper Ridge Demo Card'),
    null,
    345.00,
    null
  );

-- Synthetic vendor policies (DC-85). Every other vendor stays without one.
insert into public.policies (vendor_id, name, description, is_active)
values
  (
    (select vendor_id from public.vendors where name = 'Sunmeadow Cleaning'),
    'Automatic approval for payments',
    'Pay this vendor''s bills automatically by card through the vendor portal.',
    true
  ),
  (
    (select vendor_id from public.vendors where name = 'Harborlight Security'),
    'Manager review for payments',
    'A financial approver reviews each bill from this vendor before it is paid.',
    false
  ),
  (
    (select vendor_id from public.vendors where name = 'Maple Junction Storage'),
    'Automatic approval for payments',
    'Pay this vendor''s bills automatically by ACH through the vendor portal.',
    true
  );
