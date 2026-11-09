-- Author:          Jared Crow
-- Date Created:    11/6/26
-- Date Finished:   11/6/26
-- Ticket:          DC-53 Create "approvals" and "payments" Table, Test Data Rest API endpoints
-- Description:     This file re-populates the tables that were truncated in update_not_nulls.
--                  Also changes some variables back to nullable to prevent errors.


-- A bill may not have the right path yet:
ALTER table bills
    ALTER COLUMN pdf_path DROP NOT NULL;

-- A password can be null if not set yet, so the user can reset it:
ALTER table users
    ALTER COLUMN auth_user_id DROP NOT NULL;

    -- An approval can be submitted but not approved yet:
ALTER table approvals
    ALTER COLUMN approved_by DROP NOT NULL;

-- Seed users:
INSERT INTO users
(user_id, created_at, updated_at, name, phone, email, role, property_id, auth_user_id)
VALUES
(6,'2026-11-06T11:41:58.258538-06:00','2026-11-06T11:41:58.258538-06:00','Alex Morgan','(494) 676-9576','alex.morgan@example.com','billing_operator',1,NULL),
(7,'2026-11-06T11:41:58.258538-06:00','2026-11-06T11:41:58.258538-06:00','Jordan Lee','(239) 739-6861','jordan.lee@example.com','billing_operator',2,NULL),
(8,'2026-11-06T11:41:58.258538-06:00','2026-11-06T11:41:58.258538-06:00','Taylor Brooks','(641) 513-1367','taylor.brooks@example.com','billing_operator',3,NULL),
(9,'2026-11-06T11:41:58.258538-06:00','2026-11-06T11:41:58.258538-06:00','Casey Rivera','(680) 629-1004','casey.rivera@example.com','billing_operator',4,NULL),
(10,'2026-11-06T11:41:58.258538-06:00','2026-11-06T11:41:58.258538-06:00','Morgan Ellis','(491) 444-8489','morgan.ellis@example.com','billing_operator',5,NULL),
(11,'2026-11-06T11:41:58.258538-06:00','2026-11-06T11:41:58.258538-06:00','Jane Doe','(420) 574-1622','jane.doe@example.com','billing_operator',1,NULL),
(12,'2026-11-06T11:41:58.258538-06:00','2026-11-06T11:41:58.258538-06:00','Joe Gallego','(903) 529-1637','josephjgallego@gmail.com','billing_operator',1,NULL);

-- Seed bills:
INSERT INTO bills
(bill_id, amount, property_id, vendor_id, user_id, payment_id,
 date_due, invoice_number, date_issued, date_received, date_paid,
 status, pdf_path, created_at, updated_at)
