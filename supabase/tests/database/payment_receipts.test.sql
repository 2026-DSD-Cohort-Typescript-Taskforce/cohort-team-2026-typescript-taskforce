-- DC-112: private receipt association and shared read/retry authorization.
begin;
create extension if not exists pgtap with schema extensions;
select plan(29);
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-000000112001','receipt-owner@example.test'),
 ('00000000-0000-4000-8000-000000112002','receipt-other@example.test'),
 ('00000000-0000-4000-8000-000000112003','receipt-approver@example.test'),
 ('00000000-0000-4000-8000-000000112004','receipt-admin@example.test'),
 ('00000000-0000-4000-8000-000000112005','receipt-no-profile@example.test');
insert into public.users(user_id,name,email,role,auth_user_id) values
 (112001,'Owner','receipt-owner@example.test','billing_operator','00000000-0000-4000-8000-000000112001'),
 (112002,'Other','receipt-other@example.test','billing_operator','00000000-0000-4000-8000-000000112002'),
 (112003,'Approver','receipt-approver@example.test','financial_approver','00000000-0000-4000-8000-000000112003'),
 (112004,'Admin','receipt-admin@example.test','system_admin','00000000-0000-4000-8000-000000112004');
insert into public.bills(bill_id,user_id,vendor_id,property_id,payment_method_id,status,amount,invoice_number)
 values (112001,112001,(select min(vendor_id) from public.vendors),(select min(property_id) from public.properties),
 (select min(payment_method_id) from public.payment_methods),'pending_payment',125,'RECEIPT-112');
insert into public.approvals(bill_id,submitted_by,approved_by,status) values(112001,112001,112003,'approved');
insert into public.bills(bill_id,user_id,status) values(112002,112002,'draft');
-- DC-89: a successful payment comes only from the attempt flow: prepare (service), authorize
-- (the owner, an operator), then start and record (service). Its idempotency key is generated.
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.prepare_payment(112001,112001,0,current_date);
reset role;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000112001","role":"authenticated"}';
select public.authorize_payment(p.payment_id,public.payment_summary(p)) from public.payments p where p.bill_id=112001;
reset role;
set local role service_role;
set local request.jwt.claims='{"role":"service_role"}';
select public.start_payment_submission((select payment_id from public.payments where bill_id=112001));
-- In FROM, so it runs once ((f()).* would call it once per column).
create temp table receipt_payment as select r.* from public.record_payment(
 (select payment_id from public.payments where bill_id=112001),'success','confirmed','TX-112') r;
reset role;
select set_config('test.receipt_key',(select idempotency_key from receipt_payment),true);
select is((select status from public.bills where bill_id=112001),'payment_success','authoritative writer marks bill paid');
select is((select public from storage.buckets where id='payment-receipts'),false,'receipt bucket is private');
select is((select allowed_mime_types from storage.buckets where id='payment-receipts'),array['image/png'],'bucket accepts PNG only');
select is((select file_size_limit::integer from storage.buckets where id='payment-receipts'),2097152,'bucket limits image size');

set local role service_role;
select throws_ok(format('select public.set_payment_receipt(%s,112002,current_setting(''test.receipt_key''),null,''capture_failed'')',(select payment_id from receipt_payment)), 'PT409',null,'wrong bill cannot receive receipt');
select throws_ok(format('select public.set_payment_receipt(%s,112001,''other-key'',null,''capture_failed'')',(select payment_id from receipt_payment)), 'PT409',null,'wrong execution key cannot attach');
select throws_ok(format('select public.set_payment_receipt(%s,112001,current_setting(''test.receipt_key''),''other/path.png'',null)',(select payment_id from receipt_payment)), 'PT400',null,'caller cannot choose arbitrary object path');
select lives_ok(format('select public.set_payment_receipt(%s,112001,current_setting(''test.receipt_key''),null,''upload_failed'')',(select payment_id from receipt_payment)), 'failed upload is recorded separately');
select is((select status from public.payments where bill_id=112001),'success','upload failure does not undo payment');
select lives_ok(format('select public.set_payment_receipt(%s,112001,current_setting(''test.receipt_key''),''payments/%s/receipt.png'',null)',(select payment_id from receipt_payment),(select payment_id from receipt_payment)), 'upload retry can attach receipt without paying');
select lives_ok(format('select public.set_payment_receipt(%s,112001,current_setting(''test.receipt_key''),null,''upload_failed'')',(select payment_id from receipt_payment)), 'late upload failure cannot downgrade stored receipt');
select is((select receipt_status from public.payments where bill_id=112001),'stored','stored receipt remains stored');
reset role;
-- A #59-era success row (written before DC-89's guard, no outcome columns) can still get one.
insert into public.bills(bill_id,user_id,vendor_id,property_id,payment_method_id,status,amount,invoice_number,date_due)
 select 112003,112001,vendor_id,property_id,payment_method_id,'payment_success',125,'RECEIPT-112-OLD',current_date
 from public.bills where bill_id=112001;
