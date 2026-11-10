-- Author:          Jared Crow
-- Date Created:    11/9/26
-- Date Finished:   11/XX/26
-- Ticket:          DC-86 Update the foreign keys in the users table to be a list of ids in each row.
-- Description:     This file makes the following changes to the database:
--                      - Change property_id in users from an int to a list of property ids called properties.
--                      - Change vendor_id in users from an int to a list of vendor ids called vendors.
--                      - Change the name of payment_id to payment_method_id in the payment methods, cards, and bank accounts tables.
--                      - Add an extra status to bills for when AI fails to insert a bill.




-- Updating the users table:


-- Updating the payment method tables:
ALTER TABLE payment_methods     RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE cards               RENAME COLUMN payment_id TO payment_method_id;
ALTER TABLE bank_accounts       RENAME COLUMN payment_id TO payment_method_id;


-- Updating the bills table:
