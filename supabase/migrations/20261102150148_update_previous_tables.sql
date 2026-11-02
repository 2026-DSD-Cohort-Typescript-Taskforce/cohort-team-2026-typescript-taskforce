-- Author:          Jared Crow
-- Date Created:    10/30/26
-- Date Finished:   11/2/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     This file makes changes to tables created in prior migrations to get the database in sync with the ERD.
--                  
-- Misc. Notes:
--      - PostgreSQL doesn't have String. Instead, use TEXT.

--  QUESTIONS TO ASK THE TEAM:
--      - Should we remove or keep updated_at in users?
--      - What do the diamonds mean for each column in supabase preview? Does that mean they are primary keys?
--      - The cards and bank_accounts tables differ from the ERD. Which is the correct version?
--      - Is the id in users supposed to be a larger int than the rest of the table IDs? If not, should I change all of the ids to int4 or int8?


-- Function examples:
--      - Rename an attribute:
--          ALTER TABLE table_name RENAME COLUMN old_name TO new_name;
--      - Change an attribute's data type:
--          ALTER TABLE table_name ALTER COLUMN column_name TYPE new_type;
--      - Add a column:
--          ALTER TABLE table_name ADD COLUMN column_name datatype;
--      - Remove a column:
--          ALTER TABLE table_name DROP COLUMN column_name;

--Updating the bills table:
-- ALTER TABLE bills           ALTER COLUMN bill_id TYPE BIGINT;    -- Don't do this unless I also want to update all the foreign key instances. May need to be a separate migration.

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

-- Updating the users table:
ALTER TABLE users           RENAME COLUMN id TO user_id;
ALTER TABLE users           RENAME COLUMN user_name TO name;
ALTER TABLE users           RENAME COLUMN user_email TO email;
ALTER TABLE users           RENAME COLUMN user_phone TO phone;
ALTER TABLE users           RENAME COLUMN user_role TO role;
ALTER TABLE users           RENAME COLUMN inserted_at TO created_at;

-- Updating the audit_logs table:
ALTER TABLE audit_logs      DROP COLUMN user_id;
ALTER TABLE audit_logs      DROP COLUMN bill_id;
ALTER TABLE audit_logs      RENAME COLUMN action TO name;
ALTER TABLE audit_logs      ALTER COLUMN name TYPE TEXT;

-- Updating the payment_methods table:
ALTER TABLE payment_methods ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;


-- Updating the cards table:
ALTER TABLE cards           ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Updating the bank_accounts table:




