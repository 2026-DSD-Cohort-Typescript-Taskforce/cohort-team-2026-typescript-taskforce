-- Local sample data, loaded by `supabase db reset` after the migrations ([db.seed] in
-- config.toml). Synthetic; never run it against the shared project.

-- DC-12: three draft bills to submit. The first two are complete; the third has no
-- invoice number or due date, so submit_bill() refuses it with incomplete_bill.
insert into public.bills (status, vendor_id, property_id, invoice_number, amount, date_due)
values
  (
    'draft',
    (select vendor_id from public.vendors where vendor_name = 'Alder Creek Landscaping'),
    (select property_id from public.properties where property_name = 'Alder Creek Workshop'),
    'BILL-2001',
    212.40,
    current_date + 14
  ),
  (
    'draft',
    (select vendor_id from public.vendors where vendor_name = 'Brightwater Water & Sewer'),
    (select property_id from public.properties where property_name = 'Brightwater Print Studio'),
    'BILL-2002',
    97.15,
    current_date + 21
  ),
  (
    'draft',
    (select vendor_id from public.vendors where vendor_name = 'Copper Ridge Waste Services'),
    (select property_id from public.properties where property_name = 'Copper Ridge Fabrication'),
    null,
    345.00,
    null
  );
