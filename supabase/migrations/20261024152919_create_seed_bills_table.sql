CREATE TABLE bills (
    bill_id SERIAL PRIMARY KEY,
    amount NUMERIC(12, 2) NOT NULL,

    property_id INTEGER REFERENCES properties(property_id),
    vendor_id INTEGER REFERENCES vendors(vendor_id),
    user_id BIGINT REFERENCES users(id),
    payment_id INTEGER REFERENCES payment_methods(payment_id),

    date_due DATE,
    invoice_number VARCHAR(255),
    date_issued TIMESTAMP,
    date_received TIMESTAMP,
    date_paid TIMESTAMP,

    status VARCHAR(50),
    pdf_path VARCHAR(500),

    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    modified_at TIMESTAMP,

    CONSTRAINT bills_vendor_invoice_unique
        UNIQUE (vendor_id, invoice_number)
);

GRANT SELECT ON bills TO anon;

ALTER TABLE bills
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bills table is public"
    ON bills
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "authenticated users can insert bills"
    ON bills
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "authenticated users can update bills"
    ON bills
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON bills TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON bills TO service_role;

-- Insert mock bills.
-- Dates are relative to the day this script runs.
INSERT INTO bills (
    amount,
    property_id,
    vendor_id,
    invoice_number,
    date_issued,
    date_due,
    date_paid,
    status
)
VALUES
    -- Overdue
    (
        186.42,
        (SELECT property_id FROM properties
         WHERE property_name = 'Alder Creek Workshop'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Alder Creek Landscaping'),
        'BILL-1001',
        CURRENT_DATE - 30,
        CURRENT_DATE - 10,
        NULL,
        'unpaid'
    ),

    -- Due soon
    (
        324.16,
        (SELECT property_id FROM properties
         WHERE property_name = 'Brightwater Print Studio'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Brightwater Water & Sewer'),
        'BILL-1001',
        CURRENT_DATE - 10,
        CURRENT_DATE + 7,
        NULL,
        'unpaid'
    ),

    -- Due later
    (
        518.70,
        (SELECT property_id FROM properties
         WHERE property_name = 'Copper Ridge Fabrication'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Copper Ridge Waste Services'),
        'BILL-1001',
        CURRENT_DATE - 5,
        CURRENT_DATE + 20,
        NULL,
        'unpaid'
    ),

    -- Paid before the due date
    (
        279.95,
        (SELECT property_id FROM properties
         WHERE property_name = 'Northline Logistics'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Northline Business Internet'),
        'BILL-1001',
        CURRENT_DATE - 35,
        CURRENT_DATE - 15,
        CURRENT_DATE - 18,
        'paid'
    ),

    -- Due soon
    (
        143.28,
        (SELECT property_id FROM properties
         WHERE property_name = 'Sunmeadow Bakery'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Sunmeadow Cleaning'),
        'BILL-1001',
        CURRENT_DATE - 12,
        CURRENT_DATE + 4,
        NULL,
        'unpaid'
    ),

    -- Paid on the due date
    (
        206.54,
        (SELECT property_id FROM properties
         WHERE property_name = 'Cedar Valley Market'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Cedar Valley Pest Control'),
        'BILL-1001',
        CURRENT_DATE - 50,
        CURRENT_DATE - 30,
        CURRENT_DATE - 30,
        'paid'
    ),

    -- Overdue
    (
        392.08,
        (SELECT property_id FROM properties
         WHERE property_name = 'Harborlight Design Co.'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Harborlight Security'),
        'BILL-1001',
        CURRENT_DATE - 28,
        CURRENT_DATE - 3,
        NULL,
        'unpaid'
    ),

    -- Due today
    (
        461.33,
        (SELECT property_id FROM properties
         WHERE property_name = 'Prairie Grid Supply'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Prairie Grid HVAC Services'),
        'BILL-1001',
        CURRENT_DATE - 20,
        CURRENT_DATE,
        NULL,
        'unpaid'
    ),

    -- Paid after the due date
    (
        168.79,
        (SELECT property_id FROM properties
         WHERE property_name = 'Maple Junction Books'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Maple Junction Storage'),
        'BILL-1001',
        CURRENT_DATE - 40,
        CURRENT_DATE - 20,
        CURRENT_DATE - 17,
        'paid'
    ),

    -- Due later
    (
        287.61,
        (SELECT property_id FROM properties
         WHERE property_name = 'Summit Trail Outfitters'),
        (SELECT vendor_id FROM vendors
         WHERE vendor_name = 'Summit Trail Equipment Rental'),
        'BILL-1001',
        CURRENT_DATE - 2,
        CURRENT_DATE + 28,
        NULL,
        'unpaid'
    );
