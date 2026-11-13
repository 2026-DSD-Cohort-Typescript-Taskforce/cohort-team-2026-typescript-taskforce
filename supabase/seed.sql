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
-- Juniper Office Supply is new, complete and has no bills (so it can be deleted). The
-- phones are 555-01xx numbers (set aside for fiction) with an area code, so they have the
-- 10 digits the vendor form needs and a seeded vendor can be saved as it is.
insert into public.users (name, email, role)
values (
  'Sam Rivera',
  'sam.rivera@example.com',
  'system_admin'
);

-- DC-86: users link to properties through user_properties.
insert into public.user_properties (user_id, property_id)
select u.user_id, p.property_id
from public.users u, public.properties p
where u.email = 'sam.rivera@example.com' and p.name = 'Alder Creek Workshop';

update public.vendors v
set email = c.email, address = c.address, phone = c.phone
from (values
  ('Alder Creek Landscaping',       'billing@aldercreek.example.com',   '210 Meadow Lane, Dallas, TX 75201',      '214-555-0101'),
  ('Brightwater Water & Sewer',     'accounts@brightwater.example.com', '48 Riverside Drive, Dallas, TX 75202',   '214-555-0102'),
  ('Copper Ridge Waste Services',   'billing@copperridge.example.com',  '902 Quarry Road, Dallas, TX 75203',      '214-555-0103'),
  ('Northline Business Internet',   'support@northline.example.com',    '77 Fiber Court, Dallas, TX 75204',       '214-555-0104'),
  ('Sunmeadow Cleaning',            'office@sunmeadow.example.com',     '15 Sunrise Boulevard, Dallas, TX 75205', '214-555-0105'),
  ('Cedar Valley Pest Control',     'billing@cedarvalley.example.com',  '330 Cedar Street, Dallas, TX 75206',     '214-555-0106'),
  ('Harborlight Security',          'accounts@harborlight.example.com', '8 Lantern Pier, Dallas, TX 75207',       '214-555-0107'),
  ('Prairie Grid HVAC Services',    'service@prairiegrid.example.com',  '564 Prairie Avenue, Dallas, TX 75208',   '214-555-0108')
) as c(name, email, address, phone)
where v.name = c.name;

insert into public.vendors (name, email, address, phone, payment_portal_url, supported_payment_methods)
values (
  'Juniper Office Supply',
  'orders@juniper.example.com',
  '61 Juniper Way, Dallas, TX 75209',
  '214-555-0109',
  'https://juniper-utility-demo.vercel.app',
  'Card, ACH'
);

-- DC-81: an approver profile and three bills waiting for approval, entered by Alex
-- Morgan, to try the approvals page. Avery has no login yet (auth_user_id is NULL); a
-- separate script (npm run seed:local-users --prefix server) links one. Due dates differ from id order on purpose. BILL-2101 also
-- has a pending approvals row; the other two don't, so decide_bill() inserts one.
insert into public.users (name, email, role)
values (
  'Avery Quinn',
  'avery.quinn@example.com',
  'financial_approver'
);

insert into public.user_properties (user_id, property_id)
select u.user_id, p.property_id
from public.users u, public.properties p
where u.email = 'avery.quinn@example.com' and p.name = 'Alder Creek Workshop';

insert into public.bills (status, vendor_id, property_id, user_id, payment_id, invoice_number, amount, date_issued, date_due)
values
  (
    'pending_approval',
    (select vendor_id from public.vendors where name = 'Northline Business Internet'),
    (select property_id from public.properties where name = 'Northline Logistics'),
    (select user_id from public.users where email = 'alex.morgan@example.com'),
    (select payment_id from public.payment_methods where name = 'Northline Demo Bank Account'),
    'BILL-2101',
    189.00,
    current_date - 5,
    current_date + 7
  ),
  (
    'pending_approval',
    (select vendor_id from public.vendors where name = 'Sunmeadow Cleaning'),
    (select property_id from public.properties where name = 'Sunmeadow Bakery'),
    (select user_id from public.users where email = 'alex.morgan@example.com'),
    (select payment_id from public.payment_methods where name = 'Sunmeadow Demo Card'),
    'BILL-2102',
    420.50,
    current_date - 8,
    current_date + 3
  ),
  (
    'pending_approval',
    (select vendor_id from public.vendors where name = 'Copper Ridge Waste Services'),
    (select property_id from public.properties where name = 'Copper Ridge Fabrication'),
    (select user_id from public.users where email = 'alex.morgan@example.com'),
    (select payment_id from public.payment_methods where name = 'Copper Ridge Demo Card'),
    'BILL-2103',
    275.25,
    current_date - 2,
    current_date + 12
  );

insert into public.approvals (bill_id, submitted_by, status, notes)
values (
  (select bill_id from public.bills where invoice_number = 'BILL-2101'),
  (select user_id from public.users where email = 'alex.morgan@example.com'),
  'pending',
  'Submitted for approval'
);
