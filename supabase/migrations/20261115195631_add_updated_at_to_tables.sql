-- Author:          Jared Crow
-- Date Created:    11/15/26
-- Date Finished:   11/15/26
-- Ticket:          DC-108 Extra Supabase Edits
-- Description:     This file renames and adds a few columns to remove inconsistencies and prevent confusion.

-- Rename the primary keys in payment_methods, cards, & bank_accounts from payment_id to payment_method_id.
    -- This also means updating the foreign key in bills that references payment_id.
-- Why? Because the primary key in payments table is also named payment_id.
ALTER TABLE bills               RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE payment_methods     RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE cards               RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE bank_accounts       RENAME COLUMN payment_id TO payment_method_id;


-- Add an updated_at column to properties, payment_methods, cards, and bank_accounts.
-- Why? To make these tables consistent with the rest.

-- Add a notes column to bills.
-- Why? To better log information for why a bill parse fails.


