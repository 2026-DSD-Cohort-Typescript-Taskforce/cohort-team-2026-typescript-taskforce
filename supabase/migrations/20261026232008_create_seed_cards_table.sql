CREATE TABLE cards (
    payment_id INTEGER PRIMARY KEY
        REFERENCES payment_methods(payment_id),

    card_brand VARCHAR(50),
    last_four VARCHAR(4) NOT NULL,
    exp_date DATE,
    is_credit BOOLEAN,

    CONSTRAINT valid_last_four
        CHECK (last_four ~ '^[0-9]{4}$')
);

ALTER TABLE cards
ENABLE ROW LEVEL SECURITY;

INSERT INTO cards (
    payment_id,
    card_brand,
    last_four,
    exp_date,
    is_credit
)
VALUES
    (
        (SELECT payment_id FROM payment_methods
         WHERE name = 'Alder Creek Demo Card'),
        'Visa',
        '4242',
        '2028-12-31',
        true
    ),
    (
        (SELECT payment_id FROM payment_methods
         WHERE name = 'Copper Ridge Demo Card'),
        'Mastercard',
        '4444',
        '2029-06-30',
        false
    ),
    (
        (SELECT payment_id FROM payment_methods
         WHERE name = 'Sunmeadow Demo Card'),
        'Visa',
        '1111',
        '2029-10-31',
        true
    );

SELECT
    payment_methods.payment_id,
    payment_methods.name,
    cards.card_brand,
    cards.last_four,
    cards.exp_date,
    cards.is_credit
FROM cards
JOIN payment_methods
    ON cards.payment_id = payment_methods.payment_id
ORDER BY payment_methods.payment_id;