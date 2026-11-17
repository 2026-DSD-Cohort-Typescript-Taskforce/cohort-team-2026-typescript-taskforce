# Demo payment portal

Covers: client/app/demo/payments, client/lib/demo-payment.ts, client/test-fixtures

## Current view

The public Next.js route `/demo/payments` is a synthetic vendor checkout. It uses one
fixed invoice (INV-7, USD 125.00, demo bill 7/vendor 9) and exact bank fixture strings.
The browser simulates confirmation without any network payment, Supabase write, approval,
or bill status change. Stable review and receipt IDs are documented in
`docs/demo-payment-portal.md` for the DC-95 operator profile.

A synchronous ref guards repeated submissions; the Pay control remains disabled until
browser receipt recovery completes. sessionStorage retains only validated receipt metadata
for reloads in the same tab. It is not a payment ledger or durable idempotency boundary.
The Stagehand worker must retain its own durable idempotency enforcement.

## Lessons

- The public demo route is outside the app authentication proxy matcher, so a fresh browser
  can visit it. Existing bill pages continue to handle the application's approval workflow.
- Keep synthetic account numbers as strings, preserving leading zeroes. Only the supplied
  fixture is accepted; do not use live financial data.
- Root layout constrains body height; the route owns a scrollable main area for phone use.
- Unit tests cover fixture validation and malformed/mismatched receipt recovery. Browser
  checks must cover real checkout, reload and mobile reflow separately.

## History

- 2026-11-16: Added the demo browser target on DC-96. The DC-95 worker and bill-mcp
  integration remain separate. No live payment or database behavior was added.

Verification: all 168 client tests, root lint and server typecheck, and client TypeScript
check passed. Local Chrome exercised invalid fixture rejection, repeated Pay clicks,
matching confirmation, same-tab refresh recovery, reset, 390px reflow and input labels.
Desktop and phone screenshots were inspected. The full bill-mcp/worker service chain was
not exercised on this branch. Full-repository formatting remains blocked by unrelated files;
changed files pass Prettier. The CYC run halted on generated Next.js AGENTS changes,
which were removed from this diff; no completed CYC delivery is claimed.
