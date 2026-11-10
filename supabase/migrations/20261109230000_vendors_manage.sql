-- DC-84: managing vendors. Adds vendors.email and vendors.logo_path, makes the payment
-- portal URL and supported methods optional, requires a name, email, address and phone on
-- new rows, and limits vendor writes to financial approvers and system admins. Logos go in
-- a public vendor-logos storage bucket that only those two roles can add to or delete from.
--
-- The presence CHECKs are NOT VALID: they apply to every new and updated row, but the
-- existing vendors (which have no email, address or phone) stay as they are. This changes
-- no rows.

-- Columns
alter table public.vendors add column email text;
alter table public.vendors add column logo_path text;

alter table public.vendors alter column payment_portal_url drop not null;
alter table public.vendors alter column supported_payment_methods drop not null;

-- A blank value counts as missing.
alter table public.vendors add constraint vendors_name_present
  check (name is not null and btrim(name) <> '') not valid;
alter table public.vendors add constraint vendors_email_present
  check (email is not null and btrim(email) <> '') not valid;
alter table public.vendors add constraint vendors_address_present
  check (address is not null and btrim(address) <> '') not valid;
alter table public.vendors add constraint vendors_phone_present
  check (phone is not null and btrim(phone) <> '') not valid;

create unique index vendors_name_lower_key on public.vendors (lower(name));

-- Who can write vendors. Runs as the table owner so it can read users, which signed-in
-- users can't fully read (DC-22).
create function public.is_vendor_manager()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.users
    where auth_user_id = (select auth.uid())
      and role in ('financial_approver', 'system_admin')
  );
$$;

-- New functions in public are executable by PUBLIC and anon by default.
revoke execute on function public.is_vendor_manager() from public, anon;
grant execute on function public.is_vendor_manager() to authenticated;

-- Replaces the open policies from 20261024201906_create_seed_vendors_table.sql and
-- 20261031174836_add_delete_policies_properties_bills_vendors.sql. Only signed-in users
-- read vendors now; anon loses all access.
drop policy "vendors table is public" on public.vendors;
drop policy "authenticated users can insert vendors" on public.vendors;
drop policy "authenticated users can update vendors" on public.vendors;
drop policy "authenticated users can delete vendors" on public.vendors;

create policy "signed-in users can view vendors"
  on public.vendors for select
  to authenticated
  using (true);

create policy "vendor managers can add vendors"
  on public.vendors for insert
  to authenticated
  with check ((select public.is_vendor_manager()));

create policy "vendor managers can change vendors"
  on public.vendors for update
  to authenticated
  using ((select public.is_vendor_manager()))
  with check ((select public.is_vendor_manager()));

create policy "vendor managers can delete vendors"
  on public.vendors for delete
  to authenticated
  using ((select public.is_vendor_manager()));

revoke all on public.vendors from anon;

-- Inserts take the next vendor_id from this sequence.
grant usage on sequence public.vendors_vendor_id_seq to authenticated;

-- Logo bucket: public, 1 MiB, png/jpeg/webp.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vendor-logos', 'vendor-logos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;

-- There is no UPDATE policy: a logo is replaced by uploading a new file and deleting the old one.
create policy "signed-in users can view vendor logos"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'vendor-logos');

create policy "vendor managers can upload vendor logos"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'vendor-logos' and (select public.is_vendor_manager()));

create policy "vendor managers can delete vendor logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'vendor-logos' and (select public.is_vendor_manager()));
