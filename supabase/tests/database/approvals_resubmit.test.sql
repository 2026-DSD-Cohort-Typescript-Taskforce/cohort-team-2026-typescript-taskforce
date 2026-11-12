-- DC-81: a bill sent back for revision goes back to approval when it's resubmitted, instead
-- of straight to pending_payment. Run with `supabase test db`. Synthetic data only;
-- everything rolls back.
begin;
create extension if not exists pgtap with schema extensions;
select plan(15);

-- Setup (as postgres): login A is a billing operator, B a financial approver. Ids 81201+,
-- users 81201+, to stay clear of seeded rows and the other test files.
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-0000000081b1', 'dc81-resubmit-a@example.test'),
  ('00000000-0000-4000-8000-0000000081b2', 'dc81-resubmit-b@example.test');
insert into public.vendors (vendor_id, name, payment_portal_url, supported_payment_methods)
  values (81201, 'DC81 Resubmit Vendor', 'https://vendor.example.test', 'card');
insert into public.properties (property_id, name) values (81201, 'DC81 Resubmit Property');
insert into public.payment_methods (payment_id, payment_type, name, billing_zip)
  values (81201, 'card', 'DC81 Resubmit Card', '75001');
insert into public.users (user_id, name, email, role, property_id, auth_user_id) values
  (81201, 'Operator A', 'dc81-resubmit-a@example.test', 'billing_operator', 81201, '00000000-0000-4000-8000-0000000081b1'),
  (81202, 'Approver B', 'dc81-resubmit-b@example.test', 'financial_approver', 81201, '00000000-0000-4000-8000-0000000081b2');
insert into public.bills (bill_id, status, vendor_id, property_id, user_id, payment_id, invoice_number, amount, date_due) values
  (81201, 'pending_approval', 81201, 81201, 81201, 81201, 'DC81-21', 120.00, current_date + 7),  -- revise, edit, resubmit, approve
  (81202, 'draft',            81201, 81201, 81201, 81201, 'DC81-22', 120.00, current_date + 7),  -- never reviewed
  (81203, 'pending_approval', 81201, 81201, 81201, 81201, 'DC81-23', 120.00, current_date + 7);  -- revised twice
insert into public.approvals (approval_id, bill_id, submitted_by, status, created_at, notes) values
  (81201, 81201, 81201, 'pending', now() - interval '1 day', 'Submitted for approval'),
  (81203, 81203, 81201, 'pending', now() - interval '2 days', 'Submitted for approval');

-- How many rows a statement changed (RLS can make an UPDATE match none).
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

-- Revision → edit → resubmit → approve, for bill 81201.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b2","role":"authenticated"}';
select results_eq(
  $$select status::text from public.decide_bill(81201, 'needs_revision', 'Amount should be 130.00')$$,
  $$values ('draft')$$,
  'the approver sends the bill back: it is a draft again'
);

set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b1","role":"authenticated"}';
select is(
  pg_temp.rows_changed($$update public.bills set amount = 130.00 where bill_id = 81201$$),
  1,
  'the operator can edit the returned draft'
);
select results_eq(
  $$select status::text, amount from public.submit_bill(81201)$$,
  $$values ('pending_approval', 130.00::numeric)$$,
  'resubmitting it goes back to pending_approval, not pending_payment'
);
reset role;

select results_eq(
  $$select status::text, submitted_by, approved_by, time_approved, notes from public.approvals
      where bill_id = 81201 order by created_at, approval_id$$,
  $$values ('needs_revision', 81201, 81202, now(), 'Amount should be 130.00'),
           ('pending', 81201, null::integer, null::timestamptz, null::text)$$,
  'the revision row is kept and a new pending row is opened for the resubmission'
);
select results_eq(
  $$select name, description from public.audit_logs
      where description like 'bill 81201: draft%'$$,
  $$values ('bill_submitted', 'bill 81201: draft → pending_approval, by user 81201')$$,
  'the audit row records the move to pending_approval'
);

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b2","role":"authenticated"}';
select results_eq(
  $$select status::text from public.decide_bill(81201, 'approved', null)$$,
  $$values ('pending_payment')$$,
  'the approver approves the resubmitted bill: pending_payment'
);
reset role;

select results_eq(
  $$select status::text, approved_by from public.approvals where bill_id = 81201 order by created_at, approval_id$$,
  $$values ('needs_revision', 81202), ('approved', 81202)$$,
  'the approval is recorded on the resubmission row; the revision row is unchanged'
);

-- A draft that was never sent back still goes straight to payment, with no approvals row.
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b1","role":"authenticated"}';
select results_eq(
  $$select status::text from public.submit_bill(81202)$$,
  $$values ('pending_payment')$$,
  'a never-reviewed draft is submitted to pending_payment as before'
);
reset role;
select is(
  (select count(*)::int from public.approvals where bill_id = 81202),
  0,
  'and no approvals row is written for it'
);

-- Revised twice: each resubmission opens its own pending row, and each decision lands on the
-- newest one, including rows created in the same transaction (approval_id breaks the tie).
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b2","role":"authenticated"}';
select results_eq(
  $$select status::text from public.decide_bill(81203, 'needs_revision', 'first')$$,
  $$values ('draft')$$,
  'bill 81203 is sent back once'
);
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b1","role":"authenticated"}';
select results_eq(
  $$select status::text from public.submit_bill(81203)$$,
  $$values ('pending_approval')$$,
  'and resubmitted to pending_approval'
);
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b2","role":"authenticated"}';
select results_eq(
  $$select status::text from public.decide_bill(81203, 'needs_revision', 'second')$$,
  $$values ('draft')$$,
  'sent back a second time'
);
set local request.jwt.claims = '{"sub":"00000000-0000-4000-8000-0000000081b1","role":"authenticated"}';
select lives_ok($$select public.submit_bill(81203)$$, 'and resubmitted again');
reset role;

select results_eq(
  $$select status::text, notes from public.approvals where bill_id = 81203 order by created_at, approval_id$$,
  $$values ('needs_revision', 'first'), ('needs_revision', 'second'), ('pending', null::text)$$,
  'each revision kept its own row, and the latest resubmission is the one pending'
);
select is(
  (select status::text from public.bills where bill_id = 81203),
  'pending_approval',
  'the twice-revised bill is waiting for approval again'
);

select finish();
rollback;
