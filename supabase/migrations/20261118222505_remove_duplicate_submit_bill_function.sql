-- Author:          Jared Crow
-- Date Created:    11/18/26
-- Last Updated:    11/18/26
-- Ticket:          DC-114 Fix System Admin Permissions
-- Description:     Drops a duplicate table.
--                  Why? Because merging PR #66 before DC-114 created a duplicate submit_bill that causes db test to throw an error.

-- 20261118184316 recreated the old one-argument submit_bill(integer) next to
-- 20261118150000's submit_bill(integer, boolean DEFAULT false), which makes
-- submit_bill(id) ambiguous (42725). The two-argument version already allows
-- billing_operator, financial_approver and system_admin, so drop the old one:
DROP FUNCTION IF EXISTS public.submit_bill(integer);
