CREATE TABLE payment_methods (
    payment_id SERIAL PRIMARY KEY,
    payment_type VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    billing_zip VARCHAR(10),

    CONSTRAINT valid_payment_type
        CHECK (payment_type IN ('card', 'bank'))
);

ALTER TABLE payment_methods
ENABLE ROW LEVEL SECURITY;

INSERT INTO payment_methods (payment_type, name, billing_zip)
VALUES
    ('card', 'Alder Creek Demo Card', '75201'),
    ('bank', 'Brightwater Demo Bank Account', '76102'),
    ('card', 'Copper Ridge Demo Card', '76010'),
    ('bank', 'Northline Demo Bank Account', '75060'),
    ('card', 'Sunmeadow Demo Card', '75006');

SELECT * FROM payment_methods
ORDER BY payment_id;