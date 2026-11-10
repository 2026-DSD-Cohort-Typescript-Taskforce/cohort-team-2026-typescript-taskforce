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

-- DC-84: vendor contact details and a system admin to manage them. Sam Rivera is a
-- profile only; the Auth login is added by a separate script. Maple Junction Storage and
-- Summit Trail Equipment Rental keep no contact details, like the legacy vendors, and
-- Juniper Office Supply is new, complete and has no bills (so it can be deleted).
insert into public.users (name, email, role, property_id)
values (
  'Sam Rivera',
  'sam.rivera@example.com',
  'system_admin',
  (select property_id from public.properties where name = 'Alder Creek Workshop')
);

update public.vendors v
set email = c.email, address = c.address, phone = c.phone
from (values
  ('Alder Creek Landscaping',       'billing@aldercreek.example.com',   '210 Meadow Lane, Dallas, TX 75201',      '555-0101'),
  ('Brightwater Water & Sewer',     'accounts@brightwater.example.com', '48 Riverside Drive, Dallas, TX 75202',   '555-0102'),
  ('Copper Ridge Waste Services',   'billing@copperridge.example.com',  '902 Quarry Road, Dallas, TX 75203',      '555-0103'),
  ('Northline Business Internet',   'support@northline.example.com',    '77 Fiber Court, Dallas, TX 75204',       '555-0104'),
  ('Sunmeadow Cleaning',            'office@sunmeadow.example.com',     '15 Sunrise Boulevard, Dallas, TX 75205', '555-0105'),
  ('Cedar Valley Pest Control',     'billing@cedarvalley.example.com',  '330 Cedar Street, Dallas, TX 75206',     '555-0106'),
  ('Harborlight Security',          'accounts@harborlight.example.com', '8 Lantern Pier, Dallas, TX 75207',       '555-0107'),
  ('Prairie Grid HVAC Services',    'service@prairiegrid.example.com',  '564 Prairie Avenue, Dallas, TX 75208',   '555-0108')
) as c(name, email, address, phone)
where v.name = c.name;

insert into public.vendors (name, email, address, phone, payment_portal_url, supported_payment_methods)
values (
  'Juniper Office Supply',
  'orders@juniper.example.com',
  '61 Juniper Way, Dallas, TX 75209',
  '555-0109',
  'https://juniper-utility-demo.vercel.app',
  'Card, ACH'
);
