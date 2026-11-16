-- Author:          Jared Crow
-- Date Created:    11/16/26
-- Last Updated:    11/16/26
-- Ticket:          DC-108 Extra Supabase Edits
-- Description:     This file adds a few columns to the db to make things more consistent:


-- Add an updated_at column to properties, payment_methods, cards, and bank_accounts.
--      - Type is timestamptz. Nullable. Not unique (should be consistent with the updated_at column found in other tables).
-- Why? To make these tables consistent with the rest.
ALTER TABLE properties      ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE payment_methods ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE cards           ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE bank_accounts   ADD COLUMN updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP;


-- Keep updated_at current automatically on every UPDATE, using the existing
-- public.set_updated_at() trigger function (same as the users table).
CREATE TRIGGER properties_set_updated_at
    BEFORE UPDATE ON properties
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER payment_methods_set_updated_at
    BEFORE UPDATE ON payment_methods
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER cards_set_updated_at
    BEFORE UPDATE ON cards
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();  

CREATE TRIGGER bank_accounts_set_updated_at
    BEFORE UPDATE ON bank_accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- Add a notes column to bills.
--      - Type is text. Nullable. Not unique (should be consistent with the notes column in approvals and payments).
-- Why? To better log information for why a bill parse fails.
ALTER TABLE bills ADD COLUMN notes TEXT;
