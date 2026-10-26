CREATE TABLE audit_logs (
    audit_log_id SERIAL PRIMARY KEY,

    user_id BIGINT REFERENCES users(id),
    bill_id INTEGER REFERENCES bills(bill_id),

    action VARCHAR(100) NOT NULL,
    description TEXT,

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE audit_logs
ENABLE ROW LEVEL SECURITY;

INSERT INTO audit_logs (
    user_id,
    bill_id,
    action,
    description,
    created_at
)
VALUES
    (
        (SELECT id FROM users
         WHERE user_email = 'alex.morgan@example.com'),
        (SELECT bills.bill_id
         FROM bills
         JOIN vendors ON bills.vendor_id = vendors.vendor_id
         WHERE vendors.vendor_name = 'Alder Creek Landscaping'
           AND bills.invoice_number = 'BILL-1001'),
        'bill_created',
        'Created the Alder Creek bill.',
        CURRENT_TIMESTAMP - INTERVAL '30 days'
    ),
    (
        (SELECT id FROM users
         WHERE user_email = 'jordan.lee@example.com'),
        (SELECT bills.bill_id
         FROM bills
         JOIN vendors ON bills.vendor_id = vendors.vendor_id
         WHERE vendors.vendor_name = 'Brightwater Water & Sewer'
           AND bills.invoice_number = 'BILL-1001'),
        'bill_created',
        'Created the Brightwater bill.',
        CURRENT_TIMESTAMP - INTERVAL '10 days'
    ),
    (
        (SELECT id FROM users
         WHERE user_email = 'casey.rivera@example.com'),
        (SELECT bills.bill_id
         FROM bills
         JOIN vendors ON bills.vendor_id = vendors.vendor_id
         WHERE vendors.vendor_name = 'Northline Business Internet'
           AND bills.invoice_number = 'BILL-1001'),
        'bill_paid',
        'Recorded payment for the Northline bill.',
        CURRENT_TIMESTAMP - INTERVAL '18 days'
    ),
    (
        (SELECT id FROM users
         WHERE user_email = 'morgan.ellis@example.com'),
        (SELECT bills.bill_id
         FROM bills
         JOIN vendors ON bills.vendor_id = vendors.vendor_id
         WHERE vendors.vendor_name = 'Sunmeadow Cleaning'
           AND bills.invoice_number = 'BILL-1001'),
        'bill_created',
        'Created the Sunmeadow bill.',
        CURRENT_TIMESTAMP - INTERVAL '12 days'
    );

SELECT
    audit_logs.audit_log_id,
    audit_logs.action,
    audit_logs.description,
    audit_logs.created_at,
    users.user_name,
    bills.invoice_number,
    vendors.vendor_name
FROM audit_logs
LEFT JOIN users ON audit_logs.user_id = users.id
LEFT JOIN bills ON audit_logs.bill_id = bills.bill_id
LEFT JOIN vendors ON bills.vendor_id = vendors.vendor_id
ORDER BY audit_logs.created_at DESC;