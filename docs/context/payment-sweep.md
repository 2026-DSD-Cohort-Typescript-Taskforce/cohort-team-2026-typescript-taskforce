# Hourly payment sweep

Covers: `supabase/functions/bill-mcp/handle.ts`, `supabase/functions/bill-mcp/index.ts`, `supabase/migrations/20261118230000_pay_approved_hourly.sql`, `supabase/migrations/20261118230200_authorize_approved_payment.sql`

Last changed by AI: 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · files: supabase/functions/bill-mcp/handle.ts, supabase/functions/bill-mcp/index.ts

## Current view

The hourly cron authenticates only with bill-mcp's service secret. bill-mcp lists pending bills through the service client and deterministically runs the existing payment pipeline for each one; no model decides whether to call it. Each attempt is prepared for the latest real approver, and the service-only `authorize_approved_payment` function rechecks that the newest approval is approved before assigning that approver as `authorized_by`. No user access token is stored in Vault.

## Lessons

- 2026-11-18 · run 8aec00f7: The sweep calls the existing payment tool. It does not reopen `canRecord`, because that path would pay and then fail to record.

## History

### 2026-11-18 · run b308e613-bf1c-4665-a079-b7baf9b3bbc6 · Make execute_approved_payment claim a payment attempt before charging, record the outcome with the…

**Changed:** execute_approved_payment now prepares, authorizes, and starts an attempt before /execute, then records the outcome with the live record_payment. A confirmed receipt uses the attempt idempotency key. canRecord is on only when the service client exists. The hour still asks the agent. The signed-in user must be allowed to authorize, and a missing portal reference falls back to the attempt key.
**Learned:** The charge waits for start_payment_submission. The receipt waits for a success row. The authorizing user must be a billing operator, financial approver, or system admin.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run b308e613-bf1c-4665-a079-b7baf9b3bbc6 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:cae024a1ae6586b68b102fff6590cbf04465b3e94af184cbe95353409e0df297, supabase/functions/bill-mcp/index.ts@sha256:ce59ec08be5877bd781c967c0f68a2181d30d133a92936d89a215238a9e27fd8

### 2026-11-18 · run 111388b7-1ae4-4138-9875-04ae50872341 · Make the hourly bill-mcp sweep ask agent-bills to pay each pending bill, so the agent calls execute…

**Changed:** The hourly sweep now asks agent-bills to pay each pending bill. The agent is the caller of execute_approved_payment. canRecord stays false, so that call still does not charge. The model can skip the tool.
**Learned:** The hour lists bills and the agent pays them. canRecord and the model remain limits.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run 111388b7-1ae4-4138-9875-04ae50872341 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:2127fca435fece23060c9f1ded6c71f67c5d85e0b53e0ae6de1f633379333dbb, supabase/functions/bill-mcp/index.ts@sha256:f07686ed6879252378ab253f398e564f7215e0dc682328d2499dc2584fade4b3

### 2026-11-18 · run c26e1cdf-c8fb-414f-985a-da15f8d09d03 · Let the hourly Supabase cron call bill-mcp, which pays each pending_payment bill through the existi…

**Changed:** bill-mcp now accepts sweep_approved_payments for the hourly cron and calls executeApprovedPayment once per pending_payment bill. The method is not an agent tool. canRecord stays false, so the calls stop before /execute. The cron row is in the migration and is not installed until the database can create pg_cron and the vault secrets exist.
**Learned:** The hourly sweep is an unlisted bill-mcp method. It does not reopen canRecord, and the cron depends on vault secrets.
**Decisive check:** Planned commands: node --run lint; node --run typecheck; node --run format:check. Final outcomes are not yet claimed; inspect run c26e1cdf-c8fb-414f-985a-da15f8d09d03 command receipts separately. Local receipts may not travel with source.
**Files:** supabase/functions/bill-mcp/handle.ts@sha256:22d9b19fce20733e2e67defd93a6b70a1389ae57eb3ba83dfe451f3f700ffb4a, supabase/migrations/20261118150000_pay_approved_hourly.sql@sha256:dbed76b150092f4d92fab0633edfd8c0b4ecfceb36a3c86621d802137db84d03
