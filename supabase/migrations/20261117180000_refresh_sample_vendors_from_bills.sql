-- DC-109: refresh the ten sample vendors from sample_bills.zip.
-- Match names case-insensitively, preserving vendor_id and every foreign key.
-- PDF customer/service addresses are NOT vendor addresses. Account and invoice
-- numbers belong to individual bills, not this vendor data migration.
-- PDF links contain invoice-specific fragments as well as these base portal URLs;
-- store the base URL because a vendor can have multiple invoices.
-- PDFs identify Card/ACH support but no vendor email/address/phone. Only missing
-- contacts receive clearly synthetic fallbacks (.invalid email, marked address,
-- reserved 555-01xx phone). Existing contacts, login credentials and logos survive.
-- No DELETE, TRUNCATE, identity reset, bill/approval/payment updates or schema changes.
-- Unrelated vendors are retained. Reapplying cannot create duplicate vendor names.

insert into public.vendors as existing
  (name, payment_portal_url, supported_payment_methods, email, address, phone)
values
  ('Alder Creek Landscaping', 'https://alder-creek-utility-demo.vercel.app', 'Card, ACH', 'billing@alder-creek.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0101'),
  ('Brightwater Water & Sewer', 'https://brightwater-utility-demo.vercel.app', 'Card, ACH', 'billing@brightwater.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0102'),
  ('Copper Ridge Waste Services', 'https://copper-ridge-utility-demo.vercel.app', 'Card, ACH', 'billing@copper-ridge.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0103'),
  ('Northline Business Internet', 'https://northline-utility-demo.vercel.app', 'Card, ACH', 'billing@northline.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0104'),
  ('Sunmeadow Cleaning', 'https://sunmeadow-utility-demo.vercel.app', 'Card, ACH', 'billing@sunmeadow.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0105'),
  ('Cedar Valley Pest Control', 'https://cedar-valley-utility-demo.vercel.app', 'Card, ACH', 'billing@cedar-valley.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0106'),
  ('Harborlight Security', 'https://harborlight-utility-demo.vercel.app', 'Card, ACH', 'billing@harborlight.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0107'),
  ('Prairie Grid HVAC Services', 'https://prairie-grid-utility-demo.vercel.app', 'Card, ACH', 'billing@prairie-grid.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0108'),
  ('Maple Junction Storage', 'https://maple-junction-utility-demo.vercel.app', 'Card, ACH', 'billing@maple-junction.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0109'),
  ('Summit Trail Equipment Rental', 'https://summit-trail-utility-demo.vercel.app', 'Card, ACH', 'billing@summit-trail.example.invalid', 'Synthetic vendor address - not supplied in sample bill', '202-555-0110')
on conflict (lower(name)) do update
set payment_portal_url = excluded.payment_portal_url,
    supported_payment_methods = excluded.supported_payment_methods,
    email = case when nullif(btrim(existing.email), '') is null
                 then excluded.email else existing.email end,
    address = case when nullif(btrim(existing.address), '') is null
                   then excluded.address else existing.address end,
    phone = case when nullif(btrim(existing.phone), '') is null
                 then excluded.phone else existing.phone end,
    updated_at = now();
