# Sample vendor refresh

Covers: `supabase/migrations/20261117180000_refresh_sample_vendors_from_bills.sql`, `supabase/scripts/sample_vendors_reseed.sql`

## Current view

DC-109 refreshes ten vendors from `sample_bills.zip`: base portal URLs and Card/ACH
support. It matches names case-insensitively, preserves IDs and relationships, and
inserts missing vendors. Existing contacts, credentials, logos and unrelated vendors
are retained.

Missing required contacts get synthetic `.invalid` emails, placeholder addresses and
555-01xx phone numbers. Customer addresses and invoice-specific links aren't vendor data.

## Lessons

- Fill missing contacts during the upsert to satisfy existing constraints.
- Upserts may advance sequences; existing IDs remain unchanged.
- `sample_vendors_reseed.sql` tests preservation, missing vendors and repeat runs
  against local Supabase, then rolls back. Sequence advancement isn't rolled back.

Run the test with `psql <local-db-url> -X -v ON_ERROR_STOP=1 -f supabase/scripts/sample_vendors_reseed.sql`.

## History

- 2026-11-17: Added migration and rollback-only test on DC-109.
