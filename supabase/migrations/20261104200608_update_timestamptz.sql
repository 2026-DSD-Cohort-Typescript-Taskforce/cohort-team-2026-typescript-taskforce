-- Author:          Jared Crow
-- Date Created:    11/4/26
-- Date Finished:   11/4/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     This file simply changes any timestamp column to the timestamptz data type to keep things more consistent in the database.
--                  (Which means every timestamp that isn't in users).

-- The original tables:
ALTER TABLE bills
    ALTER COLUMN date_issued    TYPE timestamptz,
    ALTER COLUMN date_received  TYPE timestamptz,
    ALTER COLUMN date_paid      TYPE timestamptz,
    ALTER COLUMN created_at     TYPE timestamptz,
    ALTER COLUMN updated_at     TYPE timestamptz;

ALTER TABLE properties
    ALTER COLUMN created_at     TYPE timestamptz;

ALTER TABLE vendors
    ALTER COLUMN created_at     TYPE timestamptz,
    ALTER COLUMN updated_at     TYPE timestamptz;


-- Payment Methods:
ALTER TABLE payment_methods
    ALTER COLUMN created_at     TYPE timestamptz;

ALTER TABLE cards
    ALTER COLUMN created_at     TYPE timestamptz;

ALTER TABLE bank_accounts
    ALTER COLUMN created_at     TYPE timestamptz;


-- Logging & Tracking:
ALTER TABLE approvals
    ALTER COLUMN time_approved  TYPE timestamptz,
    ALTER COLUMN created_at     TYPE timestamptz;

ALTER TABLE payments
    ALTER COLUMN time_paid      TYPE timestamptz,
    ALTER COLUMN created_at     TYPE timestamptz;

ALTER TABLE audit_logs
    ALTER COLUMN created_at     TYPE timestamptz;