alter table public.payments disable trigger payments_guard;
insert into public.payments(bill_id,status,time_paid,idempotency_key) values(112003,'success',now(),'portal-112003');
alter table public.payments enable trigger payments_guard;
set local role service_role;
select lives_ok(format('select public.set_payment_receipt(%s,112003,''portal-112003'',null,''capture_failed'')',(select payment_id from public.payments where bill_id=112003)), 'a #59-era payment can still record a receipt failure');
reset role;
insert into storage.objects(bucket_id,name) select 'payment-receipts','payments/'||payment_id||'/receipt.png' from receipt_payment;
grant select on receipt_payment to authenticated;
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000112001","role":"authenticated"}';
select is((select count(*)::integer from storage.objects where bucket_id='payment-receipts'),1,'owner can read private receipt');
select lives_ok(format('select public.get_payment_receipt(112001,%s)',(select payment_id from receipt_payment)), 'owner can retrieve receipt metadata');
-- Capture ID as postgres for tests that intentionally have no table access.
reset role;
select set_config('test.receipt_payment_id',(select payment_id::text from receipt_payment),true);
set local role authenticated;
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000112002","role":"authenticated"}';
select throws_ok($sql$update public.payments set bill_id=112002 where bill_id=112001$sql$, '42501',null,'operator cannot reassign victim payment to their own bill');
select throws_ok($sql$update public.payments set receipt_status='failed',receipt_path=null where bill_id=112001$sql$, '42501',null,'operator cannot alter receipt metadata directly');
select throws_ok($sql$insert into public.payments(bill_id,status) values(112002,'success')$sql$, '42501',null,'operator cannot forge successful payments');
select throws_ok($sql$truncate public.payments cascade$sql$, '42501',null,'operator cannot truncate payment evidence');
select is((select count(*)::integer from storage.objects where bucket_id='payment-receipts'),0,'other operator cannot read image');
select throws_ok(format('select public.get_payment_receipt(112001,%s)',current_setting('test.receipt_payment_id')), 'PT404',null,'other operator cannot retry receipt upload');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000112003","role":"authenticated"}';
select is((select count(*)::integer from storage.objects where bucket_id='payment-receipts'),1,'approver can read');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000112004","role":"authenticated"}';
select is((select count(*)::integer from storage.objects where bucket_id='payment-receipts'),1,'admin can read');
set local request.jwt.claims='{"sub":"00000000-0000-4000-8000-000000112005","role":"authenticated"}';
select is((select count(*)::integer from storage.objects where bucket_id='payment-receipts'),0,'login without profile cannot read');
select throws_ok(format('select public.set_payment_receipt(%s,112001,current_setting(''test.receipt_key''),null,''upload_failed'')',current_setting('test.receipt_payment_id')), '42501',null,'signed-in users cannot associate receipts');
select throws_ok($sql$insert into storage.objects(bucket_id,name) values ('payment-receipts','forged.png')$sql$, '42501',null,'signed-in users cannot upload arbitrary receipts');
select throws_ok(format('select public.get_payment_receipt(112002,%s)',current_setting('test.receipt_payment_id')), 'PT404',null,'mismatched bill lookup is refused');
reset role;
set local role anon;
select throws_ok(format('select public.get_payment_receipt(112001,%s)',current_setting('test.receipt_payment_id')), '42501',null,'signed-out users cannot read metadata');
select throws_ok(format('select public.set_payment_receipt(%s,112001,current_setting(''test.receipt_key''),null,''upload_failed'')',current_setting('test.receipt_payment_id')), '42501',null,'signed-out users cannot attach receipts');
select * from finish();
rollback;
