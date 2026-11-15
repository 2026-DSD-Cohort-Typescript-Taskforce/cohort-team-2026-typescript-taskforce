-- Author:          Jared Crow
-- Date Created:    11/9/26
-- Date Updated:    11/12/26
-- Ticket:          DC-86 Update the foreign keys in the users table to be a list of ids in each row.
-- Description:     This file makes the following changes to the database:
--                      _X_ Create the tables user_properties and user_vendors (and set their permissions).
--                      _X_ Remove the foreign key property_id from users (read below for reason why).
--                      _X_ Constrain the role attribute in the users table to the following 3 values:
--                          - viewer,               (read-only)
--                          - billing_operator,
--                          - financial_approver,
--                          - system_admin.
--                      _X_ Add an extra status to bills for when AI fails to insert a bill.


-- The original plan was to simply change the foreign keys in users from int4 to lists.
-- However, you can't have foreign keys be lists in a 3NF database.
-- So instead, I have to create 2 new conjunction tables (user_properties and user_vendors) to represent the many-to-many relationship:

-- This table represents the many-to-many relationship between users and properties.
-- The primary key is a tuple of two foreign keys to link any user to any property.
CREATE TABLE user_properties (
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    property_id INTEGER NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,

    PRIMARY KEY (user_id, property_id)
);
INSERT INTO user_properties (user_id, property_id)
    VALUES
        (6, 1),
        (6, 2),
        (7, 2),
        (7, 3),
        (8, 3),
        (9, 4),
        (10, 5),
        (11, 1),
        (12, 1);


-- Same story here, but representing a relationship between users and vendors instead:
CREATE TABLE user_vendors (
    user_id BIGINT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    vendor_id INTEGER NOT NULL REFERENCES vendors(vendor_id) ON DELETE CASCADE,

    PRIMARY KEY (user_id, vendor_id)
);
INSERT INTO user_vendors (user_id, vendor_id)
    VALUES
        (6, 2),
        (6, 7),
        (7, 3),
        (8, 7),
        (9, 8),
        (10, 1),
        (10, 9),
        (11, 5),
        (12, 1),
        (12, 2);

-- Restricting access to the new tables:
    -- Lock down the junction tables the same way users is: signed-in users can read, nobody can write through the API.
    ALTER TABLE user_properties ENABLE ROW LEVEL SECURITY;
    ALTER TABLE user_vendors    ENABLE ROW LEVEL SECURITY;

    -- Make sure even before RLS is considered, neither role has permission to do anything with these tables before specified:
    REVOKE ALL ON TABLE user_properties, user_vendors FROM anon, authenticated;
    GRANT SELECT ON TABLE user_properties, user_vendors TO authenticated;

    -- Permissions for the new tables:
    CREATE POLICY "Authenticated users can read user_properties"
        ON user_properties FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Authenticated users can read user_vendors"
        ON user_vendors FOR SELECT TO authenticated USING (true);
    CREATE POLICY "Authenticated users can insert into user_properties"
        ON user_properties FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Authenticated users can insert into user_vendors"
        ON user_vendors FOR INSERT TO authenticated WITH CHECK (true);
    CREATE POLICY "Authenticated users can update user_properties"
        ON user_properties FOR UPDATE TO authenticated WITH CHECK (true);
    CREATE POLICY "Authenticated users can update user_vendors"
        ON user_vendors FOR UPDATE TO authenticated WITH CHECK (true);


-- And since we have the above tables, property_id in users is no longer needed:
-- Also adding a constraint to an existing attribute in users:
ALTER TABLE users 
    DROP COLUMN property_id,
    ADD CONSTRAINT role 
        CHECK (
            role IN (
                'viewer',               --  <- A read-only role.
                'billing_operator',     --  <- Can submit bills, but not approve.
                'financial_approver',   --  <- Can submit and approve bills.
                'system_admin'          --  <- All from above, plus has database editing permissions.
            )
        );


-- In order to alter the status constraints in bills, I need to remove and re-declare it: 
ALTER TABLE bills
    DROP    CONSTRAINT bills_status_check,
    ADD     CONSTRAINT bills_status_check
    CHECK (
        status IN (
            'draft', 
            'not_enough_info',
            'pending_approval', 
            'approval_denied', 
            'pending_payment',
            'processing', 
            'payment_success', 
            'payment_failed'
        )
    );