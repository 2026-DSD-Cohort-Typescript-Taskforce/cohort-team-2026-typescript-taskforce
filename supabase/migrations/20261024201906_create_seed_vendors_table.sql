CREATE TABLE vendors (
    vendor_id SERIAL PRIMARY KEY,
    vendor_name VARCHAR NOT NULL,
    vendor_address VARCHAR,
    contact_name VARCHAR,
    vendor_phone VARCHAR,
    payment_portal_url VARCHAR,
    supported_payment_methods VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

GRANT SELECT ON vendors TO anon;

ALTER TABLE vendors
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "vendors table is public"
    ON vendors
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "authenticated users can insert vendors"
    ON vendors
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "authenticated users can update vendors"
    ON vendors
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON vendors TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON vendors TO service_role;

INSERT INTO vendors (
    vendor_name,
    payment_portal_url,
    supported_payment_methods
)
VALUES
    (
        'Alder Creek Landscaping',
        'https://alder-creek-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Brightwater Water & Sewer',
        'https://brightwater-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Copper Ridge Waste Services',
        'https://copper-ridge-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Northline Business Internet',
        'https://northline-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Sunmeadow Cleaning',
        'https://sunmeadow-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Cedar Valley Pest Control',
        'https://cedar-valley-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Harborlight Security',
        'https://harborlight-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Prairie Grid HVAC Services',
        'https://prairie-grid-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Maple Junction Storage',
        'https://maple-junction-utility-demo.vercel.app',
        'Card, ACH'
    ),
    (
        'Summit Trail Equipment Rental',
        'https://summit-trail-utility-demo.vercel.app',
        'Card, ACH'
    );