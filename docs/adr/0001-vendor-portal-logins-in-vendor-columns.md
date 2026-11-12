# Vendor portal logins are stored in vendor columns

Status: accepted, 2026-11-11

The payment side needs each vendor's pay-online username and password, and extraction reads them from bills. We store them in `vendors.portal_username` and `vendors.portal_password` as plain text.

The alternative was Supabase Vault with a reference column, which encrypts the login and only lets a server-side function read it. We chose plain columns to keep the first version simple and to avoid adding tables.

Consequences: `vendors` is readable by signed-out visitors, so the two columns are hidden from them with column grants. Any signed-in user, and anyone with database or backup access, can still read every login. Only demo logins should be stored until this moves to Vault.
