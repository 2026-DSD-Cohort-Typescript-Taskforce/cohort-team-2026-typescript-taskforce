ALTER TABLE users
ADD COLUMN property_id INTEGER REFERENCES properties(property_id),
ADD COLUMN user_phone VARCHAR(255);

INSERT INTO users (user_name, user_email, user_role, property_id)
VALUES
    (
        'Alex Morgan',
        'alex.morgan@example.com',
        'billing_operator',
        (SELECT property_id FROM properties
         WHERE property_name = 'Alder Creek Workshop')
    ),
    (
        'Jordan Lee',
        'jordan.lee@example.com',
        'billing_operator',
        (SELECT property_id FROM properties
         WHERE property_name = 'Brightwater Print Studio')
    ),
    (
        'Taylor Brooks',
        'taylor.brooks@example.com',
        'billing_operator',
        (SELECT property_id FROM properties
         WHERE property_name = 'Copper Ridge Fabrication')
    ),
    (
        'Casey Rivera',
        'casey.rivera@example.com',
        'billing_operator',
        (SELECT property_id FROM properties
         WHERE property_name = 'Northline Logistics')
    ),
    (
        'Morgan Ellis',
        'morgan.ellis@example.com',
        'billing_operator',
        (SELECT property_id FROM properties
         WHERE property_name = 'Sunmeadow Bakery')
    );

SELECT
    users.id,
    users.user_name,
    users.user_email,
    users.user_role,
    users.property_id,
    properties.property_name
FROM users
LEFT JOIN properties ON users.property_id = properties.property_id
ORDER BY users.id;