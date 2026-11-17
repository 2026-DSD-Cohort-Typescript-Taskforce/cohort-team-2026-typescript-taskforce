-- DC-109: a manual check, not a pgTAP test (supabase test db would run anything under
-- supabase/tests). Run against LOCAL Supabase: psql -X -v ON_ERROR_STOP=1 -f this-file
-- Everything rolls back, except sequence advancement (normal PostgreSQL behavior).
\set ON_ERROR_STOP on
begin;

-- Recreate legacy missing contacts, which predate the NOT VALID contact checks.
alter table public.vendors drop constraint vendors_email_present,
  drop constraint vendors_address_present, drop constraint vendors_phone_present;
update public.vendors set name = upper(name), email = null, address = '', phone = ' ',
  portal_username = 'dc109-synthetic-login', portal_password = 'dc109-synthetic-password',
  contact_name = 'DC109 retained contact', payment_portal_url = 'https://stale.example.invalid',
  supported_payment_methods = 'stale'
where lower(name) = 'alder creek landscaping';
alter table public.vendors
  add constraint vendors_email_present check (email is not null and btrim(email) <> '') not valid,
  add constraint vendors_address_present check (address is not null and btrim(address) <> '') not valid,
  add constraint vendors_phone_present check (phone is not null and btrim(phone) <> '') not valid;

create temp table dc109_vendors_before as select vendor_id,
  to_jsonb(v) - array['payment_portal_url','supported_payment_methods','email','address','phone','updated_at'] as retained,
  email, address, phone from public.vendors v;
create temp table dc109_relationships_before as
select 'bills' as kind, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') as rows from public.bills t
union all select 'policies', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.policies t
union all select 'user_vendors', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.user_vendors t;

\ir ../migrations/20261117180000_refresh_sample_vendors_from_bills.sql

do $$
begin
  if (select count(*) from public.vendors) <> (select count(*) from dc109_vendors_before) then
    raise exception 'Existing sample vendor names must not create duplicates';
  end if;
  if exists (
    select 1 from dc109_vendors_before b left join public.vendors v using (vendor_id)
    where v.vendor_id is null
      or b.retained is distinct from (to_jsonb(v) - array['payment_portal_url','supported_payment_methods','email','address','phone','updated_at'])
      or (nullif(btrim(b.email), '') is not null and b.email is distinct from v.email)
      or (nullif(btrim(b.address), '') is not null and b.address is distinct from v.address)
      or (nullif(btrim(b.phone), '') is not null and b.phone is distinct from v.phone)
  ) then raise exception 'Existing vendor IDs, credentials, metadata and contacts must survive'; end if;
  if exists (
    select 1 from (values
      ('alder creek landscaping','alder-creek'),
      ('brightwater water & sewer','brightwater'),
      ('copper ridge waste services','copper-ridge'),
      ('northline business internet','northline'),
      ('sunmeadow cleaning','sunmeadow'),
      ('cedar valley pest control','cedar-valley'),
      ('harborlight security','harborlight'),
      ('prairie grid hvac services','prairie-grid'),
      ('maple junction storage','maple-junction'),
      ('summit trail equipment rental','summit-trail')
    ) expected(name, slug) left join public.vendors v on lower(v.name) = expected.name
    where v.vendor_id is null
      or v.payment_portal_url is distinct from ('https://' || expected.slug || '-utility-demo.vercel.app')
      or v.supported_payment_methods is distinct from 'Card, ACH'
      or nullif(btrim(v.email),'') is null or nullif(btrim(v.address),'') is null or nullif(btrim(v.phone),'') is null
  ) then raise exception 'All ten PDF vendor URLs, methods and required contacts must match'; end if;
  if not exists (select 1 from public.vendors where lower(name) = 'alder creek landscaping'
    and email = 'billing@alder-creek.example.invalid'
    and address = 'Synthetic vendor address - not supplied in sample bill' and phone = '202-555-0101') then
    raise exception 'Missing contacts must use explicit synthetic fallbacks';
  end if;
end $$;

-- Simulate a missing sample vendor without deleting an existing row or its links.
create temp table dc109_summit_before as select vendor_id from public.vendors where lower(name) = 'summit trail equipment rental';
update public.vendors set name = 'DC109 unrelated vendor' where vendor_id in (select vendor_id from dc109_summit_before);
\ir ../migrations/20261117180000_refresh_sample_vendors_from_bills.sql
\ir ../migrations/20261117180000_refresh_sample_vendors_from_bills.sql

do $$
begin
  if (select count(*) from public.vendors) <> (select count(*) + 1 from dc109_vendors_before) then
    raise exception 'Insert missing vendor once; repeat migration must not add duplicates';
  end if;
  if not exists (select 1 from public.vendors join dc109_summit_before using(vendor_id) where name = 'DC109 unrelated vendor') then
    raise exception 'Unrelated existing vendor must survive';
  end if;
  if not exists (select 1 from public.vendors where lower(name) = 'summit trail equipment rental'
      and payment_portal_url = 'https://summit-trail-utility-demo.vercel.app') then
    raise exception 'Missing sample vendor must be inserted';
  end if;
  if exists (
    with current_rows as (
      select 'bills' as kind, coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') as rows from public.bills t
      union all select 'policies', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.policies t
      union all select 'user_vendors', coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]') from public.user_vendors t
    ) select 1 from current_rows c join dc109_relationships_before b using(kind) where c.rows is distinct from b.rows
  ) then raise exception 'Bills, policies and user-vendor links must remain unchanged'; end if;
end $$;
rollback;
\echo 'PASS: source values, IDs, contacts, credentials, relationships, unrelated vendors, case-insensitive matching and repeat/missing-row execution'
