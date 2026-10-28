CREATE TABLE properties (
    property_id SERIAL PRIMARY KEY,
    property_name VARCHAR NOT NULL,
    property_address VARCHAR,
    property_phone VARCHAR,
    property_email VARCHAR,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

GRANT SELECT ON properties TO anon;

ALTER TABLE properties
ENABLE ROW LEVEL SECURITY;

CREATE POLICY "properties table is public"
    ON properties
    FOR SELECT
    TO anon, authenticated
    USING (true);

CREATE POLICY "authenticated users can insert properties"
    ON properties
    FOR INSERT
    TO authenticated
    WITH CHECK (true);

CREATE POLICY "authenticated users can update properties"
    ON properties
    FOR UPDATE
    TO authenticated
    USING (true)
    WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE
    ON properties TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
    ON properties TO service_role;

INSERT INTO properties (property_name, property_address)
VALUES
    ('Alder Creek Workshop', '125 Industrial Way, Dallas, TX 75201'),
    ('Brightwater Print Studio', '420 Commerce Street, Fort Worth, TX 76102'),
    ('Copper Ridge Fabrication', '3100 Manufacturing Drive, Arlington, TX 76010'),
    ('Northline Logistics', '850 Distribution Parkway, Irving, TX 75060'),
    ('Sunmeadow Bakery', '215 Main Street, Carrollton, TX 75006'),
    ('Cedar Valley Market', '680 Market Boulevard, Plano, TX 75074'),
    ('Harborlight Design Co.', '1420 Creative Lane, Frisco, TX 75034'),
    ('Prairie Grid Supply', '2750 Supply Road, Richardson, TX 75081'),
    ('Maple Junction Books', '530 Oak Street, Denton, TX 76201'),
    ('Summit Trail Outfitters', '990 Trailhead Drive, Lewisville, TX 75057');
