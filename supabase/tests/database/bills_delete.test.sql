-- Who can delete a bill (20261118235000_approvers_delete_reviewed_bills.sql). Anyone signed
-- in deletes a never-reviewed draft; financial approvers and system admins also delete a
-- sent-back draft, a bill waiting for approval or a denied one, with its approvals rows.
-- Nobody deletes a bill that reached payment. Run with `supabase test db`. Synthetic data
-- only; everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- Setup (as postgres): A is a billing operator, B a financial approver, D a system admin.
-- Bills 94001+, users 94101+ stay clear of seeded rows.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000094a1', 'del-a@example.test'),
  ('00000000-0000-4000-8000-0000000094a2', 'del-b@example.test'),
  ('00000000-0000-4000-8000-0000000094a4', 'del-d@example.test');
insert into public.vendors (vendor_id, name, email, address, phone, payment_portal_url, supported_payment_methods)
  values (94001, 'Delete Test Vendor', 'vendor-94001@example.test', '1 Test Way', '555-0100', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (94001, 'Delete Test Property');
insert into public.payment_methods (payment_method_id, payment_type, name, billing_zip)
  values (94001, 'card', 'Delete Test Card', '75001');
insert into public.users (user_id, name, email, role, auth_user_id) values
  (94101, 'Operator A', 'del-a@example.test', 'billing_operator', '00000000-0000-4000-8000-0000000094a1'),
  (94102, 'Approver B', 'del-b@example.test', 'financial_approver', '00000000-0000-4000-8000-0000000094a2'),
  (94103, 'Admin D', 'del-d@example.test', 'system_admin', '00000000-0000-4000-8000-0000000094a4');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_method_id, invoice_number, amount, date_due) values
  (94001, 'draft',            94001, 94001, 94101, 94001, 'DEL-01', 10.00, current_date + 7),  -- never reviewed
  (94002, 'draft',            94001, 94001, 94101, 94001, 'DEL-02', 10.00, current_date + 7),  -- sent back
  (94003, 'pending_approval', 94001, 94001, 94101, 94001, 'DEL-03', 10.00, current_date + 7),
  (94004, 'approval_denied',  94001, 94001, 94101, 94001, 'DEL-04', 10.00, current_date + 7),
  (94005, 'pending_payment',  94001, 94001, 94101, 94001, 'DEL-05', 10.00, current_date + 7),
  (94006, 'payment_success',  94001, 94001, 94101, 94001, 'DEL-06', 10.00, current_date + 7);
insert into public.approvals (bill_id, submitted_by, status) values
  (94002, 94101, 'needs_revision'),
  (94003, 94101, 'pending'),
  (94004, 94101, 'rejected');

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

select policy_cmd_is('public', 'bills', 'approvers can delete reviewed bills', 'delete', 'the approver delete policy covers DELETE');
select policy_roles_are('public', 'bills', 'approvers can delete reviewed bills', ARRAY['authenticated'], 'the approver delete policy is for authenticated only');

-- Billing operator: only the never-reviewed draft
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000094a1","role":"authenticated"}';
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94002$$), 0, 'an operator can''t delete a sent-back draft');
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94003$$), 0, 'an operator can''t delete a bill waiting for approval');
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94004$$), 0, 'an operator can''t delete a denied bill');
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94001$$), 1, 'an operator can delete a never-reviewed draft');
reset role;

-- Financial approver: reviewed bills, with their approvals rows
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000094a2","role":"authenticated"}';
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94002$$), 1, 'an approver can delete a sent-back draft');
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94003$$), 1, 'an approver can delete a bill waiting for approval');
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94005$$), 0, 'an approver can''t delete a bill pending payment');
reset role;

-- System admin
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000094a4","role":"authenticated"}';
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94004$$), 1, 'an admin can delete a denied bill');
select is(pg_temp.rows_changed($$delete from public.bills where bill_id = 94006$$), 0, 'an admin can''t delete a paid bill');
reset role;

select results_eq(
  $$select bill_id from public.bills where bill_id between 94001 and 94006 order by bill_id$$,
  $$values (94005), (94006)$$,
  'only the bills that reached payment are left'
);
select is((select count(*)::int from public.approvals where bill_id between 94001 and 94006), 0, 'the deleted bills'' approvals rows went with them');

select * from finish();
rollback;
