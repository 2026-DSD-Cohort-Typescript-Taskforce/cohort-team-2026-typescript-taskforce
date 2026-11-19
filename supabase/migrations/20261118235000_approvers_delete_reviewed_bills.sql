-- Who can delete a bill. Any signed-in user can delete a draft that was never reviewed.
-- Financial approvers and system admins can also delete a bill that went through review:
-- a sent-back draft, one waiting for approval, or a denied one. So whoever entered a bill
-- can't erase an approver's decision. Bills that reached payment can't be deleted: the
-- hourly sweep may be paying them, and payments keep their history.
-- Policies OR together. is_vendor_manager() is the financial_approver / system_admin check
-- (20261111170000_vendors_manage.sql); every signed-in user can read approvals.

-- Was status = 'draft' (20261111200000_bills_signed_in_read_draft_delete.sql).
alter policy "authenticated users can delete draft bills" on public.bills
  using (
    status = 'draft'
    and not exists (select 1 from public.approvals a where a.bill_id = bills.bill_id)
  );

create policy "approvers can delete reviewed bills"
  on public.bills for delete
  to authenticated
  using (
    status in ('draft', 'pending_approval', 'approval_denied')
    and (select public.is_vendor_manager())
  );

-- A reviewed bill's approvals rows go with it; the audit_row_change triggers on bills and
-- approvals still log both deletes.
alter table public.approvals
  drop constraint approvals_bill_id_fkey,
  add constraint approvals_bill_id_fkey
    foreign key (bill_id) references public.bills (bill_id) on delete cascade;
