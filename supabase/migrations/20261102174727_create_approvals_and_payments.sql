-- Author:          Jared Crow
-- Date Created:    11/2/26
-- Date Finished:   11/2/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     As the name implies, this file creates the approvals and payments tables, as seen in the ERD on Figma.
--                  
-- To do:
--      - Add permissions specifications to this file.
--      - Check with ChatGPT if my permissions are correct.
--      - Validate that everything is accurate to the ERD.
--      - Add sample data to the tables.

--  QUESTIONS TO ASK THE TEAM:
--      - What roles have permissions to view these tables?


-- Creating the approvals table:
CREATE TABLE approvals (
    -- Adding attributes:
    approval_id SERIAL PRIMARY KEY,

    bill_id INTEGER REFERENCES bills(bill_id),
    submitted_by BIGINT REFERENCES users(user_id),                     -- The user that approved this bill.
    approved_by BIGINT REFERENCES users(user_id),                      -- The user that approved this bill.

    time_approved TIMESTAMP,                                            -- Exactly when the bill gets approved.
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,            -- Exactly when the bill was requested to be approved.
    notes TEXT,

    -- Constraining possible values of status:
    CONSTRAINT status_values
    CHECK (
        status IN (
            'pending',
            'approved',
            'rejected',
            'expired',
            'canceled'
        )
    )
);
-- Permissions for the approvals table:



-- Creating the payments table:
CREATE TABLE payments (
    -- Adding attributes:
    payment_id SERIAL PRIMARY KEY,

    bill_id INTEGER REFERENCES bills(bill_id),

    time_paid TIMESTAMP,                                                -- Exactly when the bill gets paid.
    status VARCHAR(20) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,            -- Exactly when the bill was approved to be paid.
    notes TEXT,
    
    -- Constraining possible values of status:
    CONSTRAINT status_values
    CHECK (
        status IN (
            'pending',
            'processing',
            'success',
            'failure',
            'canceled'
        )
    )
);

-- Permissions for the payments table:


