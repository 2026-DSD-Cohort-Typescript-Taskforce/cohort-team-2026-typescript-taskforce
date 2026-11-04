-- Author:          Jared Crow
-- Date Created:    11/3/26
-- Date Finished:   11/X/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     This file updates the tables from prior migrations to match the nullable constraints in the ERD,
--                  adds missing attributes to the cards and bank_accounts table,
--                  and removes attributes in the cards and bank_accounts table that aren't in the ERD.
    
-- Notes:
--      -- The ALTER statements that are commented out cause problems when uncommented due to existing test data containing null values.


-- Function examples (works for both regular attributes & foreign key):
-- (You need to explicitly set foreign keys to NOT NULL, even if the referenced primary key already is!)
--      ALTER TABLE table_name
--          ALTER COLUMN column_name SET NOT NULL;
--          ALTER COLUMN column_name DROP NOT NULL;

-- The original tables:
--ALTER TABLE bills
    --ALTER COLUMN property_id            SET NOT NULL,
    --ALTER COLUMN vendor_id              SET NOT NULL,
    --ALTER COLUMN user_id                SET NOT NULL,
    --ALTER COLUMN payment_id             SET NOT NULL,
    --ALTER COLUMN pdf_path               SET NOT NULL;

-- (any changes to properties would go here)

ALTER TABLE vendors
    ALTER COLUMN payment_portal_url         SET NOT NULL,
    ALTER COLUMN supported_payment_methods  SET NOT NULL,
    ALTER COLUMN updated_at                 DROP NOT NULL;

ALTER TABLE users
    ALTER COLUMN property_id            SET NOT NULL,
    --ALTER COLUMN auth_user_id           SET NOT NULL,
    ALTER COLUMN role                   SET NOT NULL,
    ALTER COLUMN updated_at             DROP NOT NULL;


-- Payment Methods:
ALTER TABLE payment_methods
    ALTER COLUMN billing_zip            SET NOT NULL;

ALTER TABLE cards
    ALTER COLUMN card_brand             SET NOT NULL,
    --ADD COLUMN card_number  VARCHAR(19)     NOT NULL        UNIQUE,
    --ADD COLUMN cvc          VARCHAR(4)      NOT NULL,
    ALTER COLUMN exp_date               SET NOT NULL,
    ALTER COLUMN is_credit              SET NOT NULL,
    DROP COLUMN last_four;

ALTER TABLE bank_accounts
    --ADD COLUMN account_number   VARCHAR     NOT NULL,
    --ADD COLUMN routing_number   VARCHAR     NOT NULL,
    ALTER COLUMN bank_name              SET NOT NULL,
    DROP COLUMN last_four;


-- Logging & Tracking:
ALTER TABLE approvals
    ALTER COLUMN bill_id                SET NOT NULL,
    ALTER COLUMN submitted_by           SET NOT NULL,
    ALTER COLUMN approved_by            SET NOT NULL;

ALTER TABLE payments
    ALTER COLUMN bill_id                SET NOT NULL;

ALTER TABLE audit_logs
    ALTER COLUMN description            SET NOT NULL;
