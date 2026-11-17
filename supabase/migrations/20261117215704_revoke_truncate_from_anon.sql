-- Author:          Jared Crow
-- Date Created:    11/17/26
-- Last Updated:    11/17/26
-- Ticket:          DC-110 Revoke TRUNCATE from anon and authenticated on domain tables
-- Description:     Removes the ability for anonymous and authenticated users to truncate (aka delete) tables.
--                      Why? so non-admin users can't just delete data.

-- Notes:
--  - Tested my changes and they all work.
--  - However, supabase test db broke due to changes in DC-109, which a separate branch is fixing.
--  - Need to pull that before making a PR for this migration.

-- Removing the truncate privilege from 8 tables:
revoke truncate on table public.approvals       from anon, authenticated;
revoke truncate on table public.bank_accounts   from anon, authenticated;
revoke truncate on table public.cards           from anon, authenticated;
revoke truncate on table public.payment_methods from anon, authenticated;
revoke truncate on table public.payments        from anon, authenticated;
revoke truncate on table public.properties      from anon, authenticated;

revoke truncate on table public.bills           from authenticated;
revoke truncate on table public.vendors         from authenticated;


-- This command isn't needed, but helps make sure ant future tables also don't have truncate permissions for anonymous users too:
alter default privileges in schema public revoke truncate on tables from anon, authenticated;