VALUES
    (1,186.42,1,1,6,1,      '2026-10-19','BILL-1001','2026-09-29','2026-10-29T06:26:09.641',NULL,           'pending_payment',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (2,324.16,2,2,7,2,      '2026-11-05','BILL-1001','2026-10-19','2026-10-29T06:26:09.641',NULL,           'pending_payment',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (3,518.70,3,3,8,3,      '2026-11-18','BILL-1001','2026-10-24','2026-10-29T06:26:09.641',NULL,           'pending_payment',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (4,279.95,4,4,9,4,      '2026-10-14','BILL-1001','2026-09-24','2026-10-29T06:26:09.641','2026-10-11',   'payment_success',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (5,143.28,5,5,10,5,     '2026-11-02','BILL-1001','2026-10-17','2026-10-29T06:26:09.641',NULL,           'pending_payment',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (6,206.54,6,6,11,1,     '2026-09-29','BILL-1001','2026-09-09','2026-10-29T06:26:09.641','2026-09-29',   'payment_success',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (7,392.08,7,7,12,2,     '2026-10-26','BILL-1001','2026-10-01','2026-10-29T06:26:09.641',NULL,           'pending_payment',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (8,461.33,8,8,6,3,      '2026-10-29','BILL-1001','2026-10-09','2026-10-29T06:26:09.641',NULL,           'pending_payment',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (9,168.79,9,9,7,4,      '2026-10-09','BILL-1001','2026-09-19','2026-10-29T06:26:09.641','2026-10-12',   'payment_success',NULL,'2026-11-06T11:41:58.258538-06:00',NULL),
    (10,287.61,10,10,8,5,   '2026-11-26','BILL-1001','2026-10-27','2026-10-29T06:26:09.641',NULL,           'pending_payment',NULL,'2026-11-06T11:41:58.258538-06:00',NULL);


-- Seed cards:
INSERT INTO cards
(payment_id, card_brand, card_number, cvc, exp_date, is_credit, created_at)
VALUES
(1,'Visa','2380638292985421','684','2028-12-31',TRUE,'2026-11-06T11:41:58.258538-06:00'),
(3,'Mastercard','5651393167954164','251','2029-06-30',FALSE,'2026-11-06T11:41:58.258538-06:00'),
(5,'Visa','4871335678079886','796','2029-10-31',TRUE,'2026-11-06T11:41:58.258538-06:00');

-- Seed bank accounts:
INSERT INTO bank_accounts
(payment_id, bank_name, account_number, routing_number, created_at)
VALUES
(2,'Demo Community Bank','172502372402','608870065','2026-11-06T11:41:58.258538-06:00'),
(4,'Demo First Bank','214981670266','471544710','2026-11-06T11:41:58.258538-06:00');


-- Seed approvals:
INSERT INTO approvals
(bill_id, submitted_by, approved_by, status, time_approved, created_at, notes)
VALUES
(1, 6, NULL, 'pending', NULL, '2026-11-06T11:41:58.258538-06:00', 'Awaiting manager approval'),
(2, 7, 11, 'approved', '2026-11-06T13:18:22.014532-06:00', '2026-11-06T12:55:41.182931-06:00', 'Approved for payment'),
(3, 8, 12, 'approved', '2026-11-06T14:04:09.745611-06:00', '2026-11-06T13:40:56.993452-06:00', 'Verified against vendor invoice'),
(4, 9, 11, 'rejected', '2026-11-06T15:11:37.228104-06:00', '2026-11-06T14:48:12.560841-06:00', 'Invoice total does not match'),
(5, 10, NULL, 'pending', NULL, '2026-11-06T15:32:49.671254-06:00', 'Waiting on supervisor review');


-- Seed payments:
INSERT INTO payments
(bill_id, status, time_paid, created_at, notes)
VALUES
(2, 'pending', NULL,
 '2026-11-06T13:18:40.581923-06:00', 'Queued for payment'),
(3, 'processing', NULL, '2026-11-06T14:05:12.409173-06:00', 'ACH transfer initiated'),
(6, 'success', '2026-11-06T10:27:18.842117-06:00', '2026-11-06T09:58:47.390264-06:00', 'Payment completed successfully'),
(9, 'failure', '2026-11-06T11:46:02.127546-06:00', '2026-11-06T11:20:19.553671-06:00', 'Bank rejected transaction'),
(10, 'pending', NULL, '2026-11-06T15:51:28.804915-06:00', 'Awaiting nightly payment batch');



-- Make sure the id in each table will start at the next number instead of 1:
SELECT setval(
    pg_get_serial_sequence('bills', 'bill_id'),
    (SELECT MAX(bill_id) FROM bills)
);
SELECT setval(
    pg_get_serial_sequence('users', 'user_id'),
    (SELECT MAX(user_id) FROM users)
);
SELECT setval(
    pg_get_serial_sequence('cards', 'payment_id'),
    (SELECT MAX(user_id) FROM users)
);
SELECT setval(
    pg_get_serial_sequence('bank_accounts', 'payment_id'),
    (SELECT MAX(user_id) FROM users)
);
SELECT setval(
    pg_get_serial_sequence('approvals', 'approval_id'),
    (SELECT MAX(user_id) FROM users)
);
SELECT setval(
    pg_get_serial_sequence('payments', 'payment_id'),
    (SELECT MAX(user_id) FROM users)
);
