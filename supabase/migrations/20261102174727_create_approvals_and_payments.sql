-- Author:          Jared Crow
-- Date Created:    11/2/26
-- Date Finished:   11/2/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     As the name implies, this file creates the approvals and payments tables, as seen in the ERD on Figma.
--                  
-- To do:
--      - Validate that everything is accurate to the ERD.
--      - Add sample data to the tables.

--  QUESTIONS TO ASK THE TEAM:
--      - What roles have permissions to view these tables?
--          - All should be able to view.


-- Creating the approvals table:
CREATE TABLE approvals (
    -- Adding attributes:
    approval_id SERIAL PRIMARY KEY,

    bill_id INTEGER REFERENCES bills(bill_id),
    submitted_by BIGINT REFERENCES users(user_id),                     -- The user that approved this bill.
    approved_by BIGINT REFERENCES users(user_id),                      -- The user that approved this bill.

    status VARCHAR(20) NOT NULL,
    time_approved TIMESTAMP,                                            -- Exactly when the bill gets approved.
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
    -- This means permissions can apply row-by-row:
    ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "authenticated users can view approvals"
        ON approvals
        FOR SELECT
        TO authenticated
        USING (true);
    CREATE POLICY "authenticated users can insert approvals"
        ON approvals
        FOR INSERT
        TO authenticated
        WITH CHECK (true);
    CREATE POLICY "authenticated users can update approvals"
        ON approvals
        FOR UPDATE
        TO authenticated
        USING (true)
        WITH CHECK (true);

    GRANT SELECT, INSERT, UPDATE, DELETE
        ON approvals TO authenticated;

    GRANT SELECT, INSERT, UPDATE, DELETE
        ON approvals TO service_role;


-- Creating the payments table:
CREATE TABLE payments (
    -- Adding attributes:
    payment_id SERIAL PRIMARY KEY,

    bill_id INTEGER REFERENCES bills(bill_id),

    status VARCHAR(20) NOT NULL,
    time_paid TIMESTAMP,                                                -- Exactly when the bill gets paid.
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
    ALTER TABLE payments ENABLE ROW LEVEL SECURITY;

    CREATE POLICY "authenticated users can view payments"
        ON payments
        FOR SELECT
        TO authenticated
        USING (true);
    CREATE POLICY "authenticated users can insert payments"
        ON payments
        FOR INSERT
        TO authenticated
        WITH CHECK (true);
    CREATE POLICY "authenticated users can update payments"
        ON payments
        FOR UPDATE
        TO authenticated
        USING (true)
        WITH CHECK (true);

    GRANT SELECT, INSERT, UPDATE, DELETE
        ON payments TO authenticated;

    GRANT SELECT, INSERT, UPDATE, DELETE
        ON payments TO service_role;


