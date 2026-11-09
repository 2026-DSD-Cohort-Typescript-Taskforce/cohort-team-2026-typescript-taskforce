-- Author:          Jared Crow
-- Date Created:    11/4/26
-- Date Finished:   11/4/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     Before, the primary key in users (referenced by bills, approvals, and payments) was int8 instead of int4.
--                  This file fixes that, so users is consistent with all the other tables.

-- The original tables:
ALTER TABLE bills
    ALTER COLUMN user_id        TYPE integer;

ALTER TABLE users
    ALTER COLUMN user_id        TYPE integer;


-- Logging & Tracking:
ALTER TABLE approvals
    ALTER COLUMN submitted_by   TYPE integer,
    ALTER COLUMN approved_by    TYPE integer;