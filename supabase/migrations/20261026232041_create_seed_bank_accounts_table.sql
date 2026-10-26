CREATE TABLE bank_accounts (
    payment_id INTEGER PRIMARY KEY
        REFERENCES payment_methods(payment_id),

    bank_name VARCHAR(255),
    last_four VARCHAR(4) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT valid_bank_last_four
        CHECK (last_four ~ '^[0-9]{4}$')
);

ALTER TABLE bank_accounts
ENABLE ROW LEVEL SECURITY;

INSERT INTO bank_accounts (
    payment_id,
    bank_name,
    last_four
)
VALUES
    (
        (SELECT payment_id FROM payment_methods
         WHERE name = 'Brightwater Demo Bank Account'),
        'Demo Community Bank',
        '1234'
    ),
    (
        (SELECT payment_id FROM payment_methods
         WHERE name = 'Northline Demo Bank Account'),
        'Demo First Bank',
        '5678'
    );

-- View bank accounts alongside their payment method labels.
SELECT
    payment_methods.payment_id,
    payment_methods.name,
    bank_accounts.bank_name,
    bank_accounts.last_four,
    bank_accounts.created_at
FROM bank_accounts
JOIN payment_methods
    ON bank_accounts.payment_id = payment_methods.payment_id
ORDER BY payment_methods.payment_id;