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

-- DC-81: an approver profile and three bills waiting for approval, entered by Alex
-- Morgan, to try the approvals page. Avery has no login yet (auth_user_id is NULL); a
-- separate script (npm run seed:local-users --prefix server) links one. Due dates differ from id order on purpose. BILL-2101 also
-- has a pending approvals row; the other two don't, so decide_bill() inserts one.
insert into public.users (name, email, role, property_id)
values (
  'Avery Quinn',
  'avery.quinn@example.com',
  'financial_approver',
  (select property_id from public.properties where name = 'Alder Creek Workshop')
);

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
