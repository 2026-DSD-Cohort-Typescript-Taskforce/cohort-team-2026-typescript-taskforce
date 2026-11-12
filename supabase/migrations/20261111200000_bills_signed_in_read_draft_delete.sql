-- DC-21: who can read and delete bills. Signed-out (anon) requests could read every bill,
-- and any signed-in user could delete any bill, including submitted ones. Now only
-- signed-in users can read bills, and they can delete a bill only while it is a draft, as
-- with the insert and update policies (20261106205929_bills_submit_bill_and_draft_only_policies.sql).
-- The app reads bills only with the user's session (client/lib/supabase.ts,
-- client/lib/bills.ts) and never deletes one, so no screen changes.

-- Replaces "bills table is public" from 20261026232200_create_seed_bills_table.sql.
drop policy "bills table is public" on public.bills;

create policy "authenticated users can view bills"
  on public.bills for select
  to authenticated
  using (true);

-- anon had every privilege on bills (the default privileges from
-- 20261024150824_remote_schema.sql, plus GRANT SELECT); only RLS stopped its writes.
revoke all on public.bills from anon;

-- Replaces "authenticated users can delete bills" from
-- 20261031174836_add_delete_policies_properties_bills_vendors.sql.
drop policy "authenticated users can delete bills" on public.bills;

create policy "authenticated users can delete draft bills"
  on public.bills for delete
  to authenticated
  using (status = 'draft');
