-- Author:          Jared Crow
-- Date Created:    10/30/26
-- Date Finished:   11/2/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     As the name implies, this file creates the approvals and payments tables, as seen in the ERD on Figma.
--                  This file also makes changes to tables created in prior migrations to get the database in sync with the ERD.
-- Misc. Notes:
--      - PostgreSQL doesn't have String. Instead, use TEXT.
--      - Check with ChatGPT if my permissions are correct.

--  QUESTIONS TO ASK THE TEAM:
--      - What roles have permissions to view these tables?
--      - Should we remove or keep updated_at in users?
--      - What do the diamonds mean for each column in supabase preview? Does that mean they are primary keys?
--      - The cards and bank_accounts tables differ from the ERD. Which is the correct version?


-- Function examples:
--      - Rename an attribute:
--          ALTER TABLE table_name RENAME COLUMN old_name TO new_name;
--      - Change an attribute's data type:
--          ALTER TABLE table_name ALTER COLUMN column_name TYPE new_type;
--      - Add a column:
--          ALTER TABLE table_name ADD COLUMN column_name datatype;
--      - Remove a column:
--          ALTER TABLE table_name DROP COLUMN column_name;


-- Updating the users table:
ALTER TABLE users           RENAME COLUMN id TO user_id;
ALTER TABLE users           RENAME COLUMN user_name TO name;
ALTER TABLE users           RENAME COLUMN user_email TO email;
ALTER TABLE users           RENAME COLUMN user_phone TO phone;
ALTER TABLE users           RENAME COLUMN user_role TO role;
ALTER TABLE users           RENAME COLUMN inserted_at TO created_at;

-- Updating the properties table:
ALTER TABLE properties      RENAME COLUMN property_name TO name;
ALTER TABLE properties      RENAME COLUMN property_address TO address;
ALTER TABLE properties      RENAME COLUMN property_phone TO phone;
ALTER TABLE properties      RENAME COLUMN property_email TO email;

-- Updating the vendors table:
ALTER TABLE vendors         RENAME COLUMN vendor_name TO name;
ALTER TABLE vendors         RENAME COLUMN vendor_address TO address;
ALTER TABLE vendors         RENAME COLUMN vendor_phone TO phone;
ALTER TABLE vendors         ALTER COLUMN supported_payment_methods TYPE TEXT;

-- Updating the payment_methods table:
ALTER TABLE payment_methods ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Updating the audit_logs table:
ALTER TABLE audit_logs      DROP COLUMN user_id;
ALTER TABLE audit_logs      DROP COLUMN bill_id;
ALTER TABLE audit_logs      RENAME COLUMN action TO name;
ALTER TABLE audit_logs      ALTER COLUMN name TYPE TEXT;

-- Updating the cards table:

-- Updating the bank_accounts table:



-- Creating the approvals table:
--CREATE TABLE bills (
--    approval_id SERIAL PRIMARY KEY,
--
--    bill_id INTEGER REFERENCES properties(property_id),
--    approved_by INTEGER REFERENCES users(vendor_id),
--    submitted_by INTEGER REFERENCES users(id),

--);



-- Permissions for the approvals table:






-- Creating the payments table:


-- Permissions for the payments table:
